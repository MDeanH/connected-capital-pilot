# Data in this directory

Committed small files (tracked):
- `zillow_us_national_zhvi_prices.csv` — US national Zillow Home Value Index (ZHVI) monthly price *levels* (tidy, ~2000-01 to 2026-04, ~316 obs). 
  Source: public Zillow Research download (Metro file, "United States" row), processed to national series only.

Large / raw downloads (gitignored):
- `zillow_zhvi_metro_raw.csv` — full ~895 regions Metro ZHVI (4+ MB). Reproducible via `python scripts/pull_data.py`.

How to use with the engine (see `mc_reference` and `src/data/connectors.py`):
1. `prices = pd.read_csv("data/zillow_us_national_zhvi_prices.csv", ...).zhvi.values`
2. `returns = prices_to_returns(prices)`   # the reference guard + exact conversion
3. `fit = fit_distribution(returns, periods_per_year=12, ...)`  # correct annualization
4. (optional) `unsm = geltner_unsmooth(returns); fit = fit_distribution(unsm, periods_per_year=12)`
5. `score_opportunity(fit, bias_sigma_mult=1.05, ...)`  # explicit bias for any remaining index smoothing

Notes / honest limits (baked into the model):
- ZHVI is a *smoothed, model-based* price index (very high lag-1 autocorrelation ~0.98). Raw fitted sigma is unrealistically low (~1.8% ann). Geltner or your judgment + bias_sigma_mult is required.
- This series is *price appreciation only* (no net rental yield / income component). NCREIF-style total returns for core property include income + capex + appreciation (and are appraisal-smoothed). Use your own historical realized IRRs (client past deals) as the primary input for alpha/edge; public indices are base-rate / beta context.
- Long history (n_obs ~315) → high confidence score and tight parameter CIs (exactly as the post-review engine intends). Thin client history will dominate uncertainty in a real opportunity score.
- See the reference module docstring and `reference/grok-montecarlo-review-findings.md` for units rules, bias args, etc.

Re-pull the full curated set (Zillow, FHFA, FRED macro/indices, NCREIF snapshots, etc. — framework for the entire 120+ inventory):
    python scripts/ingest_real_data.py --fetch-all-curated
    python scripts/ingest_real_data.py --sources zillow_national_zhvi,fhfa_hpi_master,fred_csushpinsa --score

See data_sources_inventory.md for the complete list with URLs, model mapping (ppy, geltner, bias, n_obs, etc.), and how each feeds the verified MC engine.

For commercial real estate total returns (NCREIF NPI / ODCE): obtain the licensed quarterly series (or use recent public press-release snapshots for short demo), pass `periods_per_year=4`, apply geltner_unsmooth + negative bias_mu for appraisal + survivorship effects.

Other series (optional future):
- Case-Shiller / FHFA repeat-sales (transaction-based house prices)
- FRED macro (rates, starts, etc.) via fredapi or direct /data/*.txt
- Your DDQ-extracted or client CSV of realized IRRs (the real moat)
