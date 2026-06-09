#!/usr/bin/env python3
"""
Add Zillow county-level ZHVI markets to the Deal Score engine.

Replicates the exact transform used for the 895 metros in
netlify/functions/lib/metros.json (verified element-wise against the
committed file, max|diff| < 5e-6 = its 5-decimal rounding):

    quarterly return = pct_change(quarter-end ZHVI level) + 0.01
                       (+0.01/quarter ~= 4%/yr net income-yield proxy,
                        so series are total-return-like, not price-only)

Counties need >= MIN_RETURNS quarterly returns (leading NaNs trimmed,
series with internal gaps skipped). County ranks are offset by +10000 so
metros always win prefix ties in the UI resolver ("miami" -> Miami, FL
metro, not Miami-Dade County).

Usage (from project root):
    .venv/bin/python scripts/add_zillow_counties.py [--no-download]

Outputs (merged in place, metros untouched):
    netlify/functions/lib/metros.json   <- + ~2.6k county entries
    src/metros-list.json                <- + matching picker entries
"""

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "zillow_zhvi_county_raw.csv"
URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"

ENGINE_JSON = ROOT / "netlify/functions/lib/metros.json"
LIST_JSON = ROOT / "src/metros-list.json"

INCOME_PROXY_Q = 0.01   # same +1%/quarter total-return proxy as the metro build
MIN_RETURNS = 40        # >= 10 years of quarterly history
RANK_OFFSET = 10000     # keep counties below all metros in resolver tie-breaks


def download():
    import requests
    print(f"Downloading Zillow ZHVI County (~monthly updates)...")
    r = requests.get(URL, headers={"User-Agent": "ai-diligence-tool/1.0"}, timeout=180)
    r.raise_for_status()
    RAW.write_bytes(r.content)
    print(f"  Saved {RAW} ({len(r.content)/1024/1024:.2f} MB)")


def build():
    df = pd.read_csv(RAW)
    date_cols = [c for c in df.columns if isinstance(c, str) and c[:4].isdigit() and "-" in c]
    print(f"County rows: {len(df)} | monthly columns: {len(date_cols)}")

    engine = json.loads(ENGINE_JSON.read_text())
    listing = json.loads(LIST_JSON.read_text())
    existing = set(engine.keys())

    added, skipped_short, skipped_gap, skipped_dup = 0, 0, 0, 0
    for _, row in df.iterrows():
        key = f"{row['RegionName']}, {row['State']}"
        if key in existing:
            skipped_dup += 1
            continue
        s = pd.Series([row[c] for c in date_cols], index=pd.to_datetime(date_cols)).astype(float)
        first = s.first_valid_index()
        if first is None:
            skipped_short += 1
            continue
        s = s.loc[first:]
        if s.isna().any():
            skipped_gap += 1
            continue
        rets = (s.resample("QE").last().pct_change().dropna() + INCOME_PROXY_Q).round(5)
        if len(rets) < MIN_RETURNS:
            skipped_short += 1
            continue
        engine[key] = {"label": key, "ppy": 4, "returns": [float(x) for x in rets.values]}
        listing.append({"key": key, "label": key, "n": len(rets), "rank": RANK_OFFSET + int(row["SizeRank"])})
        existing.add(key)
        added += 1

    ENGINE_JSON.write_text(json.dumps(engine, separators=(",", ":")))
    LIST_JSON.write_text(json.dumps(listing, separators=(",", ":")))
    print(f"Added {added} counties (skipped: {skipped_short} short, {skipped_gap} gappy, {skipped_dup} dup keys)")
    print(f"engine file: {ENGINE_JSON.stat().st_size/1024:.0f} KB | picker list: {LIST_JSON.stat().st_size/1024:.0f} KB | total markets: {len(engine)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-download", action="store_true", help="Reuse existing data/zillow_zhvi_county_raw.csv")
    args = ap.parse_args()
    if not args.no_download or not RAW.exists():
        download()
    build()
