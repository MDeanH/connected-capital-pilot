#!/usr/bin/env python
"""Ingest Census Building Permits Survey (BPS) county-level data -> data/ctx_permits.json.

Source: https://www2.census.gov/econ/bps/County/coYYYYa.txt  (annual files)
  - Comma-separated, TWO header lines then data rows; 30 columns.
  - Columns we use (0-based): 0=survey year, 1=state FIPS, 2=county FIPS,
    7=1-unit units, 10=2-unit units, 13=3-4 unit units, 16=5+ unit units.
    (The first block of unit columns is the Census estimate incl. imputation;
     the trailing "rep" block is reported-only — we use the estimate block.)

Population: BEA CAINC1 (data/bea_cainc1.zip, already on disk), LineCode 2 =
  population, latest year column, joined via 5-digit GeoFIPS.

County FIPS -> market key: data/fema_nri_counties.csv gives County Name /
  County Type / State abbreviation per State-County FIPS Code. Keys are built
  as "<Name> <Type>, <ST>" (e.g. "Miami-Dade County, FL", "Acadia Parish, LA")
  and only kept when they EXIST in src/metros-list.json. A conservative
  variant fallback handles naming drift in metros-list ("St."->"Saint",
  "DeKalb"->"De Kalb", independent cities as "X (city), ST", AK
  "Municipality"/"City and Borough" listed as "Borough").

Output fields per market key:
  permits      total housing units permitted, latest complete year (int)
  permitsPer1k units per 1,000 residents (latest BEA population year)
  permitsVs5y  latest-year units / mean of the 5 prior years (1.35 = +35%)
  sfShare      share of units in 1-unit (single-family) structures

Rerunnable: raw downloads cached in data/ (bps_co<year>a_raw.txt, gitignored
via the data/*_raw* pattern). Prints coverage stats when run.
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_PATH = DATA / "ctx_permits.json"

BPS_BASE = "https://www2.census.gov/econ/bps/County"
LATEST_YEAR = 2025                  # latest complete annual file (it is mid-2026)
PRIOR_YEARS = list(range(LATEST_YEAR - 5, LATEST_YEAR))   # 2020..2024

BEA_ZIP = DATA / "bea_cainc1.zip"
FEMA_CSV = DATA / "fema_nri_counties.csv"
METROS_LIST = ROOT / "src" / "metros-list.json"


# --------------------------------------------------------------------------- BPS
def fetch_bps_year(year: int) -> Path:
    """Download (with caching) one annual BPS county file."""
    cache = DATA / f"bps_co{year}a_raw.txt"
    if cache.exists() and cache.stat().st_size > 10_000:
        return cache
    url = f"{BPS_BASE}/co{year}a.txt"
    print(f"  downloading {url}")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    cache.write_bytes(r.content)
    return cache


def parse_bps_units(path: Path) -> "dict[str, dict[str, int]]":
    """Parse one annual file -> {5-digit FIPS: {'total': units, 'sf': 1-unit units}}.

    County names contain no commas (verified), so a plain split is safe; we
    still guard on the first field being a 4-digit year to skip the two
    header lines and any blank lines.
    """
    out: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "sf": 0})
    for line in path.read_text(encoding="latin-1").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 18 or not re.fullmatch(r"\d{4}", parts[0]):
            continue  # header / blank / footer rows
        fips = parts[1].zfill(2) + parts[2].zfill(3)
        try:
            u1, u2, u34, u5 = (int(parts[i] or 0) for i in (7, 10, 13, 16))
        except ValueError:
            continue
        rec = out[fips]
        rec["total"] += u1 + u2 + u34 + u5
        rec["sf"] += u1
    return dict(out)


# --------------------------------------------------------------------------- BEA population
def load_population() -> "tuple[dict[str, int], int]":
    """BEA CAINC1 LineCode 2 (population), latest year -> {5-digit GeoFIPS: persons}."""
    with zipfile.ZipFile(BEA_ZIP) as z:
        name = next(n for n in z.namelist() if "ALL_AREAS" in n)
        raw = z.read(name).decode("latin-1")
    rows = csv.reader(io.StringIO(raw))
    header = next(rows)
    year_cols = [(i, int(c)) for i, c in enumerate(header) if re.fullmatch(r"\d{4}", c.strip())]
    col, pop_year = max(year_cols, key=lambda t: t[1])
    line_idx = header.index("LineCode")
    pop: dict[str, int] = {}
    for row in rows:
        if len(row) <= col:
            continue  # footnote lines at the bottom of the file
        geo = row[0].strip().strip('"').strip()
        if row[line_idx].strip() != "2" or not re.fullmatch(r"\d{5}", geo):
            continue
        val = row[col].strip()
        if val.isdigit():
            pop[geo] = int(val)
    return pop, pop_year


# --------------------------------------------------------------------------- FIPS -> market key
_CITYISH = {"City"}  # independent cities (VA + Baltimore/St. Louis/Carson City)


def _norm_words(s: str) -> str:
    """lowercase, strip punctuation, expand St./Ste. so 'St. Clair'=='Saint Clair',
    collapse spaces so 'De Kalb'=='DeKalb'."""
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    words = []
    for w in s.split():
        words.append({"st": "saint", "ste": "sainte"}.get(w, w))
    return "".join(words)


def build_fips_to_key() -> "dict[str, str]":
    metro_keys: set = {m["key"] for m in json.loads(METROS_LIST.read_text())}

    # Index county-level metros-list keys by (state, normalized name, class) for
    # the fallback match. Class keeps "Richmond County, VA" distinct from
    # "Richmond (city), VA".
    suffixes = [  # (regex on key's name part, class)
        (r" \(city\)$", "city"), (r" City$", "city"),
        (r" City and Borough$", "county"), (r" Census Area$", "county"),
        (r" Planning Region$", "county"), (r" Municipality$", "county"),
        (r" Municipio$", "county"), (r" County$", "county"),
        (r" Parish$", "county"), (r" Borough$", "county"),
    ]
    norm_index: dict = defaultdict(set)
    for key in metro_keys:
        if ", " not in key:
            continue
        name, st = key.rsplit(", ", 1)
        for pat, cls in suffixes:
            if re.search(pat, name):
                base = re.sub(pat, "", name)
                norm_index[(st, _norm_words(base), cls)].add(key)
                break

    fips_to_key: dict[str, str] = {}
    used_keys: set = set()
    with open(FEMA_CSV, newline="") as f:
        for row in csv.DictReader(f):
            fips = row["State-County FIPS Code"].strip().zfill(5)
            name = row["County Name"].strip()
            typ = row["County Type"].strip()
            st = row["State Name Abbreviation"].strip()
            if not name or not st:
                continue
            saint = name.replace("St. ", "Saint ").replace("Ste. ", "Sainte ")
            # exact candidates, in priority order
            cands = [f"{name} {typ}, {st}".replace(" ,", ",")]
            if saint != name:
                cands.append(f"{saint} {typ}, {st}".replace(" ,", ","))
            if typ in _CITYISH:
                cands += [f"{name} (city), {st}", f"{saint} (city), {st}"]
            key = next((c for c in cands if c in metro_keys), None)
            if key is None:
                # conservative normalized fallback: unique hit within state+class
                cls = "city" if typ in _CITYISH else "county"
                hits = norm_index.get((st, _norm_words(name), cls), set())
                if len(hits) == 1:
                    key = next(iter(hits))
            if key is None:
                continue
            if key in used_keys:  # never let two FIPS share one market key
                print(f"  WARN: key collision on {key} (fips {fips}); skipped")
                continue
            used_keys.add(key)
            fips_to_key[fips] = key
    return fips_to_key


# --------------------------------------------------------------------------- main
def main() -> None:
    print(f"BPS annual files: latest={LATEST_YEAR}, priors={PRIOR_YEARS}")
    latest = parse_bps_units(fetch_bps_year(LATEST_YEAR))
    priors = {y: parse_bps_units(fetch_bps_year(y)) for y in PRIOR_YEARS}

    pop, pop_year = load_population()
    print(f"BEA population year: {pop_year} ({len(pop)} areas)")

    fips_to_key = build_fips_to_key()
    print(f"FIPS->key crosswalk: {len(fips_to_key)} counties matched to metros-list keys")

    out: dict = {}
    n_pop_missing = 0
    for fips, rec in sorted(latest.items()):
        key = fips_to_key.get(fips)
        if key is None:
            continue
        permits = rec["total"]
        # units per 1,000 residents
        p = pop.get(fips)
        if p:
            per1k = round(permits / p * 1000, 2)
        else:
            per1k, n_pop_missing = None, n_pop_missing + 1
        # latest vs mean of prior 5 years (county absent from a prior file -> 0 units)
        prior_mean = sum(priors[y].get(fips, {}).get("total", 0) for y in PRIOR_YEARS) / len(PRIOR_YEARS)
        vs5y = round(permits / prior_mean, 2) if prior_mean > 0 else None
        sf_share = round(rec["sf"] / permits, 3) if permits > 0 else None
        out[key] = {
            "permits": permits,
            "permitsPer1k": per1k,
            "permitsVs5y": vs5y,
            "sfShare": sf_share,
        }

    OUT_PATH.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    n_bps = len(latest)
    print(f"\nWrote {OUT_PATH}")
    print(f"Coverage: {len(out)} market keys "
          f"(BPS {LATEST_YEAR} counties: {n_bps}; matched to metros-list: {len(out)}; "
          f"{len(out) / n_bps:.0%})")
    print(f"  permitsPer1k null (no BEA population): {n_pop_missing}")
    n_vs5y = sum(1 for v in out.values() if v["permitsVs5y"] is not None)
    print(f"  permitsVs5y populated: {n_vs5y}/{len(out)}")
    print("  sample:", json.dumps({k: out[k] for k in list(out)[:2]}))


if __name__ == "__main__":
    main()
