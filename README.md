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

The Netlify version is client-side for scoring/UI (very fast) and uses serverless functions only for the AI copilot.

## Current Status (MVP in progress)
- Core engine: exact de-smoothed NCREIF-style Monte Carlo (the grounded PoC you supplied) — desmooth_variance on your past realized IRRs, lognormal compounding, full P(≥20%), median, VaR_5%, CVaR_5%, fractional Kelly position size.
- Live analyst weights directly drive mu_adj into the MC (transparent).
- Both Streamlit (local) and React/Netlify (hosted) now use the real distributional engine.
- DDQ + copilot context include the MC outputs.

See the grounded reference block for the exact formulas. This is Streamlit-first + React parity to match your proven operator dashboards (Edge, ServeBot, etc.).

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

## 3D Market Environment
The **🌐 3D Market** tab renders a navigable three.js environment built entirely from the repo's real datasets: a phyllotaxis "city" of the 150 largest metros (tower height = annualized ZHVI home-value growth, color = de-smoothed risk, distance from center = market-size rank), a ring of 17 macro indicators (green/red by YoY direction), and three time-series ridges — national ZHVI (2000+), 30-yr mortgage rate (1971+), and housing starts (1959+). Hover anything for the underlying diligence stats. Regenerate the scene data after refreshing sources with `python3 scripts/build_market3d_data.py`.

## Next / Done
- **Real data ingest for 100+ sources**: `scripts/ingest_real_data.py --fetch-all-curated` (Zillow, FHFA, FRED, NCREIF snapshots, REITs, Census, etc.). See `data/data_sources_inventory.md` (full categorized list with direct URLs + exact MC mapping: prices_to_returns, ppy, geltner, bias_mu/sigma, n_obs for confidence, etc.).
- Connectors + scoring now load real pulled market comps / macro (boosts n_obs, applies source-appropriate bias, macro mu_adj).
- Full verified reference engine (post 41-defect adversarial review) is the core.
- Your real client deals CSV + DDQ remain the moat/alpha; public indices are base rates + context.

Questions or data to share? Provide the document(s) and we'll wire them in immediately.
