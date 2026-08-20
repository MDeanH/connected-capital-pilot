"""Bake the conditional market-path prior into netlify/functions/lib/market-path.json.

LIVE forecast: runs TimesFM-2.5 zero-shot on the LATEST 120 months of each
market's series (data through 2026-04), so the 12-month window is forward, not
an expired backtest window. Provenance (hit rate, DM p vs drift over the
2015-2025 rolling-origin windows) comes from housing_results/.

Per-market gate (pre-registered in FINDINGS.md): a market only gets a nonzero
tilt if its out-of-sample record rejects the drift null at 5% (one-sided
HLN-DM) AND beats the seasonal naive (rMAE < 1). Markets that fail (e.g. Los
Angeles, p=0.166) are baked with gatePassed=false and tiltAnnual=0.

Units: drift and conditional median are BOTH compounded over 12 months.
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import housing_zhvi_benchmark as hb  # noqa: E402

OUT = os.path.join(hb.REPO, "netlify", "functions", "lib", "market-path.json")
KEYMAP = {
    "US ZHVI": "United States",
    "metro New York": "New York, NY", "metro Los Angeles": "Los Angeles, CA",
    "metro Chicago": "Chicago, IL", "metro Dallas": "Dallas, TX",
    "metro Houston": "Houston, TX", "metro Washington": "Washington, DC",
    "metro Philadelphia": "Philadelphia, PA", "metro Miami": "Miami, FL",
    "metro Atlanta": "Atlanta, GA", "metro Boston": "Boston, MA",
}
MODEL = "TimesFM-2.5"
GELTNER_TESTED = {"US ZHVI", "metro New York", "metro Dallas", "metro Miami", "metro Chicago"}


def ann(path):
    v = 1.0
    for m in path:
        v *= 1.0 + m
    return v - 1.0


def cum(path):
    out, v = [], 1.0
    for m in path:
        v *= 1.0 + m
        out.append(round(v - 1.0, 5))
    return out


def main():
    res = hb.OUT_DIR
    base = json.load(open(os.path.join(res, "baselines.json")))
    tsfm = json.load(open(os.path.join(res, "tsfm.json")))
    # Fail closed on a stale TSFM artifact before baking it into the shipped
    # prior: same guard stage_report() uses, since this consumer aligns the two
    # by (task, window) with no freshness check of its own.
    hb._require_matching_artifacts(base, tsfm)
    idx = [tuple(t) for t in tsfm["index"]]
    tf = tsfm["models"][MODEL]

    dm, rmae = {}, {}
    for r in csv.DictReader(open(os.path.join(res, "dm_tests.csv"))):
        if r["model"] == MODEL and r["benchmark"] == "Drift":
            dm[r["task"]] = float(r["p_value"])
    for r in csv.DictReader(open(os.path.join(res, "summary.csv"))):
        if r["model"] == MODEL:
            rmae[r["task"]] = float(r["rMAE_vs_SN"])

    # --- live contexts from the latest data ---
    series = hb.load_series()
    tasks = [t for t in KEYMAP if t in base["tasks"]]
    ctxs, asofs, drifts = {}, {}, {}
    for t in tasks:
        levels = series[t if not t.startswith("metro") else t]
        rets = (levels / levels.shift(1) - 1.0).dropna()
        ctx = rets.values[-hb.L:]
        ctxs[t] = ctx
        asofs[t] = str(rets.index[-1].date())
        drifts[t] = ann([float(ctx.mean())] * 12)  # compounded, same units as median

    import numpy as np
    import timesfm
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
    model.compile(timesfm.ForecastConfig(max_context=512, max_horizon=64,
                  normalize_inputs=True, use_continuous_quantile_head=True,
                  fix_quantile_crossing=True))
    _p, q = model.forecast(horizon=hb.H, inputs=[ctxs[t].astype(np.float32) for t in tasks])
    q = np.asarray(q)  # (n, H, 10): [mean, q0.1 .. q0.9]

    out = {}
    for i, t in enumerate(tasks):
        key = KEYMAP[t]
        med, q10, q90 = q[i, :, 5].tolist(), q[i, :, 1].tolist(), q[i, :, 9].tolist()

        # directional record over the historical out-of-sample windows
        entry = base["tasks"][t]
        hits = n = 0
        for w in range(len(entry["origin_dates"])):
            j = idx.index((t, w))
            c = ann(tf["med"][j])
            d = ann([entry["models"]["DriftRW"][w][0]] * 12)
            a = ann(entry["actuals"][w])
            if c - d == 0:
                continue
            n += 1
            hits += int((c - d > 0) == (a - d > 0))

        p = dm.get(t)
        gate = (p is not None and p < 0.05) and (rmae.get(t, 9) < 1.0)
        annual_med = ann(med)
        tilt = round(annual_med - drifts[t], 5)
        out[key] = {
            "asof": asofs[t], "model": MODEL,
            "annualMedian": round(annual_med, 5),
            "annualQ10": round(ann(q10), 5), "annualQ90": round(ann(q90), 5),
            "driftAnnual": round(drifts[t], 5),
            "tiltAnnual": tilt if gate else 0.0,
            "tiltAnnualUngated": tilt,
            "gatePassed": gate,
            "geltnerTested": t in GELTNER_TESTED,
            "cumMed": cum(med), "cumQ10": cum(q10), "cumQ90": cum(q90),
            "backtest": {
                "hitRate": round(hits / n, 3) if n else None, "nWindows": n,
                "dmPvsDrift": round(p, 6) if p is not None else None,
                "rmaeVsSeasonal": round(rmae.get(t), 3) if t in rmae else None,
                "protocol": "rolling-origin 2015-2025, HOUSING-ACCEPTANCE-TEST.md",
            },
        }
        print(f"{key:16s} asof {asofs[t]} tilt {tilt:+.4f} gate={'PASS' if gate else 'NO-TILT'} hit {hits}/{n} p={p}")

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", OUT, f"({len(out)} markets)")


if __name__ == "__main__":
    main()
