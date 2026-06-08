"""
Public data connectors (FRED, Zillow CSV, Census).

MVP: Stubs + realistic hardcoded values so the app runs immediately.
Real version: Wire fredapi, CSV loaders from Zillow Research downloads (as discussed in prior forecasting session and Data_Source_Comparison.docx), etc.

Keep everything auditable and raw-preferring.
"""

from typing import Dict
import pandas as pd


def get_fred_macro_snapshot() -> Dict:
    """Stub. In production use fredapi.Fred with user key."""
    return {
        "30y_mortgage": 6.48,      # recent FRED MORTGAGE30US
        "housing_starts_sa": 1502, # k (example)
        "case_shiller_yoy": 2.7,
        "note": "Stub data — replace with live FRED series for production"
    }


def load_zillow_research_csv(path: str = None) -> pd.DataFrame:
    """
    Expect user to download from https://www.zillow.com/research/data/
    (ZHVI, ZHVF, inventory, etc.). Pass the CSV path.
    """
    if path:
        try:
            return pd.read_csv(path)
        except Exception as e:
            return pd.DataFrame({"error": [str(e)]})
    # Sample synthetic for MVP
    return pd.DataFrame({
        "region": ["National", "Metro-Example"],
        "zhvi_mid": [420000, 385000],
        "zhvf_1yr_growth": [0.021, 0.015],  # from ZHVF
        "inventory_months": [4.4, 3.8],
    })
