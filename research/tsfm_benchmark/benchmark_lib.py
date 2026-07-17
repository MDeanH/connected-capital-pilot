"""
Rolling-origin TSFM benchmark utilities.

Implements the evaluation protocol of:

    Noguer i Alonso & Franklin (2026), "Pretrained Time-Series Foundation
    Models for Financial Return Forecasting", arXiv:2606.27100 [q-fin.MF].

Protocol (paper Sections 4.3-4.4):
  * context length L = 512 daily returns, horizon H = 20 business days
  * 10 rolling-origin windows over the evaluation segment
  * point forecast = predictive median where available
  * primary metric MAE; skill vs. zero-return random walk; rMAE vs. weekly
    (5-business-day) seasonal naive
  * one-sided Diebold-Mariano test vs. the random walk with the
    Harvey-Leybourne-Newbold small-sample correction, pooled across windows

The exact rolling-origin calendar anchors of the paper are not published
(their Appendix B notes they live in a companion code release), so origins
here are spaced evenly across the evaluation segment. Numbers are therefore
comparable in magnitude and interpretation, not digit-for-digit.

Only numpy/pandas/scipy are required for the protocol itself; the TSFM
wrappers import torch/timesfm/chronos lazily so the module stays importable
in the main product environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@dataclass
class BenchmarkConfig:
    tickers: tuple = ("AAPL", "AMZN", "GOOG", "JPM", "META")
    start: str = "2014-09-15"          # paper data range start
    end: str = "2026-02-16"            # paper range end 2026-02-15 (yf end-exclusive)
    eval_start: str = "2024-08-22"     # paper evaluation segment start
    context_len: int = 512             # L
    horizon: int = 20                  # H (business days)
    n_windows: int = 10                # rolling-origin windows
    seasonal_period: int = 5           # weekly seasonal naive on daily data
    return_types: tuple = ("linear", "log")
    quantile_levels: tuple = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def load_prices(cfg: BenchmarkConfig, cache_path: str | None = None) -> pd.DataFrame:
    """Daily adjusted closes; use the committed CSV cache when available so the
    notebook re-runs deterministically and offline."""
    if cache_path:
        try:
            px = pd.read_csv(cache_path, index_col=0, parse_dates=True)
            if set(cfg.tickers).issubset(px.columns):
                return px[list(cfg.tickers)]
        except FileNotFoundError:
            pass
    import yfinance as yf

    df = yf.download(list(cfg.tickers), start=cfg.start, end=cfg.end,
                     auto_adjust=True, progress=False)
    px = df["Close"][list(cfg.tickers)].dropna(how="any")
    if cache_path:
        px.to_csv(cache_path)
    return px


def compute_returns(prices: pd.DataFrame, kind: str) -> pd.DataFrame:
    if kind == "linear":
        return (prices / prices.shift(1) - 1.0).dropna()
    if kind == "log":
        return np.log(prices / prices.shift(1)).dropna()
    raise ValueError(f"unknown return type {kind!r}")


def rolling_origins(returns_index: pd.DatetimeIndex, cfg: BenchmarkConfig) -> list[int]:
    """Indices of the first forecast day for each of the n_windows windows,
    spaced evenly across the evaluation segment.

    Each origin t0 requires context_len history before it and horizon days
    from it (inclusive) within the sample.
    """
    idx = returns_index
    first = int(np.searchsorted(idx, pd.Timestamp(cfg.eval_start)))
    first = max(first, cfg.context_len)                 # need L days of history
    last = len(idx) - cfg.horizon                       # need H days ahead
    if last <= first:
        raise ValueError("evaluation segment too short for the requested protocol")
    origins = np.linspace(first, last, cfg.n_windows).round().astype(int)
    origins = sorted(set(origins.tolist()))
    if len(origins) != cfg.n_windows:
        raise ValueError("could not place distinct rolling origins")
    return origins


def make_tasks(prices: pd.DataFrame, cfg: BenchmarkConfig) -> dict:
    """Build {(ticker, return_type): {'returns': Series, 'origins': [int]}}."""
    tasks = {}
    for kind in cfg.return_types:
        rets = compute_returns(prices, kind)
        origins = rolling_origins(rets.index, cfg)
        for t in cfg.tickers:
            tasks[(t, kind)] = {"returns": rets[t], "origins": origins}
    return tasks


def iter_windows(task: dict, cfg: BenchmarkConfig):
    """Yield (window_id, context ndarray[L], actual ndarray[H], dates[H])."""
    r = task["returns"].values.astype(np.float64)
    dates = task["returns"].index
    for w, t0 in enumerate(task["origins"]):
        ctx = r[t0 - cfg.context_len: t0]
        actual = r[t0: t0 + cfg.horizon]
        yield w, ctx, actual, dates[t0: t0 + cfg.horizon]


# ---------------------------------------------------------------------------
# Naive / statistical baselines
# ---------------------------------------------------------------------------
def forecast_random_walk(ctx: np.ndarray, horizon: int) -> np.ndarray:
    """Zero-return random walk (the paper's primary benchmark)."""
    return np.zeros(horizon)


def forecast_seasonal_naive(ctx: np.ndarray, horizon: int, m: int = 5) -> np.ndarray:
    """Standard seasonal naive: tile the last observed seasonal cycle,
    y_hat[T+h] = y[T + h - m*(floor((h-1)/m)+1)]."""
    h = np.arange(1, horizon + 1)
    lags = m * ((h - 1) // m + 1)
    return ctx[len(ctx) + (h - lags) - 1]


def forecast_ar1(ctx: np.ndarray, horizon: int) -> np.ndarray:
    """AR(1) with intercept fit on the context window by OLS, iterated forward."""
    y, x = ctx[1:], ctx[:-1]
    X = np.column_stack([np.ones_like(x), x])
    (c, phi), *_ = np.linalg.lstsq(X, y, rcond=None)
    out = np.empty(horizon)
    prev = ctx[-1]
    for h in range(horizon):
        prev = c + phi * prev
        out[h] = prev
    return out


# ---------------------------------------------------------------------------
# TSFM wrappers (lazy imports; batched over all windows/tasks at once)
# ---------------------------------------------------------------------------
class TimesFMForecaster:
    """TimesFM 2.5 (200M, torch checkpoint), zero-shot, median point forecast."""

    name = "TimesFM-2.5"

    def __init__(self, cfg: BenchmarkConfig):
        import timesfm

        self.model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch")
        self.model.compile(timesfm.ForecastConfig(
            max_context=cfg.context_len,
            max_horizon=max(64, cfg.horizon),
            normalize_inputs=True,
            use_continuous_quantile_head=True,
            fix_quantile_crossing=True,
        ))
        self.cfg = cfg

    def forecast_batch(self, contexts: list[np.ndarray]) -> np.ndarray:
        """Return (n_series, horizon) median forecasts."""
        point, quantiles = self.model.forecast(
            horizon=self.cfg.horizon,
            inputs=[c.astype(np.float32) for c in contexts],
        )
        q = np.asarray(quantiles)          # (n, H, 10): [mean, q0.1 ... q0.9]
        med = q[:, :, 5]                   # 0.5 quantile
        assert np.all(q[:, :, 4] <= q[:, :, 5] + 1e-9) and \
               np.all(q[:, :, 5] <= q[:, :, 6] + 1e-9), "quantile ordering broken"
        return med


class Chronos2Forecaster:
    """Chronos-2 (120M), zero-shot, median point forecast."""

    name = "Chronos-2"

    def __init__(self, cfg: BenchmarkConfig):
        import torch
        from chronos import Chronos2Pipeline

        self.torch = torch
        self.pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2",
                                                     device_map="cpu")
        self.cfg = cfg

    def forecast_batch(self, contexts: list[np.ndarray]) -> np.ndarray:
        levels = list(self.cfg.quantile_levels)
        mid = levels.index(0.5)
        qs, _means = self.pipe.predict_quantiles(
            [self.torch.tensor(c, dtype=self.torch.float32) for c in contexts],
            prediction_length=self.cfg.horizon,
            quantile_levels=levels,
        )
        med = np.stack([q.squeeze(0)[:, mid].numpy() for q in qs])
        return med


# ---------------------------------------------------------------------------
# Metrics (paper Section 4.4)
# ---------------------------------------------------------------------------
def mae(errors: np.ndarray) -> float:
    return float(np.mean(np.abs(errors)))


def dm_test_one_sided(model_abs_err: np.ndarray, rw_abs_err: np.ndarray,
                      h: int) -> dict:
    """One-sided Diebold-Mariano test of H1: model more accurate than RW,
    on absolute-loss differentials d_t = |e_model| - |e_RW| (paper Eq. 54-56).

    Long-run variance: truncated autocovariance sum at lag h-1 (Eq. 55); if the
    truncated estimator goes non-positive (possible in finite samples) fall
    back to Bartlett/Newey-West weights at the same lag. HLN small-sample
    correction and t_{n-1} reference distribution (Eq. 56).
    """
    d = np.asarray(model_abs_err) - np.asarray(rw_abs_err)
    n = d.size
    dbar = d.mean()
    dc = d - dbar
    gamma = np.array([np.sum(dc[k:] * dc[:n - k]) / n for k in range(h)])
    lrv = gamma[0] + 2.0 * gamma[1:].sum()
    if lrv <= 0:  # fall back to Bartlett weights
        w = 1.0 - np.arange(1, h) / h
        lrv = gamma[0] + 2.0 * np.sum(w * gamma[1:])
        lrv = max(lrv, 1e-16)
    dm = dbar / np.sqrt(lrv / n)
    hln = np.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    dm_star = dm * hln
    p_one_sided = float(stats.t.cdf(dm_star, df=n - 1))  # H1: E[d] < 0
    return {"dbar": float(dbar), "dm_stat": float(dm_star), "n": int(n),
            "p_value": p_one_sided,
            "direction": "Model better" if dbar < 0 else "RW better"}


def summarize_task(forecasts: dict, actuals_by_window: list[np.ndarray],
                   h: int, m: int = 5) -> pd.DataFrame:
    """Per-model summary for one (ticker, return_type) task.

    forecasts: {model_name: list over windows of (H,) forecast arrays}
    Returns MAE mean/std across windows, pooled skill vs RW, pooled rMAE vs
    seasonal naive, and the one-sided DM p-value vs RW.
    """
    actual_pool = np.concatenate(actuals_by_window)
    rw_abs = np.abs(actual_pool)                       # |0 - y|
    mae_rw_pool = rw_abs.mean()
    sn_abs = np.abs(np.concatenate(forecasts["SeasonalNaive"]) - actual_pool)
    mae_sn_pool = sn_abs.mean()

    rows = []
    for name, fc_windows in forecasts.items():
        errs_w = [fc - act for fc, act in zip(fc_windows, actuals_by_window)]
        mae_w = np.array([mae(e) for e in errs_w])
        abs_pool = np.abs(np.concatenate(errs_w))
        skill = 1.0 - abs_pool.mean() / mae_rw_pool
        rmae = abs_pool.mean() / mae_sn_pool
        row = {"model": name, "MAE_mean": mae_w.mean(), "MAE_std": mae_w.std(ddof=0),
               "skill_vs_RW": skill, "rMAE_vs_SN": rmae}
        if name != "RandomWalk":
            row.update({f"DM_{k}": v for k, v in
                        dm_test_one_sided(abs_pool, rw_abs, h=h).items()
                        if k in ("dm_stat", "p_value", "direction")})
        rows.append(row)
    df = pd.DataFrame(rows).set_index("model").sort_values("MAE_mean")
    return df
