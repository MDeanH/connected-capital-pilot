"""
DDQ extraction & quantization helpers.

MVP: Structured form already in app.py. This module provides a stub for PDF/text → structured fields + qualitative flags.

In real version:
- pdfplumber or pymupdf for text
- LLM call (local Ollama preferred) with strict JSON schema for RE Dev/Value-Add fields
- Confidence per field + risk flags
- Merge into feature vector for scoring
"""

from typing import Dict, Any


def extract_ddq_from_text(text: str, asset_subtype: str = "Value-Add") -> Dict[str, Any]:
    """
    Stub extractor. Replace with real pdfplumber + LLM structured output.
    Returns fields the scoring engine can consume.
    """
    # Naive heuristics for demo (illustrates "qualitize")
    lowered = text.lower()
    sponsor_strength = "Strong" if "sponsor" in lowered and ("track" in lowered or "exit" in lowered) else "Moderate"
    exec_risk = "High" if any(k in lowered for k in ["delay", "entitle", "litigation", "community opposition"]) else "Medium"

    return {
        "sponsor_domain": sponsor_strength,
        "execution_risk": exec_risk,
        "extracted_notes": text[:280] + "..." if len(text) > 280 else text,
        "extraction_confidence": 0.55,  # low because stub
        "source": "stub_extractor",
    }


def quantize_qualitative(extracted: Dict[str, Any]) -> Dict[str, float]:
    """Turn qualitative flags into numeric adjustments the model can use."""
    risk = extracted.get("execution_risk", "Medium")
    mult = 0.65 if risk == "High" else (0.95 if risk == "Low" else 0.82)
    return {
        "qual_risk_adjustment": mult,
        "sponsor_flag": 0.9 if extracted.get("sponsor_domain") == "Strong" else 0.6,
    }
