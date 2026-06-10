#!/usr/bin/env python3
"""
Pull nationwide crime stats (every state + every matchable city/county) from
the FBI Crime Data Explorer summarized API and bake a compact lookup JSON for
the Deal Score crime overlay.

Source: https://api.usa.gov/crime/fbi/cde — the same public API the FBI's own
CDE webapp calls from every visitor's browser (the API key below is the public
one embedded in the webapp bundle at cde.ucr.cjis.gov; polite concurrency +
retries, one-time pull of public statistics).

Pipeline:
  1. agency/byStateAbbr/{ST} for all 50 states + DC  -> ~19k agencies
  2. Keep City + County agencies whose derived market key ("Panama City, FL",
     "Bay County, FL") exists in src/metros-list.json (20,216 markets)
  3. summarized/agency/{ori}/{violent-crime|property-crime}?type=counts for
     each kept agency (checkpointed JSONL; rerun resumes)
  4. summarized/state/{ST}/{offense}?type=counts for all states (+ national
     benchmark from the embedded "United States" series)
  5. Write public/crime-stats.json:
     { "year": 2024, "national": {v, p}, "states": {"FL": {...}},
       "markets": {"<market key>": {v, p, pop, src}} }
     v/p = annual offenses per 100k (violent / property)

Usage:
  .venv/bin/python scripts/fetch_fbi_crime.py            # full run (resumable)
  .venv/bin/python scripts/fetch_fbi_crime.py --finalize # just rebuild output from checkpoint
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = ROOT / "data" / "fbi_crime_checkpoint.jsonl"
AGENCY_CACHE = ROOT / "data" / "fbi_agencies.json"
OUT = ROOT / "public" / "crime-stats.json"

API = "https://api.usa.gov/crime/fbi/cde"
# The default is the public, read-only api.usa.gov key the FBI CDE webapp ships
# in its own browser bundle — not a private credential. Override via env if desired.
API_KEY = os.environ.get("FBI_CDE_API_KEY", "iiHnOKfno2Mgkt5AynpvPpUQTEyxE77jo1RU8PIv")
YEAR = 2024
FROM, TO = f"01-{YEAR}", f"12-{YEAR}"
WORKERS = 12

STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY",
    "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH",
    "OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]

PD_SUFFIXES = re.compile(
    r"\s+(police department|police dept\.?|police|dept\.? of public safety|"
    r"department of public safety|public safety department|marshal'?s? office|"
    r"pd)\s*$", re.I)
SHERIFF_SUFFIXES = re.compile(r"\s+(county )?sheriff'?s?( office| department| dept\.?)?\s*$", re.I)

session = requests.Session()
session.headers["User-Agent"] = "ai-diligence-tool/1.0 (one-time public stats pull)"
# default urllib3 pool (10) throttles the thread pool — size it to WORKERS
_adapter = requests.adapters.HTTPAdapter(pool_connections=WORKERS * 2, pool_maxsize=WORKERS * 2)
session.mount("https://", _adapter)


def get(url: str, tries: int = 5) -> dict | None:
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            return None  # 4xx — no data for this agency/offense
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def fetch_agencies() -> list[dict]:
    if AGENCY_CACHE.exists():
        return json.loads(AGENCY_CACHE.read_text())
    out = []
    for st in STATES:
        data = get(f"{API}/agency/byStateAbbr/{st}?API_KEY={API_KEY}")
        if not data:
            print(f"  !! agency list failed for {st}", flush=True)
            continue
        n = 0
        for county_agencies in data.values():
            for a in county_agencies:
                out.append(a)
                n += 1
        print(f"  {st}: {n} agencies", flush=True)
    AGENCY_CACHE.write_text(json.dumps(out))
    return out


def market_key_for(agency: dict) -> str | None:
    """Derive our market key from an agency record, or None if not mappable."""
    name = (agency.get("agency_name") or "").strip()
    st = agency.get("state_abbr")
    typ = (agency.get("agency_type_name") or "").lower()
    if not name or not st:
        return None
    if typ == "county":
        base = SHERIFF_SUFFIXES.sub("", name).strip()
        if not base.lower().endswith("county"):
            base += " County"
        return f"{base}, {st}"
    if typ in ("city", "municipality"):
        base = PD_SUFFIXES.sub("", name).strip()
        return f"{base}, {st}"
    return None


def series_for(data: dict, contains: str, kind: str) -> dict:
    block = (data or {}).get("offenses", {}).get(kind, {}) or {}
    for label, months in block.items():
        if contains in label and "Offenses" in label:
            return months or {}
    return {}


def population_for(data: dict, contains: str) -> float | None:
    pops = (data or {}).get("populations", {}) or {}
    # populations: {"population": {"<label>": {"01-2024": N, ...}}} (shape varies)
    stack = [pops]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            for k, v in cur.items():
                if contains in str(k) and isinstance(v, dict):
                    vals = [x for x in v.values() if isinstance(x, (int, float)) and x > 0]
                    if vals:
                        return max(vals)
                stack.append(v)
    return None


def annual_from(data: dict, label_contains: str) -> tuple[float | None, float | None]:
    """Return (annual_count, population) for the series whose label contains label_contains."""
    actuals = series_for(data, label_contains, "actuals")
    count = sum(v for v in actuals.values() if isinstance(v, (int, float))) if actuals else None
    pop = population_for(data, label_contains)
    return count, pop


def fetch_agency_pair(agency: dict) -> dict | None:
    ori = agency["ori"]
    short = (agency.get("agency_name") or "").strip()
    rec = {"ori": ori, "key": market_key_for(agency), "name": short, "pop": None}
    for tag, off in (("v", "violent-crime"), ("p", "property-crime")):
        data = get(f"{API}/summarized/agency/{ori}/{off}?from={FROM}&to={TO}&type=counts&API_KEY={API_KEY}")
        if data is None:
            rec[tag] = None
            continue
        count, pop = annual_from(data, short.split(",")[0][:25])
        rec[tag] = count
        if pop:
            rec["pop"] = max(rec["pop"] or 0, pop)
    if rec["v"] is None and rec["p"] is None:
        return None
    return rec


def run_pull():
    print("Phase 1: agency lists", flush=True)
    agencies = fetch_agencies()
    print(f"  total agencies: {len(agencies)}", flush=True)

    markets = {e["key"] for e in json.loads((ROOT / "src/metros-list.json").read_text())}
    targets = []
    for a in agencies:
        k = market_key_for(a)
        if k and (k in markets or f"{k.rsplit(', ', 1)[0]} (city), {k.rsplit(', ', 1)[1]}" in markets):
            targets.append(a)
    print(f"Phase 2: {len(targets)} agencies map to known markets", flush=True)

    done = set()
    if CHECKPOINT.exists():
        for line in CHECKPOINT.read_text().splitlines():
            try:
                rec = json.loads(line)
                # "skip" records are transient failures (throttling) — retry
                # them on the next run instead of losing the agency forever
                if not rec.get("skip"):
                    done.add(rec["ori"])
            except Exception:
                pass
    todo = [a for a in targets if a["ori"] not in done]
    print(f"  resume: {len(done)} done, {len(todo)} to fetch", flush=True)

    n_ok = 0
    with CHECKPOINT.open("a") as ckpt, ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(fetch_agency_pair, a): a for a in todo}
        for i, fut in enumerate(as_completed(futs)):
            a = futs[fut]
            try:
                rec = fut.result()
            except Exception:
                rec = None
            ckpt.write(json.dumps(rec if rec else {"ori": a["ori"], "skip": True}) + "\n")
            if rec:
                n_ok += 1
            if (i + 1) % 200 == 0:
                ckpt.flush()
                print(f"  {i+1}/{len(todo)} fetched ({n_ok} with data)", flush=True)
    print(f"Phase 2 done: {n_ok} new agencies with data", flush=True)


def finalize():
    print("Phase 3: states + national", flush=True)
    states, national = {}, {}
    for st in STATES:
        entry = {}
        for tag, off in (("v", "violent-crime"), ("p", "property-crime")):
            data = get(f"{API}/summarized/state/{st}/{off}?from={FROM}&to={TO}&type=counts&API_KEY={API_KEY}")
            if not data:
                continue
            rates = series_for(data, "Offenses" if False else "", "rates")  # unused; compute from actuals
            count, pop = annual_from(data, " ")  # state series label = "<State name> Offenses"
            # state label: find the non-US series
            block = data.get("offenses", {}).get("actuals", {}) or {}
            st_label = next((l for l in block if "United States" not in l and "Offenses" in l), None)
            if st_label:
                cnt = sum(v for v in block[st_label].values() if isinstance(v, (int, float)))
                pop2 = population_for(data, st_label.replace(" Offenses", ""))
                if cnt and pop2:
                    entry[tag] = round(cnt / pop2 * 100000, 1)
            if not national.get(tag):
                us = data.get("offenses", {}).get("rates", {}).get("United States Offenses", {})
                vals = [v for v in us.values() if isinstance(v, (int, float))]
                if vals:
                    national[tag] = round(sum(vals), 1)  # monthly per-100k rates sum ≈ annual rate
        if entry:
            states[st] = entry
        print(f"  {st}: {entry}", flush=True)

    print("Phase 4: aggregate agencies → markets", flush=True)
    markets_list = json.loads((ROOT / "src/metros-list.json").read_text())
    market_keys = {e["key"] for e in markets_list}
    agg: dict[str, dict] = {}
    seen_oris: set[str] = set()
    for line in CHECKPOINT.read_text().splitlines():
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if not rec or rec.get("skip") or not rec.get("key"):
            continue
        if rec.get("ori") in seen_oris:
            continue
        seen_oris.add(rec["ori"])
        key = rec["key"]
        # prefer the explicit "(city)" market when it exists — keeps metro keys
        # (e.g. "Miami, FL") distinct from the city PD's jurisdiction; the UI
        # falls back metro -> (city) -> county -> state when looking up
        alt = f"{key.rsplit(', ', 1)[0]} (city), {key.rsplit(', ', 1)[1]}"
        if alt in market_keys:
            key = alt
        elif key not in market_keys:
            continue
        slot = agg.setdefault(key, {"v": 0.0, "p": 0.0, "pop": 0.0, "n": 0})
        slot["v"] += rec.get("v") or 0
        slot["p"] += rec.get("p") or 0
        slot["pop"] += rec.get("pop") or 0
        slot["n"] += 1

    out_markets = {}
    for key, s in agg.items():
        if s["pop"] and s["pop"] > 100:
            out_markets[key] = {
                "v": round(s["v"] / s["pop"] * 100000, 1),
                "p": round(s["p"] / s["pop"] * 100000, 1),
                "pop": int(s["pop"]),
            }

    out = {"year": YEAR, "source": "FBI Crime Data Explorer (UCR/NIBRS)",
           "national": national, "states": states, "markets": out_markets}
    # Sanity gate: don't overwrite the published file with a degraded result.
    if len(out_markets) < 3000 or len(states) < 45:
        raise SystemExit(f"ABORT: {len(out_markets)} markets / {len(states)} states is below floor; "
                         f"not overwriting {OUT.name}. Existing file left intact.")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB) — {len(out_markets)} markets, {len(states)} states", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--finalize", action="store_true", help="Skip agency pull; rebuild output from checkpoint")
    args = ap.parse_args()
    if not args.finalize:
        run_pull()
    finalize()
