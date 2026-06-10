#!/usr/bin/env python3
"""
Bake public/market-context.json — five open datasets joined to the platform's
market keys ("Miami, FL", "Miami-Dade County, FL", "Coral Gables, FL", ...):

  rents        Zillow ZORI (metro/county/city): latest rent, rent YoY,
               gross yield = 12*rent / latest ZHVI level
  heat         Zillow for-sale inventory YoY (county+metro), median list price
               vs ZHVI, days-to-pending (metro)
  income       BEA CAINC1 (county): per-capita income, 5-yr growth,
               price-to-income, PTI vs that county's own 20-yr norm
  hazard       FEMA National Risk Index (county): score, rating, EAL rate,
               top hazards
  migration    IRS SOI county flows 2022→2023: net households, net AGI ($M),
               avg AGI of in-migrants, top feeder counties

Each dataset is fetched independently and failures degrade gracefully (the
others still bake). Raw downloads are cached in data/ (gitignored).
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "public" / "market-context.json"

MARKETS = {e["key"] for e in json.loads((ROOT / "src/metros-list.json").read_text())}
CTX: dict[str, dict] = {}

session = requests.Session()
session.headers["User-Agent"] = "ai-diligence-tool/1.0 (open data ingest)"


def slot(key: str) -> dict:
    return CTX.setdefault(key, {})


def market_key(region: str, state: str, region_type: str) -> str | None:
    """Map a Zillow RegionName/State to our market key (preferring (city) variants)."""
    if region_type == "msa":
        k = f"{region}"  # Zillow metro RegionName already looks like "Miami, FL"
        return k if k in MARKETS else None
    k = f"{region}, {state}"
    if region_type == "city":
        alt = f"{region} (city), {state}"
        if alt in MARKETS:
            return alt
    return k if k in MARKETS else None


def cached_download(url: str, name: str) -> Path | None:
    p = DATA / name
    if p.exists() and p.stat().st_size > 1000:
        return p
    try:
        r = session.get(url, timeout=300)
        r.raise_for_status()
        p.write_bytes(r.content)
        print(f"  downloaded {name} ({len(r.content)/1e6:.1f} MB)")
        return p
    except Exception as e:
        print(f"  !! {name}: {e}")
        return None


def date_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if isinstance(c, str) and c[:4].isdigit() and "-" in c]


def last_valid(row, cols) -> tuple[float | None, str | None]:
    s = pd.Series([row[c] for c in cols], index=cols).dropna()
    if s.empty:
        return None, None
    return float(s.iloc[-1]), s.index[-1]


# ---------------------------------------------------------------- ZHVI levels
def zhvi_levels() -> dict[str, float]:
    """Latest ZHVI price level per market key, from the raw files already on disk."""
    levels: dict[str, float] = {}
    specs = [
        ("zillow_zhvi_metro_raw.csv", "msa"),
        ("zillow_zhvi_county_raw.csv", "county"),
        ("zillow_zhvi_city_raw.csv", "city"),
    ]
    for fname, rtype in specs:
        p = DATA / fname
        if not p.exists():
            print(f"  !! missing {fname} — run the zillow ingest first")
            continue
        df = pd.read_csv(p)
        cols = date_cols(df)
        for _, row in df.iterrows():
            region = str(row["RegionName"])
            if rtype == "county":
                key = market_key(region, row.get("State", ""), "county")
            elif rtype == "city":
                key = market_key(region, row.get("State", ""), "city")
            else:
                key = market_key(region, "", "msa")
            if not key:
                continue
            v, _ = last_valid(row, cols)
            if v and key not in levels:
                levels[key] = v
    print(f"  ZHVI levels for {len(levels)} markets")
    return levels


# ---------------------------------------------------------------------- ZORI
def bake_rents(levels: dict[str, float]):
    print("ZORI rents…")
    base = "https://files.zillowstatic.com/research/public_csvs/zori/"
    specs = [
        ("Metro_zori_uc_sfrcondomfr_sm_month.csv", "msa"),
        ("County_zori_uc_sfrcondomfr_sm_month.csv", "county"),
        ("City_zori_uc_sfrcondomfr_sm_month.csv", "city"),
    ]
    n = 0
    for fname, rtype in specs:
        p = cached_download(base + fname, f"zori_{rtype}.csv")
        if not p:
            continue
        df = pd.read_csv(p)
        cols = date_cols(df)
        for _, row in df.iterrows():
            key = market_key(str(row["RegionName"]), row.get("State", ""), rtype)
            if not key:
                continue
            s = slot(key)
            if "rent" in s:
                continue
            rent, when = last_valid(row, cols)
            if not rent:
                continue
            s["rent"] = round(rent)
            # YoY: 12 months earlier
            try:
                idx = cols.index(when)
                prev = row[cols[idx - 12]] if idx >= 12 else None
                if prev and np.isfinite(prev):
                    s["rentYoY"] = round(rent / float(prev) - 1, 4)
            except Exception:
                pass
            lvl = levels.get(key)
            if lvl:
                s["grossYield"] = round(12 * rent / lvl, 4)
            n += 1
    print(f"  rents for {n} markets")


# ------------------------------------------------------------ Inventory/heat
def bake_heat(levels: dict[str, float]):
    print("Market heat (inventory, list price, days-to-pending)…")
    base = "https://files.zillowstatic.com/research/public_csvs/"
    specs = [
        ("invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv", "msa", "inv"),
        ("invt_fs/County_invt_fs_uc_sfrcondo_sm_month.csv", "county", "inv"),
        ("mlp/Metro_mlp_uc_sfrcondo_sm_month.csv", "msa", "mlp"),
        ("mlp/County_mlp_uc_sfrcondo_sm_month.csv", "county", "mlp"),
        ("mean_doz_pending/Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv", "msa", "dtp"),
    ]
    for path, rtype, kind in specs:
        p = cached_download(base + path, f"heat_{kind}_{rtype}.csv")
        if not p:
            continue
        df = pd.read_csv(p)
        cols = date_cols(df)
        for _, row in df.iterrows():
            key = market_key(str(row["RegionName"]), row.get("State", ""), rtype)
            if not key:
                continue
            s = slot(key)
            v, when = last_valid(row, cols)
            if v is None:
                continue
            if kind == "inv" and "invYoY" not in s:
                try:
                    idx = cols.index(when)
                    prev = row[cols[idx - 12]] if idx >= 12 else None
                    if prev and np.isfinite(prev) and prev > 0:
                        s["invYoY"] = round(v / float(prev) - 1, 4)
                except Exception:
                    pass
            elif kind == "mlp" and "listVsZhvi" not in s:
                lvl = levels.get(key)
                if lvl:
                    s["listVsZhvi"] = round(v / lvl, 3)
            elif kind == "dtp" and "daysToPending" not in s:
                s["daysToPending"] = round(v)
    n = sum(1 for v in CTX.values() if "invYoY" in v or "daysToPending" in v)
    print(f"  heat for {n} markets")


# ------------------------------------------------------------------ BEA income
def bake_income(levels: dict[str, float]):
    print("BEA county income…")
    p = cached_download("https://apps.bea.gov/regional/zip/CAINC1.zip", "bea_cainc1.zip")
    if not p:
        return
    with zipfile.ZipFile(p) as z:
        csv_name = next(n for n in z.namelist() if "ALL_AREAS" in n)
        df = pd.read_csv(io.BytesIO(z.read(csv_name)), encoding="latin-1", low_memory=False)
    pci = df[df["LineCode"] == 3]
    years = [c for c in pci.columns if c.isdigit()]
    latest, prev5 = years[-1], years[-6]
    n = 0
    for _, row in pci.iterrows():
        geo = str(row["GeoName"]).strip().rstrip("*")
        if ", " not in geo:
            continue
        name, st = geo.rsplit(", ", 1)
        if len(st) != 2:
            continue
        key = f"{name} County, {st}"
        if key not in MARKETS:
            key = f"{name}, {st}"
            if key not in MARKETS:
                continue
        try:
            inc = float(row[latest])
            inc5 = float(row[prev5])
        except Exception:
            continue
        if not np.isfinite(inc) or inc <= 0:
            continue
        s = slot(key)
        s["income"] = round(inc)
        if np.isfinite(inc5) and inc5 > 0:
            s["incomeGrowth5y"] = round(inc / inc5 - 1, 4)
        lvl = levels.get(key)
        if lvl:
            s["priceToIncome"] = round(lvl / inc, 2)
        n += 1
    print(f"  income for {n} markets")


# ------------------------------------------------------------------- FEMA NRI
def bake_hazard():
    print("FEMA National Risk Index…")
    p = DATA / "fema_nri_counties.csv"
    if not p.exists():
        try:
            meta = session.get(
                "https://hub.arcgis.com/api/download/v1/items/39485e8035d446a5bff03259508ae355/csv?redirect=false&layers=0",
                timeout=120).json()
            url = meta.get("resultUrl")
            if not url:
                print(f"  !! NRI: no resultUrl ({str(meta)[:120]})")
                return
            r = session.get(url, timeout=600)
            r.raise_for_status()
            p.write_bytes(r.content)
            print(f"  downloaded NRI ({len(r.content)/1e6:.1f} MB)")
        except Exception as e:
            print(f"  !! NRI: {e}")
            return
    df = pd.read_csv(p, low_memory=False)
    hazard_names = [
        "Hurricane", "Coastal Flooding", "Riverine Flooding", "Wildfire", "Tornado",
        "Earthquake", "Winter Weather", "Drought", "Heat Wave", "Strong Wind",
        "Hail", "Lightning", "Ice Storm", "Landslide", "Cold Wave",
    ]
    n = 0
    for _, row in df.iterrows():
        ctype = str(row.get("County Type") or "County")
        key = f"{row.get('County Name')} {ctype}, {row.get('State Name Abbreviation')}"
        if key not in MARKETS:
            key = f"{row.get('County Name')} County, {row.get('State Name Abbreviation')}"
            if key not in MARKETS:
                continue
        s = slot(key)
        if "nriScore" in s:
            continue
        try:
            s["nriScore"] = round(float(row["National Risk Index - Score - Composite"]), 1)
            s["nriRating"] = str(row["National Risk Index - Rating - Composite"])
        except Exception:
            continue
        tops = []
        for name in hazard_names:
            try:
                sc = float(row.get(f"{name} - Hazard Type Risk Index Score", float("nan")))
                if np.isfinite(sc):
                    tops.append((name.replace(" Flooding", " flood"), round(sc, 1)))
            except Exception:
                pass
        tops.sort(key=lambda x: -x[1])
        s["topHazards"] = tops[:3]
        n += 1
    print(f"  hazard for {n} counties")


# -------------------------------------------------------------- IRS migration
def bake_migration():
    print("IRS migration flows…")
    pin = cached_download("https://www.irs.gov/pub/irs-soi/countyinflow2223.csv", "irs_inflow.csv")
    pout = cached_download("https://www.irs.gov/pub/irs-soi/countyoutflow2223.csv", "irs_outflow.csv")
    if not pin or not pout:
        return
    inf = pd.read_csv(pin, encoding="latin-1")
    out = pd.read_csv(pout, encoding="latin-1")
    inf.columns = [c.lower() for c in inf.columns]
    out.columns = [c.lower() for c in out.columns]

    # destination county names from the inflow file's summary rows
    # (y1_statefips 96 = total migration US+foreign)
    def fips(state, county):
        return f"{int(state):02d}{int(county):03d}"

    # FIPS -> "Name County, ST" using origin name columns
    fips_name: dict[str, str] = {}
    for _, r in inf.iterrows():
        try:
            f = fips(r["y1_statefips"], r["y1_countyfips"])
        except Exception:
            continue
        nm, st = str(r.get("y1_countyname", "")).strip(), str(r.get("y1_state", "")).strip()
        if len(st) == 2 and nm and int(r["y1_statefips"]) < 57 and f not in fips_name:
            nm = nm.replace(" Non-migrants", "").strip()
            fips_name[f] = f"{nm}, {st}" if nm.lower().endswith("county") else f"{nm} County, {st}"

    def totals(df, dst_state, dst_county, src_state):
        t = df[(df[dst_state + "_statefips"].astype(int) < 57)]
        return t

    results: dict[str, dict] = {}
    tot_in = inf[inf["y1_statefips"].astype(int) == 96]
    for _, r in tot_in.iterrows():
        try:
            f = fips(r["y2_statefips"], r["y2_countyfips"])
        except Exception:
            continue
        key = fips_name.get(f)
        if not key or key not in MARKETS:
            continue
        results.setdefault(key, {})["inHH"] = int(r["n1"])
        results[key]["inAGI"] = float(r["agi"])  # thousands of $
        if int(r["n1"]) > 0:
            results[key]["inAvgAGI"] = round(float(r["agi"]) * 1000 / int(r["n1"]))
    tot_out = out[out["y2_statefips"].astype(int) == 96]
    for _, r in tot_out.iterrows():
        try:
            f = fips(r["y1_statefips"], r["y1_countyfips"])
        except Exception:
            continue
        key = fips_name.get(f)
        if not key or key not in results:
            continue
        results[key]["outHH"] = int(r["n1"])
        results[key]["outAGI"] = float(r["agi"])

    # top feeder counties per destination (largest real origin rows)
    real = inf[(inf["y1_statefips"].astype(int) < 57)]
    n = 0
    for key, m in results.items():
        if "outHH" not in m:
            continue
        s = slot(key)
        s["netMigHH"] = m["inHH"] - m["outHH"]
        s["netAGI_M"] = round((m["inAGI"] - m["outAGI"]) / 1000, 1)  # $M
        if "inAvgAGI" in m:
            s["inAvgAGI"] = m["inAvgAGI"]
        n += 1
    # feeders: group top 2 origins for markets we kept (one pass, cheap enough)
    dst_fips = {}
    for f, nm in fips_name.items():
        if nm in results:
            dst_fips.setdefault(nm, f)
    by_dst: dict[str, list] = {}
    for _, r in real.iterrows():
        try:
            df_ = fips(r["y2_statefips"], r["y2_countyfips"])
            of_ = fips(r["y1_statefips"], r["y1_countyfips"])
        except Exception:
            continue
        if df_ == of_:
            continue
        dst_name = fips_name.get(df_)
        if not dst_name or dst_name not in results:
            continue
        by_dst.setdefault(dst_name, []).append((fips_name.get(of_, "?"), int(r["n1"])))
    for key, lst in by_dst.items():
        lst.sort(key=lambda x: -x[1])
        slot(key)["topOrigins"] = [[a, b] for a, b in lst[:2] if a != "?"]
    print(f"  migration for {n} counties")


def bake_sidecars():
    """Fold in independently-built ingests (HMDA, permits, NFIP) if present."""
    for name in ("ctx_hmda.json", "ctx_permits.json", "ctx_nfip.json"):
        p = DATA / name
        if not p.exists():
            print(f"  (sidecar {name} not present — skipped)")
            continue
        try:
            side = json.loads(p.read_text())
        except Exception as e:
            print(f"  !! sidecar {name}: {e}")
            continue
        n = 0
        for key, fields in side.items():
            if key in MARKETS and isinstance(fields, dict):
                slot(key).update({k: v for k, v in fields.items() if v is not None})
                n += 1
        print(f"  sidecar {name}: {n} markets")


def main():
    DATA.mkdir(exist_ok=True)
    levels = zhvi_levels()
    bake_rents(levels)
    bake_heat(levels)
    bake_income(levels)
    bake_hazard()
    bake_migration()
    print("Sidecar ingests…")
    bake_sidecars()

    # prune empty slots and write
    out = {k: v for k, v in CTX.items() if v}
    payload = {
        "sources": {
            "rents": "Zillow ZORI", "heat": "Zillow inventory/list/days-to-pending",
            "income": "BEA CAINC1", "hazard": "FEMA National Risk Index",
            "migration": "IRS SOI county flows 2022-23",
        },
        "markets": out,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    fields = {}
    for v in out.values():
        for f in v:
            fields[f] = fields.get(f, 0) + 1
    print(f"\nWrote {OUT} ({OUT.stat().st_size/1e6:.1f} MB) — {len(out)} markets")
    print("field coverage:", json.dumps(fields, indent=None))


if __name__ == "__main__":
    main()
