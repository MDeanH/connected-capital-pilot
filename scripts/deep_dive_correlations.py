#!/usr/bin/env python3
"""
Statistical deep dive over every cross-market dataset the platform has
assembled, to determine which relationships are real, strong, and stable
enough to matter for deal scoring.

Goes well beyond scripts/crime_correlations.py (which only correlated crime
against return metrics):

  STAGE 1  master cross-section table (one row per market) joining
           metros.json return metrics + market-context.json fields +
           crime-stats.json + segment labels (msa/county/city) + state.
  STAGE 2  cross-sectional mining done right: full pairwise Pearson AND
           Spearman matrix, Benjamini-Hochberg FDR across all pairs,
           PARTIAL correlations controlling log-population + state fixed
           effects (within-state demeaning), and per-segment stability.
  STAGE 3  predictive backtests from raw monthly price/rent/income levels:
             3a  momentum/reversal: past 5y growth vs NEXT 5y growth
                 (vintages 2005/2010/2015/2020 + the GFC window)
             3b  gross-yield vintages (ZORI*12/ZHVI at 2016/2018/2020/2022)
                 vs forward 3y price growth and forward rent growth
             3c  price-to-income vintages (county ZHVI / BEA per-capita
                 income) vs forward 5y growth and GFC drawdown
             3d  volatility & drawdown persistence (2000-12 vs 2013-25)
             3e  permits 2020-21 per 1k (BPS + BEA pop) vs 2022-26 growth
  STAGE 4  independent re-derivation of the published crime correlations
           (public/crime-correlations.json) and a replication check.

Inputs (read-only — never modified):
  netlify/functions/lib/metros.json        quarterly total-return series
  public/market-context.json               per-market context fields
  public/crime-stats.json                  FBI 2025 rates per 100k
  public/crime-correlations.json           published numbers (replication)
  data/zillow_zhvi_{metro,county,city}_raw.csv   monthly ZHVI levels
  data/zori_{msa,county,city}.csv          monthly ZORI rent levels (2015+)
  data/bea_cainc1.zip                      county income + population 1969-2024
  data/bps_co20{20..25}a_raw.txt           county building permits

Outputs (worktree, gitignored):
  data/deep_dive_master.csv      the master cross-section table
  data/deep_dive_results.json    every computed statistic, machine-readable
  reference/deep-dive-charts/*.png  (if matplotlib available)
plus a full human-readable dump on stdout — every number in
reference/correlation-deep-dive.md comes from this output.

Run:  .venv/bin/python scripts/deep_dive_correlations.py
(~2-3 min; the city ZHVI file is 88 MB)
"""

from __future__ import annotations

import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
# raw bulk files are gitignored, so in a worktree they only exist in the main
# checkout's data/ — resolve whichever data dir actually has them
_CAND = [ROOT / "data", Path("/Users/friday/Projects/ai-diligence-tool/data")]
DATA = next(d for d in _CAND if (d / "zillow_zhvi_metro_raw.csv").exists())
OUT = ROOT / "data"          # intermediates (gitignored: data/*.csv, *.json)
CHARTS = ROOT / "reference" / "deep-dive-charts"

MIN_N = 100                  # same floor as the published methodology
WINSOR = (1, 99)             # winsorize percentiles for Pearson

RESULTS: dict = {}           # everything we print also lands here


# --------------------------------------------------------------------------
# small statistical helpers
# --------------------------------------------------------------------------

def winsorize(x: np.ndarray, lo=WINSOR[0], hi=WINSOR[1]) -> np.ndarray:
    a, b = np.nanpercentile(x, [lo, hi])
    return np.clip(x, a, b)


def corr_pair(x: np.ndarray, y: np.ndarray) -> dict | None:
    """Pearson (winsorized) + Spearman + exact p-values. None if n < MIN_N."""
    m = np.isfinite(x) & np.isfinite(y)
    n = int(m.sum())
    if n < MIN_N:
        return None
    xw, yw = winsorize(x[m]), winsorize(y[m])
    if np.std(xw) == 0 or np.std(yw) == 0:
        return None
    rp, pp = stats.pearsonr(xw, yw)
    rs, ps = stats.spearmanr(x[m], y[m])
    return {"r": float(rp), "p_r": float(pp), "rho": float(rs),
            "p_rho": float(ps), "n": n}


def bh_fdr(pvals: list[float], alpha=0.05) -> list[bool]:
    """Benjamini-Hochberg: which p-values survive FDR control at alpha."""
    m = len(pvals)
    order = np.argsort(pvals)
    passed = np.zeros(m, dtype=bool)
    thresh = 0.0
    for rank, idx in enumerate(order, start=1):
        if pvals[idx] <= alpha * rank / m:
            thresh = pvals[idx]
    for i, p in enumerate(pvals):
        passed[i] = p <= thresh and thresh > 0
    return passed.tolist()


def partial_corr(df: pd.DataFrame, x: str, y: str,
                 rank: bool = False) -> dict | None:
    """Correlation of x,y after removing state fixed effects (demean within
    state) and log10(population). rank=True -> partial Spearman (ranks first).
    """
    sub = df[[x, y, "pop_log", "state"]].dropna()
    sub = sub[sub.groupby("state")["state"].transform("size") >= 5]
    n = len(sub)
    if n < MIN_N:
        return None
    cols = {}
    for c in (x, y, "pop_log"):
        v = sub[c].to_numpy(dtype=float)
        if rank:
            v = stats.rankdata(v)
        else:
            v = winsorize(v)
        cols[c] = v
    d = pd.DataFrame(cols)
    d["state"] = sub["state"].to_numpy()
    # state fixed effects = demean every column within state
    for c in (x, y, "pop_log"):
        d[c] = d[c] - d.groupby("state")[c].transform("mean")
    # then regress out (state-demeaned) log pop from x and y
    pv = np.ascontiguousarray(d["pop_log"].to_numpy(), dtype=np.float64)
    denom = float(np.sum(pv * pv))
    resid = {}
    for c in (x, y):
        v = np.ascontiguousarray(d[c].to_numpy(), dtype=np.float64)
        beta = float(np.sum(v * pv)) / denom if denom > 0 else 0.0
        resid[c] = v - beta * pv
    if np.std(resid[x]) == 0 or np.std(resid[y]) == 0:
        return None
    r, p = stats.pearsonr(resid[x], resid[y])
    return {"r": float(r), "p": float(p), "n": n}


def quintile_spread(signal: np.ndarray, outcome: np.ndarray) -> dict | None:
    """Mean outcome in top vs bottom signal quintile (effect size in
    outcome units, e.g. %/yr) — far more interpretable than r alone."""
    m = np.isfinite(signal) & np.isfinite(outcome)
    if m.sum() < MIN_N:
        return None
    s, o = signal[m], outcome[m]
    qs = np.nanpercentile(s, [20, 80])
    bot, top = o[s <= qs[0]], o[s >= qs[1]]
    return {"q1_mean": float(np.mean(bot)), "q5_mean": float(np.mean(top)),
            "spread": float(np.mean(top) - np.mean(bot)),
            "n": int(m.sum()), "n_q": int(min(len(bot), len(top)))}


def ann(p0: float, p1: float, months: int) -> float:
    return (p1 / p0) ** (12.0 / months) - 1.0


# --------------------------------------------------------------------------
# STAGE 1 — master cross-section table
# --------------------------------------------------------------------------

def market_metrics(returns: list[float]) -> dict | None:
    """Same definitions as scripts/crime_correlations.py (product metrics)."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 24:
        return None
    mu_q, sd_q = r.mean(), r.std(ddof=1)
    cum = np.cumprod(1 + r)
    peak = np.maximum.accumulate(cum)
    mdd = float(((cum - peak) / peak).min())
    r5 = r[-20:]
    g5 = float(np.prod(1 + r5) ** (4 / len(r5)) - 1)
    return {"mu_ann": float(mu_q * 4), "sigma_ann": float(sd_q * 2),
            "sharpe_like": float(mu_q * 4 / (sd_q * 2)) if sd_q > 0 else np.nan,
            "growth_5y": g5, "max_drawdown": mdd, "n_q": len(r)}


def build_master() -> pd.DataFrame:
    returns = json.loads((ROOT / "netlify/functions/lib/metros.json").read_text())
    context = json.loads((ROOT / "public/market-context.json").read_text())["markets"]
    crime = json.loads((ROOT / "public/crime-stats.json").read_text())["markets"]

    # segment labels from the raw Zillow files (key construction mirrors
    # scripts/add_zillow_{counties,cities}.py)
    msa_names = set(pd.read_csv(DATA / "zillow_zhvi_metro_raw.csv",
                                usecols=["RegionName"])["RegionName"])
    cty = pd.read_csv(DATA / "zillow_zhvi_county_raw.csv",
                      usecols=["RegionName", "State", "StateCodeFIPS",
                               "MunicipalCodeFIPS"])
    county_names = set(cty["RegionName"] + ", " + cty["State"])

    # BEA county population (2024) for counties — more reliable than the FBI
    # agency population, and covers counties with no FBI agency match
    bea = load_bea()
    cty["fips"] = (cty["StateCodeFIPS"].astype(str).str.zfill(2)
                   + cty["MunicipalCodeFIPS"].astype(str).str.zfill(3))
    cty["key"] = cty["RegionName"] + ", " + cty["State"]
    fips_pop = bea["pop"].get(2024, {})
    county_pop = {k: fips_pop.get(f) for k, f in zip(cty["key"], cty["fips"])}

    rows = []
    for key, series in returns.items():
        if key == "United States":
            continue
        m = market_metrics(series["returns"])
        if m is None:
            continue
        if key in county_names:
            seg = "county"
        elif key in msa_names:
            seg = "msa"
        else:
            seg = "city"
        state = key.rsplit(", ", 1)[-1][:2]
        row = {"key": key, "segment": seg, "state": state, **m}

        ctx = context.get(key) or context.get(re.sub(r" \(city[^)]*\)", "", key)) or {}
        for f in ("rent", "rentYoY", "grossYield", "invYoY", "listVsZhvi",
                  "daysToPending", "income", "incomeGrowth5y", "priceToIncome",
                  "nriScore", "netMigHH", "netAGI_M", "inAvgAGI",
                  "investorShare", "denialRate", "loanCount", "permits",
                  "permitsPer1k", "permitsVs5y", "sfShare", "claims10y",
                  "paid10yM", "claimsTrend", "nonRenewalRate"):
            row[f] = ctx.get(f)

        # crime joins on the bare "Name, ST" key (no "(city)" suffix)
        ck = re.sub(r" \(city[^)]*\)", "", key)
        cr = crime.get(key) or crime.get(ck)
        if cr and seg != "msa":     # an MSA key matching a same-named CITY
            row["v"], row["p"] = cr["v"], cr["p"]   # agency would be a bad
            row["crime_pop"] = cr.get("pop")        # geography join
        rows.append(row)

    df = pd.DataFrame(rows).set_index("key")

    # population: BEA for counties, FBI agency population otherwise
    df["pop"] = df["crime_pop"]
    is_cty = df["segment"] == "county"
    df.loc[is_cty, "pop"] = df.index.map(county_pop).to_numpy()[is_cty]
    df.loc[df["pop"] <= 0, "pop"] = np.nan
    df["pop_log"] = np.log10(df["pop"])

    # derived per-capita / ratio fields (raw counts scale with size)
    df["netMigRate"] = df["netMigHH"] / df["pop"]
    df["netAGIperCap"] = df["netAGI_M"] * 1e6 / df["pop"]
    df["inAGIRatio"] = df["inAvgAGI"] / df["income"]   # in-migrant HH AGI vs
    df["claimsPer1k"] = df["claims10y"] / df["pop"] * 1000  # resident income
    df["income_log"] = np.log10(df["income"])
    df["rent_log"] = np.log10(df["rent"])

    out = OUT / "deep_dive_master.csv"
    df.to_csv(out)
    print(f"[stage1] master table: {len(df)} markets "
          f"(msa {sum(df.segment=='msa')}, county {sum(df.segment=='county')}, "
          f"city {sum(df.segment=='city')}) -> {out}")
    print(f"[stage1] coverage: crime {df['v'].notna().sum()}, "
          f"context-yield {df['grossYield'].notna().sum()}, "
          f"county-fields {df['nriScore'].notna().sum()}, "
          f"pop {df['pop'].notna().sum()}")
    return df


# --------------------------------------------------------------------------
# STAGE 2 — cross-sectional mining with FDR + partials + segments
# --------------------------------------------------------------------------

RETURN_VARS = ["mu_ann", "sigma_ann", "sharpe_like", "growth_5y", "max_drawdown"]
PREDICTORS = [
    "pop_log", "v", "p", "grossYield", "rentYoY", "invYoY", "listVsZhvi",
    "daysToPending", "income_log", "incomeGrowth5y", "priceToIncome",
    "nriScore", "netMigRate", "netAGIperCap", "inAGIRatio", "investorShare",
    "denialRate", "permitsPer1k", "permitsVs5y", "sfShare", "claimsPer1k",
    "claimsTrend", "nonRenewalRate", "rent_log",
]


def stage2(df: pd.DataFrame) -> None:
    print("\n" + "=" * 78)
    print("STAGE 2 — cross-sectional mining (all markets pooled)")
    print("=" * 78)

    all_vars = RETURN_VARS + PREDICTORS
    pairs = []
    for i, a in enumerate(all_vars):
        for b in all_vars[i + 1:]:
            c = corr_pair(df[a].to_numpy(dtype=float), df[b].to_numpy(dtype=float))
            if c:
                pairs.append({"x": a, "y": b, **c})
    # BH-FDR over EVERY pair we computed (the honest correction)
    flags = bh_fdr([p["p_rho"] for p in pairs])
    for p, f in zip(pairs, flags):
        p["fdr_pass"] = bool(f)
    n_pass = sum(flags)
    print(f"[stage2] computed {len(pairs)} pairs; {n_pass} pass BH-FDR(0.05) "
          f"on Spearman p — but with n in the thousands significance is cheap;"
          f" effect size is the bar that matters")

    # the pairs that involve a return metric, sorted by |rho|
    rp = [p for p in pairs if p["x"] in RETURN_VARS or p["y"] in RETURN_VARS]
    rp.sort(key=lambda p: -abs(p["rho"]))
    print(f"\n--- return-metric pairs, by |Spearman| (top 40 of {len(rp)}) ---")
    print(f"{'pair':42s} {'r':>7s} {'rho':>7s} {'r2':>6s} {'n':>6s}  FDR")
    for p in rp[:40]:
        print(f"{p['x']+' x '+p['y']:42s} {p['r']:+.3f} {p['rho']:+.3f} "
              f"{p['r']**2:6.3f} {p['n']:6d}  {'pass' if p['fdr_pass'] else 'FAIL'}")

    # predictor-vs-predictor pairs worth knowing (confound map), top 15
    pp = [p for p in pairs
          if p["x"] in PREDICTORS and p["y"] in PREDICTORS]
    pp.sort(key=lambda p: -abs(p["rho"]))
    print(f"\n--- strongest predictor-x-predictor pairs (confound map) ---")
    for p in pp[:15]:
        print(f"{p['x']+' x '+p['y']:42s} r={p['r']:+.3f} rho={p['rho']:+.3f} "
              f"n={p['n']}")

    RESULTS["pairwise"] = pairs

    # ---- partial correlations: state FE + log10(pop) ----------------------
    print(f"\n--- PARTIAL correlations (state fixed effects + log pop) ---")
    print(f"{'predictor':16s} {'outcome':13s} {'raw rho':>8s} {'partial r':>10s}"
          f" {'partial rank-r':>14s} {'n':>6s}")
    partials = []
    for pred in PREDICTORS:
        if pred == "pop_log":
            continue
        for out_v in RETURN_VARS:
            raw = corr_pair(df[pred].to_numpy(float), df[out_v].to_numpy(float))
            pc = partial_corr(df, pred, out_v, rank=False)
            pr = partial_corr(df, pred, out_v, rank=True)
            if raw is None or pc is None:
                continue
            partials.append({"pred": pred, "out": out_v,
                             "raw_rho": raw["rho"], "raw_n": raw["n"],
                             "partial_r": pc["r"], "partial_p": pc["p"],
                             "partial_rank_r": pr["r"] if pr else None,
                             "n": pc["n"]})
    flags = bh_fdr([p["partial_p"] for p in partials])
    for p, f in zip(partials, flags):
        p["fdr_pass"] = bool(f)
    partials.sort(key=lambda p: -abs(p["partial_rank_r"] or 0))
    for p in partials:
        if abs(p["partial_rank_r"] or 0) < 0.05 and abs(p["raw_rho"]) < 0.05:
            continue
        print(f"{p['pred']:16s} {p['out']:13s} {p['raw_rho']:+8.3f} "
              f"{p['partial_r']:+10.3f} {p['partial_rank_r']:+14.3f} "
              f"{p['n']:6d} {'pass' if p['fdr_pass'] else 'FAIL'}")
    RESULTS["partials"] = partials

    # ---- per-segment stability --------------------------------------------
    print(f"\n--- per-segment Spearman (stability check) ---")
    seg_tbl = []
    hdr = f"{'predictor':16s} {'outcome':13s}"
    for seg in ("msa", "county", "city"):
        hdr += f" {seg+' rho':>10s} {'n':>6s}"
    print(hdr)
    for pred in PREDICTORS:
        for out_v in ("growth_5y", "mu_ann", "sigma_ann", "max_drawdown"):
            row = {"pred": pred, "out": out_v}
            vals = []
            for seg in ("msa", "county", "city"):
                d = df[df.segment == seg]
                c = corr_pair(d[pred].to_numpy(float), d[out_v].to_numpy(float))
                row[seg] = {"rho": c["rho"], "n": c["n"]} if c else None
                vals.append(c["rho"] if c else None)
            present = [v for v in vals if v is not None]
            if not present or max(abs(v) for v in present) < 0.08:
                continue
            line = f"{pred:16s} {out_v:13s}"
            for seg in ("msa", "county", "city"):
                if row[seg]:
                    line += f" {row[seg]['rho']:+10.3f} {row[seg]['n']:6d}"
                else:
                    line += f" {'--':>10s} {'--':>6s}"
            print(line)
            seg_tbl.append(row)
    RESULTS["segments"] = seg_tbl


# --------------------------------------------------------------------------
# raw level loaders (ZHVI / ZORI / BEA / BPS)
# --------------------------------------------------------------------------

def load_levels(path: Path, meta_cols: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.read_csv(path)
    date_cols = [c for c in df.columns if re.match(r"\d{4}-\d{2}-\d{2}", c)]
    meta = df[[c for c in meta_cols if c in df.columns]].copy()
    vals = df[date_cols].astype("float32")
    vals.columns = pd.to_datetime(date_cols)
    vals.index = meta.index
    return meta, vals


def col_at(vals: pd.DataFrame, ym: str) -> pd.Series:
    """Series of values at the month-end column for 'YYYY-MM'."""
    target = pd.Period(ym, freq="M").to_timestamp("M")
    if target in vals.columns:
        return vals[target]
    # nearest available month within 1 month
    diffs = abs(vals.columns - target)
    j = int(np.argmin(diffs))
    if diffs[j] <= pd.Timedelta(days=35):
        return vals.iloc[:, j]
    return pd.Series(np.nan, index=vals.index)


def growth(vals: pd.DataFrame, t0: str, t1: str) -> pd.Series:
    p0, p1 = col_at(vals, t0), col_at(vals, t1)
    months = (pd.Period(t1, "M") - pd.Period(t0, "M")).n
    return (p1 / p0) ** (12.0 / months) - 1.0


def max_dd_window(vals: pd.DataFrame, t0: str, t1: str) -> pd.Series:
    t0p = pd.Period(t0, "M").to_timestamp("M")
    t1p = pd.Period(t1, "M").to_timestamp("M")
    cols = [c for c in vals.columns if t0p <= c <= t1p]
    w = vals[cols]
    peak = w.cummax(axis=1)
    return ((w - peak) / peak).min(axis=1)


_BEA_CACHE: dict | None = None

def load_bea() -> dict:
    """{'pop': {year: {fips: v}}, 'pci': {year: {fips: v}}} from CAINC1."""
    global _BEA_CACHE
    if _BEA_CACHE is not None:
        return _BEA_CACHE
    with zipfile.ZipFile(DATA / "bea_cainc1.zip") as z:
        raw = z.read("CAINC1__ALL_AREAS_1969_2024.csv")
    df = pd.read_csv(io.BytesIO(raw), encoding="latin-1", dtype=str,
                     on_bad_lines="skip")
    df["GeoFIPS"] = df["GeoFIPS"].str.strip().str.strip('"')
    df = df[df["GeoFIPS"].str.len() == 5]
    df = df[~df["GeoFIPS"].str.endswith("000")]          # drop states/US
    years = [c for c in df.columns if re.match(r"^\d{4}$", c)]
    out: dict = {"pop": {}, "pci": {}}
    for code, name in ((2, "pop"), (3, "pci")):
        sub = df[df["LineCode"].astype(float) == code]
        for y in years:
            v = pd.to_numeric(sub[y], errors="coerce")
            out[name][int(y)] = dict(zip(sub["GeoFIPS"], v))
    _BEA_CACHE = out
    return out


# --------------------------------------------------------------------------
# STAGE 3 — predictive backtests
# --------------------------------------------------------------------------

def stage3() -> dict:
    print("\n" + "=" * 78)
    print("STAGE 3 — predictive backtests (raw monthly levels, price-only)")
    print("=" * 78)
    bt: dict = {}

    levels = {}
    for lvl, fname in (("msa", "zillow_zhvi_metro_raw.csv"),
                       ("county", "zillow_zhvi_county_raw.csv"),
                       ("city", "zillow_zhvi_city_raw.csv")):
        meta, vals = load_levels(DATA / fname,
                                 ["RegionID", "RegionName", "State",
                                  "StateName", "StateCodeFIPS",
                                  "MunicipalCodeFIPS"])
        if lvl == "msa":
            keep = meta["RegionName"] != "United States"
            meta, vals = meta[keep], vals[keep]
        levels[lvl] = (meta, vals)
        print(f"[stage3] {lvl}: {len(meta)} regions, "
              f"{vals.columns[0]:%Y-%m}..{vals.columns[-1]:%Y-%m}")

    # ---- 3a momentum / reversal -------------------------------------------
    print("\n--- 3a  cross-market momentum: past 5y growth vs NEXT 5y growth ---")
    print(f"{'level':7s} {'vintage':18s} {'rho':>7s} {'n':>6s} "
          f"{'Q5-Q1 fwd spread':>17s}  (top minus bottom prior-growth quintile, %/yr)")
    bt["momentum"] = []
    windows = [("2000-01", "2005-01", "2010-01"),
               ("2005-01", "2010-01", "2015-01"),
               ("2010-01", "2015-01", "2020-01"),
               ("2015-01", "2020-01", "2025-01")]
    for lvl, (meta, vals) in levels.items():
        for a, b, c in windows:
            g_prior = growth(vals, a, b).to_numpy()
            g_fwd = growth(vals, b, c).to_numpy()
            cp = corr_pair(g_prior, g_fwd)
            qs = quintile_spread(g_prior, g_fwd)
            if cp is None:
                continue
            rec = {"level": lvl, "prior": f"{a}->{b}", "fwd": f"{b}->{c}",
                   "rho": cp["rho"], "r": cp["r"], "n": cp["n"],
                   "q5_q1": qs["spread"] if qs else None}
            bt["momentum"].append(rec)
            print(f"{lvl:7s} {b[:4]+' (prior '+a[:4]+'-'+b[:4]+')':18s} "
                  f"{cp['rho']:+7.3f} {cp['n']:6d} "
                  f"{(qs['spread']*100 if qs else float('nan')):+16.2f}%")

    # the GFC reversal window specifically
    print("\n    GFC test: 2000-2006H1 boom growth vs 2006H1-2012H1 outcome")
    bt["gfc_reversal"] = []
    for lvl, (meta, vals) in levels.items():
        g_boom = growth(vals, "2000-01", "2006-06").to_numpy()
        g_bust = growth(vals, "2006-06", "2012-06").to_numpy()
        dd = max_dd_window(vals, "2006-06", "2012-12").to_numpy()
        c1 = corr_pair(g_boom, g_bust)
        c2 = corr_pair(g_boom, dd)
        q = quintile_spread(g_boom, g_bust)
        if c1:
            rec = {"level": lvl, "rho_fwd": c1["rho"], "rho_dd": c2["rho"] if c2 else None,
                   "n": c1["n"], "q5_q1": q["spread"] if q else None}
            bt["gfc_reversal"].append(rec)
            print(f"    {lvl:7s} boom-vs-bust rho={c1['rho']:+.3f} "
                  f"boom-vs-drawdown rho={(c2['rho'] if c2 else float('nan')):+.3f} "
                  f"n={c1['n']} Q5-Q1 fwd={q['spread']*100:+.2f}%/yr")

    # ---- 3b gross-yield vintages ------------------------------------------
    print("\n--- 3b  gross yield (ZORI*12/ZHVI) vintages vs forward growth ---")
    print(f"{'level':7s} {'vintage':8s} {'fwd':12s} {'rho px':>8s} {'Q5-Q1 px':>10s}"
          f" {'rho rent':>9s} {'Q5-Q1 rent':>11s} {'n':>6s}")
    bt["yield"] = []
    zori_files = {"msa": "zori_msa.csv", "county": "zori_county.csv",
                  "city": "zori_city.csv"}
    for lvl, fname in zori_files.items():
        zmeta, zvals = load_levels(DATA / fname, ["RegionID", "RegionName"])
        hmeta, hvals = levels[lvl]
        # align on Zillow RegionID
        zid = zmeta["RegionID"].to_numpy()
        hid = hmeta["RegionID"].to_numpy()
        common, zi, hi = np.intersect1d(zid, hid, return_indices=True)
        zv = zvals.iloc[zi].reset_index(drop=True)
        hv = hvals.iloc[hi].reset_index(drop=True)
        for vint in ("2016-01", "2018-01", "2020-01", "2022-01"):
            t1 = f"{int(vint[:4])+3}-01"
            y = (col_at(zv, vint).to_numpy() * 12.0
                 / col_at(hv, vint).to_numpy())
            y[(y < 0.01) | (y > 0.35)] = np.nan       # junk joins
            g_px = growth(hv, vint, t1).to_numpy()
            g_rent = growth(zv, vint, t1).to_numpy()
            cp = corr_pair(y, g_px)
            cr = corr_pair(y, g_rent)
            qp = quintile_spread(y, g_px)
            qr = quintile_spread(y, g_rent)
            if cp is None:
                continue
            rec = {"level": lvl, "vintage": vint, "fwd": f"{vint}->{t1}",
                   "rho_px": cp["rho"], "q_px": qp["spread"] if qp else None,
                   "rho_rent": cr["rho"] if cr else None,
                   "q_rent": qr["spread"] if qr else None, "n": cp["n"]}
            bt["yield"].append(rec)
            print(f"{lvl:7s} {vint:8s} {vint+'->'+t1:12s} {cp['rho']:+8.3f} "
                  f"{(qp['spread']*100 if qp else float('nan')):+9.2f}% "
                  f"{(cr['rho'] if cr else float('nan')):+9.3f} "
                  f"{(qr['spread']*100 if qr else float('nan')):+10.2f}% {cp['n']:6d}")

    # ---- 3c price-to-income vintages (counties) ----------------------------
    print("\n--- 3c  county price-to-income vintages vs forward outcomes ---")
    bea = load_bea()
    meta, vals = levels["county"]
    fips = (meta["StateCodeFIPS"].astype(str).str.zfill(2)
            + meta["MunicipalCodeFIPS"].astype(str).str.zfill(3)).to_numpy()

    def pti_at(year: int) -> np.ndarray:
        inc = bea["pci"].get(year - 1, {})     # use prior-year income
        px = col_at(vals, f"{year}-01").to_numpy()
        iv = np.array([inc.get(f, np.nan) for f in fips], dtype=float)
        return px / iv

    # PTI "stretch" = PTI vs the county's own 2000-2002 average
    base = np.nanmean(np.column_stack([pti_at(y) for y in (2000, 2001, 2002)]),
                      axis=1)

    print(f"{'vintage':8s} {'outcome':22s} {'raw PTI rho':>12s} "
          f"{'stretch rho':>12s} {'Q5-Q1 (stretch)':>16s} {'n':>6s}")
    bt["pti"] = []
    tests = [(2005, "fwd 5y growth", "2005-01", "2010-01", None),
             (2007, "fwd 5y growth", "2007-01", "2012-01", None),
             (2007, "max DD 2007-2012", None, None, ("2007-01", "2012-12")),
             (2012, "fwd 5y growth", "2012-01", "2017-01", None),
             (2016, "fwd 5y growth", "2016-01", "2021-01", None),
             (2019, "fwd 5y growth", "2019-01", "2024-01", None),
             (2021, "fwd 4y growth", "2021-01", "2025-01", None)]
    for year, label, t0, t1, ddw in tests:
        pti = pti_at(year)
        stretch = pti / base
        if ddw:
            outcome = max_dd_window(vals, *ddw).to_numpy()
        else:
            outcome = growth(vals, t0, t1).to_numpy()
        c_raw = corr_pair(pti, outcome)
        c_str = corr_pair(stretch, outcome)
        q = quintile_spread(stretch, outcome)
        if c_raw is None:
            continue
        rec = {"vintage": year, "outcome": label, "rho_raw": c_raw["rho"],
               "rho_stretch": c_str["rho"] if c_str else None,
               "q5_q1_stretch": q["spread"] if q else None, "n": c_raw["n"]}
        bt["pti"].append(rec)
        unit = "%" if ddw else "%/yr"
        print(f"{year:<8d} {label:22s} {c_raw['rho']:+12.3f} "
              f"{(c_str['rho'] if c_str else float('nan')):+12.3f} "
              f"{(q['spread']*100 if q else float('nan')):+13.2f}{unit:5s} "
              f"{c_raw['n']:6d}")

    # ---- 3d volatility & drawdown persistence ------------------------------
    print("\n--- 3d  volatility / drawdown persistence ---")
    bt["persistence"] = []
    for lvl, (meta, v) in levels.items():
        q = v.T.resample("QE").last().pct_change().T   # quarterly returns
        c1 = [c for c in q.columns if c.year <= 2012 and c.year >= 2001]
        c2 = [c for c in q.columns if c.year >= 2013]
        vol1 = q[c1].std(axis=1).to_numpy()
        vol2 = q[c2].std(axis=1).to_numpy()
        # need enough quarters on both sides
        ok = (q[c1].notna().sum(axis=1) >= 24) & (q[c2].notna().sum(axis=1) >= 24)
        cp = corr_pair(np.where(ok, vol1, np.nan), np.where(ok, vol2, np.nan))
        dd1 = max_dd_window(v, "2006-01", "2012-12").to_numpy()
        dd2 = max_dd_window(v, "2022-01", "2025-12").to_numpy()
        cd = corr_pair(dd1, dd2)
        if cp:
            rec = {"level": lvl, "vol_rho": cp["rho"], "vol_n": cp["n"],
                   "dd_rho": cd["rho"] if cd else None,
                   "dd_n": cd["n"] if cd else None}
            bt["persistence"].append(rec)
            print(f"{lvl:7s} vol(01-12) vs vol(13-25): rho={cp['rho']:+.3f} "
                  f"n={cp['n']};  GFC DD vs 2022-25 DD: "
                  f"rho={(cd['rho'] if cd else float('nan')):+.3f} "
                  f"n={cd['n'] if cd else 0}")

    # ---- 3e permits 2020-21 vs subsequent growth ---------------------------
    print("\n--- 3e  permits 2020-21 per 1k residents vs 2022-2026 growth ---")
    meta, vals = levels["county"]          # 3d's loop rebound these names
    fips = (meta["StateCodeFIPS"].astype(str).str.zfill(2)
            + meta["MunicipalCodeFIPS"].astype(str).str.zfill(3)).to_numpy()
    units = {}
    for yr in (2020, 2021):
        f = DATA / f"bps_co{yr}a_raw.txt"
        raw = pd.read_csv(f, skiprows=2, header=None, dtype=str,
                          on_bad_lines="skip")
        st = raw[1].str.strip().str.zfill(2)
        co = raw[2].str.strip().str.zfill(3)
        tot = (pd.to_numeric(raw[7], errors="coerce").fillna(0)
               + pd.to_numeric(raw[10], errors="coerce").fillna(0)
               + pd.to_numeric(raw[13], errors="coerce").fillna(0)
               + pd.to_numeric(raw[16], errors="coerce").fillna(0))
        for f5, u in zip(st + co, tot):
            units[f5] = units.get(f5, 0.0) + float(u)
    pop21 = bea["pop"].get(2021, {})
    permits_1k = np.array([units.get(f, np.nan)
                           / pop21.get(f, np.nan) * 1000 / 2.0
                           for f in fips], dtype=float)   # avg units/yr per 1k
    g_px = growth(vals, "2022-01", "2026-01").to_numpy()
    zmeta, zvals = load_levels(DATA / "zori_county.csv", ["RegionID"])
    zid, hid = zmeta["RegionID"].to_numpy(), meta["RegionID"].to_numpy()
    common, zi, hi = np.intersect1d(zid, hid, return_indices=True)
    g_rent_al = np.full(len(meta), np.nan)
    g_rent_al[hi] = growth(zvals.iloc[zi].reset_index(drop=True),
                           "2022-01", "2026-01").to_numpy()
    cp = corr_pair(permits_1k, g_px)
    cr = corr_pair(permits_1k, g_rent_al)
    qp = quintile_spread(permits_1k, g_px)
    qr = quintile_spread(permits_1k, g_rent_al)
    bt["permits"] = {"rho_px": cp["rho"] if cp else None,
                     "n_px": cp["n"] if cp else 0,
                     "rho_rent": cr["rho"] if cr else None,
                     "n_rent": cr["n"] if cr else 0,
                     "q_px": qp["spread"] if qp else None,
                     "q_rent": qr["spread"] if qr else None}
    if cp:
        print(f"counties: permits/1k vs fwd price growth rho={cp['rho']:+.3f} "
              f"(n={cp['n']}, Q5-Q1 {qp['spread']*100:+.2f}%/yr); "
              f"vs fwd rent growth rho={(cr['rho'] if cr else float('nan')):+.3f} "
              f"(n={cr['n'] if cr else 0}, "
              f"Q5-Q1 {(qr['spread']*100 if qr else float('nan')):+.2f}%/yr)")

    # ---- 3f robustness: are the headline backtest signals within-state? ----
    # A cross-market signal could be "all sunbelt": demean ranks within state
    # and re-correlate. If the within-state rho holds up, the signal is not
    # just a region bet.
    print("\n--- 3f  robustness: within-state (state-demeaned rank) versions ---")

    def within_state_rho(sig: np.ndarray, out: np.ndarray,
                         states: np.ndarray) -> tuple[float, int] | None:
        m = np.isfinite(sig) & np.isfinite(out) & (states != None)  # noqa: E711
        if m.sum() < MIN_N:
            return None
        d = pd.DataFrame({"s": stats.rankdata(sig[m]),
                          "o": stats.rankdata(out[m]),
                          "st": states[m]})
        d = d[d.groupby("st")["st"].transform("size") >= 5]
        for c in ("s", "o"):
            d[c] = d[c] - d.groupby("st")[c].transform("mean")
        r, _ = stats.pearsonr(d["s"], d["o"])
        return float(r), len(d)

    bt["within_state"] = {}
    # yield signal, city level, every vintage
    zmeta, zvals = load_levels(DATA / "zori_city.csv", ["RegionID"])
    hmeta, hvals = levels["city"]
    zid, hid = zmeta["RegionID"].to_numpy(), hmeta["RegionID"].to_numpy()
    common, zi, hi = np.intersect1d(zid, hid, return_indices=True)
    zv = zvals.iloc[zi].reset_index(drop=True)
    hv = hvals.iloc[hi].reset_index(drop=True)
    st = hmeta["State"].to_numpy()[hi]
    for vint in ("2016-01", "2018-01", "2020-01", "2022-01"):
        t1 = f"{int(vint[:4])+3}-01"
        y = col_at(zv, vint).to_numpy() * 12.0 / col_at(hv, vint).to_numpy()
        y[(y < 0.01) | (y > 0.35)] = np.nan
        g = growth(hv, vint, t1).to_numpy()
        ws = within_state_rho(y, g, st)
        if ws:
            bt["within_state"][f"yield_city_{vint}"] = {"rho": ws[0], "n": ws[1]}
            print(f"  yield city {vint}: within-state rank-r={ws[0]:+.3f} "
                  f"n={ws[1]}")
    # momentum 2020 vintage, county level
    cmeta, cvals = levels["county"]
    g_prior = growth(cvals, "2015-01", "2020-01").to_numpy()
    g_fwd = growth(cvals, "2020-01", "2025-01").to_numpy()
    ws = within_state_rho(g_prior, g_fwd, cmeta["State"].to_numpy())
    if ws:
        bt["within_state"]["momentum_county_2020"] = {"rho": ws[0], "n": ws[1]}
        print(f"  momentum county 2020: within-state rank-r={ws[0]:+.3f} n={ws[1]}")
    # GFC reversal, county level
    g_boom = growth(cvals, "2000-01", "2006-06").to_numpy()
    g_bust = growth(cvals, "2006-06", "2012-06").to_numpy()
    ws = within_state_rho(g_boom, g_bust, cmeta["State"].to_numpy())
    if ws:
        bt["within_state"]["gfc_reversal_county"] = {"rho": ws[0], "n": ws[1]}
        print(f"  GFC reversal county: within-state rank-r={ws[0]:+.3f} n={ws[1]}")
    # permits vs forward rent growth (the headline supply finding)
    fips = (cmeta["StateCodeFIPS"].astype(str).str.zfill(2)
            + cmeta["MunicipalCodeFIPS"].astype(str).str.zfill(3)).to_numpy()
    permits_1k = np.array([units.get(f, np.nan) / pop21.get(f, np.nan) * 1000 / 2.0
                           for f in fips], dtype=float)
    ws = within_state_rho(permits_1k, g_rent_al, cmeta["State"].to_numpy())
    if ws:
        bt["within_state"]["permits_rent_county"] = {"rho": ws[0], "n": ws[1]}
        print(f"  permits->rent county: within-state rank-r={ws[0]:+.3f} n={ws[1]}")
    # PTI 2007 -> GFC drawdown
    meta_c, vals_c = levels["county"]
    inc06 = load_bea()["pci"].get(2006, {})
    px07 = col_at(vals_c, "2007-01").to_numpy()
    iv = np.array([inc06.get(f, np.nan) for f in fips], dtype=float)
    pti07 = px07 / iv
    dd_gfc = max_dd_window(vals_c, "2007-01", "2012-12").to_numpy()
    ws = within_state_rho(pti07, dd_gfc, meta_c["State"].to_numpy())
    if ws:
        bt["within_state"]["pti2007_dd_county"] = {"rho": ws[0], "n": ws[1]}
        print(f"  PTI2007->GFC DD county: within-state rank-r={ws[0]:+.3f} n={ws[1]}")

    RESULTS["backtests"] = bt

    # keep levels around for charts
    return {"levels": levels}


# --------------------------------------------------------------------------
# STAGE 4 — replication of the published crime correlations
# --------------------------------------------------------------------------

def stage4(df: pd.DataFrame) -> None:
    print("\n" + "=" * 78)
    print("STAGE 4 — replication check vs public/crime-correlations.json")
    print("=" * 78)
    pub = json.loads((ROOT / "public/crime-correlations.json").read_text())
    mine = {}
    # replicate the published 'all' segment: winsorize CRIME at 1/99 only,
    # plain Pearson (their methodology), against each metric
    seg = df[df["v"].notna()].copy()
    v = seg["v"].to_numpy(float)
    lo, hi = np.nanpercentile(v, [1, 99])
    keep = (v >= lo) & (v <= hi)
    print(f"joined crime markets: {len(seg)} (published n=10801 incl. msa-name "
          f"matches; we exclude msa-key joins as geographically wrong)")
    rows = []
    for metric in ("mu_ann", "sigma_ann", "sharpe_like", "growth_5y",
                   "max_drawdown", "pop_log", "grossYield", "priceToIncome",
                   "nriScore", "rentYoY", "incomeGrowth5y"):
        y = seg[metric].to_numpy(float)
        m = keep & np.isfinite(y) & np.isfinite(v)
        if m.sum() < MIN_N:
            continue
        r = float(np.corrcoef(v[m], y[m])[0, 1])
        rho = float(stats.spearmanr(v[m], y[m]).statistic)
        pub_r = (pub["segments"]["all"]["matrix"]["v"].get(metric) or {}).get("pearson")
        rows.append({"metric": metric, "mine_r": r, "mine_rho": rho,
                     "n": int(m.sum()), "published_r": pub_r,
                     "delta": None if pub_r is None else r - pub_r})
        print(f"  v x {metric:15s} mine r={r:+.3f} rho={rho:+.3f} "
              f"n={m.sum():6d} | published r="
              f"{('%+.3f' % pub_r) if pub_r is not None else '   --'} "
              f"{'OK' if pub_r is not None and abs(r-pub_r) < 0.03 else 'CHECK'}")
    RESULTS["replication"] = rows

    # which control kills the crime-growth correlation? ----------------------
    print("\n  decomposition of v x growth_5y after controls:")
    sub = df[["v", "growth_5y", "pop_log", "state"]].dropna()
    sub = sub[sub.groupby("state")["state"].transform("size") >= 5]
    rk = sub.apply(lambda col: stats.rankdata(col) if col.name != "state" else col)
    raw = float(stats.pearsonr(rk["v"], rk["growth_5y"])[0])
    # (a) state FE only
    d = rk.copy()
    for c in ("v", "growth_5y", "pop_log"):
        d[c] = d[c] - d.groupby("state")[c].transform("mean")
    st_only = float(stats.pearsonr(d["v"], d["growth_5y"])[0])
    # (b) pop only (no state FE)
    e = rk[["v", "growth_5y", "pop_log"]].astype(float)
    for c in ("v", "growth_5y"):
        beta = float(np.cov(e[c], e["pop_log"])[0, 1] / np.var(e["pop_log"]))
        e[c] = e[c] - beta * (e["pop_log"] - e["pop_log"].mean())
    pop_only = float(stats.pearsonr(e["v"], e["growth_5y"])[0])
    # (c) both
    pv = d["pop_log"].to_numpy(float)
    den = float(np.sum(pv * pv))
    both = {}
    for c in ("v", "growth_5y"):
        vv = d[c].to_numpy(float)
        both[c] = vv - (float(np.sum(vv * pv)) / den) * pv
    both_r = float(stats.pearsonr(both["v"], both["growth_5y"])[0])
    print(f"    rank-r raw={raw:+.3f}  state-FE only={st_only:+.3f}  "
          f"pop only={pop_only:+.3f}  both={both_r:+.3f}  (n={len(sub)})")
    RESULTS["crime_decomposition"] = {"raw": raw, "state_only": st_only,
                                      "pop_only": pop_only, "both": both_r,
                                      "n": len(sub)}


# --------------------------------------------------------------------------
# charts (optional)
# --------------------------------------------------------------------------

def charts(df: pd.DataFrame, extra: dict) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("[charts] matplotlib not available — skipped")
        return
    CHARTS.mkdir(parents=True, exist_ok=True)

    def scatter(x, y, xlabel, ylabel, title, fname, pct_y=True):
        m = np.isfinite(x) & np.isfinite(y)
        xs, ys = winsorize(x[m], 0.5, 99.5), y[m]
        fig, ax = plt.subplots(figsize=(7, 5), dpi=110)
        ax.scatter(xs, ys * (100 if pct_y else 1), s=4, alpha=0.25,
                   color="#2563eb", edgecolors="none")
        b, a = np.polyfit(xs, ys * (100 if pct_y else 1), 1)
        xx = np.linspace(np.nanmin(xs), np.nanmax(xs), 50)
        ax.plot(xx, a + b * xx, color="#dc2626", lw=1.5)
        rho = stats.spearmanr(xs, ys).statistic
        ax.set_xlabel(xlabel); ax.set_ylabel(ylabel)
        ax.set_title(f"{title}  (rho={rho:+.2f}, n={m.sum():,})", fontsize=10)
        fig.tight_layout(); fig.savefig(CHARTS / fname); plt.close(fig)
        print(f"[charts] wrote {CHARTS / fname}")

    # 1) the strongest robust cross-sectional relationship(s)
    scatter(df["grossYield"].to_numpy(float), df["mu_ann"].to_numpy(float),
            "Gross rent yield (ZORI*12/ZHVI)", "Annualized total return, %/yr",
            "Yield vs long-run return (all markets)", "yield_vs_mu.png")
    scatter(df["pop_log"].to_numpy(float), df["sigma_ann"].to_numpy(float),
            "log10(population)", "Annualized volatility, %",
            "Size vs volatility", "pop_vs_vol.png")

    # 2) momentum: 2015-2020 vs 2020-2025 growth, counties
    meta, vals = extra["levels"]["county"]
    gp = growth(vals, "2015-01", "2020-01").to_numpy()
    gf = growth(vals, "2020-01", "2025-01").to_numpy()
    scatter(gp * 100, gf, "2015-2020 growth, %/yr", "2020-2025 growth, %/yr",
            "Cross-market momentum (counties)", "momentum_counties.png")

    # 3) GFC: boom growth vs bust drawdown, counties
    gb = growth(vals, "2000-01", "2006-06").to_numpy()
    dd = max_dd_window(vals, "2006-06", "2012-12").to_numpy()
    scatter(gb * 100, dd, "2000-2006H1 growth, %/yr", "2006-2012 max drawdown, %",
            "Boom growth vs GFC drawdown (counties)", "gfc_boom_vs_dd.png")

    # 4) the yield backtest at city level, 2018 vintage
    zmeta, zvals = load_levels(DATA / "zori_city.csv", ["RegionID"])
    hmeta, hvals = extra["levels"]["city"]
    zid, hid = zmeta["RegionID"].to_numpy(), hmeta["RegionID"].to_numpy()
    common, zi, hi = np.intersect1d(zid, hid, return_indices=True)
    zv = zvals.iloc[zi].reset_index(drop=True)
    hv = hvals.iloc[hi].reset_index(drop=True)
    y18 = col_at(zv, "2018-01").to_numpy() * 12.0 / col_at(hv, "2018-01").to_numpy()
    y18[(y18 < 0.01) | (y18 > 0.35)] = np.nan
    g18 = growth(hv, "2018-01", "2021-01").to_numpy()
    scatter(y18 * 100, g18, "Gross yield Jan-2018, %", "Fwd 3y price growth, %/yr",
            "Yield vintage 2018 vs forward growth (cities)", "yield2018_fwd_city.png")

    # 5) PTI 2007 vs GFC drawdown, counties
    bea = load_bea()
    cmeta, cvals = extra["levels"]["county"]
    fips = (cmeta["StateCodeFIPS"].astype(str).str.zfill(2)
            + cmeta["MunicipalCodeFIPS"].astype(str).str.zfill(3)).to_numpy()
    inc06 = bea["pci"].get(2006, {})
    pti07 = col_at(cvals, "2007-01").to_numpy() / np.array(
        [inc06.get(f, np.nan) for f in fips], dtype=float)
    ddg = max_dd_window(cvals, "2007-01", "2012-12").to_numpy()
    scatter(pti07, ddg, "Price-to-income, Jan 2007", "Max drawdown 2007-2012, %",
            "Valuation stretch vs GFC crash (counties)", "pti2007_vs_dd.png")


# --------------------------------------------------------------------------

def main() -> None:
    pd.set_option("display.width", 200)
    df = build_master()
    stage2(df)
    extra = stage3()
    stage4(df)
    charts(df, extra)
    out = OUT / "deep_dive_results.json"
    out.write_text(json.dumps(RESULTS, indent=1, default=float))
    print(f"\n[done] all results -> {out}")


if __name__ == "__main__":
    main()
