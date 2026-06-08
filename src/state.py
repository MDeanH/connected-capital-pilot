"""
DiligenceState — core shared state for the AI diligence platform.

Inspired by SwarmState / health pipelines in your existing dashboards.
Holds past deals, current opportunities, model config, scores, freshness.
Recomputes on demand. Local-first, auditable.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional
import pandas as pd
import streamlit as st

from src.model.config import ModelConfig
from src.data.sample import get_sample_past_deals, get_sample_opportunities


@dataclass
class DiligenceState:
    past_deals: pd.DataFrame = field(default_factory=get_sample_past_deals)
    opportunities: pd.DataFrame = field(default_factory=get_sample_opportunities)
    ddq_responses: List[Dict] = field(default_factory=list)
    model_config: ModelConfig = field(default_factory=ModelConfig)
    scores: Dict[str, Dict] = field(default_factory=dict)  # opportunity_id -> ProbabilityResult dict
    correlations: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    last_refresh: datetime = field(default_factory=datetime.now)
    alerts: List[str] = field(default_factory=list)

    def refresh_public_context(self):
        """Stub for FRED + Zillow CSV refresh. In real version: call connectors."""
        from src.data.connectors import get_fred_macro_snapshot, load_zillow_research_csv
        self._public_context = {
            "fred": get_fred_macro_snapshot(),
            "zillow": load_zillow_research_csv(),
        }
        self.last_refresh = datetime.now()
        self.alerts = [a for a in self.alerts if "public" not in a.lower()]
        self.alerts.append("Public context refreshed (FRED + Zillow sample). Wire real loaders + API keys for production.")

    def recompute_all(self):
        """Re-score every opportunity using current model_config + features."""
        from src.model.scoring import compute_probability_result

        new_scores = {}
        for _, row in self.opportunities.iterrows():
            res = compute_probability_result(
                features=row.to_dict(),
                model_config=self.model_config,
                past_deals=self.past_deals
            )
            new_scores[row["id"]] = res
        self.scores = new_scores
        self.last_refresh = datetime.now()

    def get_filtered_opportunities(self, min_prob: float = 0.0, subtypes: Optional[List[str]] = None):
        if subtypes is None:
            subtypes = ["Development", "Value-Add"]

        df = self.opportunities.copy()
        if "p_hit_target" not in df.columns:
            # attach latest scores
            df["p_hit_target"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("p_hit_target", 0.5))
            df["expected_return"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("expected_return", 0.12))
            df["downside_p_loss"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("p_loss", 0.25))
            df["confidence"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("confidence", 0.6))
            df["top_driver"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("top_drivers", ["market"])[0] if self.scores.get(oid) else "market")
            df["recommended_size_pct"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("recommended_size_pct", 4.0))
            df["risk_note"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("risk_note", "See detail for MC scenarios."))
            # New grounded MC fields (de-biased)
            df["median_irr"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("median_irr", 0.12))
            df["var_5pct"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("var_5pct", -0.05))
            df["de_smoothed_sigma"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("de_smoothed_sigma", 0.09))
            df["mu_adj"] = df["id"].map(lambda oid: self.scores.get(oid, {}).get("mu_adj", 0.0))

        mask = (df["p_hit_target"] >= min_prob) & (df["sub_type"].isin(subtypes))
        return df.loc[mask]

    def get_all_opportunities(self):
        return self.get_filtered_opportunities(min_prob=0.0)

    def get_past_deals(self):
        return self.past_deals

    def get_avg_prob(self) -> float:
        probs = [v.get("p_hit_target", 0.5) for v in self.scores.values()]
        return sum(probs) / len(probs) if probs else 0.5

    def get_high_conf_count(self) -> int:
        return sum(1 for v in self.scores.values() if v.get("confidence", 0) >= 0.65)

    def ingest_user_csv(self, df: pd.DataFrame):
        """Simple ingest — normalize and append or replace opportunities/past."""
        # Very lightweight for MVP; real version has schema validation + provenance
        if "realized_irr" in df.columns or "outcome_label" in df.columns:
            self.past_deals = pd.concat([self.past_deals, df], ignore_index=True).drop_duplicates(subset=["id"], keep="last")
        else:
            # treat as opportunities
            self.opportunities = pd.concat([self.opportunities, df], ignore_index=True).drop_duplicates(subset=["id"], keep="last")
        self.recompute_all()

    def get_opportunity_by_id(self, oid: str):
        matches = self.opportunities[self.opportunities["id"] == oid]
        if matches.empty:
            return None
        row = matches.iloc[0].to_dict()
        row.update(self.scores.get(oid, {}))
        return row


@st.cache_resource
def get_state() -> DiligenceState:
    """Singleton cached across reruns (Streamlit session)."""
    s = DiligenceState()
    s.recompute_all()  # initial scores from samples
    return s
