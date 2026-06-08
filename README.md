# AI Investment Due-Diligence & Probability Platform

Explainable, analyst-augmented tool that scores the probability an alternative investment opportunity achieves a target return (e.g. ~20% net IRR or configurable) and quantifies the risk of falling short. Answers "how much risk to earn the 20%?" and recommends the right position size.

**Phase 1 (MVP)**: Real Estate — Development + Value-Add.  
Later phases: VC, private lending, RE hedge funds, sports.

## Core Outputs (per opportunity)
- % likelihood (P(hit target return))
- Expected / median return (distributional)
- Downside risk (P(loss), size of loss)
- Confidence (backed by comps/history)
- Top driving factors (explainable)
- Recommended allocation ("right amount to invest" — risk-budgeted)

## Key Differentiators
- **Transparent** (glass-box drivers, not black box)
- **Edge from proprietary data**: Your historical outcomes + analyst-curated qualitative judgment (via structured DDQ), not a secret algorithm
- Analyst keeps the model current ("qualitize and quantize")
- Public data (FRED, Zillow Research, Census) as auditable context/ base rates — model computes its own forecasts/metrics (see prior Data_Source_Comparison philosophy)
- Local-first preferred

## Honest Limits (baked into UI)
- Small samples / high variance (especially non-RE)
- Survivorship and self-reporting bias in third-party data
- Conditional forecasts only — no macro shock timing
- Wide confidence intervals on thin history
- Not financial advice

## Quick Start (Local - Streamlit)
```bash
cd /Users/friday/Projects/ai-diligence-tool
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open http://localhost:8501

## Hosting on Netlify (recommended for production)

This repo now includes a full **React + TypeScript + Plotly** frontend that replicates the Streamlit experience, plus Netlify Functions for the Grok copilot.

See [README-NETLIFY.md](./README-NETLIFY.md) for setup and deployment instructions.

### Deploy steps (one-time)
1. Connect the GitHub repo to a new Netlify site (or use the included `scripts/deploy-netlify.sh` after `netlify-cli login`).
2. Set the `XAI_API_KEY` environment variable in Netlify (Site settings → Environment variables) so the Diligence Copilot works.
3. The included `netlify.toml` handles build + functions + SPA redirects.

The Netlify version is client-side for scoring/UI (very fast) and uses serverless functions only for the AI copilot. The original Python Streamlit version remains available for local use.

## Quick Start (Local - Streamlit)
```bash
cd /Users/friday/Projects/ai-diligence-tool
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open http://localhost:8501

## Current Status (MVP in progress)
See plan.md in the session for full roadmap. This is Streamlit-first to match your proven operator dashboards (Edge, ServeBot, etc.).

Provide your scoping document or historical deals CSV for richer samples and real backtesting.

## Data Sources (Public / Local Preferred)
- FRED (rates, housing starts, HPI, etc.)
- Zillow Research CSVs (ZHVI + ZHVF forecasts, inventory, etc.)
- Census ACS (demographics)
- Your DDQs + past investment outcomes (the real moat)

Optional (when justified): RentCast or institutional feeds (Preqin, etc.).

## Project Layout
See plan.md for detailed structure and phases.

## Run with Sample Data
The app seeds realistic RE Dev/Value-Add examples derived from the internal scoping document. Upload your own CSVs or PDFs to extend.

## Next
- Full DDQ form + extraction for RE
- Analyst model studio (weights, rules, versioning)
- AI Copilot with tools (explain, scenario, filter)
- Stronger Monte Carlo + correlations
- Your real data ingest

Questions or data to share? Provide the document(s) and we'll wire them in immediately.
