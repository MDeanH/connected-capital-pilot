"""
Sample data for MVP — realistic RE Dev / Value-Add opportunities and past deals.

Derived from the internal scoping document + your prior RE forecasting discussion.
Replace/extend with user's real document + CSVs.
"""

import pandas as pd
from datetime import datetime


def get_sample_past_deals() -> pd.DataFrame:
    data = [
        {"id": "past_001", "asset_class": "RE", "sub_type": "Value-Add", "entry_date": "2021-03", "hold_period": 3.2,
         "sponsor_exits": 5, "ltv": 0.62, "execution_risk": "Medium", "rate_environment": "low",
         "realized_irr": 0.19, "realized_moic": 1.85, "outcome_label": "hit_target", "notes": "Strong sponsor, good supply tailwinds"},
        {"id": "past_002", "asset_class": "RE", "sub_type": "Development", "entry_date": "2022-06", "hold_period": 2.8,
         "sponsor_exits": 1, "ltv": 0.78, "execution_risk": "High", "rate_environment": "elevated",
         "realized_irr": 0.08, "realized_moic": 1.12, "outcome_label": "missed", "notes": "Entitlement delays + rate spike"},
        {"id": "past_003", "asset_class": "RE", "sub_type": "Value-Add", "entry_date": "2020-11", "hold_period": 4.1,
         "sponsor_exits": 7, "ltv": 0.55, "execution_risk": "Low", "rate_environment": "low",
         "realized_irr": 0.27, "realized_moic": 2.15, "outcome_label": "hit_target", "notes": "Excellent execution"},
    ]
    return pd.DataFrame(data)


def get_sample_opportunities() -> pd.DataFrame:
    data = [
        {"id": "opp_dev_downtown", "name": "Downtown Core Dev", "sub_type": "Development",
         "sponsor_exits": 3, "ltv": 0.72, "execution_risk": "High", "rate_environment": "elevated",
         "projected_gross_irr": 0.24, "notes": "Strong location but heavy lift on entitlements"},
        {"id": "opp_va_suburban", "name": "Suburban Value-Add Portfolio", "sub_type": "Value-Add",
         "sponsor_exits": 6, "ltv": 0.58, "execution_risk": "Medium", "rate_environment": "elevated",
         "projected_gross_irr": 0.18, "notes": "Stabilized assets, light reno, good cash flow"},
        {"id": "opp_dev_mixed", "name": "Mixed-Use Infill Dev", "sub_type": "Development",
         "sponsor_exits": 2, "ltv": 0.68, "execution_risk": "Medium", "rate_environment": "elevated",
         "projected_gross_irr": 0.21, "notes": "Slightly better sponsor history than downtown"},
    ]
    return pd.DataFrame(data)
