"""
Core scoring engine — transparent, distributional probability of target return.

MVP: Simple weighted features + illustrative Monte Carlo.
Real version: Learn expected return / vol from past_deals per asset class,
then run MC with explicit correlations (from state).

Outputs exactly what the scoping document requires.
"""

from typing import Dict, Any
import numpy as np
import pandas as pd

from src.model.config import ModelConfig


def compute_probability_result(
    features: Dict[str, Any],
    model_config: ModelConfig,
    past_deals: pd.DataFrame
) -> Dict[str, Any]:
    """
    Returns a dict matching ProbabilityResult shape in the plan.
    """
    weights = model_config.feature_weights
    target = model_config.target_return_default

    # Very lightweight "quant + qual" fusion for MVP
    # Normalize a few plausible inputs (these will come from DDQ + public data + user)
    sponsor_score = min(1.0, features.get("sponsor_exits", 2) / 8.0) * weights.get("sponsor", 0.28)
    market_score = (0.5 + 0.5 * (1.0 - min(1.0, features.get("ltv", 0.65)))) * weights.get("market", 0.22)  # lower leverage better in tight markets
    structure_score = (0.7 if features.get("execution_risk", "Medium") != "High" else 0.35) * weights.get("structure", 0.18)
    macro_score = (0.6 if features.get("rate_environment", "elevated") == "elevated" else 0.8) * weights.get("macro", 0.20)
    qual_score = (0.4 if features.get("execution_risk", "Medium") == "High" else 0.75) * weights.get("qual", 0.12)

    base = sponsor_score + market_score + structure_score + macro_score + qual_score

    # Crude calibration to a probability
    # Incorporate stub public macro context if present on features
    macro_adj = 0.0
    if "macro_30y" in features:
        macro_adj = -0.08 if features["macro_30y"] > 6.0 else 0.03

    p_hit = float(np.clip(base + macro_adj + np.random.normal(0, 0.025), 0.15, 0.92))  # noise for demo variety

    # Simple expected return (around target, adjusted by p)
    expected = target * (0.6 + 0.8 * p_hit) + np.random.normal(0, 0.015)

    # Downside (illustrative)
    p_loss = max(0.05, 0.38 - 0.45 * p_hit)
    expected_shortfall = 0.12 + (0.18 * (1 - p_hit))

    # Confidence heuristic (more past deals + sponsor track = higher)
    n_comps = len(past_deals) if not past_deals.empty else 8
    confidence = min(0.92, 0.45 + 0.04 * min(n_comps, 25) + 0.15 * (features.get("sponsor_exits", 2) / 6))

    # Top drivers (for explainability — critical transparency requirement)
    drivers = [
        ("Sponsor track record", round(sponsor_score, 3), "positive" if sponsor_score > 0.15 else "negative"),
        ("Market / supply-demand & leverage", round(market_score, 3), "positive" if market_score > 0.12 else "negative"),
        ("Execution / qual risk (DDQ)", round(qual_score, 3), "negative" if qual_score < 0.08 else "positive"),
    ]
    drivers = sorted(drivers, key=lambda x: -abs(x[1]))[:3]

    # Risk note + sizing (answers the core question)
    risk_note = f"To target {target:.0%}: illustrative P(loss) ~{p_loss:.0%}, expected shortfall ~{expected_shortfall:.1%}. Wide interval on limited comps."
    rec_size = round(max(1.5, min(12.0, (p_hit - 0.35) * 18 + 3.5)), 1)  # toy risk-budgeted

    return {
        "p_hit_target": round(p_hit, 3),
        "expected_return": round(expected, 3),
        "p_loss": round(p_loss, 3),
        "expected_shortfall": round(expected_shortfall, 3),
        "confidence": round(confidence, 2),
        "top_drivers": [d[0] for d in drivers],
        "recommended_size_pct": rec_size,
        "risk_note": risk_note,
        "model_version": model_config.version,
    }


def simple_monte_carlo(expected: float, vol: float, n_sims: int = 5000, target: float = 0.20) -> Dict:
    """Placeholder real MC. Replace with full feature-driven paths + correlation matrix."""
    sims = np.random.normal(expected, vol, n_sims)
    p_hit = (sims >= target).mean()
    downside = (sims < 0).mean()
    return {
        "p_hit": round(p_hit, 3),
        "p_loss": round(downside, 3),
        "median": round(np.median(sims), 3),
        "p5": round(np.percentile(sims, 5), 3),
        "p95": round(np.percentile(sims, 95), 3),
    }
