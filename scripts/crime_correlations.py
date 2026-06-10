#!/usr/bin/env python3
"""
Correlate FBI crime rates with the platform's market return histories.

Joins public/crime-stats.json (violent/property offenses per 100k, 2024) with
netlify/functions/lib/metros.json (quarterly total-return series since 2000,
Zillow ZHVI + income proxy) on market key, computes per-market metrics, and
correlates crime against them — overall and split by cities vs counties.

Outputs:
  public/crime-correlations.json   (matrix + downsampled scatter for the UI)
  stdout                            (human-readable report)

Run after scripts/fetch_fbi_crime.py has produced crime-stats.json.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]

CRIME = json.loads((ROOT / "public/crime-stats.json").read_text())
RETURNS = json.loads((ROOT / "netlify/functions/lib/metros.json").read_text())
try:
    CONTEXT = json.loads((ROOT / "public/market-context.json").read_text())["markets"]
except Exception:
    CONTEXT = {}

METRICS = {
    "mu_ann": "Annualized total return (full history)",
    "sigma_ann": "Annualized volatility",
    "sharpe_like": "Return / volatility",
    "growth_5y": "Annualized return, last 5 yrs",
    "max_drawdown": "Max drawdown (cumulative)",
    "pop_log": "log10(population)",
    # from market-context.json (ZORI / Zillow heat / BEA / FEMA / IRS)
    "grossYield": "Gross rent yield (ZORI/ZHVI)",
    "rentYoY": "Rent growth YoY",
    "invYoY": "For-sale inventory YoY",
    "priceToIncome": "Price-to-income (BEA)",
    "incomeGrowth5y": "Per-capita income growth 5y",
    "nriScore": "FEMA hazard risk score",
    "netMigRate": "Net migration / population",
    # subtle-signal sidecars (HMDA, Census permits, NFIP)
    "investorShare": "Investor share of purchases (HMDA)",
    "denialRate": "Mortgage denial rate (HMDA)",
    "permitsPer1k": "Building permits / 1k residents",
    "permitsVs5y": "Permits vs own 5-yr norm",
    "claimsTrend": "NFIP flood-claims trend",
}

CONTEXT_FIELDS = ("grossYield", "rentYoY", "invYoY", "priceToIncome", "incomeGrowth5y", "nriScore",
                  "investorShare", "denialRate", "permitsPer1k", "permitsVs5y", "claimsTrend")


def market_metrics(returns: list[float]) -> dict | None:
    r = np.asarray(returns, dtype=float)
    if len(r) < 24:
        return None
    mu_q, sd_q = r.mean(), r.std(ddof=1)
    cum = np.cumprod(1 + r)
    peak = np.maximum.accumulate(cum)
    mdd = float(((cum - peak) / peak).min())
    r5 = r[-20:]
    g5 = float((np.prod(1 + r5)) ** (4 / len(r5)) - 1)
    return {
        "mu_ann": float(mu_q * 4),
        "sigma_ann": float(sd_q * 2),
        "sharpe_like": float(mu_q * 4 / (sd_q * 2)) if sd_q > 0 else None,
        "growth_5y": g5,
        "max_drawdown": mdd,
    }


MIN_N = 100  # below this a correlation is noise — county fields rarely join to cities

def pearson(x: np.ndarray, y: np.ndarray) -> tuple[float, float, int]:
    n = len(x)
    if n < MIN_N:
        return float("nan"), float("nan"), n
    r = float(np.corrcoef(x, y)[0, 1])
    # two-sided p via t approximation
    if abs(r) >= 1.0:
        return r, 0.0, n
    t = r * math.sqrt((n - 2) / (1 - r * r))
    # survival function of t-dist ~ normal for large n
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
    return r, p, n


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    rx = np.argsort(np.argsort(x)).astype(float)
    ry = np.argsort(np.argsort(y)).astype(float)
    return float(np.corrcoef(rx, ry)[0, 1]) if len(x) >= 8 else float("nan")


def segment_rows(markets: dict, kind: str) -> list[dict]:
    rows = []
    for key, c in markets.items():
        if kind == "cities" and "County" in key:
            continue
        if kind == "counties" and "County" not in key:
            continue
        series = RETURNS.get(key) or RETURNS.get(key.replace(" (city)", ""))
        if not series:
            continue
        m = market_metrics(series["returns"])
        if not m:
            continue
        pop = c.get("pop") or 0
        row = {
            "key": key, "v": c["v"], "p": c["p"],
            "pop_log": math.log10(pop) if pop > 0 else None, **m,
        }
        ctx = CONTEXT.get(key) or CONTEXT.get(key.replace(" (city)", "")) or {}
        for f in CONTEXT_FIELDS:
            row[f] = ctx.get(f)
        if ctx.get("netMigHH") is not None and pop > 0:
            row["netMigRate"] = ctx["netMigHH"] / pop
        else:
            row["netMigRate"] = None
        rows.append(row)
    return rows


def correlate(rows: list[dict]) -> dict:
    out = {}
    for crime_var in ("v", "p"):
        out[crime_var] = {}
        cv = np.array([r[crime_var] for r in rows], dtype=float)
        # winsorize crime rates at 1%/99% to tame reporting artifacts
        lo, hi = np.nanpercentile(cv, [1, 99])
        keep0 = (cv >= lo) & (cv <= hi)
        for metric in METRICS:
            pairs = [(r[crime_var], r[metric]) for r, k in zip(rows, keep0)
                     if k and r.get(metric) is not None and np.isfinite(r[metric])]
            if len(pairs) < MIN_N:
                continue
            x = np.array([a for a, _ in pairs])
            y = np.array([b for _, b in pairs])
            r_p, p_val, n = pearson(x, y)
            if not np.isfinite(r_p):
                continue
            out[crime_var][metric] = {
                "pearson": round(r_p, 3), "spearman": round(spearman(x, y), 3),
                "p": round(p_val, 5), "n": n,
            }
    return out


def main():
    markets = CRIME.get("markets", {})
    print(f"crime markets: {len(markets)}")

    result = {"year": CRIME.get("year"), "metricLabels": METRICS, "segments": {}}
    for seg in ("all", "cities", "counties"):
        rows = segment_rows(markets, seg)
        if len(rows) < 8:
            print(f"  {seg}: only {len(rows)} joined rows — skipped")
            continue
        result["segments"][seg] = {"n": len(rows), "matrix": correlate(rows)}
        print(f"\n=== {seg} (n={len(rows)}) ===")
        for cv, label in (("v", "Violent"), ("p", "Property")):
            for metric, stats in result["segments"][seg]["matrix"][cv].items():
                print(f"  {label:9s} × {metric:13s} r={stats['pearson']:+.3f} "
                      f"(ρ={stats['spearman']:+.3f}, n={stats['n']}, p={stats['p']})")

    # scatter for the UI: violent rate vs 5y growth — ALL joined markets, so the
    # frontend can highlight any user-selected market and compute percentiles
    rows = segment_rows(markets, "all")
    rows = [r for r in rows if r.get("growth_5y") is not None and np.isfinite(r["growth_5y"])]
    # winsorize the crime axis like the matrix does, so one mis-reported agency
    # can't stretch the plot
    vvals = np.array([r["v"] for r in rows])
    lo, hi = np.nanpercentile(vvals, [0.5, 99.5])
    rows = [r for r in rows if lo <= r["v"] <= hi]
    pts = [{"k": r["key"], "x": round(r["v"], 1), "y": round(r["growth_5y"], 4)} for r in rows]
    # least-squares trend line so the UI doesn't have to fit anything
    x = np.array([p["x"] for p in pts]); y = np.array([p["y"] for p in pts])
    slope, intercept = np.polyfit(x, y, 1)
    r_xy = float(np.corrcoef(x, y)[0, 1])
    result["scatter"] = {
        "label": "Violent crime rate vs 5-yr annualized return — every matched market",
        "points": pts,
        "trend": {"slope": float(slope), "intercept": float(intercept),
                  "r": round(r_xy, 3), "r2": round(r_xy * r_xy, 4),
                  "xMin": float(x.min()), "xMax": float(x.max())},
    }

    out = ROOT / "public/crime-correlations.json"
    out.write_text(json.dumps(result, separators=(",", ":")))
    print(f"\nWrote {out} ({out.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
