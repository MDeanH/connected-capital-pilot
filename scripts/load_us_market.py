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
    ("WILLREITIND", "Wilshire US REIT Index", "Commercial/REIT", "price", "fred"),
    ("HOUST", "Housing Starts", "Activity", "level", "fred"),
    ("EXHOSLUSM495S", "Existing Home Sales", "Activity", "level", "fred"),
    ("ACTLISCOUUS", "Active Listings", "Activity", "level", "fred"),
    ("MORTGAGE30US", "30-Yr Fixed Mortgage Rate", "Financing", "rate", "fred"),
    ("FEDFUNDS", "Fed Funds Rate", "Macro/rates", "rate", "fred"),
    ("DGS10", "10-Yr Treasury Yield", "Macro/rates", "rate", "fred"),
    ("UNRATE", "Unemployment Rate", "Macro/rates", "rate", "fred"),
    ("CPIAUCSL", "CPI (All Items)", "Macro/rates", "price", "fred"),
    ("GDPC1", "Real GDP", "Macro/rates", "level", "fred"),
    ("PAYEMS", "Nonfarm Payrolls", "Macro/rates", "level", "fred"),
    ("BAMLH0A0HYM2", "High-Yield Credit Spread", "Macro/rates", "rate", "fred"),
    ("WILL5000IND", "Wilshire 5000 (Equities)", "Macro/rates", "price", "fred"),
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


def _fetch(fid):
    dest = os.path.join(TMP, f"fred_{fid}.csv")
    for _ in range(4):
        r = subprocess.run(["curl", "-s", "--max-time", "20", "-o", dest, "-w", "%{http_code}",
                            "-A", "Mozilla/5.0 (Macintosh)", f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fid}"],
                           capture_output=True, text=True)
        if r.stdout.strip() == "200" and os.path.exists(dest) and os.path.getsize(dest) > 50 \
                and not open(dest, "rb").read(20).lstrip().startswith(b"<"):
            return dest
    return None


def load_fred(fid):
    p = _resolve(fid) or _fetch(fid)
    if not p:
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
    return s if len(s) >= 8 else None


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
    json.dump(out, open(dest, "w"), separators=(",", ":"))
    print(f"Wrote {dest}: {len(meta)} series, {out['commonQuarters']}q overlap, asof {out['asof']}.")
    if missing:
        print(f"Missing (FRED-blocked/uncached): {', '.join(missing)}")


if __name__ == "__main__":
    main()
