# Hosting on Netlify

This version of the AI Diligence Platform is built as a **static React + TypeScript frontend** + **Netlify Functions** (for the scoring API).

It replicates the core experience of the original Streamlit app:
- Live editable model weights
- Probability scoring + risk notes
- Tables, filters, detail views
- Plotly charts (histograms + heatmaps)
- DDQ form that adds opportunities

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Netlify

1. Connect this repo (or the GitHub `ai-diligence-platform`) to a new Netlify site.
2. Build settings (or use the included `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. (Optional) Use the included deploy script after `netlify-cli login`:

```bash
./scripts/deploy-netlify.sh
```

The script handles build + production deploy.

## Differences from the Streamlit version

- Fully client-side for scoring, data, and UI (fast, no server needed for core features).
- Same dark theme and interaction model.
- Easy to extend with more Netlify Functions (e.g. real data ingestion, PDF processing via other services, etc.).

## Original Streamlit version

The Python/Streamlit code is still available in the repo for local use or deployment to Streamlit Community Cloud / other Python platforms:

```bash
cd /path/to/project
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

The React + Netlify version is the one designed for free static hosting + serverless on Netlify.
