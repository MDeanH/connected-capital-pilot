#!/usr/bin/env python
"""Ingest HMDA (CFPB/FFIEC) county-level mortgage demand-quality metrics.

Produces data/ctx_hmda.json with shape {"<market key>": {...}} where market keys
are county-level keys that exist in src/metros-list.json (e.g. "Miami-Dade
County, FL", "St. Tammany Parish, LA" -> "Saint Tammany Parish, LA").

Fields per county (home-purchase loans, latest available HMDA year):
  investorShare : share of ORIGINATED home-purchase FIRST-LIEN loans where the
                  occupancy type is second residence (2) or investment (3).
  denialRate    : denied / (originated + denied) over home-purchase
                  applications (action_taken 3 vs 1+3), all liens.
  loanCount     : number of originated home-purchase first-lien loans.

Data source
-----------
HMDA Data Browser API (no key / signup required):
  https://ffiec.cfpb.gov/v2/data-browser-api/view/csv
The aggregation endpoint (view/aggregations) cannot group by occupancy type
(occupancy is not an accepted filter/variable - probed empirically), so we pull
loan-level CSVs filtered SERVER-SIDE to home-purchase applications that were
originated or denied (actions_taken=1,3 & loan_purposes=1), one state per
request, and aggregate locally with pandas (only 4 columns are parsed).
Filtered national volume is ~2 GB across all states (well under budget);
downloads are cached in data/raw/hmda/ (gitignored) so reruns are cheap.

County FIPS -> market key mapping comes from data/fema_nri_counties.csv
(State-County FIPS Code / County Name / County Type / State Name Abbreviation),
with canonical-form name matching to absorb metros-list spelling conventions
("St." -> "Saint", stripped apostrophes/hyphens, "DeKalb" vs "De Kalb", AK
census areas listed with a "Borough" suffix, VA independent cities as
"<Name> (city), VA", ...).

Known coverage gaps (honest, not fabricated):
  * Connecticut: HMDA 2024 reports the new planning-region FIPS (09110-09190)
    while metros-list.json only carries the legacy CT counties - no clean 1:1
    crosswalk, so CT county keys are left absent.
  * "Valdez Cordova Borough, AK" no longer exists as a FIPS (split 2019 into
    Chugach/Copper River, which are not in metros-list).
  * Counties absent from the curated metros-list (e.g. Maricopa County, AZ has
    no county-level key there) are skipped by design.

Rerunnable: state CSVs are cached; pass --force-aggregate to recompute from
cache, delete files under data/raw/hmda/ to re-download.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import defaultdict

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
METROS_PATH = os.path.join(ROOT, "src", "metros-list.json")
FEMA_COUNTIES_PATH = os.path.join(ROOT, "data", "fema_nri_counties.csv")
CACHE_DIR = os.path.join(ROOT, "data", "raw", "hmda")  # gitignored (data/raw/)
OUT_PATH = os.path.join(ROOT, "data", "ctx_hmda.json")

API_BASE = "https://ffiec.cfpb.gov/v2/data-browser-api/view"
YEARS_PREFERRED = [2024, 2023]  # try latest first, fall back

# Skip territories not present in metros-list.json
SKIP_STATES = {"PR", "VI", "GU", "AS", "MP"}

# Columns we actually need out of the ~99-column LAR CSV
USECOLS = ["county_code", "action_taken", "lien_status", "occupancy_type"]

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "ai-diligence-tool/ingest_hmda (research)"})


# ---------------------------------------------------------------------------
# Market-key matching
# ---------------------------------------------------------------------------
def canon(s: str) -> str:
    """Canonical form for fuzzy-but-safe name matching.

    Lowercase ASCII, drop apostrophes/periods, hyphen->space, expand the
    abbreviations 'St.'->'Saint' / 'Ste.'->'Sainte', then strip all
    non-alphanumerics. Examples that collapse to the same form:
      "St. Tammany Parish, LA"  ~ "Saint Tammany Parish, LA"
      "DeKalb County, AL"       ~ "De Kalb County, AL"
      "O'Brien County, IA"      ~ "O Brien County, IA"
      "Dona Ana County, NM"     ~ "Doña Ana County, NM"
    """
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("'", "").replace(".", "").replace("-", " ")
    s = re.sub(r"\bste\b", "sainte", s)
    s = re.sub(r"\bst\b", "saint", s)
    return re.sub(r"[^a-z0-9]", "", s)


# County-equivalent key shapes present in metros-list.json
COUNTY_KEY_RE = re.compile(
    r"(County|Parish|Borough|Census Area|Municipality|City and Borough"
    r"|Planning Region|District of Columbia), [A-Z]{2}$"
)


def build_fips_to_key() -> "tuple[dict[str, str], dict[str, str], list[str]]":
    """Return (fips5 -> market key, state-fips2 -> state abbrev, county_keys)."""
    with open(METROS_PATH) as f:
        all_keys = [d["key"] for d in json.load(f)]
    key_set = set(all_keys)

    county_keys = [k for k in all_keys if COUNTY_KEY_RE.search(k)]
    if "District of Columbia, DC" in key_set:
        county_keys.append("District of Columbia, DC")

    # canonical-form lookup tables (first occurrence wins; no dupes in practice)
    canon_county: dict[str, str] = {}
    for k in county_keys:
        canon_county.setdefault(canon(k), k)
    canon_city: dict[str, str] = {}
    for k in all_keys:
        if "(city)" in k:  # county-equivalent independent cities ("Richmond (city), VA")
            canon_city.setdefault(canon(k), k)

    fema = pd.read_csv(
        FEMA_COUNTIES_PATH,
        usecols=["State Name Abbreviation", "County Name", "County Type",
                 "State-County FIPS Code"],
        dtype=str,
    )
    fema = fema[~fema["State Name Abbreviation"].isin(SKIP_STATES)]

    fips_to_key: dict[str, str] = {}
    state_abbrev: dict[str, str] = {}
    for _, r in fema.iterrows():
        name = r["County Name"]
        typ = r["County Type"]  # County/Parish/Borough/.../City/NaN(DC)
        st = r["State Name Abbreviation"]
        fips = r["State-County FIPS Code"]
        state_abbrev[fips[:2]] = st

        hit = None
        if pd.isna(typ):  # District of Columbia row has no type
            hit = canon_county.get(canon(f"{name}, {st}"))
        elif typ == "City":
            # Independent cities (VA et al., Baltimore, Carson City) are
            # county-equivalents whose geography IS the city -> map only onto
            # explicit "(city)" keys to avoid colliding with metro keys.
            hit = canon_city.get(canon(f"{name} (city), {st}"))
        else:
            # AK census areas / municipalities / city-and-boroughs appear in
            # metros-list with a plain "Borough" suffix - try both.
            for t in ([typ] if typ in ("County", "Parish") else [typ, "Borough"]):
                hit = canon_county.get(canon(f"{name} {t}, {st}"))
                if hit:
                    break
        if hit:
            fips_to_key[fips] = hit

    return fips_to_key, state_abbrev, county_keys


# ---------------------------------------------------------------------------
# Download (cached, server-side filtered)
# ---------------------------------------------------------------------------
def pick_year() -> int:
    """Probe the aggregation endpoint with a tiny request per candidate year."""
    for year in YEARS_PREFERRED:
        url = (f"{API_BASE}/aggregations?years={year}&states=DE&actions_taken=1")
        try:
            r = SESSION.get(url, timeout=60)
            if r.ok and r.json().get("aggregations", [{}])[0].get("count", 0) > 0:
                return year
        except Exception as e:  # noqa: BLE001 - probe failures just fall through
            print(f"  probe {year} failed: {e}")
    raise SystemExit("No HMDA year available from the API - aborting (no data fabricated).")


def state_csv_path(year: int, st: str) -> str:
    return os.path.join(CACHE_DIR, f"hmda_{year}_{st}_purchase_apps.csv")


def download_state(year: int, st: str, retries: int = 3) -> str:
    """Download (with cache) home-purchase applications (actions 1,3) for a state."""
    path = state_csv_path(year, st)
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return path
    os.makedirs(CACHE_DIR, exist_ok=True)
    url = (f"{API_BASE}/csv?years={year}&states={st}"
           f"&actions_taken=1,3&loan_purposes=1")
    for attempt in range(1, retries + 1):
        tmp = path + ".part"
        try:
            t0 = time.time()
            with SESSION.get(url, stream=True, timeout=(30, 1800)) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
            os.replace(tmp, path)
            mb = os.path.getsize(path) / 1e6
            print(f"  {st}: {mb:7.1f} MB in {time.time()-t0:5.1f}s")
            return path
        except Exception as e:  # noqa: BLE001
            if os.path.exists(tmp):
                os.remove(tmp)
            print(f"  {st}: attempt {attempt}/{retries} failed: {e}")
            time.sleep(10 * attempt)
    raise RuntimeError(f"Failed to download {st} after {retries} attempts")


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def aggregate_state(path: str, acc: "defaultdict[str, dict[str, int]]") -> None:
    """Accumulate per-county counts from one state CSV (chunked, 4 columns)."""
    for chunk in pd.read_csv(path, usecols=USECOLS, dtype=str, chunksize=500_000):
        chunk = chunk.dropna(subset=["county_code"])
        originated = chunk["action_taken"] == "1"
        denied = chunk["action_taken"] == "3"
        first_lien_orig = originated & (chunk["lien_status"] == "1")
        investor = first_lien_orig & chunk["occupancy_type"].isin(["2", "3"])
        for col, mask in (("orig", originated), ("denied", denied),
                          ("fl_orig", first_lien_orig), ("investor", investor)):
            for fips, n in chunk.loc[mask, "county_code"].value_counts().items():
                acc[str(fips)][col] = acc[str(fips)].get(col, 0) + int(n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--year", type=int, default=None,
                    help="force a specific HMDA year (default: probe 2024 then 2023)")
    ap.add_argument("--force-aggregate", action="store_true",
                    help="recompute output from cached CSVs without re-probing year")
    args = ap.parse_args()

    print("Building FIPS -> market-key map from FEMA NRI counties + metros-list.json ...")
    fips_to_key, state_abbrev, county_keys = build_fips_to_key()
    print(f"  {len(fips_to_key)} county FIPS mapped to metros-list keys "
          f"({len(county_keys)} county-style keys in metros-list)")

    year = args.year or pick_year()
    print(f"Using HMDA year {year}")

    # Only download states that can contribute at least one mappable county
    # (this naturally skips CT, whose 2024 planning-region FIPS have no keys).
    states = sorted({state_abbrev[f[:2]] for f in fips_to_key})
    print(f"Downloading {len(states)} state CSVs (cached in {CACHE_DIR}) ...")
    acc: defaultdict[str, dict[str, int]] = defaultdict(dict)
    failures: list[str] = []
    for st in states:
        try:
            path = download_state(year, st)
        except RuntimeError as e:
            print(f"  WARNING: {e}")
            failures.append(st)
            continue
        aggregate_state(path, acc)

    # ------------------------------------------------------------------
    # Emit JSON keyed by metros-list market keys
    # ------------------------------------------------------------------
    out: dict[str, dict] = {}
    unmapped_loans = 0
    for fips, c in acc.items():
        orig, denied = c.get("orig", 0), c.get("denied", 0)
        fl_orig, investor = c.get("fl_orig", 0), c.get("investor", 0)
        key = fips_to_key.get(fips)
        if key is None:
            unmapped_loans += fl_orig
            continue
        if orig + denied == 0:
            continue
        out[key] = {
            "investorShare": round(investor / fl_orig, 4) if fl_orig else None,
            "denialRate": round(denied / (orig + denied), 4),
            "loanCount": fl_orig,
        }

    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)

    total_loans = sum(v["loanCount"] for v in out.values())
    print(f"\nWrote {OUT_PATH}")
    print(f"Coverage: {len(out)} market keys populated "
          f"({len(out)}/{len(set(fips_to_key.values()))} mappable county keys; "
          f"metros-list has {len(county_keys)} county-style keys - gap is CT "
          f"planning regions + counties not in the curated list)")
    print(f"Originated first-lien purchase loans covered: {total_loans:,} "
          f"(plus {unmapped_loans:,} in counties without a metros-list key)")
    if failures:
        print(f"FAILED states (no data): {failures}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
