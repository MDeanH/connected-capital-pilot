"""Bake the conditional market-path prior into netlify/functions/lib/market-path.json.

Source: housing_results/ (the pre-registered acceptance test, HOUSING-ACCEPTANCE-TEST.md).
For each market with a TSFM forecast, takes the LATEST rolling-origin window's
TimesFM-2.5 monthly median/q10/q90 path (12 months), computes annualized numbers,
the tilt vs the unconditional drift, and the per-market directional backtest
(sign hit-rate of the conditional median vs drift over all 10 out-of-sample
windows, plus the one-sided HLN-DM p-value vs drift from dm_tests.csv).

Honesty notes baked into the payload:
- q10/q90 are POINTWISE monthly quantiles compounded — an approximation of the
  path band, not joint path quantiles.
- The tilt is a 12-month conditional statement; the engine caps it and decays
  it over the holding period (see compute.ts).
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "housing_results")
OUT = os.path.join(HERE, "..", "..", "netlify", "functions", "lib", "market-path.json")

KEYMAP = {
    "US ZHVI": "US",
    "metro New York": "New York, NY",
    "metro Los Angeles": "Los Angeles, CA",
    "metro Chicago": "Chicago, IL",
    "metro Dallas": "Dallas, TX",
    "metro Houston": "Houston, TX",
    "metro Washington": "Washington, DC",
    "metro Philadelphia": "Philadelphia, PA",
    "metro Miami": "Miami, FL",
    "metro Atlanta": "Atlanta, GA",
    "metro Boston": "Boston, MA",
}
MODEL = "TimesFM-2.5"


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
    base = json.load(open(os.path.join(RES, "baselines.json")))
    tsfm = json.load(open(os.path.join(RES, "tsfm.json")))
    idx = [tuple(t) for t in tsfm["index"]]
    tf = tsfm["models"][MODEL]

    dm = {}
    with open(os.path.join(RES, "dm_tests.csv")) as f:
        for r in csv.DictReader(f):
            if r["model"] == MODEL and r["benchmark"] == "Drift":
                dm[r["task"]] = float(r["p_value"])

    out = {}
    for task, key in KEYMAP.items():
        entry = base["tasks"].get(task)
        if entry is None:
            continue
        W = len(entry["origin_dates"])
        last = W - 1
        i = idx.index((task, last))
        med, q10, q90 = tf["med"][i], tf["q10"][i], tf["q90"][i]
        drift_last = entry["models"]["DriftRW"][last][0] * 12  # constant per window

        # Directional backtest over all out-of-sample windows: did the conditional
        # median point the right way relative to drift?
        hits = n = 0
        for w in range(W):
            j = idx.index((task, w))
            c = ann(tf["med"][j])
            d = ann([entry["models"]["DriftRW"][w][0]] * 12)
            a = ann(entry["actuals"][w])
            if (c - d) == 0:
                continue
            n += 1
            hits += int((c - d > 0) == (a - d > 0))

        annual_med = ann(med)
        out[key] = {
            "asof": entry["origin_dates"][last],
            "model": MODEL,
            "annualMedian": round(annual_med, 5),
            "annualQ10": round(ann(q10), 5),
            "annualQ90": round(ann(q90), 5),
            "driftAnnual": round(drift_last, 5),
            "tiltAnnual": round(annual_med - drift_last, 5),
            "cumMed": cum(med),
            "cumQ10": cum(q10),
            "cumQ90": cum(q90),
            "backtest": {
                "hitRate": round(hits / n, 3) if n else None,
                "nWindows": n,
                "dmPvsDrift": round(dm.get(task, float("nan")), 4),
                "protocol": "rolling-origin 2015-2025, HOUSING-ACCEPTANCE-TEST.md",
            },
        }
        print(f"{key:20s} tilt {out[key]['tiltAnnual']:+.4f}  hit {hits}/{n}  dmP {out[key]['backtest']['dmPvsDrift']}")

    with open(os.path.abspath(OUT), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", os.path.abspath(OUT), f"({len(out)} markets)")


if __name__ == "__main__":
    main()
