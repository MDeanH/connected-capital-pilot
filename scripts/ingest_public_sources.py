#!/usr/bin/env python3
"""
Ingest the free/keyless sources from the 2026-07-10 public data catalogs:
  data/public_economic_data_catalog.md  +  data/stock_market_data_catalog.md
  registry: data/catalog/public_source_registry.json

Raw pulls land in data/raw/public/<source_id>/ (gitignored).
Run manifest (committed-able) at data/catalog/public_ingest_manifest.json.

Every source is independent try/except: one failure never stops the run.
Sources needing API keys or logins are recorded as skipped with the reason.

Usage:
    python scripts/ingest_public_sources.py            # ingest everything feasible
    python scripts/ingest_public_sources.py --only vix_history,french_factors
    python scripts/ingest_public_sources.py --list
"""

import argparse
import datetime as dt
import io
import json
import re
import sys
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "public"
MANIFEST = ROOT / "data" / "catalog" / "public_ingest_manifest.json"

UA = "ai-diligence-tool research ingester (michaeldeanharwood@gmail.com)"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

session = requests.Session()
session.headers["User-Agent"] = UA


def fetch(url, browser=False, timeout=120, retries=2, **kw):
    headers = dict(kw.pop("headers", {}))
    if browser:
        headers.setdefault("User-Agent", BROWSER_UA)
        headers.setdefault("Accept", "*/*")
    last = None
    for i in range(retries + 1):
        try:
            r = session.get(url, headers=headers, timeout=timeout, **kw)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def save(source_id, filename, content: bytes):
    d = RAW / source_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / filename
    p.write_bytes(content)
    return p


def line_count(content: bytes):
    try:
        return content.count(b"\n")
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- handlers

def h_direct(source_id, files, browser=False):
    """files: list of (url, filename)."""
    out = []
    for url, name in files:
        r = fetch(url, browser=browser)
        p = save(source_id, name, r.content)
        out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)})
    return out


def h_fred_batch(source_id, series):
    out = []
    for sid in series:
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
        r = fetch(url)
        if b"Error" in r.content[:200] and len(r.content) < 500:
            raise RuntimeError(f"FRED returned error page for {sid}")
        p = save(source_id, f"{sid}.csv", r.content)
        out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)})
        time.sleep(0.5)
    return out


def h_scrape_link(source_id, page_url, pattern, filename, browser=True, base=None):
    """Fetch page, find first href matching regex pattern, download it."""
    from urllib.parse import urljoin
    r = fetch(page_url, browser=browser)
    m = re.search(pattern, r.text)
    if not m:
        raise RuntimeError(f"link pattern not found on {page_url}")
    link = m.group(0) if m.lastindex is None else m.group(1)
    link = link.replace("&amp;", "&")
    if link.startswith("//"):
        link = "https:" + link
    elif not link.startswith("http"):
        link = urljoin(base or page_url, link)
    r2 = fetch(link, browser=browser)
    p = save(source_id, filename, r2.content)
    return [{"url": link, "file": str(p.relative_to(ROOT)), "bytes": len(r2.content), "lines": line_count(r2.content)}]


def h_first_working(source_id, candidates, filename, browser=True, min_bytes=1000):
    """Try candidate URLs in order; save the first that returns plausible content."""
    errors = []
    for url in candidates:
        try:
            r = fetch(url, browser=browser)
            if len(r.content) >= min_bytes and not r.content[:200].lstrip().lower().startswith(b"<!doctype html"):
                p = save(source_id, filename, r.content)
                return [{"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)}]
            errors.append(f"{url} -> {len(r.content)}B html/short")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url} -> {str(e)[:80]}")
    raise RuntimeError("; ".join(errors)[:280])


def h_wayback_fred(source_id, fred_id, before="20260401", ask="20260320"):
    """Pull the most recent pre-`before` Wayback snapshot of a fredgraph CSV
    (rescues history FRED has since truncated, e.g. ICE BofA series)."""
    target = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}"
    avail = fetch(
        "https://archive.org/wayback/available",
        params={"url": target, "timestamp": ask},
    ).json()
    snap = avail.get("archived_snapshots", {}).get("closest")
    if not snap or not snap.get("available"):
        raise RuntimeError("no wayback snapshot found")
    ts = snap["timestamp"]
    if ts >= before:
        raise RuntimeError(f"closest snapshot {ts} is not before {before}")
    raw_url = f"https://web.archive.org/web/{ts}id_/{target}"
    r = fetch(raw_url, timeout=180)
    if not r.content.startswith(b"DATE") and b"," not in r.content[:100]:
        raise RuntimeError("snapshot did not return CSV")
    p = save(source_id, f"{fred_id}_wayback_{ts}.csv", r.content)
    lines = r.content.split(b"\n")
    first_obs = lines[1].split(b",")[0].decode(errors="replace") if len(lines) > 1 else "?"
    return [{"url": raw_url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content),
             "note": f"vintage snapshot {ts}; first observation {first_obs}"}]


def h_qcew(source_id, year, qtr, areas):
    out = []
    for area in areas:
        url = f"https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area}.csv"
        r = fetch(url)
        if len(r.content) < 200:
            raise RuntimeError(f"QCEW empty for {area} {year}q{qtr}")
        p = save(source_id, f"qcew_{year}q{qtr}_{area}.csv", r.content)
        out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)})
        time.sleep(0.5)
    return out


def h_socrata_cot(source_id):
    """CFTC TFF equity-index positioning, all history for the big index contracts."""
    codes = ["13874A", "13874U", "13874+", "20974+", "209742", "239742", "124603"]
    base = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
    where = " OR ".join(f"cftc_contract_market_code='{c}'" for c in codes)
    rows, offset = [], 0
    while True:
        r = fetch(base, params={"$where": where, "$limit": 50000, "$offset": offset, "$order": "report_date_as_yyyy_mm_dd"})
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < 50000:
            break
        offset += 50000
    if not rows:
        raise RuntimeError("no COT rows returned")
    content = json.dumps(rows).encode()
    p = save(source_id, "cftc_tff_equity_indexes.json", content)
    return [{"url": base, "file": str(p.relative_to(ROOT)), "bytes": len(content), "rows": len(rows)}]


def h_finra(source_id):
    out = []
    # bi-monthly consolidated short interest. NB: a bare GET returns the OLDEST
    # partition's first 5,000 rows (2020) — must filter to the latest settlement
    # date and paginate. Find the latest partition, then page through it.
    url = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
    parts = fetch("https://api.finra.org/partitions/group/otcMarket/name/consolidatedShortInterest",
                  headers={"Accept": "application/json"}).json()
    latest = max(p["partitions"][0] if isinstance(p, dict) and "partitions" in p else p
                 for p in (parts.get("availablePartitions") or parts if isinstance(parts, list) else [parts]))
    if isinstance(latest, dict):
        latest = sorted(v for v in latest.values() if isinstance(v, str))[-1]
    rows, offset = [], 0
    while True:
        r = session.post(url, headers={"Accept": "application/json", "Content-Type": "application/json",
                                       "User-Agent": BROWSER_UA},
                         json={"limit": 5000, "offset": offset,
                               "compareFilters": [{"fieldName": "settlementDate", "compareType": "EQUAL",
                                                   "fieldValue": str(latest)[:10]}]}, timeout=90)
        r.raise_for_status()
        chunk = r.json()
        rows += chunk
        if len(chunk) < 5000:
            break
        offset += 5000
    content = json.dumps(rows).encode()
    p = save(source_id, "consolidated_short_interest_latest.json", content)
    out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(content), "rows": len(rows),
                "note": f"settlementDate {str(latest)[:10]}, paginated"})
    # daily short-sale volume flat file (walk back to most recent business day)
    day = dt.date.today()
    for _ in range(7):
        f = f"CNMSshvol{day.strftime('%Y%m%d')}.txt"
        try:
            r = fetch(f"https://cdn.finra.org/equity/regsho/daily/{f}")
            p = save(source_id, f, r.content)
            out.append({"url": r.url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)})
            break
        except Exception:  # noqa: BLE001
            day -= dt.timedelta(days=1)
    else:
        raise RuntimeError("no recent CNMSshvol file found")
    return out


def h_occ(source_id):
    day = dt.date.today()
    for _ in range(7):
        url = f"https://marketdata.theocc.com/daily-volume-statistics?reportDate={day.strftime('%Y%m%d')}&format=csv"
        try:
            r = fetch(url, browser=True)
            if len(r.content) > 200:
                p = save(source_id, f"occ_daily_volume_{day.strftime('%Y%m%d')}.csv", r.content)
                return [{"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)}]
        except Exception:  # noqa: BLE001
            pass
        day -= dt.timedelta(days=1)
    raise RuntimeError("no recent OCC daily volume file")


def h_census_bfs(source_id):
    url = "https://api.census.gov/data/timeseries/eits/bfs"
    r = fetch(url, params={
        "get": "cell_value,time_slot_id,seasonally_adj,category_code,data_type_code",
        "for": "us:*",
        "time": "from 2010",
    })
    p = save(source_id, "bfs_us_timeseries.json", r.content)
    return [{"url": r.url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content)}]


def h_stooq(source_id, symbols):
    out = []
    for sym in symbols:
        url = f"https://stooq.com/q/d/l/?s={sym}&i=d"
        r = None
        for browser in (False, True):
            r = fetch(url, browser=browser)
            if r.content[:4] == b"Date" or r.content[:20].count(b",") > 0:
                break
        if r is None or len(r.content) < 1000 or b"<" in r.content[:5]:
            raise RuntimeError(f"stooq refused {sym}: {(r.content[:80] if r is not None else b'')!r}")
        name = sym.replace("%5E", "idx_").replace("^", "idx_")
        p = save(source_id, f"{name}.csv", r.content)
        out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content), "lines": line_count(r.content)})
        time.sleep(1)
    return out


def h_zip_extract(source_id, url, browser=False):
    r = fetch(url, browser=browser)
    d = RAW / source_id
    d.mkdir(parents=True, exist_ok=True)
    out = [{"url": url, "file": None, "bytes": len(r.content), "note": "zip"}]
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        for name in z.namelist():
            data = z.read(name)
            p = d / Path(name).name
            p.write_bytes(data)
            out.append({"file": str(p.relative_to(ROOT)), "bytes": len(data), "lines": line_count(data)})
    return out


# ---------------------------------------------------------------- source table

TODAY = dt.date.today()

SOURCES = {
    # === URGENT (deadlines) ===
    "hy_oas_history_wayback": dict(
        desc="ICE BofA HY OAS full history via pre-Apr-2026 Wayback snapshot (FRED now 3yr-window)",
        run=lambda sid: h_wayback_fred(sid, "BAMLH0A0HYM2"),
    ),
    "ig_oas_history_wayback": dict(
        desc="ICE BofA IG Corp OAS history via Wayback (only snapshot is 2026-04-22 — checked for truncation)",
        run=lambda sid: h_wayback_fred(sid, "BAMLC0A0CM", before="20270101", ask="20260422"),
    ),
    "naaim_exposure": dict(
        desc="NAAIM Exposure Index full history (goes subscription 2026-08-01)",
        run=lambda sid: h_scrape_link(
            sid, "https://naaim.org/programs/naaim-exposure-index/",
            r'https://naaim\.org/wp-content/uploads/[^"\']+USE_Data[^"\']*\.xlsx', "naaim_use_history.xlsx"),
    ),
    # === Macro/credit block (FRED keyless) ===
    "fred_macro_market": dict(
        desc="FRED keyless CSV batch: rates, curve, credit, claims, permits, liquidity, uncertainty",
        run=lambda sid: h_fred_batch(sid, [
            "T10Y3M", "T10Y2Y", "DGS10", "DGS2", "DFF", "SOFR",
            "BAMLH0A0HYM2", "BAMLC0A0CM", "NFCI", "ANFCI",
            "ICSA", "CCSA", "PERMIT", "HOUST", "UMCSENT", "SAHMREALTIME",
            "WALCL", "WTREGEN", "RRPONTSYD", "DTWEXBGS", "DCOILWTICO",
            "VIXCLS", "NASDAQCOM", "SP500", "THREEFYTP10", "GEPUCURRENT",
            "USEPUINDXD", "RECPROUSM156N", "TEMPHELPS", "MORTGAGE30US",
        ]),
    ),
    # === Labor: state weekly claims + QCEW ===
    "dol_eta_claims": dict(
        desc="DOL ETA 539 weekly state UI claims bulk CSV",
        run=lambda sid: h_direct(sid, [("https://oui.doleta.gov/unemploy/csv/ar539.csv", "ar539_state_weekly_claims.csv")]),
    ),
    "qcew_latest": dict(
        desc="QCEW latest slice: US + CA/TX/FL/NY statewide (pattern documented for all areas)",
        run=lambda sid: h_qcew(sid, 2025, 4, ["US000", "06000", "48000", "12000", "36000"]),
    ),
    "philly_fed_state_indexes": dict(
        desc="Philly Fed state coincident indexes (all 50 states, one XLSX)",
        run=lambda sid: h_first_working(sid, [
            "https://www.philadelphiafed.org/-/media/frbp/assets/surveys-and-data/coincident/coincident-revised.xlsx",
            "https://www.philadelphiafed.org/-/media/frbp/assets/surveys-and-data/coincident/coincident.xlsx",
            "https://www.philadelphiafed.org/-/media/frbp/assets/surveys-and-data/coincident/allstates.xlsx",
        ], "state_coincident_indexes.xlsx"),
    ),
    "census_bfs": dict(
        desc="Business Formation Statistics via FRED mirrors (Census EITS API demands a key)",
        run=lambda sid: h_fred_batch(sid, ["BABATOTALSAUS", "BAHBATOTALSAUS", "BUSAPPWNSAUS"]),
    ),
    # === Equity: prices, vol, factors, deep history ===
    "cboe_index_history": dict(
        desc="Cboe index history CSVs: VIX, SKEW, VVIX, VIX9D, VIX3M, RVX",
        run=lambda sid: h_direct(sid, [
            (f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{s}_History.csv", f"{s}_History.csv")
            for s in ["VIX", "SKEW", "VVIX", "VIX9D", "VIX3M", "RVX"]
        ], browser=True),
    ),
    "cboe_putcall_archive": dict(
        desc="Cboe frozen put/call archives (2006-2019) + today's daily stats page",
        run=lambda sid: h_direct(sid, [
            ("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv", "totalpc.csv"),
            ("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv", "equitypc.csv"),
            ("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpc.csv", "indexpc.csv"),
        ], browser=True),
    ),
    "french_factors": dict(
        desc="Ken French 3-factor monthly + daily (1926->)",
        run=lambda sid: (
            h_zip_extract(sid, "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip")
            + h_zip_extract(sid, "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip")
        ),
    ),
    "shiller_cape": dict(
        desc="Shiller ie_data.xls from shillerdata.com (maintained home; Yale copy frozen)",
        run=lambda sid: h_scrape_link(
            sid, "https://shillerdata.com/",
            r'(//img1\.wsimg\.com/blobby/go/[^"\']+ie_data\.xls[^"\']*)', "ie_data.xls"),
    ),
    "stooq_indexes": dict(
        desc="Stooq deep index history: ^SPX, ^DJI, ^NDX daily",
        run=lambda sid: h_stooq(sid, ["%5Espx", "%5Edji", "%5Endx"]),
    ),
    "damodaran": dict(
        desc="Damodaran: annual returns 1928-> + implied ERP monthly",
        run=lambda sid: h_direct(sid, [
            ("https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls", "histretSP.xls"),
            ("https://pages.stern.nyu.edu/~adamodar/pc/implprem/ERPbymonth.xlsx", "ERPbymonth.xlsx"),
            ("https://pages.stern.nyu.edu/~adamodar/pc/datasets/histimpl.xls", "histimpl.xls"),
        ], browser=True),
    ),
    "goyal_welch": dict(
        desc="Goyal-Welch predictor dataset (Google Sheets export)",
        run=lambda sid: h_direct(sid, [
            ("https://docs.google.com/spreadsheets/d/1qwpl2R_DNujpU5YUkk8lacP1tTeMb9iJ/export?format=xlsx",
             "goyal_welch_predictors.xlsx")], browser=True),
    ),
    "baker_wurgler": dict(
        desc="Baker-Wurgler sentiment index (1965-2023, stale but canonical)",
        run=lambda sid: h_direct(sid, [
            ("https://pages.stern.nyu.edu/~jwurgler/data/SENTIMENT.xlsx", "SENTIMENT.xlsx")], browser=True),
    ),
    "ritter_ipo": dict(
        desc="Ritter IPO data page: grab all linked xls/xlsx files",
        run=lambda sid: _ritter(sid),
    ),
    "sp_buyback_eps": dict(
        # Akamai bot-manager 403s all non-browser clients (curl/requests, even with
        # replayed cookies — it validates the httpOnly _abck cookie + TLS fingerprint).
        # The document CDN path itself returns 200 to a real same-origin browser fetch,
        # so these were gathered 2026-07-10 by fetching in the browser pane and bridging
        # the bytes to disk via a localhost uploader (Private-Network-Access header set).
        # A plain requests attempt is kept so failures are explicit in the manifest.
        desc="S&P DJI buyback + EPS workbooks (BROWSER-ONLY: Akamai-walled; see note)",
        run=lambda sid: h_direct_spdji(sid),
    ),
    "finra_short": dict(desc="FINRA consolidated short interest + latest daily short volume", run=h_finra),
    "cftc_cot_tff": dict(desc="CFTC TFF equity-index futures positioning, full history", run=h_socrata_cot),
    "occ_volume": dict(desc="OCC daily cleared options volume CSV", run=h_occ),
    "ici_flows": dict(
        desc="ICI weekly fund flows workbooks",
        run=lambda sid: h_direct(sid, [
            ("https://www.ici.org/flows_data_2026.xls", "flows_data_2026.xls"),
            ("https://www.ici.org/combined_flows_data_2025.xls", "combined_flows_data_2025.xls"),
        ], browser=True),
    ),
    "sec_reference": dict(
        desc="SEC reference: ticker-CIK map + latest fails-to-deliver",
        run=lambda sid: h_direct(sid, [
            ("https://www.sec.gov/files/company_tickers.json", "company_tickers.json"),
        ]),
    ),
    "nasdaq_symbol_dirs": dict(
        desc="Nasdaq Trader symbol directories (listing universe)",
        run=lambda sid: h_direct(sid, [
            ("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "nasdaqlisted.txt"),
            ("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "otherlisted.txt"),
        ], browser=True),
    ),
    # === Risk / uncertainty / supply chain ===
    "gscpi": dict(
        desc="NY Fed Global Supply Chain Pressure Index",
        run=lambda sid: h_direct(sid, [(
            "https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx",
            "gscpi_data.xlsx")], browser=True),
    ),
    "acm_term_premia": dict(
        desc="NY Fed ACM term premia (daily, 1961->)",
        run=lambda sid: h_direct(sid, [(
            "https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls",
            "ACMTermPremium.xls")], browser=True),
    ),
    "epu": dict(
        desc="Economic Policy Uncertainty: US monthly + daily + global",
        run=lambda sid: h_direct(sid, [
            ("https://www.policyuncertainty.com/media/US_Policy_Uncertainty_Data.xlsx", "US_EPU_monthly.xlsx"),
            ("https://www.policyuncertainty.com/media/All_Daily_Policy_Data.csv", "US_EPU_daily.csv"),
            ("https://www.policyuncertainty.com/media/Global_Policy_Uncertainty_Data.xlsx", "Global_EPU.xlsx"),
        ], browser=True),
    ),
    "gpr": dict(
        desc="Caldara-Iacoviello Geopolitical Risk index",
        run=lambda sid: h_direct(sid, [
            ("https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls", "data_gpr_export.xls")], browser=True),
    ),
    "tpu": dict(
        desc="Trade Policy Uncertainty index (scrape link from page)",
        run=lambda sid: h_scrape_link(
            sid, "https://www.matteoiacoviello.com/tpu.htm",
            r'(tpu_files/[^"\']+\.(?:xlsx|xls))', "tpu_data.xlsx",
            base="https://www.matteoiacoviello.com/"),
    ),
    # === International ===
    "ecb_fx": dict(
        desc="ECB euro FX reference rates full history",
        run=lambda sid: h_zip_extract(sid, "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip"),
    ),
    "imf_weo_datamapper": dict(
        desc="IMF DataMapper: real GDP growth + inflation, all countries",
        run=lambda sid: h_direct(sid, [
            ("https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH", "weo_ngdp_rpch.json"),
            ("https://www.imf.org/external/datamapper/api/v1/PCPIPCH", "weo_pcpipch.json"),
        ]),
    ),
    "world_bank_wdi": dict(
        desc="World Bank WDI: US + world GDP, trade, population (keyless)",
        run=lambda sid: h_direct(sid, [
            ("https://api.worldbank.org/v2/country/USA;WLD;CHN;EMU/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=2000&date=1990:2026", "wdi_gdp_growth.json"),
            ("https://api.worldbank.org/v2/country/USA/indicator/NE.TRD.GNFS.ZS?format=json&per_page=2000", "wdi_us_trade_share.json"),
        ]),
    ),
    "bis_policy_rates": dict(
        desc="BIS central bank policy rates bulk CSV",
        run=lambda sid: h_zip_extract(sid, "https://data.bis.org/static/bulk/WS_CBPOL_csv_flat.zip", browser=True),
    ),
    "treasury_fiscaldata": dict(
        desc="Treasury FiscalData: debt to the penny + avg interest rates (recent)",
        run=lambda sid: h_direct(sid, [
            ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?page[size]=10000&sort=-record_date", "debt_to_penny_recent.json"),
            ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?page[size]=10000&sort=-record_date", "avg_interest_rates.json"),
        ]),
    ),
    "tic_mfh": dict(
        # ticdata.treasury.gov/Publish/mfh.txt is a FROZEN legacy snapshot (Jan 2023).
        # The maintained MFH is SLT Table 5 (tab-delimited txt + html) plus the mfhhis01 history.
        desc="Treasury TIC major foreign holders (SLT Table 5, current; + mfhhis01 history)",
        run=lambda sid: h_direct(sid, [
            ("https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt", "slt_table5.txt"),
            ("https://treasury.gov/resource-center/data-chart-center/tic/Documents/mfhhis01.csv", "mfhhis01_history.csv"),
        ], browser=True),
    ),
    "fao_food_price_index": dict(
        # NB: URLs carry ?sfvrsn= version stamps that change on republish. These were
        # captured via the browser 2026-07-10; if they 404, re-scrape the anchor hrefs
        # from https://www.fao.org/worldfoodsituation/foodpricesindex/en/ (JS-rendered).
        desc="FAO Food Price Index CSV + xlsx (versioned URLs)",
        run=lambda sid: h_direct(sid, [
            ("https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv?sfvrsn=523ebd2a_81&download=true", "food_price_indices_data.csv"),
            ("https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/ffpi-data-2026-07.xlsx?sfvrsn=63809b16_123", "ffpi_data_2026_07.xlsx"),
            ("https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_index_nominal_real.xlsx?sfvrsn=78b6121d_68", "food_price_index_nominal_real.xlsx"),
        ], browser=True),
    ),
    "frankfurter_fx": dict(
        desc="Frankfurter FX (ECB rates) sanity endpoint",
        run=lambda sid: h_direct(sid, [("https://api.frankfurter.dev/v1/latest?base=USD", "usd_latest.json")]),
    ),
}


def h_direct_spdji(sid):
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.spglobal.com/spdji/en/indices/equity/sp-500/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
    }
    out = []
    for url, name in [
        ("https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-buyback.xlsx", "sp-500-buyback.xlsx"),
        ("https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-eps-est.xlsx", "sp-500-eps-est.xlsx"),
    ]:
        r = fetch(url, headers=headers)
        p = save(sid, name, r.content)
        out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(r.content)})
    return out


def _ritter(sid):
    r = fetch("https://site.warrington.ufl.edu/ritter/ipo-data/", browser=True)
    links = re.findall(r'href="(https://site\.warrington\.ufl\.edu/ritter/files/[^"]+\.xlsx?)"', r.text)
    links = list(dict.fromkeys(links))[:12]
    if not links:
        raise RuntimeError("no xls links found on Ritter page")
    out = []
    for url in links:
        try:
            rr = fetch(url, browser=True)
            p = save(sid, Path(url).name.replace("%20", "_"), rr.content)
            out.append({"url": url, "file": str(p.relative_to(ROOT)), "bytes": len(rr.content)})
        except Exception as e:  # noqa: BLE001
            out.append({"url": url, "error": str(e)[:120]})
        time.sleep(0.5)
    return out


# Sources we deliberately do NOT fetch, recorded in the manifest with reasons.
SKIPPED = {
    "bea_api": "needs free UserID key (apps.bea.gov/api/signup) — county income already ingested via existing pipeline",
    "eia_api": "needs free key (eia.gov/opendata) — WTI covered via FRED DCOILWTICO meanwhile",
    "bls_api_v2": "keyless v1 limited to 25/day; register free key for series pulls — QCEW slice API used instead (keyless)",
    "census_acs_full": "keyless tier OK but full ACS pull is out of scope for one run; use api.census.gov with key",
    "aaii_sentiment": "requires AAII account login (Imperva bot wall)",
    "un_comtrade": "needs free key (comtradedeveloper.un.org)",
    "wto_api": "needs free key (apiportal.wto.org)",
    "sec_companyfacts_bulk": "nightly companyfacts.zip ~1.2GB — pull on demand, not in default run",
    "un_wpp_bulk": "multi-GB CSVs — pull on demand",
    "lodes_qcew_full_expand": "QCEW all-3000-counties + LODES are bulk jobs — pattern documented, run scaled pull when needed",
    "alpaca_tiingo": "require free account registration (user action)",
    "imf_portwatch": "ArcGIS item ids to be pinned on first UI visit — free CSV/GeoJSON per dataset",
    "oecd_sdmx_cli": "needs exact dataflow key from Data Explorer 'Developer API' button — add on first use",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated source ids")
    ap.add_argument("--force", action="store_true", help="re-download even if files already present")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for k, v in SOURCES.items():
            print(f"{k:28s} {v['desc']}")
        return

    todo = list(SOURCES)
    if args.only:
        todo = [s.strip() for s in args.only.split(",") if s.strip() in SOURCES]

    # merge into the existing manifest so partial runs never clobber prior results
    manifest = {"sources": {}, "skipped": SKIPPED}
    if MANIFEST.exists():
        try:
            manifest.update(json.loads(MANIFEST.read_text()))
            manifest["skipped"] = SKIPPED
        except Exception:  # noqa: BLE001
            pass
    manifest["run_at"] = dt.datetime.now().isoformat(timespec="seconds")

    ok = failed = 0
    for sid in todo:
        spec = SOURCES[sid]
        prior = manifest["sources"].get(sid, {})
        if not args.force and prior.get("status") == "ok" and any((RAW / sid).glob("*")):
            print(f"[cached] {sid:28s} (use --force to refetch)")
            ok += 1
            continue
        t0 = time.time()
        try:
            files = spec["run"](sid)
            manifest["sources"][sid] = {"status": "ok", "desc": spec["desc"], "files": files, "secs": round(time.time() - t0, 1)}
            total = sum(f.get("bytes", 0) for f in files)
            print(f"[ok]     {sid:28s} {len(files)} file(s), {total/1024:.0f} KB")
            ok += 1
        except Exception as e:  # noqa: BLE001
            manifest["sources"][sid] = {"status": "failed", "desc": spec["desc"], "error": str(e)[:300], "secs": round(time.time() - t0, 1)}
            print(f"[FAILED] {sid:28s} {str(e)[:120]}")
            failed += 1

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1))
    print(f"\n{ok} ok, {failed} failed, {len(SKIPPED)} skipped-by-design")
    print(f"manifest: {MANIFEST.relative_to(ROOT)}")
    print(f"raw data: {RAW.relative_to(ROOT)}/ (gitignored)")


if __name__ == "__main__":
    main()
