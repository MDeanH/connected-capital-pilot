"""
ModelConfig — versioned, transparent, analyst-editable configuration.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List


@dataclass
class ModelConfig:
    version: str = "v0.1-mvp-re"
    target_return_default: float = 0.20
    feature_weights: Dict[str, float] = field(default_factory=lambda: {
        "sponsor": 0.28,
        "market": 0.22,
        "structure": 0.18,
        "macro": 0.20,
        "qual": 0.12,
    })
    custom_rules: List[str] = field(default_factory=list)  # human-readable for now
    mc_params: Dict = field(default_factory=lambda: {
        "n_sims": 10000,
        "holding_years": 4,
        "autocorrelation": 0.70,   # NCREIF-style appraisal smoothing (de-smooth before MC)
        "base_reported_vol": 0.09, # fallback if no client history
        "rf": 0.04,                # risk-free for Kelly
    })
    last_updated: datetime = field(default_factory=datetime.now)
    last_updated_by_analyst: str = "analyst"

    def bump_version(self):
        self.version = f"v{int(self.version.split('-')[0][1:]) + 1}-mvp-re"
        self.last_updated = datetime.now()
