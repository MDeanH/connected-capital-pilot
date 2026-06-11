"""
Assemble the national U.S. real-estate market dataset + cross-correlation matrix that
powers the "US Market" tab (src/us-market.json).

Pulls/reuses comprehensive national series across home prices, rents, commercial RE,
activity, financing, and adjacent macro; aligns them to quarterly changes; and computes
a pairwise correlation matrix plus per-series return distributions (de-smoothed via the
verified engine). Reuses cached FRED/Zillow files; fetches missing ones from FRED's
fredgraph.csv when the API is reachable (it rate-limits aggressively).

Run:  python scripts/load_us_market.py
"""
from __future__ import annotations
import os, sys, json, glob, subprocess, importlib.util
import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src", "model"))
_spec = importlib.util.spec_from_file_location("mc_reference", os.path.join(ROOT, "src", "model", "mc_reference.py"))
mc = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(mc)

CAT = os.path.join(ROOT, "data", "catalog", "raw")
RAW = os.path.join(ROOT, "data", "raw")
TMP = os.environ.get("FRED_CACHE", "/tmp/mcrev")
ALIAS = {"EXHOSLUSM495S": "exhosl", "ACTLISCOUUS": "actlis", "MORTGAGE30US": "mortgage30us",
         "HOUST": "houst", "CSUSHPINSA": "csushpinsa"}

# (id, display name, category, kind, source)   kind: price|level|rate ; source: fred|zillow
SPEC = [
    ("CSUSHPINSA", "Case-Shiller US National HPI", "Home prices", "price", "fred"),
    ("CSUSHPISA", "Case-Shiller US National (SA)", "Home prices", "price", "fred"),
    ("SPCS20RSA", "Case-Shiller 20-City", "Home prices", "price", "fred"),
    ("SPCS10RSA", "Case-Shiller 10-City", "Home prices", "price", "fred"),
    ("USSTHPI", "FHFA US House Price Index", "Home prices", "price", "fred"),
    ("HPIPONM226S", "FHFA Purchase-Only HPI", "Home prices", "price", "fred"),
    ("MSPUS", "Median Sales Price of Houses", "Home prices", "price", "fred"),
    ("ZHVI_US", "Zillow Home Value Index (US)", "Home prices", "price", "zillow"),
    ("CUSR0000SEHA", "CPI Rent of Primary Residence", "Rents", "price", "fred"),
    ("CUSR0000SEHC", "CPI Owners' Equiv. Rent", "Rents", "price", "fred"),
    ("ZORI_US", "Zillow Observed Rent Index (US)", "Rents", "price", "zillow"),
    ("COMREPUSQ159N", "Commercial Real Estate Prices", "Commercial/REIT", "price", "fred"),
    # WILLREITIND (Wilshire US REIT) was discontinued on FRED with no free
    # no-key replacement, so the REIT slot is dropped (Commercial RE prices remain).
    ("HOUST", "Housing Starts", "Activity", "level", "fred"),
    # EXHOSLUSM495S (existing home sales) was reset on FRED to a 14-month stub;
    # HSN1F (new one-family home sales, monthly since 1963) is the long-history
    # RE-activity stand-in.
    ("HSN1F", "New One-Family Home Sales", "Activity", "level", "fred"),
    ("ACTLISCOUUS", "Active Listings", "Activity", "level", "fred"),
    ("MORTGAGE30US", "30-Yr Fixed Mortgage Rate", "Financing", "rate", "fred"),
    ("FEDFUNDS", "Fed Funds Rate", "Macro/rates", "rate", "fred"),
    ("SOFR", "SOFR (Secured Overnight Rate)", "Financing", "rate", "fred"),
    ("DGS10", "10-Yr Treasury Yield", "Macro/rates", "rate", "fred"),
    ("UNRATE", "Unemployment Rate", "Macro/rates", "rate", "fred"),
    ("CPIAUCSL", "CPI (All Items)", "Macro/rates", "price", "fred"),
    ("GDPC1", "Real GDP", "Macro/rates", "level", "fred"),
    ("PAYEMS", "Nonfarm Payrolls", "Macro/rates", "level", "fred"),
    # BAMLH0A0HYM2 (ICE BofA high-yield spread): FRED's free API exposes only
    # ~3 years (ICE licensing), too thin to correlate or to keep from dragging
    # the common-overlap window — dropped until fuller free history is available.
    # WILL5000IND (Wilshire 5000) discontinued on FRED; NASDAQCOM (Nasdaq
    # Composite, daily since 1971) is the long-history equity-market series.
    ("NASDAQCOM", "Nasdaq Composite (Equities)", "Macro/rates", "price", "fred"),
]


def _resolve(fid):
    for p in (os.path.join(CAT, f"fred_{fid}.csv"), os.path.join(TMP, f"fred_{fid}.csv")):
        if os.path.exists(p):
            return p
    for a in {fid.lower(), ALIAS.get(fid, "")}:
        if a:
            g = sorted(glob.glob(os.path.join(RAW, f"fred_{a}_*.csv")))
            if g:
                return g[-1]
    return None


_FRED_CSV_DOWN = False  # circuit breaker: once the CSV endpoint refuses the
                        # connection this run, stop wasting 80s/series on retries.


def _fetch(fid):
    global _FRED_CSV_DOWN
    if _FRED_CSV_DOWN:
        return None
    dest = os.path.join(TMP, f"fred_{fid}.csv")
    for attempt in range(4):
        r = subprocess.run(["curl", "-s", "--max-time", "15", "-o", dest, "-w", "%{http_code}",
                            "-A", "Mozilla/5.0 (Macintosh)", f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fid}"],
                           capture_output=True, text=True)
        code = r.stdout.strip()
        if code == "200" and os.path.exists(dest) and os.path.getsize(dest) > 50 \
                and not open(dest, "rb").read(20).lstrip().startswith(b"<"):
            return dest
        if code == "000":  # connection refused/timeout — the endpoint is blocked; don't hammer it
            _FRED_CSV_DOWN = True
            return None
    return None


def _fetch_fred_api(fid):
    """Official FRED API (api.stlouisfed.org). Far less aggressively rate-limited
    than the fredgraph.csv scrape; needs a free 32-char key in FRED_API_KEY."""
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        return None
    import urllib.request
    url = (f"https://api.stlouisfed.org/fred/series/observations?series_id={fid}"
           f"&api_key={key}&file_type=json")
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            obs = json.load(r).get("observations", [])
    except Exception:
        return None
    rows = [(o["date"], o["value"]) for o in obs if o.get("value") not in (".", None, "")]
    if len(rows) < 8:
        return None
    s = pd.Series({pd.to_datetime(d): float(v) for d, v in rows}).sort_index()
    return s if len(s) >= 8 else None


def _fetch_alt(fid):
    """No-key primary-source fallbacks for series whose origin agency is reachable
    even when FRED is blocked: Treasury (yields) and BLS (CPI, payrolls)."""
    try:
        if fid == "DGS10":
            import io
            import urllib.request
            frames = []
            for yr in range(2015, 2027):
                url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
                       f"daily-treasury-rates.csv/{yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value={yr}&_format=csv")
                try:
                    with urllib.request.urlopen(url, timeout=25) as r:
                        df = pd.read_csv(io.BytesIO(r.read()))
                    col = next((c for c in df.columns if c.strip() in ("10 Yr", "10 YR", "10Yr")), None)
                    if col:
                        df["d"] = pd.to_datetime(df["Date"], errors="coerce")
                        frames.append(df[["d", col]].rename(columns={col: "v"}))
                except Exception:
                    continue
            if not frames:
                return None
            s = pd.concat(frames).dropna().set_index("d")["v"].sort_index()
            return s if len(s) >= 8 else None

        if fid == "FEDFUNDS":
            import urllib.request
            url = ("https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json"
                   "?startDate=2006-01-01&endDate=2030-12-31&type=rate")
            try:
                with urllib.request.urlopen(url, timeout=25) as r:
                    refs = json.load(r).get("refRates", [])
            except Exception:
                return None
            rows = {pd.to_datetime(x["effectiveDate"]): float(x["percentRate"])
                    for x in refs if x.get("percentRate") is not None}
            s = pd.Series(rows).sort_index()
            return s if len(s) >= 8 else None

        bls_map = {"CPIAUCSL": "CUSR0000SA0", "PAYEMS": "CES0000000001", "UNRATE": "LNS14000000"}
        if fid in bls_map:
            import datetime
            import urllib.request
            # BLS unregistered API caps at 10 years/query (and throttles bursts),
            # so pull a single most-recent 10-year window per series — continuous,
            # one request. ~40 quarters, deeper than the file's prior ~35q overlap.
            cy = datetime.date.today().year
            sid = bls_map[fid]
            body = json.dumps({"seriesid": [sid], "startyear": str(cy - 9), "endyear": str(cy)}).encode()
            req = urllib.request.Request("https://api.bls.gov/publicAPI/v2/timeseries/data/",
                                         data=body, headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    data = json.load(r)
                obs = {f'{d["year"]}-{d["period"][1:]}-01': float(d["value"])
                       for d in data["Results"]["series"][0]["data"] if d["period"].startswith("M")}
            except Exception:
                return None
            if len(obs) < 8:
                return None
            return pd.Series({pd.to_datetime(k): v for k, v in obs.items()}).sort_index()
    except Exception:
        return None
    return None


def load_fred(fid):
    # cached -> official FRED API (key) -> fredgraph scrape -> no-key agency source
    p = _resolve(fid)
    if p is None:
        s = _fetch_fred_api(fid)
        if s is not None:
            return _finish_fred(s)
        p = _fetch(fid)
    if p is None:
        s = _fetch_alt(fid)
        if s is not None:
            return _finish_fred(s)
        return None
    try:
        if open(p, "rb").read(20).lstrip().startswith(b"<"):
            return None
        df = pd.read_csv(p, on_bad_lines="skip")
    except Exception:
        return None
    if df.shape[1] > 2:
        df = df.iloc[:, :2]
    if df.shape[1] < 2:
        return None
    df.columns = ["d", "v"]
    df["d"] = pd.to_datetime(df["d"], errors="coerce")
    df["v"] = pd.to_numeric(df["v"], errors="coerce")
    s = df.dropna().set_index("d")["v"]
    return _finish_fred(s)


def _finish_fred(s):
    return s if s is not None and len(s) >= 8 else None


def load_zillow(kind):  # 'ZHVI' | 'ZORI' US-national row
    f = os.path.join(CAT, f"{kind}_metro.csv")
    if not os.path.exists(f):
        return None
    z = pd.read_csv(f)
    dc = [c for c in z.columns if c[:4].isdigit() and "-" in c]
    row = z[z["RegionName"] == "United States"]
    if row.empty:
        return None
    s = pd.to_numeric(row.iloc[0][dc], errors="coerce")
    s.index = pd.to_datetime(dc)
    return s.dropna()


def main():
    series, meta, missing = {}, [], []
    for fid, name, cat, kind, src in SPEC:
        s = load_zillow(fid.replace("_US", "")) if src == "zillow" else load_fred(fid)
        if s is None:
            missing.append(fid); continue
        q = s.resample("QE").last().dropna()
        chg = (q.pct_change() if kind in ("price", "level") else q.diff()).dropna()
        if len(chg) < 8:
            missing.append(fid); continue
        series[fid] = chg
        yoy = ((float(q.iloc[-1]) / float(q.iloc[-5]) - 1) * 100 if kind in ("price", "level") and len(q) >= 5 and q.iloc[-5] > 0
               else (float(q.iloc[-1]) - float(q.iloc[-5]) if len(q) >= 5 else None))
        m = {"id": fid, "name": name, "category": cat, "kind": kind, "latest": round(float(q.iloc[-1]), 3),
             "asof": str(q.index[-1].date()), "yoy": round(yoy, 2) if yoy is not None else None, "n": int(len(q))}
        if kind == "price":
            try:
                r = mc.prices_to_returns(q.values)
                f = mc.fit_distribution(r, periods_per_year=4)
                fd = mc.fit_distribution(mc.geltner_unsmooth(r), periods_per_year=4)
                m.update(annReturn=round(f["mu"], 4), annVol=round(f["sigma"], 4), annVolDesmoothed=round(fd["sigma"], 4))
            except Exception:
                pass
        meta.append(m)

    df = pd.DataFrame(series)
    corr = df.corr(min_periods=10).round(3)
    labels = [m["id"] for m in meta if m["id"] in corr.columns]
    corr = corr.loc[labels, labels]
    mat = [[None if pd.isna(corr.iloc[i, j]) else float(corr.iloc[i, j]) for j in range(len(labels))] for i in range(len(labels))]
    re_i = labels.index("CSUSHPINSA")
    re_corr = sorted(
        [{"id": l, "name": next(m["name"] for m in meta if m["id"] == l),
          "category": next(m["category"] for m in meta if m["id"] == l), "corr": mat[re_i][labels.index(l)]}
         for l in labels if l != "CSUSHPINSA" and mat[re_i][labels.index(l)] is not None],
        key=lambda x: -abs(x["corr"]))
    out = {"asof": max(m["asof"] for m in meta), "nSeries": len(meta), "missing": missing, "series": meta,
           "corr": {"labels": labels, "names": [next(m["name"] for m in meta if m["id"] == l) for l in labels],
                    "category": [next(m["category"] for m in meta if m["id"] == l) for l in labels], "matrix": mat},
           "reCorr": re_corr, "commonQuarters": int(df.dropna().shape[0])}
    dest = os.path.join(ROOT, "src", "us-market.json")

    # Non-destructive: never overwrite a good file by *accidentally* losing a
    # series (blocked CSV endpoint, empty cache, transient API failure). A
    # regression = a series still defined in SPEC that the live file has but this
    # run failed to fetch. Series intentionally removed from SPEC are NOT a
    # regression, so curation (dropping discontinued/thin series) is allowed.
    new_present = {m["id"] for m in meta}
    spec_ids = {s[0] for s in SPEC}
    if os.path.exists(dest):
        try:
            old_present = {m["id"] for m in json.load(open(dest)).get("series", [])}
        except Exception:
            old_present = set()
        regressed = (old_present & spec_ids) - new_present
        if regressed:
            print(f"SKIP write: would regress (lose {', '.join(sorted(regressed))}). Live file left intact. "
                  f"Set FRED_API_KEY or wait for the source to recover.")
            return len(missing)

    json.dump(out, open(dest, "w"), separators=(",", ":"))
    print(f"Wrote {dest}: {len(meta)} series, {out['commonQuarters']}q overlap, asof {out['asof']}.")
    if missing:
        print(f"Missing: {', '.join(missing)}")
    return len(missing)


if __name__ == "__main__":
    main()
