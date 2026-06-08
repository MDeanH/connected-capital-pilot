"""
Public data connectors (FRED, Zillow CSV, Census, FHFA, NAREIT, etc.).

Fully wired to the 120+ source inventory (data/data_sources_inventory.md) via the comprehensive ingest framework (scripts/ingest_real_data.py --fetch-all-curated).

- Real pulled data lives in data/processed/<source>/ (latest_returns.csv, latest_fit.json, meta.json).
- Price levels (Zillow, FHFA, Case-Shiller, etc.) are converted via reference.prices_to_returns + fit(ppy=12 or 4).
- Macro series (FRED starts, rates, sales, inventory) for mu_adj drivers / scenarios / correlations.
- NCREIF-style (ppy=4 + geltner + bias) from public snapshots or your licensed extracts.
- See ingest script + inventory for exact URLs, how to extend to the full list, and model mapping (units guards, annualization, smoothing flags, n_obs for confidence, etc.).

Raw-preferring + auditable. The reference engine (mc_reference) owns conversion, validation, and fitting.
"""

from typing import Dict, Optional, Tuple, List, Any
import json
import importlib.util
import numpy as np
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROCESSED = DATA_DIR / "processed"

_ENGINE = None
def _engine():
    """Lazy-load the verified reference engine (src/model/mc_reference.py), cached."""
    global _ENGINE
    if _ENGINE is None:
        p = Path(__file__).resolve().parents[1] / "model" / "mc_reference.py"
        spec = importlib.util.spec_from_file_location("mc_reference_conn", p)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _ENGINE = m
    return _ENGINE

def _get_ref() -> Optional[Dict]:
    """Back-compat shim: engine functions as a dict (used by get_zillow_national_returns)."""
    try:
        e = _engine()
        return {"prices_to_returns": e.prices_to_returns, "fit_distribution": e.fit_distribution,
                "geltner_unsmooth": e.geltner_unsmooth}
    except Exception:
        return None

def _load_fred_series(name: str) -> Optional[pd.Series]:
    """Load a processed FRED series (data/processed/<name>/latest.csv) as a date-indexed Series."""
    p = PROCESSED / name / "latest.csv"
    if not p.exists():
        return None
    try:
        df = pd.read_csv(p)
        idx = pd.to_datetime(df.iloc[:, 0], errors="coerce")
        val = pd.to_numeric(df.iloc[:, 1], errors="coerce")
        s = pd.Series(val.values, index=idx).dropna().sort_index()
        return s if len(s) else None
    except Exception:
        return None

def _load_latest_json(name: str, fname: str = "meta.json") -> Dict:
    p = PROCESSED / name / fname
    if p.exists():
        return json.loads(p.read_text())
    return {}

def _load_series(name: str, fname: str = "latest_returns.csv") -> Optional[np.ndarray]:
    p = PROCESSED / name / fname
    if p.exists():
        try:
            df = pd.read_csv(p, parse_dates=[0] if "csv" in fname else None)
            if df.shape[1] >= 2:
                return pd.to_numeric(df.iloc[:, 1], errors="coerce").dropna().values
            return pd.to_numeric(df.iloc[:, 0], errors="coerce").dropna().values
        except:
            return None
    return None

def _load_fit(name: str) -> Optional[Dict]:
    p = PROCESSED / name / "latest_fit.json"
    if p.exists():
        return json.loads(p.read_text())
    return None


def get_fred_macro_snapshot() -> Dict:
    """Macro snapshot computed from REAL pulled FRED series in data/processed/ (refresh with
    `python scripts/ingest_real_data.py --sources fred_mortgage30us,fred_houst,fred_csushpinsa`).

    Each field carries an as-of date when it comes from real data; any series not yet pulled
    falls back to a labeled recent value. `_real_fields` lists which fields are live. This
    replaces the prior static stub (which never actually read the processed series because it
    looked for latest_returns.csv instead of the FRED latest.csv)."""
    fallback = {"30y_mortgage": 6.48, "housing_starts_sa": 1502, "case_shiller_yoy": 2.7}
    out: Dict[str, Any] = {}
    real: List[str] = []

    mort = _load_fred_series("fred_mortgage30us")
    if mort is not None:
        out["30y_mortgage"] = round(float(mort.iloc[-1]), 2)
        out["30y_mortgage_asof"] = str(mort.index[-1].date())
        real.append("30y_mortgage")
    else:
        out["30y_mortgage"] = fallback["30y_mortgage"]

    houst = _load_fred_series("fred_houst")
    if houst is not None:
        out["housing_starts_sa"] = round(float(houst.iloc[-1]), 0)
        out["housing_starts_asof"] = str(houst.index[-1].date())
        real.append("housing_starts_sa")
    else:
        out["housing_starts_sa"] = fallback["housing_starts_sa"]

    # Case-Shiller YoY % from the index level series (last vs 12 months prior).
    cs = _load_fred_series("fred_csushpinsa")
    if cs is not None and len(cs) >= 13:
        out["case_shiller_yoy"] = round((float(cs.iloc[-1]) / float(cs.iloc[-13]) - 1.0) * 100.0, 2)
        out["case_shiller_asof"] = str(cs.index[-1].date())
        real.append("case_shiller_yoy")
    else:
        out["case_shiller_yoy"] = fallback["case_shiller_yoy"]

    # Explicit, auditable rate-regime drift suggestion: mortgage rates above a ~6% neutral
    # band shave expected RE return (affordability drag). Advisory mu_adj for scoring.
    out["rate_regime_mu_adj"] = round(-0.01 * max(0.0, out["30y_mortgage"] - 6.0), 4)
    out["_real_fields"] = real
    out["note"] = (f"{len(real)}/3 fields from real pulled FRED data"
                   + (f" (as of {out.get('30y_mortgage_asof','?')})" if real else "")
                   + "; any others are labeled fallbacks. "
                     "Refresh: python scripts/ingest_real_data.py "
                     "--sources fred_mortgage30us,fred_houst,fred_csushpinsa")
    return out


def load_zillow_research_csv(path: Optional[str] = None) -> pd.DataFrame:
    """Load Zillow or fall back to processed national tidy."""
    if path:
        try:
            return pd.read_csv(path)
        except Exception as e:
            return pd.DataFrame({"error": [str(e)]})
    nat = PROCESSED / "zillow_national_zhvi" / "latest_prices.csv"
    if nat.exists():
        df = pd.read_csv(nat, parse_dates=[0])
        df["region"] = "United States"
        return df
    return pd.DataFrame({"region": ["National"], "zhvi": [368000]})


def get_zillow_national_zhvi_prices() -> pd.Series:
    """Pulled + processed national ZHVI levels (or processed latest)."""
    p = PROCESSED / "zillow_national_zhvi" / "latest_prices.csv"
    if p.exists():
        s = pd.read_csv(p, parse_dates=[0], index_col=0).iloc[:, 0]
        s.name = "zhvi_us_national"
        return s
    # fallback to the committed tidy
    nat = DATA_DIR / "zillow_us_national_zhvi_prices.csv"
    if nat.exists():
        return pd.read_csv(nat, parse_dates=[0], index_col=0).iloc[:, 0]
    idx = pd.date_range("2018-01-01", periods=24, freq="MS")
    return pd.Series(np.linspace(300000, 380000, 24), index=idx, name="zhvi_us_national_synth")


def get_zillow_national_returns() -> Tuple[np.ndarray, dict]:
    """Returns array + meta from processed (preferred) or on-the-fly conversion."""
    rets = _load_series("zillow_national_zhvi", "latest_returns.csv")
    meta = _load_latest_json("zillow_national_zhvi")
    if rets is not None:
        meta = meta or {"source": "Zillow US National (processed)", "n_returns": len(rets)}
        return rets, meta
    # on-the-fly from prices
    prices = get_zillow_national_zhvi_prices().values.astype(float)
    ref = _get_ref()
    if ref and "prices_to_returns" in ref:
        rets = ref["prices_to_returns"](prices)
    else:
        rets = np.diff(prices) / prices[:-1]
    meta = {"source": "Zillow Research ZHVI (United States national)", "n_returns": len(rets), "note": "Use with fit_distribution(ppy=12) + geltner for vol."}
    return rets, meta


def get_market_comps() -> List[Dict[str, Any]]:
    """Return list of real market comp fits/series from pulled sources (Zillow, FHFA if processed, etc.). Ready for n_obs, empirical mode, or base mu/sigma."""
    comps = []
    for name in ["zillow_national_zhvi", "fhfa_hpi_master"]:
        fit = _load_fit(name)
        meta = _load_latest_json(name)
        rets = _load_series(name)
        if fit or rets is not None:
            comps.append({"name": name, "fit": fit, "returns": rets, "meta": meta})
    return comps


def get_macro_drivers() -> Dict:
    """Real macro from processed FRED + inventory sources (or enhanced stub)."""
    return get_fred_macro_snapshot()


# ---------------------------------------------------------------------------
# Metro base-rate distributions: any of ~895 ZHVI / ~499 ZORI metros on demand.
# Source: data/catalog/raw/{ZHVI,ZORI}_metro.csv (built by fetch_data / the catalog
# step). Each metro is fit through the verified engine -> ready for score_opportunity.
# ---------------------------------------------------------------------------
_METRO_FILES = {
    "home_values": ("ZHVI_metro.csv", "Zillow ZHVI (home values)"),
    "rents":       ("ZORI_metro.csv", "Zillow ZORI (rents)"),
}


def _metro_path(kind: str) -> Optional[Path]:
    fname = _METRO_FILES.get(kind, _METRO_FILES["home_values"])[0]
    for cand in (DATA_DIR / "catalog" / "raw" / fname,
                 DATA_DIR / "zillow_zhvi_metro_raw.csv"):  # fallback (home values only)
        if cand.exists():
            return cand
    return None


def list_metros(kind: str = "home_values") -> List[str]:
    """All available metro names for a kind ('home_values' or 'rents'), largest first."""
    p = _metro_path(kind)
    if p is None:
        return []
    try:
        z = pd.read_csv(p)
        return z.sort_values("SizeRank")["RegionName"].astype(str).tolist()
    except Exception:
        return []


def get_metro_comp(metro_name: str, kind: str = "home_values", desmooth: bool = True) -> Optional[Dict]:
    """Base-rate distribution for ONE metro, fit through the engine and ready to score.

    Args:
        metro_name: e.g. "Phoenix, AZ" (exact or case-insensitive substring; "United States" = national).
        kind: "home_values" (ZHVI) or "rents" (ZORI).
        desmooth: if the index is appraisal/index-smoothed (it usually is -> lag-1 AC ~0.95),
            return the GELTNER DE-SMOOTHED fit as `fit` (the honest volatility for a risk tool).

    Returns {fit, fit_raw, fit_desmoothed, meta} or None if not found / too short. `fit` is
    a mc_reference fit dict (with log_returns) -> pass straight to score_opportunity(mode="empirical").
    Honest limit: this is a price/rent INDEX (appreciation only, no income/total return); use it as
    beta/base-rate context, then layer the deal's DDQ bias and the client's own realized IRRs on top.
    """
    p = _metro_path(kind)
    if p is None:
        return None
    z = pd.read_csv(p)
    date_cols = [c for c in z.columns if isinstance(c, str) and c[:4].isdigit() and "-" in c]
    key = str(metro_name).strip().lower()
    match = z[z["RegionName"].astype(str).str.lower() == key]
    if match.empty:
        match = z[z["RegionName"].astype(str).str.lower().str.contains(key, na=False)]
    if match.empty:
        return None
    row = match.sort_values("SizeRank").iloc[0]
    vals = pd.to_numeric(row[date_cols], errors="coerce").dropna().values.astype(float)
    if len(vals) < 24:
        return None

    e = _engine()
    rets = e.prices_to_returns(vals)
    fit_raw = e.fit_distribution(rets, periods_per_year=12)
    smoothing = bool(fit_raw["smoothing_flag"])
    fit_ds = e.fit_distribution(e.geltner_unsmooth(rets), periods_per_year=12) if smoothing else None
    chosen = fit_ds if (desmooth and fit_ds is not None) else fit_raw

    meta = {
        "metro": str(row["RegionName"]),
        "kind": _METRO_FILES.get(kind, _METRO_FILES["home_values"])[1],
        "n_obs": int(fit_raw["n_obs"]),
        "mu_ann": round(float(fit_raw["mu"]), 4),
        "sigma_ann_raw": round(float(fit_raw["sigma"]), 4),
        "sigma_ann_desmoothed": round(float(fit_ds["sigma"]), 4) if fit_ds is not None else round(float(fit_raw["sigma"]), 4),
        "lag1_autocorr": round(float(fit_raw["lag1_autocorr"]), 3),
        "smoothing_flag": smoothing,
        "fit_used": "de-smoothed" if (desmooth and fit_ds is not None) else "raw",
        "span": f"{date_cols[0][:7]}..{date_cols[-1][:7]}" if date_cols else None,
        "source": "Zillow Research (metro index)",
        "note": "Price/rent INDEX only (appreciation, no income/total return); smoothed -> "
                "de-smoothed sigma is the honest risk. Beta/base-rate context, not the moat.",
    }
    return {"fit": chosen, "fit_raw": fit_raw, "fit_desmoothed": fit_ds, "meta": meta}
