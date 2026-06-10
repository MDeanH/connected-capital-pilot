#!/usr/bin/env python
"""FEMA NFIP flood insurance claims (OpenFEMA) -> county-level realized flood losses.

Produces data/ctx_nfip.json with shape {"<market key>": {fields}} where market keys
are county-level keys from src/metros-list.json ("Miami-Dade County, FL",
"Orleans Parish, LA" style — only keys that actually exist in the list).

Fields per county (window = last 10 COMPLETE loss-years available; the current
calendar year is excluded because it is partial and NFIP payment reporting lags):
  claims10y    count of NFIP claims over the 10-year window
  paid10yM     total paid $M (building + contents) over the window
  claimsTrend  claims in latest 5 loss-years / prior 5 loss-years (null if prior 0)
  worstYear    loss-year with the highest total paid within the window
  nonRenewalRate  BONUS: 2023 homeowner insurance non-renewal rate (%, all perils),
                  US Senate Budget Committee Dec-2024 release. Only where matchable.

Source: OpenFEMA FimaNfipClaims v2 API, paginated CSV ($select keeps it small).
  https://www.fema.gov/api/open/v2/FimaNfipClaims
Raw pages are cached in data/raw/ (gitignored) so reruns are cheap.

County FIPS -> market key via data/fema_nri_counties.csv (County Name / County Type /
State Abbreviation), with name normalization (St./Saint, DeKalb/De Kalb, AK
Municipality->Borough, VA independent cities -> "(city)" keys).

Rerun:  .venv/bin/python scripts/ingest_nfip.py
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = DATA / "ctx_nfip.json"
NRI_CSV = DATA / "fema_nri_counties.csv"

API = "https://www.fema.gov/api/open/v2/FimaNfipClaims"
SELECT = "countyCode,yearOfLoss,amountPaidOnBuildingClaim,amountPaidOnContentsClaim"
PAGE = 10000  # OpenFEMA max records per request

SENATE_XLSX_URL = (
    "https://www.budget.senate.gov/imo/media/doc/"
    "2024_homeowners_insurance_non-renewal_data_senate_budget_committee.xlsx"
)
SENATE_XLSX = RAW / "senate_nonrenewal_2024.xlsx"

session = requests.Session()
session.headers["User-Agent"] = "ai-diligence-tool/1.0 (data ingest)"


# ------------------------------------------------------------------ market keys

def load_markets() -> set[str]:
    return {e["key"] for e in json.loads((ROOT / "src/metros-list.json").read_text())}


def name_variants(name: str) -> list[str]:
    """Spelling variants between Census/FEMA county names and metros-list keys."""
    out = [name]
    if name.startswith("St. "):
        out.append("Saint " + name[4:])
    if name.startswith("Ste. "):
        out.append("Sainte " + name[5:])
    # DeKalb -> De Kalb, LaSalle -> La Salle, DuPage -> Du Page ...
    m = re.match(r"^(De|La|Le|Du)([A-Z])(.*)$", name)
    if m:
        out.append(f"{m.group(1)} {m.group(2)}{m.group(3)}")
    if "'" in name:
        out.append(name.replace("'", ""))
    return out


def build_fips_to_key(markets: set[str]) -> dict[str, str]:
    """5-digit county FIPS -> market key, using the FEMA NRI county roster."""
    if not NRI_CSV.exists():
        sys.exit(f"missing {NRI_CSV} — run scripts/build_market_context.py first "
                 "(it downloads the FEMA NRI county roster)")
    fips_to_key: dict[str, str] = {}
    with open(NRI_CSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            fips = str(row["State-County FIPS Code"]).split(".")[0].zfill(5)
            nm = row["County Name"].strip()
            ctype = (row.get("County Type") or "County").strip()
            st = row["State Name Abbreviation"].strip()
            # candidate type suffixes, most specific first
            types = [ctype, "County"]
            if st == "AK":
                types.append("Borough")  # Municipality / Census Area / City and Borough
            found = None
            for n in name_variants(nm):
                for t in types:
                    k = f"{n} {t}, {st}"
                    if k in markets:
                        found = k
                        break
                if found:
                    break
                if ctype == "City":  # independent cities (VA etc.) == county-equivalents
                    k = f"{n} (city), {st}"
                    if k in markets:
                        found = k
                        break
            if found:
                fips_to_key[fips] = found
    return fips_to_key


# ------------------------------------------------------------------ NFIP claims

def latest_complete_loss_year() -> int:
    """Max yearOfLoss in the dataset, capped at last calendar year (current is partial)."""
    r = session.get(API, params={"$select": "yearOfLoss",
                                 "$orderby": "yearOfLoss desc", "$top": "1"}, timeout=60)
    r.raise_for_status()
    max_year = int(r.json()["FimaNfipClaims"][0]["yearOfLoss"])
    return min(max_year, date.today().year - 1)


def fetch_claims(y0: int, y1: int) -> Path:
    """Download claims for loss-years [y0, y1] as one CSV, cached in data/raw/."""
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / f"nfip_claims_{y0}_{y1}.csv"
    if cache.exists() and cache.stat().st_size > 0:
        print(f"  using cached {cache.name} ({cache.stat().st_size/1e6:.1f} MB)")
        return cache

    flt = f"yearOfLoss ge {y0} and yearOfLoss le {y1}"
    meta = session.get(API, params={"$filter": flt, "$select": "id", "$top": "1",
                                    "$inlinecount": "allpages"}, timeout=60).json()
    total = int(meta["metadata"]["count"])
    print(f"  {total:,} claims for loss-years {y0}-{y1}; fetching in pages of {PAGE:,}…")

    tmp = cache.with_suffix(".part")
    rows = 0
    with open(tmp, "w", encoding="utf-8") as out:
        skip = 0
        while skip < total:
            for attempt in range(4):  # simple retry on transient errors
                try:
                    r = session.get(API, params={
                        "$filter": flt, "$select": SELECT, "$orderby": "id",
                        "$format": "csv", "$top": str(PAGE), "$skip": str(skip),
                    }, timeout=300)
                    r.raise_for_status()
                    break
                except Exception as e:
                    if attempt == 3:
                        raise
                    print(f"    retry skip={skip}: {e}")
                    time.sleep(5 * (attempt + 1))
            lines = r.text.splitlines()
            if not lines:
                break
            body = lines if skip == 0 else lines[1:]  # keep header once
            out.write("\n".join(body) + "\n")
            got = len(lines) - 1
            rows += got
            skip += PAGE
            print(f"    {min(skip, total):>9,}/{total:,}", flush=True)
            if got < PAGE:
                break
    if rows < total:
        print(f"  !! got {rows:,} of {total:,} rows — keeping anyway, rerun to refresh")
    tmp.rename(cache)
    print(f"  saved {cache.name} ({cache.stat().st_size/1e6:.1f} MB, {rows:,} rows)")
    return cache


def aggregate(cache: Path, y0: int, y1: int, fips_to_key: dict[str, str]) -> dict:
    df = pd.read_csv(cache, dtype={"countyCode": str}, low_memory=False)
    df["yearOfLoss"] = pd.to_numeric(df["yearOfLoss"], errors="coerce")
    df = df[(df["yearOfLoss"] >= y0) & (df["yearOfLoss"] <= y1)]
    n_all = len(df)
    df = df[df["countyCode"].notna()]
    df["fips"] = df["countyCode"].str.split(".").str[0].str.zfill(5)
    df["paid"] = (pd.to_numeric(df["amountPaidOnBuildingClaim"], errors="coerce").fillna(0)
                  + pd.to_numeric(df["amountPaidOnContentsClaim"], errors="coerce").fillna(0))
    df["key"] = df["fips"].map(fips_to_key)
    n_keyed = int(df["key"].notna().sum())
    print(f"  {n_all:,} claims in window; {n_all - len(df):,} without countyCode; "
          f"{n_keyed:,} ({n_keyed/n_all:.0%}) map to a market key")
    df = df[df["key"].notna()]

    mid = y1 - 4  # latest 5 loss-years = [mid, y1], prior 5 = [y0, mid-1]
    out: dict[str, dict] = {}
    for key, g in df.groupby("key"):
        recent = int((g["yearOfLoss"] >= mid).sum())
        prior = int((g["yearOfLoss"] < mid).sum())
        by_year = g.groupby("yearOfLoss")["paid"].sum()
        out[key] = {
            "claims10y": int(len(g)),
            "paid10yM": round(float(g["paid"].sum()) / 1e6, 2),
            "claimsTrend": round(recent / prior, 2) if prior > 0 else None,
            "worstYear": int(by_year.idxmax()),
        }
    # mapped counties with zero NFIP claims in the window: an honest, useful zero
    for key in set(fips_to_key.values()) - set(out):
        out[key] = {"claims10y": 0, "paid10yM": 0.0, "claimsTrend": None, "worstYear": None}
    return out


# ------------------------------------------------- bonus: insurance non-renewals

def norm(name: str) -> str:
    """Aggressive county-name normalization for cross-source matching."""
    s = name.upper()
    s = re.sub(r"\b(COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPALITY|CITY AND|CITY)\b", "", s)
    s = s.replace("SAINT", "ST")
    return re.sub(r"[^A-Z]", "", s)  # drop spaces, periods, hyphens, apostrophes


def add_nonrenewal(out: dict, markets: set[str]) -> int:
    """Senate Budget Committee 2024 release: county non-renewal rates (latest = 2023).

    The sheet lists UPPERCASE county names grouped under 2-letter state rows; some
    rows are multi-county groups ("A / B / C") — the group rate is applied to each
    member. Matching is by normalized name + state against metros-list county keys.
    Skips silently (per spec) if the download fails.
    """
    try:
        if not SENATE_XLSX.exists():
            r = session.get(SENATE_XLSX_URL, timeout=120)
            r.raise_for_status()
            RAW.mkdir(parents=True, exist_ok=True)
            SENATE_XLSX.write_bytes(r.content)
        sheet = pd.read_excel(SENATE_XLSX, sheet_name="2023 Compiled")
    except Exception as e:
        print(f"  bonus non-renewal data unavailable ({e}) — skipping")
        return 0

    # normalized "<name>|<ST>" -> market key, county-level keys only. Two passes
    # over sorted keys so collisions (e.g. "Richmond County" vs "Richmond (city)")
    # resolve deterministically, preferring county-type keys over "(city)" keys.
    lookup: dict[str, str] = {}
    for k in sorted(markets):
        m = re.match(r"^(.*) (County|Parish|Borough|Census Area|Municipality), ([A-Z]{2})$", k)
        if m:
            lookup.setdefault(f"{norm(m.group(1))}|{m.group(3)}", k)
    for k in sorted(markets):
        m = re.match(r"^(.*) \(city\), ([A-Z]{2})$", k)
        if m:
            lookup.setdefault(f"{norm(m.group(1))}|{m.group(2)}", k)

    state = None
    n = 0
    for _, row in sheet.iterrows():
        name = str(row["County"]).strip()
        rate = row["Calculated Non-Renewal Rate"]
        if re.fullmatch(r"[A-Z]{2}", name):
            state = name  # state header row (statewide total) — not a county
            continue
        if not state or pd.isna(rate) or not name or name == "nan":
            continue
        for part in name.split("/"):  # multi-county group rows
            key = lookup.get(f"{norm(part)}|{state}")
            if key and key in out and "nonRenewalRate" not in out[key]:
                out[key]["nonRenewalRate"] = round(float(rate) * 100, 2)
                n += 1
    return n


# --------------------------------------------------------------------------- main

def main() -> None:
    markets = load_markets()
    fips_to_key = build_fips_to_key(markets)
    print(f"county FIPS mapped to market keys: {len(fips_to_key):,}")

    y1 = latest_complete_loss_year()
    y0 = y1 - 9
    print(f"loss-year window: {y0}-{y1} (latest 5: {y1-4}-{y1})")

    cache = fetch_claims(y0, y1)
    out = aggregate(cache, y0, y1, fips_to_key)

    n_bonus = add_nonrenewal(out, markets)
    print(f"bonus nonRenewalRate (2023, %) added for {n_bonus:,} counties")

    OUT.write_text(json.dumps({k: out[k] for k in sorted(out)}, indent=1) + "\n")
    with_claims = sum(1 for v in out.values() if v["claims10y"] > 0)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out):,} markets "
          f"({with_claims:,} with >=1 claim in window, "
          f"{len(out) - with_claims:,} zero-claim counties)")


if __name__ == "__main__":
    main()
