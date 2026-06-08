"""
Monte Carlo investment-scoring reference implementation (corrected).

WHAT THIS IS
============
A glass-box risk/due-diligence scorer for alternative investments (real estate
first, then VC / private lending / RE hedge funds). For one opportunity it
returns, with confidence intervals:
  (1) P(achieving a target return, e.g. P(IRR >= 20%))
  (2) expected / median return
  (3) downside risk: probability AND SIZE of loss (VaR / CVaR reported as LOSSES)
  (4) a CONFIDENCE level driven by how much COMPARABLE HISTORY backs the estimate
      (n_obs and the width of bootstrapped parameter CIs), NOT by n_sims
  (5) the TOP FACTORS driving the score via a real one-at-a-time sensitivity
      attribution (re-run perturbing each input, rank by impact)
  (6) a suggested POSITION SIZE: risk-budgeted, fractional, capped, correlation-
      aware, advisory only (never auto-commit; 0% for non-positive edge)

HONEST LIMITS (read before trusting any number)
===============================================
* APPRAISAL SMOOTHING (RE): NCREIF appraisal-based returns are serially
  correlated, which compresses observed volatility. Feed UNSMOOTHED data (a
  first-order Geltner de-smoother is provided) or sigma is understated and the
  tail looks too thin. We also flag suspicious lag-1 autocorrelation.
* SURVIVORSHIP / BACKFILL BIAS (Preqin / VC): self-reported fund databases drop
  dead funds and backfill winners, inflating mu and shrinking sigma. There is no
  way to recover the unreported failures from the surviving sample alone; apply
  an explicit, signed haircut (bias_mu / bias_sigma_mult) and document it.
* THIN HISTORY => WIDE CIs: with n=15 the sampling error on mu/sigma dominates
  Monte Carlo noise. We bootstrap the sample to put CIs on EVERY output. n_sims
  only controls MC sampling error, never confidence in mu/sigma.
* SINGLE-STARTUP POWER LAW (VC): a single lognormal cannot represent a book that
  is ~50-65% total losses plus a thin power-law upside. Use 'empirical' bootstrap
  mode (resample real outcomes) or the explicit mixture helper; VC is only
  meaningful at the portfolio level, not per single startup.
* TWR PROXY, NOT IRR: with no interim-cashflow vector this models a single bullet
  (one outflow, one terminal inflow), so the annualized figure is a
  time-weighted return / CAGR, which equals IRR only for a bullet deal. Supply a
  cashflow schedule (irr_from_cashflows) for a true, timing-aware IRR. Outputs
  are labelled 'TWR/IRR (bullet proxy)' accordingly.

INPUT UNITS PER SOURCE (you MUST normalise on ingest)
=====================================================
* NCREIF: quarterly TOTAL returns (decimal, e.g. 0.0192). Pass periods_per_year=4
  to annualize: mu_ann=(1+mu_q)^4 - 1, sigma_ann=sigma_q*sqrt(4). Appraisal-
  smoothed -> de-smooth first.
* Preqin: SINCE-INCEPTION net IRR / TVPI multiple, ONE ROW PER FUND. This is a
  CROSS-SECTIONAL lifetime outcome, NOT a periodic return series. Do NOT feed it
  to the time-series fitter or it gets re-compounded / mis-scaled. Use
  fit_cross_sectional_irr (already-annual, periods_per_year=1, no re-compounding)
  or model the multiple directly.
* RentCast / Zillow: PRICE LEVELS / AVMs, not returns. Convert to returns first
  (prices_to_returns), then annualize by the sampling frequency.

Dependencies: numpy, pandas, scipy only.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import special as sp_special

# Valid periodic simple return domain is (-1, +inf): -100% is a total loss.
_MIN_RETURN = -1.0

# Minimum credible annualized volatility for risk-sizing. Below this a "fitted"
# sigma is degenerate (a constant/near-constant input series, or floating-point
# dust from std() of identical values ~1e-18) rather than a real return
# distribution. Sizing on it explodes Kelly (f* = edge / sigma^2 -> ~1e32) and
# recommends the max position on a zero-information deal -- the exact risk-
# understatement pathology this tool exists to prevent. We ABSTAIN instead.
_SIGMA_FLOOR = 1e-4  # 1 bp annualized; nothing real is below this.


# ----------------------------------------------------------------------------
# Input validation / unit conversion helpers
# ----------------------------------------------------------------------------
def prices_to_returns(prices: np.ndarray) -> np.ndarray:
    """Convert a price/AVM level series (RentCast/Zillow) to simple period returns.

    Guards against the classic units error of feeding raw price levels (e.g.
    $300k) into the return fitter, which silently produces a guaranteed-total-loss
    distribution. Returns r_t = P_t / P_{t-1} - 1.
    """
    prices = np.asarray(prices, dtype=float)
    if prices.ndim != 1 or prices.size < 2:
        raise ValueError("prices_to_returns needs a 1-D series of >= 2 levels.")
    if np.any(prices <= 0):
        raise ValueError("Prices must be strictly positive level values.")
    return prices[1:] / prices[:-1] - 1.0


def _validate_returns(returns: np.ndarray, min_obs: int = 2) -> np.ndarray:
    """Validate a periodic SIMPLE-return series before fitting.

    Fails loudly on the wrong-units / empty / degenerate inputs that the original
    code digested silently (empty -> NaN, prices -> Expected IRR = -1, TVPI -> a
    98%-go fantasy). Returns must lie in (-1, +inf).
    """
    returns = np.asarray(returns, dtype=float)
    if returns.ndim != 1:
        raise ValueError("Return series must be 1-D.")
    if returns.size < min_obs:
        raise ValueError(f"Need >= {min_obs} observations, got {returns.size}.")
    if not np.all(np.isfinite(returns)):
        raise ValueError("Return series contains non-finite values (NaN/inf).")
    if np.any(returns <= _MIN_RETURN):
        raise ValueError(
            "Returns must be simple returns in (-1, +inf). Values <= -1 (or huge "
            "values that look like price LEVELS / TVPI multiples) were supplied. "
            "If these are prices, call prices_to_returns first; if TVPI/IRR rows, "
            "use fit_cross_sectional_irr."
        )
    # Heuristic units smell-test on the MEDIAN (not the max): a few large values are
    # a legitimate fat upper tail (VC), but a whole series whose TYPICAL value is in
    # the hundreds/thousands is mislabeled price LEVELS or TVPI multiples. Using the
    # median avoids vetoing a real power-law tail while still catching the units bug.
    if np.median(np.abs(returns)) > 10.0:
        raise ValueError(
            "Median |return| > 1000% detected; this looks like price levels or "
            "TVPI multiples, not periodic returns. Convert first (prices_to_returns "
            "for levels; fit_cross_sectional_irr for IRR/TVPI rows)."
        )
    return returns


# ----------------------------------------------------------------------------
# De-smoothing (appraisal smoothing in RE)
# ----------------------------------------------------------------------------
def geltner_unsmooth(returns: np.ndarray, a: float | None = None) -> np.ndarray:
    """First-order Geltner/Fisher de-smoother for appraisal-based series.

    r_true_t = (r_obs_t - a * r_obs_{t-1}) / (1 - a), where `a` is the estimated
    lag-1 autocorrelation. Recovers the volatility that appraisal smoothing hides.
    If `a` is None it is estimated from the data; if a<=0 the series is returned
    unchanged (nothing to unsmooth).
    """
    returns = _validate_returns(returns, min_obs=3)
    if a is None:
        a = lag1_autocorr(returns)
    if not (0.0 < a < 0.99):
        return returns.copy()
    return (returns[1:] - a * returns[:-1]) / (1.0 - a)


def lag1_autocorr(returns: np.ndarray) -> float:
    """Lag-1 autocorrelation. Positive => smoothing/momentum (RE appraisal);
    negative => mean reversion. IID assumes this is ~0, so we surface it."""
    r = np.asarray(returns, dtype=float)
    if r.size < 3:
        return 0.0
    r0, r1 = r[:-1], r[1:]
    denom = np.std(r0) * np.std(r1)
    if denom == 0:
        return 0.0
    return float(np.mean((r0 - r0.mean()) * (r1 - r1.mean())) / denom)


# ----------------------------------------------------------------------------
# Distribution fitting (with explicit annualization and honest sigma)
# ----------------------------------------------------------------------------
def fit_distribution(
    returns: np.ndarray,
    periods_per_year: int = 1,
    unbiased_sigma: bool = True,
    verbose: bool = False,
):
    """Fit per-period mu/sigma from a SIMPLE-return time series and annualize.

    Args:
        returns: periodic SIMPLE returns in (-1, +inf). NCREIF quarterly ->
            periods_per_year=4; annual -> 1. NOT for Preqin since-inception IRR.
        periods_per_year: sampling frequency, used to annualize.
        unbiased_sigma: use ddof=1 plus the small-sample c4 bias correction so the
            risk parameter is not optimistically low on thin samples.

    Returns dict with annualized mu/sigma, the n_obs, lag-1 autocorr, and the raw
    de-meaned log returns (needed by the empirical bootstrap mode).
    """
    r = _validate_returns(returns, min_obs=2)
    n = r.size

    # Per-period arithmetic moments.
    mu_p = float(np.mean(r))
    if unbiased_sigma:
        s = float(np.std(r, ddof=1))
        s = s / _c4(n)  # c4 corrects the downward (Jensen) bias of s for sigma.
    else:
        s = float(np.std(r, ddof=0))

    # Annualize arithmetic moments explicitly.
    mu_ann = (1.0 + mu_p) ** periods_per_year - 1.0
    sigma_ann = s * np.sqrt(periods_per_year)

    ac1 = lag1_autocorr(r)
    smoothing_flag = ac1 > 0.2  # appraisal-smoothing / momentum warning threshold

    if verbose:
        print(
            f"Fitted n={n} obs @ {periods_per_year}/yr -> mu_ann={mu_ann:.4f}, "
            f"sigma_ann={sigma_ann:.4f}, lag1_autocorr={ac1:.3f}"
            + ("  [WARN: positive autocorr; consider geltner_unsmooth]" if smoothing_flag else "")
        )

    return {
        "mu": mu_ann,
        "sigma": sigma_ann,
        "n_obs": n,
        "periods_per_year": periods_per_year,
        "lag1_autocorr": ac1,
        "smoothing_flag": smoothing_flag,
        # log returns retained for empirical bootstrap resampling (preserves shape)
        "log_returns": np.log1p(r),
    }


def fit_cross_sectional_irr(irrs: np.ndarray, verbose: bool = False):
    """Fit a CROSS-SECTIONAL distribution of since-inception fund IRRs (Preqin).

    These are ALREADY-ANNUAL lifetime outcomes (one per fund), so there is no
    re-compounding and no frequency scaling: periods_per_year is fixed at 1 and
    the dispersion is cross-fund, not per-period vol. WARNING: such databases are
    survivorship/backfill biased -> apply a haircut downstream.
    """
    irrs = _validate_returns(irrs, min_obs=2)
    out = fit_distribution(irrs, periods_per_year=1, unbiased_sigma=True, verbose=False)
    if verbose:
        print(
            f"Cross-sectional Preqin IRR fit: n={out['n_obs']} funds, "
            f"mu={out['mu']:.4f}, sigma(cross-fund)={out['sigma']:.4f}. "
            f"NOTE: survivorship/backfill biased; apply a haircut."
        )
    return out


def _c4(n: int) -> float:
    """c4 unbiasing constant for the sample SD (E[s] = c4(n) * sigma)."""
    if n < 2:
        return 1.0
    # Use log-gamma to avoid overflow of gamma(n/2) for large n (it -> inf/inf=nan).
    log_ratio = sp_special.gammaln(n / 2.0) - sp_special.gammaln((n - 1) / 2.0)
    return float(np.sqrt(2.0 / (n - 1)) * np.exp(log_ratio))


# ----------------------------------------------------------------------------
# True IRR from a cashflow vector (timing-aware), to escape the TWR proxy
# ----------------------------------------------------------------------------
def irr_from_cashflows(cashflows: np.ndarray) -> float:
    """IRR of a dated cashflow vector cashflows[0..T] (period 0 = initial outflow).

    Solves sum_t CF_t / (1+r)^t = 0 on the sign-changing root. This is the only
    way to get a timing-correct IRR; the Monte Carlo paths below are a bullet/TWR
    proxy unless you wrap them with an explicit cashflow schedule.
    """
    cf = np.asarray(cashflows, dtype=float)
    if cf.ndim != 1 or cf.size < 2 or not (np.any(cf > 0) and np.any(cf < 0)):
        raise ValueError("Cashflows need >= 2 entries with at least one + and one -.")
    # NPV is monotonic in r when there is a single sign change (bullet/standard
    # PE schedule); bisect on the discount rate.
    def npv(rate):
        t = np.arange(cf.size)
        return np.sum(cf / (1.0 + rate) ** t)
    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return float("nan")  # no sign change in bracket -> IRR undefined here
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        f_mid = npv(mid)
        if abs(f_mid) < 1e-10:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return 0.5 * (lo + hi)


# ----------------------------------------------------------------------------
# Core single-asset path simulator (one fit -> one IRR distribution)
# ----------------------------------------------------------------------------
def _simulate_irrs(
    mu: float,
    sigma: float,
    holding_years: int,
    n_sims: int,
    rng: np.random.Generator,
    mode: str = "lognormal",
    log_returns: np.ndarray | None = None,
    block: int = 1,
    periods_per_year: int = 1,
) -> np.ndarray:
    """Return an array of n_sims annualized bullet returns (TWR/CAGR proxy).

    mode='lognormal'  : parametric. Convert ARITHMETIC (mu,sigma) to LOG moments
                        before drawing (the original used arithmetic sigma as the
                        log sigma, overstating tail vol ~28-37% at VC vols).
    mode='empirical'  : non-parametric block bootstrap of real historical LOG
                        returns -> represents fat tails / skew / power-law that a
                        lognormal cannot. Recommended default for thin/skewed data.
    """
    if not np.isfinite(mu) or not np.isfinite(sigma) or sigma < 0:
        raise ValueError(f"Non-finite or negative parameters: mu={mu}, sigma={sigma}")

    if mode == "lognormal":
        # mu/sigma are ANNUALIZED, so we draw `holding_years` annual returns.
        # Arithmetic -> log moment conversion for a lognormal (1+r):
        #   sigma_log^2 = ln(1 + (sigma/(1+mu))^2);  mu_log = ln(1+mu) - 0.5 sigma_log^2
        var_log = np.log1p((sigma / (1.0 + mu)) ** 2) if (1.0 + mu) > 0 else sigma ** 2
        sigma_log = np.sqrt(var_log)
        mu_log = np.log1p(mu) - 0.5 * sigma_log ** 2
        period_logrets = rng.normal(mu_log, sigma_log, size=(n_sims, holding_years))

    elif mode == "empirical":
        if log_returns is None or len(log_returns) == 0:
            raise ValueError("empirical mode needs a non-empty log_returns sample.")
        lr = np.asarray(log_returns, dtype=float)
        # The empirical pool is PER-PERIOD (e.g. quarterly when periods_per_year=4),
        # so a `holding_years`-year hold spans holding_years * periods_per_year draws.
        # (The bug this fixes: drawing only `holding_years` quarterly returns simulated
        # ~1.25 yrs of return but annualized over 5 yrs, crushing the expected return.)
        n_periods = holding_years * max(1, periods_per_year)
        # Block bootstrap preserves short-range serial dependence (autocorrelation /
        # appraisal smoothing) that an IID resample would destroy.
        period_logrets = _block_bootstrap(lr, (n_sims, n_periods), block, rng)
    else:
        raise ValueError("mode must be 'lognormal' or 'empirical'.")

    cum_logret = np.sum(period_logrets, axis=1)
    total_multiplier = np.exp(cum_logret)
    # Bullet annualization: (V_T/V_0)^(1/T) - 1 over T = holding_years. Each branch
    # above produces columns spanning exactly holding_years years, so this is correct
    # for both. This is TWR/CAGR == IRR only for a single in/out bullet; with interim
    # cashflows use irr_from_cashflows instead.
    return total_multiplier ** (1.0 / holding_years) - 1.0


def _block_bootstrap(lr: np.ndarray, shape, block: int, rng: np.random.Generator):
    """Resample `lr` in contiguous blocks of length `block` to fill `shape`."""
    n_rows, n_cols = shape
    block = max(1, min(block, len(lr)))
    if block == 1:
        idx = rng.integers(0, len(lr), size=(n_rows, n_cols))
        return lr[idx]
    out = np.empty((n_rows, n_cols), dtype=float)
    for j in range(0, n_cols, block):
        width = min(block, n_cols - j)
        starts = rng.integers(0, len(lr), size=n_rows)
        # tile a wrapped window so blocks can run off the end of the sample
        cols = (starts[:, None] + np.arange(width)[None, :]) % len(lr)
        out[:, j:j + width] = lr[cols]
    return out


def _adjust_empirical_pool(log_returns, bias_mu_annual: float, sigma_mult: float,
                           periods_per_year: int):
    """Re-center and re-scale an empirical per-period log-return pool to reflect a
    DDQ/analyst view, WITHOUT discarding its shape (skew / fat tails / power-law).

    This is what makes qualitative adjustments actually move the distribution in
    EMPIRICAL mode. Without it, bias_mu / bias_sigma_mult only touched Kelly sizing,
    so a first-time dev sponsor and an institutional core sponsor got an identical
    P(target) and identical downside -- defeating the whole qualitative layer.

    sigma_mult scales dispersion around the pool mean; bias_mu_annual shifts the mean
    so the ANNUALIZED arithmetic return moves by exactly bias_mu_annual. Neutral inputs
    (bias_mu_annual=0, sigma_mult=1) return the pool unchanged (identity).
    """
    lr = np.asarray(log_returns, dtype=float)
    r = np.expm1(lr)                                   # per-period simple returns
    mu_pp = float(np.mean(r))
    r_scaled = mu_pp + sigma_mult * (r - mu_pp)        # scale spread, keep mean
    mu_ann_cur = (1.0 + mu_pp) ** periods_per_year - 1.0
    base = 1.0 + mu_ann_cur + bias_mu_annual
    target_mu_pp = base ** (1.0 / periods_per_year) - 1.0 if base > 0 else mu_pp + bias_mu_annual / periods_per_year
    r_adj = np.clip(r_scaled + (target_mu_pp - mu_pp), -0.999, None)
    return np.log1p(r_adj)


# ----------------------------------------------------------------------------
# Risk metrics from an IRR sample (VaR/CVaR as LOSSES)
# ----------------------------------------------------------------------------
def _risk_metrics(irrs: np.ndarray, target_irr: float, alpha: float = 0.05) -> dict:
    """Compute the score dashboard metrics from one IRR sample.

    VaR/CVaR are reported as LOSS magnitudes (positive number = a loss). A
    non-positive 'loss' means the alpha-quantile outcome still makes money, which
    we surface honestly rather than printing a positive return under a loss label.
    """
    irrs = irrs[np.isfinite(irrs)]
    q = np.percentile(irrs, 100 * alpha)          # alpha-quantile of the RETURN
    tail = irrs[irrs <= q]
    cq = np.mean(tail) if tail.size else q        # conditional mean below quantile

    var_loss = -q                                  # loss = negative of the return
    cvar_loss = -cq
    p_target = float(np.mean(irrs >= target_irr))
    p_loss = float(np.mean(irrs < 0.0))
    return {
        "p_target": p_target,
        "expected": float(np.mean(irrs)),
        "median": float(np.median(irrs)),
        "p_loss": p_loss,
        "var_loss": float(var_loss),    # >0 means a real loss at the alpha tail
        "cvar_loss": float(cvar_loss),  # expected loss given we are in that tail
        "q_return": float(q),           # the raw alpha-quantile return (for clarity)
    }


# ----------------------------------------------------------------------------
# Kelly position sizing (dimensionally consistent, 0 on bad deals, capped)
# ----------------------------------------------------------------------------
def kelly_position(
    expected_irr_arith: float,
    sigma_per_period_arith: float,
    risk_free_rate: float,
    fraction: float = 0.5,
    cap: float = 0.25,
    book_correlation: float = 0.0,
) -> dict:
    """Fractional, capped, advisory Kelly with edge and variance in the SAME units.

    f* = (mu_excess) / sigma^2, where BOTH are per-period ARITHMETIC quantities on
    the same horizon (the original divided an annualized IRR edge by a single-year
    LOG variance -- dimensionally incoherent and explosive). Returns 0% for any
    non-positive edge (no 1% floor that funds value-destroying deals). The
    suggested size is then shrunk for positive correlation with the existing book
    (concentration risk) and clamped to [0, cap].
    """
    edge = expected_irr_arith - risk_free_rate
    if not np.isfinite(edge) or not np.isfinite(sigma_per_period_arith):
        return {"position": 0.0, "raw_kelly": float("nan"), "verdict": "INVALID (non-finite inputs)"}
    if sigma_per_period_arith < _SIGMA_FLOOR:
        # No (or degenerate, ~1e-18 floating-point) dispersion -> we cannot risk-
        # size; abstain rather than let Kelly explode to the cap. Guards both exact
        # zero AND the near-zero dust that a constant input series produces.
        return {"position": 0.0, "raw_kelly": 0.0, "verdict": "ABSTAIN (no modeled risk; need a real return distribution)"}
    if edge <= 0:
        # Kelly says don't bet (f* <= 0) on a deal below the risk-free hurdle.
        return {"position": 0.0, "raw_kelly": edge / sigma_per_period_arith ** 2, "verdict": "PASS (edge <= risk-free)"}

    raw_kelly = edge / (sigma_per_period_arith ** 2)
    sized = fraction * raw_kelly
    # Correlation-aware haircut: a position highly correlated with the book adds
    # less diversification, so shrink it by (1 - max(0, rho)). rho<=0 => no haircut.
    sized *= (1.0 - max(0.0, book_correlation))
    position = float(min(max(sized, 0.0), cap))
    verdict = "INVEST" if position > 0 else "PASS"
    if position >= cap:
        verdict = "INVEST (capped; note Kelly is sensitive to a possibly-understated sigma)"
    return {"position": position, "raw_kelly": float(raw_kelly), "verdict": verdict}


# ----------------------------------------------------------------------------
# Confidence from parameter-bootstrap CI width and n_obs (NOT n_sims)
# ----------------------------------------------------------------------------
def _ci(samples: np.ndarray, lo=5, hi=95) -> tuple:
    """Return (low, median, high) percentile triple of a bootstrap output sample."""
    return (
        float(np.percentile(samples, lo)),
        float(np.percentile(samples, 50)),
        float(np.percentile(samples, hi)),
    )


def _confidence_score(n_obs: int, p_target_ci: tuple) -> dict:
    """Honest confidence: driven by sample size and the width of the bootstrapped
    P(target) CI -- the genuine estimation uncertainty -- NOT by n_sims (which only
    shrinks Monte Carlo sampling error and adds no information about mu/sigma)."""
    width = p_target_ci[2] - p_target_ci[0]      # 90% CI width on P(target)
    # Map to a 0-100 score: more observations and a tighter CI => higher confidence.
    size_term = min(1.0, n_obs / 60.0)           # ~60 obs saturates the size term
    width_term = max(0.0, 1.0 - width / 0.30)    # a 30pt-wide CI => zero credit
    score = round(100.0 * 0.5 * (size_term + width_term), 1)
    if n_obs < 10:
        band = "LOW (thin history; CIs are wide -- treat point estimates as indicative)"
    elif n_obs < 30:
        band = "MODERATE (limited history; respect the CI band)"
    else:
        band = "REASONABLE (for a backward-looking fit; bias caveats still apply)"
    return {
        "score_0_100": score,
        "band": band,
        "n_obs": n_obs,
        "p_target_90pct_CI": (round(p_target_ci[0], 4), round(p_target_ci[2], 4)),
        "note": "Confidence reflects n_obs and parameter-CI width. n_sims only "
                "controls Monte Carlo sampling error, not estimation confidence.",
    }


# ----------------------------------------------------------------------------
# Real explainability: one-at-a-time sensitivity / attribution
# ----------------------------------------------------------------------------
def _sensitivity(base_inputs: dict, base_p_target: float, rng_seed_base: int) -> list:
    """Re-run the simulation perturbing each input in turn; rank inputs by the
    absolute change in P(target). Replaces the original hardcoded driver list with
    a genuine per-deal attribution."""
    drivers = []
    mode = base_inputs["mode"]
    ppy = base_inputs.get("periods_per_year", 1)
    pool = base_inputs.get("log_returns")            # already the bias-adjusted eff pool
    mu0, sigma0, hy0 = base_inputs["mu"], base_inputs["sigma"], base_inputs["holding_years"]
    # (label, kind); bumps are small but economically meaningful. In EMPIRICAL mode the
    # mu/sigma bumps reshape the pool via _adjust_empirical_pool so the effect is real
    # (otherwise the simulator ignores mu/sigma and every driver shows delta 0).
    for label, kind in [("Expected return (mu)", "mu"),
                        ("Volatility (sigma)", "sigma"),
                        ("Holding period", "holding")]:
        mu, sigma, hy, p_pool = mu0, sigma0, hy0, pool
        if kind == "mu":
            mu = mu0 + 0.01                                            # +1pp return
            if mode == "empirical" and pool is not None:
                p_pool = _adjust_empirical_pool(pool, 0.01, 1.0, ppy)
        elif kind == "sigma":
            sigma = sigma0 * 1.20                                      # +20% vol
            if mode == "empirical" and pool is not None:
                p_pool = _adjust_empirical_pool(pool, 0.0, 1.20, ppy)
        else:
            hy = max(1, int(hy0) + 1)
        rng = np.random.default_rng(rng_seed_base + hash(kind) % 10_000)
        irrs = _simulate_irrs(
            mu=mu, sigma=sigma, holding_years=hy, n_sims=base_inputs["n_sims"],
            rng=rng, mode=mode, log_returns=p_pool, block=base_inputs.get("block", 1),
            periods_per_year=ppy,
        )
        p = float(np.mean(irrs >= base_inputs["target_irr"]))
        drivers.append({"factor": label, "delta_P(target)": round(p - base_p_target, 4)})
    drivers.sort(key=lambda d: abs(d["delta_P(target)"]), reverse=True)
    return drivers


# ----------------------------------------------------------------------------
# Top-level scorer
# ----------------------------------------------------------------------------
def score_opportunity(
    fit: dict,
    holding_years: int = 5,
    target_irr: float = 0.20,
    risk_free_rate: float = 0.04,
    n_sims: int = 20_000,
    mode: str = "empirical",            # empirical bootstrap is the safer default
    n_param_boot: int = 300,            # parameter-uncertainty bootstrap draws
    bias_mu: float = 0.0,               # signed survivorship/backfill haircut (use <0)
    bias_sigma_mult: float = 1.0,       # inflate sigma for known-biased sources (>1)
    book_correlation: float = 0.0,      # correlation of this deal with the book
    kelly_fraction: float = 0.5,
    kelly_cap: float = 0.25,
    block: int = 1,                     # block length for empirical bootstrap
    rng: np.random.Generator | None = None,
    seed: int | None = None,
) -> dict:
    """Score one opportunity with CONFIDENCE INTERVALS on every output.

    Parameter uncertainty is propagated by bootstrapping the historical sample to
    get a distribution over (mu, sigma) [parametric mode] or over the empirical
    return pool [empirical mode], re-running the Monte Carlo per draw, and reporting
    each metric as median + 90% CI. The point-estimate run (no resample) is also
    reported for reference.

    Args:
        fit: output of fit_distribution / fit_cross_sectional_irr.
        mode: 'empirical' (block bootstrap of real returns; default) or 'lognormal'.
        bias_mu / bias_sigma_mult: EXPLICIT, signed corrections for survivorship /
            backfill (Preqin/VC) -- pass a negative bias_mu and >1 sigma mult.
        rng / seed: inject an rng for reproducibility WITHOUT touching global state.
    """
    if rng is None:
        rng = np.random.default_rng(seed)  # local generator; never reseeds globals

    n_obs = fit["n_obs"]
    ppy = fit.get("periods_per_year", 1)

    # Apply explicit bias corrections to the fitted (annual) parameters.
    mu = fit["mu"] + bias_mu
    sigma = fit["sigma"] * bias_sigma_mult
    log_returns = fit.get("log_returns")

    # In EMPIRICAL mode, fold the bias into the resampled pool itself (shape-preserving),
    # so DDQ adjustments actually move the distribution -- not just the Kelly sizer.
    eff_log_returns = log_returns
    if mode == "empirical" and log_returns is not None and len(log_returns) >= 2:
        eff_log_returns = _adjust_empirical_pool(log_returns, bias_mu, bias_sigma_mult, ppy)

    # Per-period arithmetic sigma for Kelly (same horizon as the per-period edge).
    # We size on a 1-year arithmetic basis: deannualize the annual arithmetic sigma.
    sigma_per_period = sigma / np.sqrt(ppy) if ppy > 1 else sigma
    # Use the per-year (annual) sigma for sizing since edge is an annual IRR excess.
    sigma_for_kelly = sigma

    # --- Point estimate run (reference; CIs come from the bootstrap below) ---
    base_irrs = _simulate_irrs(
        mu=mu, sigma=sigma, holding_years=holding_years, n_sims=n_sims, rng=rng,
        mode=mode, log_returns=eff_log_returns, block=block, periods_per_year=ppy,
    )
    base = _risk_metrics(base_irrs, target_irr)

    # --- Parameter-uncertainty bootstrap (the honest CI engine) ---
    boot = {k: [] for k in ("p_target", "expected", "median", "p_loss", "var_loss", "cvar_loss")}
    boot_sims = max(2000, n_sims // 5)  # fewer sims per draw; many draws dominate noise
    for _ in range(n_param_boot):
        if mode == "empirical" and eff_log_returns is not None and len(eff_log_returns) >= 2:
            # Resample the (bias-adjusted) empirical pool -- the resampled pool itself
            # IS the parameter draw; preserves shape (fat tails) and the DDQ adjustment.
            idx = rng.integers(0, len(eff_log_returns), size=len(eff_log_returns))
            lr_b = eff_log_returns[idx]  # a resampled return pool IS one parameter draw
            irrs_b = _simulate_irrs(
                mu=mu, sigma=sigma, holding_years=holding_years, n_sims=boot_sims,
                rng=rng, mode="empirical", log_returns=lr_b, block=block,
                periods_per_year=ppy,
            )
        else:
            # Parametric parameter draw: mu ~ Normal(mu_hat, SE), sigma^2 from chi2.
            se_mu = sigma / np.sqrt(max(1, n_obs))
            mu_b = mu + rng.normal(0.0, se_mu)
            if n_obs > 1:
                chi = rng.chisquare(n_obs - 1)
                sigma_b = sigma * np.sqrt((n_obs - 1) / chi) if chi > 0 else sigma
            else:
                sigma_b = sigma
            irrs_b = _simulate_irrs(
                mu=mu_b, sigma=sigma_b, holding_years=holding_years, n_sims=boot_sims,
                rng=rng, mode="lognormal",
            )
        m = _risk_metrics(irrs_b, target_irr)
        for k in boot:
            boot[k].append(m[k])

    boot = {k: np.asarray(v) for k, v in boot.items()}
    ci = {k: _ci(v) for k, v in boot.items()}
    p_target_ci = ci["p_target"]

    # --- Position sizing (dimensionally consistent, correlation-aware, advisory) ---
    pos = kelly_position(
        expected_irr_arith=base["expected"],
        sigma_per_period_arith=sigma_for_kelly,
        risk_free_rate=risk_free_rate,
        fraction=kelly_fraction,
        cap=kelly_cap,
        book_correlation=book_correlation,
    )

    # --- Confidence (n_obs + CI width, NOT n_sims) ---
    confidence = _confidence_score(n_obs, p_target_ci)

    # --- Real explainability via sensitivity attribution ---
    drivers = _sensitivity(
        base_inputs={
            "mu": mu, "sigma": sigma, "holding_years": holding_years,
            "n_sims": max(4000, n_sims // 4), "target_irr": target_irr,
            "mode": mode, "log_returns": eff_log_returns, "block": block,
            "periods_per_year": ppy,
        },
        base_p_target=base["p_target"],
        rng_seed_base=int(rng.integers(0, 1_000_000)),
    )

    mc_se = float(np.sqrt(base["p_target"] * (1 - base["p_target"]) / n_sims))

    def _fmt_ci(key):
        lo, med, hi = ci[key]
        return {"median": round(med, 4), "90%_CI": (round(lo, 4), round(hi, 4))}

    return {
        # (1) probability of hitting target, with CI
        "P(IRR>=target)": _fmt_ci("p_target"),
        # (2) expected / median return, with CI
        "Expected return (TWR/IRR bullet proxy)": _fmt_ci("expected"),
        "Median return (TWR/IRR bullet proxy)": _fmt_ci("median"),
        # (3) downside: probability AND SIZE of loss (losses are POSITIVE numbers)
        "P(loss)": _fmt_ci("p_loss"),
        "VaR_5% (loss magnitude)": _fmt_ci("var_loss"),
        "CVaR_5% (expected loss in worst 5%)": _fmt_ci("cvar_loss"),
        "downside_note": (
            "VaR/CVaR are LOSS magnitudes: a positive value is a real loss at the "
            "5% tail; a NEGATIVE value means the 5th-percentile outcome still gains "
            "(no modeled loss at 5%). Here the median 5% VaR is "
            + (f"{round(ci['var_loss'][1],4)} -- "
               + ("a genuine loss." if ci['var_loss'][1] > 0
                  else "i.e. no modeled loss at the 5% tail."))
        ),
        # (4) confidence from comparable history, not sim count
        "Confidence": confidence,
        # (5) genuine per-deal driver attribution
        "Top drivers (sensitivity of P(target))": drivers,
        # (6) advisory, capped, correlation-aware position size
        "Suggested position % of book": round(pos["position"] * 100, 2),
        "Position verdict": pos["verdict"],
        "Position detail": {
            "raw_kelly": round(pos["raw_kelly"], 3),
            "fraction": kelly_fraction,
            "cap": kelly_cap,
            "book_correlation_applied": book_correlation,
            "advisory": "Advisory only -- never auto-commit capital.",
        },
        # diagnostics / honesty
        "diagnostics": {
            "mode": mode,
            "n_sims": n_sims,
            "n_param_bootstrap": n_param_boot,
            "MC_standard_error_on_P(target)": round(mc_se, 5),
            "mu_used (after bias adj)": round(mu, 4),
            "sigma_used (after bias adj)": round(sigma, 4),
            "bias_mu_applied": bias_mu,
            "bias_sigma_mult_applied": bias_sigma_mult,
            "lag1_autocorr": round(fit.get("lag1_autocorr", 0.0), 3),
            "smoothing_warning": fit.get("smoothing_flag", False),
            "limits": "TWR/bullet proxy (no interim cashflows); fitted on backward-"
                      "looking, possibly smoothed/biased data; thin history => wide CIs.",
        },
    }


# ----------------------------------------------------------------------------
# Correlated multi-asset portfolio path (working Cholesky over ASSETS)
# ----------------------------------------------------------------------------
def simulate_portfolio_irrs(
    mus: np.ndarray,
    sigmas: np.ndarray,
    corr_matrix: np.ndarray,
    weights: np.ndarray | None = None,
    holding_years: int = 5,
    n_sims: int = 20_000,
    rng: np.random.Generator | None = None,
    seed: int | None = None,
) -> dict:
    """Simulate a correlated multi-asset book and return the portfolio IRR sample.

    Correct construction (the original crashed): draw standard normals shaped
    (n_sims, holding_years, n_assets), apply the Cholesky factor along the ASSET
    axis for EACH period, scale by per-asset log-sigma, add per-asset log-drift,
    compound each asset over the holding period, then combine assets by weight.
    """
    mus = np.asarray(mus, dtype=float)
    sigmas = np.asarray(sigmas, dtype=float)
    corr_matrix = np.asarray(corr_matrix, dtype=float)
    n_assets = mus.size
    if not (sigmas.size == n_assets and corr_matrix.shape == (n_assets, n_assets)):
        raise ValueError("mus, sigmas, and corr_matrix must agree on n_assets.")
    if weights is None:
        weights = np.full(n_assets, 1.0 / n_assets)
    weights = np.asarray(weights, dtype=float)
    if weights.size != n_assets:
        raise ValueError("weights must have one entry per asset.")
    if rng is None:
        rng = np.random.default_rng(seed)

    # Per-asset arithmetic -> log moments (same correction as the single-asset path).
    var_log = np.log1p((sigmas / (1.0 + mus)) ** 2)
    sigma_log = np.sqrt(var_log)                       # (n_assets,)
    mu_log = np.log1p(mus) - 0.5 * sigma_log ** 2      # (n_assets,)

    chol = np.linalg.cholesky(corr_matrix)             # (n_assets, n_assets)

    # z: (n_sims, holding_years, n_assets) iid standard normals.
    z = rng.standard_normal(size=(n_sims, holding_years, n_assets))
    # Correlate across assets per period: einsum applies chol along the asset axis.
    correlated = np.einsum("syk,ak->sya", z, chol)     # (n_sims, hy, n_assets)
    # Scale by per-asset log-sigma and shift by per-asset log-drift.
    asset_logrets = mu_log[None, None, :] + sigma_log[None, None, :] * correlated

    # Compound each asset over the holding period -> terminal multiple per asset.
    asset_cum_log = asset_logrets.sum(axis=1)          # (n_sims, n_assets)
    asset_multiple = np.exp(asset_cum_log)             # (n_sims, n_assets)
    # Portfolio terminal multiple = weighted sum of asset multiples (book level).
    # Use explicit broadcasting (not BLAS matmul) so a rare inf fat-tail draw does
    # not emit spurious FP-environment warnings; non-finite paths are filtered in
    # _risk_metrics. A weighted SUM of multiples (>=0) cannot underflow below 0.
    port_multiple = np.sum(asset_multiple * weights[None, :], axis=1)  # (n_sims,)
    port_irr = port_multiple ** (1.0 / holding_years) - 1.0

    return {
        "portfolio_irrs": port_irr,
        "metrics": _risk_metrics(port_irr, target_irr=0.20),
        "per_asset_mean_multiple": np.exp(asset_cum_log).mean(axis=0).round(4).tolist(),
        "weights": weights.round(4).tolist(),
    }


# ----------------------------------------------------------------------------
# VC power-law helper: explicit wipeout + heavy-tail survivor mixture
# ----------------------------------------------------------------------------
def vc_mixture_returns(
    n: int = 2000,
    p_wipeout: float = 0.50,
    survivor_mu: float = 0.30,
    survivor_sigma: float = 0.80,
    rng: np.random.Generator | None = None,
    seed: int | None = None,
) -> np.ndarray:
    """Generate a VC-shaped HOLDING-PERIOD multiple sample as a return series proxy.

    Bernoulli total-loss mass (-100%) + lognormal survivor multiples with a heavy
    upper tail. Feed the resulting (period) returns into fit_distribution with
    mode='empirical' so the single-lognormal limitation is bypassed. Reminder: VC
    is meaningful only at the PORTFOLIO level; a single startup is power-law.
    """
    if rng is None:
        rng = np.random.default_rng(seed)
    wipeout = rng.random(n) < p_wipeout
    surv_mult = np.exp(rng.normal(survivor_mu, survivor_sigma, size=n))
    mult = np.where(wipeout, 0.0, surv_mult)
    # Convert multiple to a one-period simple return, clamped just above -1 to stay
    # in-domain (a literal 0.0 multiple is -100%; nudge to keep log-returns finite).
    return np.clip(mult - 1.0, _MIN_RETURN + 1e-6, None)


# ----------------------------------------------------------------------------
# Pretty printer
# ----------------------------------------------------------------------------
def _print_score(title: str, result: dict):
    print(f"\n=== {title} ===")
    for k, v in result.items():
        if k in ("Top drivers (sensitivity of P(target))", "Position detail",
                 "Confidence", "diagnostics"):
            print(f"{k}:")
            if isinstance(v, list):
                for item in v:
                    print(f"    {item}")
            else:
                for kk, vv in v.items():
                    print(f"    {kk}: {vv}")
        else:
            print(f"{k}: {v}")


# ====================== DEMO ======================
if __name__ == "__main__":
    # Reproducible but non-global RNG; pass seed=None for fresh entropy in real use.
    rng = np.random.default_rng(12345)

    # ---- Example A: a single RE deal from an ANNUAL return series ----
    # (15 annual total returns; in production de-smooth NCREIF and pass ppy=4.)
    historical_re = np.array([
        0.08, 0.12, 0.05, 0.15, -0.03, 0.09, 0.11, 0.07,
        0.14, 0.06, 0.10, 0.04, 0.13, -0.08, 0.02,
    ])
    fit_re = fit_distribution(historical_re, periods_per_year=1, verbose=True)

    # EMPIRICAL bootstrap mode (recommended default for thin/skewed data).
    res_emp = score_opportunity(
        fit_re, holding_years=4, target_irr=0.20, risk_free_rate=0.04,
        mode="empirical", book_correlation=0.20, rng=rng,
    )
    _print_score("RE Deal -- EMPIRICAL bootstrap mode", res_emp)

    # PARAMETRIC lognormal mode on the same fit, for comparison.
    res_logn = score_opportunity(
        fit_re, holding_years=4, target_irr=0.20, risk_free_rate=0.04,
        mode="lognormal", book_correlation=0.20, rng=rng,
    )
    _print_score("RE Deal -- PARAMETRIC lognormal mode", res_logn)

    # ---- Example B: VC book via the power-law mixture + empirical mode ----
    vc_rets = vc_mixture_returns(n=3000, p_wipeout=0.55, rng=rng)
    fit_vc = fit_distribution(vc_rets, periods_per_year=1, verbose=True)
    # Survivorship/backfill haircut applied EXPLICITLY (negative mu, inflated sigma).
    res_vc = score_opportunity(
        fit_vc, holding_years=5, target_irr=0.30, risk_free_rate=0.04,
        mode="empirical", bias_mu=-0.03, bias_sigma_mult=1.15,
        book_correlation=0.0, rng=rng,
    )
    _print_score("VC Book -- EMPIRICAL mode (power-law via mixture)", res_vc)

    # ---- Example C: correlated 2-asset portfolio (the path that used to crash) ----
    port = simulate_portfolio_irrs(
        mus=np.array([0.09, 0.25]),
        sigmas=np.array([0.10, 0.40]),
        corr_matrix=np.array([[1.00, 0.35], [0.35, 1.00]]),
        weights=np.array([0.7, 0.3]),
        holding_years=5, n_sims=20_000, rng=rng,
    )
    print("\n=== Correlated 2-Asset Portfolio (working Cholesky) ===")
    print(f"Portfolio metrics (losses positive): {port['metrics']}")
    print(f"Per-asset mean terminal multiple: {port['per_asset_mean_multiple']}")
    print(f"Weights: {port['weights']}")

    # ---- Example D: true IRR from an explicit cashflow schedule (escapes TWR) ----
    # -1.0 invested at t0, +0.5 distribution at year 1, +1.0 at exit (year 5).
    cf = np.array([-1.0, 0.5, 0.0, 0.0, 0.0, 1.0])
    print("\n=== True IRR from cashflows (timing-aware, not TWR) ===")
    print(f"IRR of {cf.tolist()} = {irr_from_cashflows(cf):.4f}")
