#!/usr/bin/env python3
"""Build src/market3d-data.json for the 3D Market Environment tab.

Distills the repo's real datasets into one compact JSON consumed by Market3D.tsx:
  - data/catalog/distribution_catalog.csv  -> per-metro mu/sigma (ZHVI) + rent mu (ZORI)
  - src/metros-list.json                   -> metro size ranks (drives city layout)
  - data/zillow_us_national_zhvi_prices.csv-> national ZHVI ridge (monthly, 2000+)
  - data/processed/fred_mortgage30us      -> 30y mortgage rate wall (monthly avg, 1971+)
  - data/processed/fred_houst             -> housing starts ridge (monthly, 1959+)
  - src/us-market.json                    -> macro indicator ring

Run: python3 scripts/build_market3d_data.py
"""
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
N_METROS = 150


def load_catalog():
    """distribution_catalog.csv -> {metro: {mu, sigma, n}} per source."""
    by_source = {"Zillow ZHVI": {}, "Zillow ZORI": {}}
    with open(ROOT / "data/catalog/distribution_catalog.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            src = row["source"]
            if src not in by_source:
                continue
            try:
                by_source[src][row["metro"]] = {
                    "mu": float(row["mu_ann"]),
                    "sigma": float(row["sigma_ann_desmoothed"]),
                    "n": int(row["n_obs"]),
                }
            except ValueError:
                continue
    return by_source


def build_metros(catalog):
    metros_list = json.loads((ROOT / "src/metros-list.json").read_text())
    zhvi, zori = catalog["Zillow ZHVI"], catalog["Zillow ZORI"]
    out = []
    for m in metros_list:
        if m["rank"] == 0 or m["key"] not in zhvi:  # rank 0 = United States
            continue
        stats = zhvi[m["key"]]
        rec = {
            "name": m["label"],
            "rank": m["rank"],
            "mu": stats["mu"],
            "sigma": stats["sigma"],
            "n": stats["n"],
        }
        if m["key"] in zori:
            rec["rentMu"] = zori[m["key"]]["mu"]
        out.append(rec)
        if len(out) >= N_METROS:
            break
    return out


def monthly_series(path, date_col=0, value_col=1, monthly_average=False):
    """CSV (date,value) -> ordered {YYYY-MM: value}; weekly data can be averaged."""
    buckets = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # header
        for row in reader:
            try:
                buckets[row[date_col][:7]].append(float(row[value_col]))
            except (ValueError, IndexError):
                continue
    months = sorted(buckets)
    if monthly_average:
        return months, [sum(buckets[m]) / len(buckets[m]) for m in months]
    return months, [buckets[m][-1] for m in months]


def ridge(months, values, round_to=1):
    return {
        "start": months[0],
        "end": months[-1],
        "points": [round(v, round_to) for v in values],
    }


def build_macro():
    market = json.loads((ROOT / "src/us-market.json").read_text())
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "category": s["category"],
            "latest": s["latest"],
            "yoy": s.get("yoy"),
            "annReturn": s.get("annReturn"),
            "annVol": s.get("annVolDesmoothed"),
        }
        for s in market["series"]
    ]


def main():
    catalog = load_catalog()
    metros = build_metros(catalog)

    zhvi_m, zhvi_v = monthly_series(ROOT / "data/zillow_us_national_zhvi_prices.csv")
    mort_m, mort_v = monthly_series(
        ROOT / "data/processed/fred_mortgage30us/latest.csv", monthly_average=True
    )
    houst_m, houst_v = monthly_series(ROOT / "data/processed/fred_houst/latest.csv")

    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "metros": metros,
        "zhvi": ridge(zhvi_m, zhvi_v, round_to=0),
        "mortgage": ridge(mort_m, mort_v, round_to=2),
        "houst": ridge(houst_m, houst_v, round_to=0),
        "macro": build_macro(),
    }

    out = ROOT / "src/market3d-data.json"
    out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(
        f"wrote {out} | metros={len(metros)} zhvi={len(zhvi_v)} "
        f"mortgage={len(mort_v)} houst={len(houst_v)} macro={len(data['macro'])}"
    )


if __name__ == "__main__":
    main()
