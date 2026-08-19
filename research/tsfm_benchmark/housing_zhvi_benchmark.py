"""
Housing-index acceptance test for a conditional market-path prior.

This is the test the equity notebook (tsfm_return_benchmark.ipynb, section 6)
says any TSFM overlay must pass before it touches the engine's mu: the same
rolling-origin + one-sided HLN-corrected Diebold-Mariano protocol, run on the
platform's own monthly housing series instead of daily equities.

Tasks (monthly linear returns of price levels):
  * national: Zillow ZHVI (repo bake), FHFA HPI master, Case-Shiller national
  * metro:    top-10 metros by SizeRank from the local Zillow metro ZHVI file

Protocol: context L=120 months, horizon H=12 months, 10 rolling origins
spaced evenly from 2015-01 to the end of sample, seasonal period m=12.

Models:
  RandomWalk    zero-return (paper's null; "prices don't move")
  DriftRW       constant drift = context mean (analog of the engine's current
                unconditional stationary mu — the null that actually matters
                for the mu_adj decision)
  SeasonalNaive last seasonal cycle (m=12)
  AR1           AR(1) w/ intercept fit on context, iterated
  Chronos-2 / TimesFM-2.5 (zero-shot, median point forecast + q10/q90 for
                calibration) -- only in --stage tsfm

Stages (so baselines can run without torch):
  --stage baselines   compute + save baseline forecasts and actuals
  --stage tsfm        compute + save TSFM forecasts and quantiles
  --stage report      merge everything, print tables, write summary CSVs
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from benchmark_lib import (  # noqa: E402
    BenchmarkConfig,
    dm_test_one_sided,
    forecast_ar1,
    forecast_seasonal_naive,
)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
# Metro-series input lives in this repo; override with ADT_CHECKOUT to point
# at another checkout (the original run used an author-machine path).
MAIN_CHECKOUT = os.environ.get("ADT_CHECKOUT", REPO)
OUT_DIR = os.path.join(HERE, "housing_results")

L = 120          # context, months (10y)
H = 12           # horizon, months
N_WINDOWS = 10
M = 12           # seasonal period
EVAL_START = "2015-01-01"
N_METROS = 10


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def _read_two_col(path: str) -> pd.Series:
    df = pd.read_csv(path)
    s = pd.Series(df[df.columns[-1]].values, index=pd.to_datetime(df[df.columns[0]]))
    return s.dropna().astype(float)


def load_series() -> dict[str, pd.Series]:
    out = {
        "US ZHVI": _read_two_col(
            os.path.join(REPO, "data/processed/zillow_national_zhvi/latest_prices.csv")),
        "US FHFA HPI": _read_two_col(
            os.path.join(REPO, "data/processed/fhfa_hpi_master/latest_prices.csv")),
        "US Case-Shiller": _read_two_col(
            os.path.join(REPO, "data/processed/fred_csushpinsa/latest.csv")),
    }
    metro_path = os.path.join(MAIN_CHECKOUT, "data/zillow_zhvi_metro_raw.csv")
    raw = pd.read_csv(metro_path)
    msa = raw[raw["RegionType"] == "msa"].sort_values("SizeRank").head(N_METROS)
    date_cols = [c for c in raw.columns if c[:2] in ("19", "20")]
    for _, row in msa.iterrows():
        name = "metro " + str(row["RegionName"]).split(",")[0]
        s = pd.Series(row[date_cols].astype(float).values,
                      index=pd.to_datetime(date_cols)).dropna()
        out[name] = s
    return out


def make_windows(levels: pd.Series):
    """Monthly linear returns -> (contexts[L], actuals[H]) x N_WINDOWS."""
    rets = (levels / levels.shift(1) - 1.0).dropna()
    r = rets.values.astype(np.float64)
    idx = rets.index
    first = max(int(np.searchsorted(idx, pd.Timestamp(EVAL_START))), L)
    last = len(r) - H
    if last <= first:
        raise ValueError(f"series too short: first origin {first}, last {last}")
    origins = sorted(set(np.linspace(first, last, N_WINDOWS).round().astype(int).tolist()))
    if len(origins) != N_WINDOWS:
        raise ValueError("could not place distinct origins")
    ctxs = [r[t - L:t] for t in origins]
    acts = [r[t:t + H] for t in origins]
    dates = [str(idx[t].date()) for t in origins]
    return ctxs, acts, dates


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------
def forecast_drift_rw(ctx: np.ndarray, horizon: int) -> np.ndarray:
    return np.full(horizon, ctx.mean())


BASELINES = {
    "RandomWalk": lambda c: np.zeros(H),
    "DriftRW": lambda c: forecast_drift_rw(c, H),
    "SeasonalNaive": lambda c: forecast_seasonal_naive(c, H, m=M),
    "AR1": lambda c: forecast_ar1(c, H),
}


def stage_baselines() -> None:
    series = load_series()
    payload = {"tasks": {}, "protocol": {
        "L": L, "H": H, "n_windows": N_WINDOWS, "m": M, "eval_start": EVAL_START}}
    for task, levels in series.items():
        ctxs, acts, dates = make_windows(levels)
        entry = {"origin_dates": dates,
                 "actuals": [a.tolist() for a in acts],
                 "n_obs": int(len(levels)),
                 "range": [str(levels.index.min().date()), str(levels.index.max().date())],
                 "models": {}}
        for name, fn in BASELINES.items():
            entry["models"][name] = [fn(c).tolist() for c in ctxs]
        payload["tasks"][task] = entry
        print(f"[baselines] {task}: n={len(levels)} windows at {dates[0]}..{dates[-1]}")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "baselines.json"), "w") as f:
        json.dump(payload, f)
    print("wrote", os.path.join(OUT_DIR, "baselines.json"))


# ---------------------------------------------------------------------------
# TSFMs (median + q10/q90 for calibration)
# ---------------------------------------------------------------------------
def stage_tsfm() -> None:
    series = load_series()
    tasks, all_ctx = [], []
    for task, levels in series.items():
        ctxs, _acts, _dates = make_windows(levels)
        for w, c in enumerate(ctxs):
            tasks.append((task, w))
            all_ctx.append(c)
    print(f"[tsfm] {len(all_ctx)} contexts of length {L}")

    out: dict = {}

    # --- Chronos-2 ---
    import torch
    from chronos import Chronos2Pipeline

    pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cpu")
    levels_q = [0.1, 0.5, 0.9]
    qs, _means = pipe.predict_quantiles(
        [torch.tensor(c, dtype=torch.float32) for c in all_ctx],
        prediction_length=H, quantile_levels=levels_q)
    ch = {"med": [q.squeeze(0)[:, 1].numpy().tolist() for q in qs],
          "q10": [q.squeeze(0)[:, 0].numpy().tolist() for q in qs],
          "q90": [q.squeeze(0)[:, 2].numpy().tolist() for q in qs]}
    out["Chronos-2"] = ch
    print("[tsfm] Chronos-2 done")

    # --- TimesFM 2.5 ---
    import timesfm

    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
        "google/timesfm-2.5-200m-pytorch")
    model.compile(timesfm.ForecastConfig(
        max_context=512, max_horizon=64,
        normalize_inputs=True, use_continuous_quantile_head=True,
        fix_quantile_crossing=True))
    _point, quantiles = model.forecast(
        horizon=H, inputs=[c.astype(np.float32) for c in all_ctx])
    q = np.asarray(quantiles)  # (n, H, 10): [mean, q0.1 .. q0.9]
    assert np.all(q[:, :, 4] <= q[:, :, 5] + 1e-9) and \
        np.all(q[:, :, 5] <= q[:, :, 6] + 1e-9), "quantile ordering broken"
    out["TimesFM-2.5"] = {"med": q[:, :, 5].tolist(),
                          "q10": q[:, :, 1].tolist(),
                          "q90": q[:, :, 9].tolist()}
    print("[tsfm] TimesFM-2.5 done")

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "tsfm.json"), "w") as f:
        json.dump({"index": [list(t) for t in tasks], "models": out}, f)
    print("wrote", os.path.join(OUT_DIR, "tsfm.json"))


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def stage_report() -> None:
    with open(os.path.join(OUT_DIR, "baselines.json")) as f:
        base = json.load(f)
    tsfm_path = os.path.join(OUT_DIR, "tsfm.json")
    tsfm = None
    if os.path.exists(tsfm_path):
        with open(tsfm_path) as f:
            tsfm = json.load(f)

    # reshape tsfm: {task: {model: {med/q10/q90: [windows][H]}}}
    tsfm_by_task: dict = {}
    if tsfm:
        for i, (task, _w) in enumerate([tuple(t) for t in tsfm["index"]]):
            for mname, blocks in tsfm["models"].items():
                slot = tsfm_by_task.setdefault(task, {}).setdefault(
                    mname, {"med": [], "q10": [], "q90": []})
                for k in ("med", "q10", "q90"):
                    slot[k].append(np.array(blocks[k][i]))

    rows, dm_rows, cov_rows = [], [], []
    for task, entry in base["tasks"].items():
        acts = [np.array(a) for a in entry["actuals"]]
        pool = np.concatenate(acts)
        fcs: dict[str, list[np.ndarray]] = {
            name: [np.array(x) for x in wins] for name, wins in entry["models"].items()}
        if task in tsfm_by_task:
            for mname, slot in tsfm_by_task[task].items():
                fcs[mname] = slot["med"]
                inside = [(a >= lo) & (a <= hi)
                          for a, lo, hi in zip(acts, slot["q10"], slot["q90"])]
                cov_rows.append({"task": task, "model": mname,
                                 "cov_q10_q90": float(np.concatenate(inside).mean())})

        abs_err = {n: np.abs(np.concatenate(w) - pool) for n, w in fcs.items()}
        mae_rw = abs_err["RandomWalk"].mean()
        mae_drift = abs_err["DriftRW"].mean()
        mae_sn = abs_err["SeasonalNaive"].mean()
        for name, w in fcs.items():
            e = abs_err[name]
            per_w = np.array([np.mean(np.abs(f - a)) for f, a in zip(w, acts)])
            row = {"task": task, "model": name,
                   "MAE_mean": per_w.mean(), "MAE_std": per_w.std(ddof=0),
                   "skill_vs_RW0": 1 - e.mean() / mae_rw,
                   "skill_vs_Drift": 1 - e.mean() / mae_drift,
                   "rMAE_vs_SN": e.mean() / mae_sn}
            for bench, bname in ((abs_err["RandomWalk"], "RW0"),
                                 (abs_err["DriftRW"], "Drift")):
                if name in ("RandomWalk",) and bname == "RW0":
                    continue
                if name in ("DriftRW",) and bname == "Drift":
                    continue
                dm = dm_test_one_sided(e, bench, h=H)
                row[f"DM_p_vs_{bname}"] = dm["p_value"]
                dm_rows.append({"task": task, "model": name, "benchmark": bname,
                                **{k: dm[k] for k in ("dm_stat", "p_value", "direction")}})
            rows.append(row)

    df = pd.DataFrame(rows)
    dm_df = pd.DataFrame(dm_rows)
    cov_df = pd.DataFrame(cov_rows)

    pd.set_option("display.width", 200, "display.float_format", lambda v: f"{v:.4f}")
    for task in df["task"].unique():
        print(f"\n=== {task} ===")
        print(df[df.task == task].drop(columns="task")
              .set_index("model").sort_values("MAE_mean").to_string())

    # aggregate: winners and significant DM results
    real = df[~df.model.isin(["RandomWalk"])]
    winners = (df.loc[df.groupby("task")["MAE_mean"].idxmin(), ["task", "model"]]
               .groupby("model").size().sort_values(ascending=False))
    print("\n=== Task wins (lowest MAE) ===")
    print(winners.to_string())
    ranks = df.pivot(index="task", columns="model", values="MAE_mean").rank(axis=1)
    print("\n=== Average MAE rank across tasks ===")
    print(ranks.mean().sort_values().to_string())

    for bench in ("RW0", "Drift"):
        sub = dm_df[(dm_df.benchmark == bench) & (dm_df.direction == "Model better")]
        sig = sub[sub.p_value < 0.05]
        n_tests = len(dm_df[dm_df.benchmark == bench])
        print(f"\n=== DM one-sided vs {bench}: {len(sig)}/{n_tests} significant at 5% ===")
        if len(sig):
            print(sig.sort_values("p_value").to_string(index=False))

    if len(cov_df):
        print("\n=== TSFM 80% interval coverage (q10-q90, pooled) ===")
        print(cov_df.pivot(index="task", columns="model",
                           values="cov_q10_q90").to_string())

    df.to_csv(os.path.join(OUT_DIR, "summary.csv"), index=False)
    dm_df.to_csv(os.path.join(OUT_DIR, "dm_tests.csv"), index=False)
    if len(cov_df):
        cov_df.to_csv(os.path.join(OUT_DIR, "coverage.csv"), index=False)
    print("\nwrote summary.csv / dm_tests.csv / coverage.csv in", OUT_DIR)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["baselines", "tsfm", "report"], required=True)
    args = ap.parse_args()
    {"baselines": stage_baselines, "tsfm": stage_tsfm, "report": stage_report}[args.stage]()
