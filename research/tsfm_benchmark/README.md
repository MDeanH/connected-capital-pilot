# TSFM return-forecasting benchmark (paper replication)

Replicates the core protocol of Noguer i Alonso & Franklin (2026),
*"Pretrained Time-Series Foundation Models for Financial Return Forecasting"*
(arXiv:2606.27100): zero-shot **TimesFM-2.5** and **Chronos-2** vs. AR(1) /
seasonal-naive / random-walk baselines on daily returns of AAPL, AMZN, GOOG,
JPM, META — rolling-origin evaluation (L=512, H=20, 10 windows), MAE / skill /
rMAE, and one-sided Diebold–Mariano tests with the HLN correction.

## Files
- **`FINDINGS.md` — start here**: results, interpretation, and what this means
  for the diligence platform.
- `tsfm_return_benchmark.ipynb` — the full pipeline with executed outputs.
- `benchmark_lib.py` — protocol, baselines, TSFM wrappers, metrics, DM test.
- `data/prices_adjclose.csv` — committed price cache (Yahoo Finance adjusted
  closes, 2014-09-15 → 2026-02-13) so the run is deterministic and offline.
- `requirements.txt` — benchmark-only dependencies (torch/timesfm/chronos are
  **not** needed by the app; keep this env separate).

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
jupyter nbconvert --to notebook --execute --inplace tsfm_return_benchmark.ipynb
```
First execution downloads ~1.3 GB of model weights from Hugging Face; the whole
run takes a few minutes on CPU.

## Why it lives in this repo
The final notebook section maps the paper's findings onto the diligence
platform: the same zero-shot TSFMs that barely beat "predict zero" on daily
equities are strong candidates for a *conditional* market-path prior on the
platform's housing-index series (ZHVI lag-1 autocorr ≈ 0.98 — far more
predictable than equities), and this rolling-origin + DM harness is the
acceptance test any such overlay must pass before it touches `mu_adj`.
