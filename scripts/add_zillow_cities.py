#!/usr/bin/env python3
"""
Add Zillow city-level ZHVI markets to the Deal Score engine.

Same verified transform as metros/counties (see add_zillow_counties.py):
quarter-end pct change + 0.01/quarter income-yield proxy, 5-decimal rounding,
>= MIN_RETURNS quarterly returns, series with internal gaps skipped.

Key collisions: many cities share names with their metro ("Miami, FL" city vs
"Miami, FL" MSA). Cities never overwrite existing keys — a colliding city gets
"Name (city), ST"; a further intra-state duplicate gets
"Name (city, X County), ST"; anything still colliding is skipped.

City ranks are offset +100000 so resolver tie-breaks prefer
metros (0+) > counties (10000+) > cities (100000+).

Usage:
    .venv/bin/python scripts/add_zillow_cities.py [--no-download]
"""

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "zillow_zhvi_city_raw.csv"
URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"

ENGINE_JSON = ROOT / "netlify/functions/lib/metros.json"
LIST_JSON = ROOT / "src/metros-list.json"

INCOME_PROXY_Q = 0.01
MIN_RETURNS = 40
RANK_OFFSET = 100000


def download():
    import requests
    print("Downloading Zillow ZHVI City (~100MB, monthly updates)...")
    with requests.get(URL, headers={"User-Agent": "ai-diligence-tool/1.0"}, timeout=600, stream=True) as r:
        r.raise_for_status()
        with open(RAW, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    print(f"  Saved {RAW} ({RAW.stat().st_size/1024/1024:.1f} MB)")


def build():
    df = pd.read_csv(RAW)
    date_cols = [c for c in df.columns if isinstance(c, str) and c[:4].isdigit() and "-" in c]
    print(f"City rows: {len(df)} | monthly columns: {len(date_cols)}")

    engine = json.loads(ENGINE_JSON.read_text())
    listing = json.loads(LIST_JSON.read_text())
    existing = set(engine.keys())

    added, renamed, skipped_short, skipped_gap, skipped_dup = 0, 0, 0, 0, 0
    for _, row in df.iterrows():
        plain = f"{row['RegionName']}, {row['State']}"
        key = plain
        if key in existing:
            key = f"{row['RegionName']} (city), {row['State']}"
            if key in existing:
                county = str(row.get("CountyName", "")).strip()
                key = f"{row['RegionName']} (city, {county}), {row['State']}" if county else key
            if key in existing:
                skipped_dup += 1
                continue
            renamed += 1
        s = pd.Series([row[c] for c in date_cols], index=pd.to_datetime(date_cols)).astype(float)
        first = s.first_valid_index()
        if first is None:
            skipped_short += 1
            if key != plain:
                renamed -= 1
            continue
        s = s.loc[first:]
        if s.isna().any():
            skipped_gap += 1
            if key != plain:
                renamed -= 1
            continue
        rets = (s.resample("QE").last().pct_change().dropna() + INCOME_PROXY_Q).round(5)
        if len(rets) < MIN_RETURNS:
            skipped_short += 1
            if key != plain:
                renamed -= 1
            continue
        engine[key] = {"label": key, "ppy": 4, "returns": [float(x) for x in rets.values]}
        listing.append({"key": key, "label": key, "n": len(rets), "rank": RANK_OFFSET + int(row["SizeRank"])})
        existing.add(key)
        added += 1

    ENGINE_JSON.write_text(json.dumps(engine, separators=(",", ":")))
    LIST_JSON.write_text(json.dumps(listing, separators=(",", ":")))
    print(f"Added {added} cities ({renamed} disambiguated; skipped: {skipped_short} short, {skipped_gap} gappy, {skipped_dup} dup)")
    print(f"engine file: {ENGINE_JSON.stat().st_size/1024/1024:.1f} MB | picker list: {LIST_JSON.stat().st_size/1024:.0f} KB | total markets: {len(engine)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-download", action="store_true")
    args = ap.parse_args()
    if not args.no_download or not RAW.exists():
        download()
    build()
