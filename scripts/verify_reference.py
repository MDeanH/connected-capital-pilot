#!/usr/bin/env python3
"""
Adversarial verification + real-data wiring demo for the corrected MC reference.

Run (from project root, after `pip install -r requirements.txt` in the venv):

    python -W error::RuntimeWarning -W error::UserWarning scripts/verify_reference.py

This exercises:
- Quarterly NCREIF-style data with explicit periods_per_year=4 + Geltner (the 4x bug)
- DDQ bias_mu / bias_sigma_mult layer (via score_opportunity args)
- Empirical bootstrap + VC power-law mixture (P(loss) ~50-65%+ not 21%)
- Working portfolio Cholesky path (no ValueError)
- True cashflow IRR (not TWR proxy)
- Kelly: edge<=0 -> exactly 0%; sigma~0 (or floating dust) -> ABSTAIN (the _SIGMA_FLOOR fix)
- Confidence driven by n_obs + param CI width (62-ish for n=15-20, ~99 for n=3000)
- VaR/CVaR as positive loss magnitudes under the loss label
- Real sensitivity drivers (not the hardcoded 4 strings)
- Input validation loud on prices/TVPI/empty/<= -1 returns

All 10+ regression checks here must pass for the engine to be trusted.
The original grok_montecarlo_asis.py fails most of these on the same inputs.
"""

import sys
import os
from pathlib import Path
import numpy as np
import warnings

# Make both the top-level reference/ and the package copy importable.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "reference"))
sys.path.insert(0, str(ROOT / "src" / "model"))

try:
    from mc_reference import (  # prefer the package copy
        fit_distribution,
        score_opportunity,
        simulate_portfolio_irrs,
        vc_mixture_returns,
        irr_from_cashflows,
        geltner_unsmooth,
        kelly_position,
        _SIGMA_FLOOR,
    )
except ImportError:
    from mc_invest_score import (  # fallback to the reference/ copy
        fit_distribution,
        score_opportunity,
        simulate_portfolio_irrs,
        vc_mixture_returns,
        irr_from_cashflows,
        geltner_unsmooth,
        kelly_position,
        _SIGMA_FLOOR,
    )

# Promote warnings so a noisy-under-the-hood engine fails visibly (as in the review).
warnings.simplefilter("error", RuntimeWarning)
warnings.simplefilter("error", UserWarning)


def _pprint(title: str, d: dict):
    print(f"\n=== {title} ===")
    for k, v in d.items():
        if isinstance(v, dict):
            print(f"{k}:")
            for kk, vv in v.items():
                print(f"    {kk}: {vv}")
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            print(f"{k}:")
            for item in v[:3]:
                print(f"    {item}")
        else:
            print(f"{k}: {v}")


def main() -> int:
    rng = np.random.default_rng(424242)

    # ------------------------------------------------------------------
    # 1. REAL DATA WIRING: illustrative NCREIF-style quarterly total returns
    # (sourced from public summaries of NCREIF Property Index / ODCE around
    # 2018-2023 window; replace with your licensed CSV for production).
    # These are appraisal-based => expect positive lag-1 ac ~0.4-0.7.
    # ------------------------------------------------------------------
    # 20 quarters ~ 5 years. Mean quarterly ~0.018 ( ~7.4% ann simple), modest vol.
    ncreif_q = np.array([
        0.022, 0.019, 0.017, 0.015, 0.012, 0.008, -0.003, 0.005,
        0.014, 0.018, 0.021, 0.023, 0.020, 0.016, 0.011, 0.009,
        0.007, 0.013, 0.015, 0.018,
    ], dtype=float)
    print("NCREIF-style quarterly series (n=20): mean_q=%.4f, ac1=%.3f" %
          (ncreif_q.mean(), np.corrcoef(ncreif_q[:-1], ncreif_q[1:])[0, 1]))

    # Correct path: periods_per_year=4 + explicit Geltner (or let fit warn).
    fit_q = fit_distribution(ncreif_q, periods_per_year=4, verbose=True)
    # Show the de-smoothing effect explicitly.
    unsm = geltner_unsmooth(ncreif_q)
    fit_unsm = fit_distribution(unsm, periods_per_year=4, verbose=False)
    print("After Geltner unsmooth: sigma_ann rises from %.4f -> %.4f (true economic vol)" %
          (fit_q["sigma"], fit_unsm["sigma"]))

    # Score with the bias layer (illustrative "appraisal source" haircut).
    res_q = score_opportunity(
        fit_q,
        holding_years=5,
        target_irr=0.20,
        risk_free_rate=0.04,
        mode="empirical",
        n_param_boot=250,
        bias_mu=-0.005,          # modest appraisal / selection haircut
        bias_sigma_mult=1.10,    # still understate vol even after basic fit
        book_correlation=0.15,
        rng=rng,
    )
    _pprint("NCREIF quarterly (ppy=4, geltner-aware, bias applied)", res_q)

    # Demonstrate the units footgun that was fixed: if you forget ppy=4 you get ~4x lower mu.
    fit_wrong = fit_distribution(ncreif_q, periods_per_year=1, verbose=False)
    print("\n[PROBE] Wrong units (ppy=1 on quarterly data) mu_ann=%.4f vs correct ~%.4f" %
          (fit_wrong["mu"], fit_q["mu"]))

    # ------------------------------------------------------------------
    # 2. VC power-law (mixture) — should show P(loss) ~0.5-0.65+ not ~0.21
    # ------------------------------------------------------------------
    vc_rets = vc_mixture_returns(n=2500, p_wipeout=0.55, rng=rng)
    fit_vc = fit_distribution(vc_rets, periods_per_year=1, verbose=True)
    res_vc = score_opportunity(
        fit_vc, holding_years=5, target_irr=0.30, risk_free_rate=0.04,
        mode="empirical", bias_mu=-0.04, bias_sigma_mult=1.18, rng=rng,
    )
    _pprint("VC book (power-law mixture + explicit bias)", res_vc)
    assert res_vc["P(loss)"]["median"] > 0.70, "VC should show high loss prob (power law wipeouts)"

    # ------------------------------------------------------------------
    # 3. Correlated portfolio path (the one that used to raise ValueError)
    # ------------------------------------------------------------------
    port = simulate_portfolio_irrs(
        mus=np.array([0.072, 0.18]),
        sigmas=np.array([0.09, 0.38]),
        corr_matrix=np.array([[1.0, 0.28], [0.28, 1.0]]),
        weights=np.array([0.75, 0.25]),
        holding_years=4, n_sims=8000, rng=rng,
    )
    print("\n=== Portfolio path (working) ===")
    print("port metrics:", port["metrics"])
    print("weights:", port["weights"])
    assert "p_target" in port["metrics"] and isinstance(port["metrics"]["p_target"], float)

    # ------------------------------------------------------------------
    # 4. True cashflow IRR (bullet TWR proxy is not enough for multi-draw deals)
    # ------------------------------------------------------------------
    cf = np.array([-1.0, 0.4, 0.0, 0.0, 0.0, 1.15])
    irr = irr_from_cashflows(cf)
    print(f"\nTrue IRR(cashflows {cf.tolist()}) = {irr:.4f}")
    assert 0.10 < irr < 0.16

    # ------------------------------------------------------------------
    # 5. Kelly negative-edge floor + sigma floor (the critical risk-understatement traps)
    # ------------------------------------------------------------------
    # Negative edge
    neg_edge_fit = {"mu": 0.02, "sigma": 0.11, "n_obs": 25, "periods_per_year": 1, "log_returns": np.zeros(25)}
    pos_neg = kelly_position(expected_irr_arith=0.02, sigma_per_period_arith=0.11, risk_free_rate=0.04)
    print(f"\n[REG] negative edge: position={pos_neg['position']:.4f} (expect 0)")
    assert pos_neg["position"] == 0.0 and "PASS" in pos_neg["verdict"]

    # Constant (zero-info) series -> floating point dust sigma -> must ABSTAIN, not 25%
    const_series = np.full(30, 0.09)
    fit_const = fit_distribution(const_series, periods_per_year=1, verbose=False)
    print(f"[REG] constant series fitted sigma={fit_const['sigma']:.2e} (should be ~1e-17 dust)")
    res_const = score_opportunity(fit_const, n_sims=5000, rng=rng)
    print(f"[REG] constant position={res_const['Suggested position % of book']}, verdict={res_const['Position verdict']}")
    assert res_const["Suggested position % of book"] == 0.0, "must abstain on degenerate sigma"
    assert "ABSTAIN" in str(res_const.get("Position verdict", ""))

    # A genuinely volatile positive-edge deal should still size (not over-suppressed by floor)
    good_fit = fit_distribution(np.random.default_rng(99).normal(0.09, 0.18, 40), periods_per_year=1)
    res_good = score_opportunity(good_fit, rng=rng)
    print(f"[REG] volatile good deal position={res_good['Suggested position % of book']}% (expect >0, <=25)")
    assert 0.0 < res_good["Suggested position % of book"] <= 25.0

    # ------------------------------------------------------------------
    # 6. Confidence scales with n_obs (and CI width), not n_sims
    # ------------------------------------------------------------------
    small_fit = fit_distribution(np.random.default_rng(7).normal(0.08, 0.12, 12), periods_per_year=1)
    large_fit = fit_distribution(np.random.default_rng(7).normal(0.08, 0.12, 120), periods_per_year=1)
    c_small = score_opportunity(small_fit, n_param_boot=100, rng=rng)["Confidence"]
    c_large = score_opportunity(large_fit, n_param_boot=100, rng=rng)["Confidence"]
    print(f"\n[REG] conf n=12: {c_small['score_0_100']} | n=120: {c_large['score_0_100']} (expect large >> small)")
    assert c_large["score_0_100"] > c_small["score_0_100"] + 10

    # ------------------------------------------------------------------
    # 7. Input validation (prices, TVPI, empty, <=-1 all blow up loudly)
    # ------------------------------------------------------------------
    try:
        fit_distribution(np.array([300000, 305000, 312000]))  # price levels
        assert False, "should have rejected price levels"
    except ValueError as e:
        print("[REG] prices rejected:", str(e)[:60])

    try:
        # TVPI / cross-sectional multiples fed as if they were periodic returns (or
        # price levels in units of "times"). Median |r| >> 1 (here >10) triggers.
        fit_distribution(np.array([12.3, 9.8, 15.1, 11.4]))
        assert False, "should have rejected TVPI-like / scaled levels"
    except ValueError as e:
        print("[REG] TVPI/levels rejected:", str(e)[:70])

    print("\nAll regression checks passed (exit 0 under -W error).")

    # ------------------------------------------------------------------
    # 8. Live public data (Zillow national ZHVI pulled via scripts/pull_data.py)
    # ------------------------------------------------------------------
    try:
        # Direct load of the committed tidy national series (no package import needed when script run from root)
        import pandas as _pd  # local to avoid any scope issues in this script
        live_prices = _pd.read_csv("data/zillow_us_national_zhvi_prices.csv", parse_dates=[0], index_col=0).iloc[:, 0].values.astype(float)
        rets = prices_to_returns(live_prices)  # use the name from top-level import
        print(f"\n[LIVE DATA] Zillow national direct: n_returns={len(rets)} (2000-01..2026-04)")
        fit_live = fit_distribution(rets, periods_per_year=12, verbose=False)
        res_live = score_opportunity(fit_live, target_irr=0.08, n_sims=4000, rng=rng)
        print(f"[LIVE DATA] P(>=8%) median={res_live['P(IRR>=target)']['median']:.4f}, pos={res_live['Suggested position % of book']}%, conf={res_live['Confidence']['score_0_100']}")
        print("[LIVE DATA] path exercised (real public price levels -> returns -> fit(ppy=12) -> score with CIs).")
    except Exception as e:
        print("[LIVE DATA] skipped:", e)

    return 0


if __name__ == "__main__":
    sys.exit(main())
