# Research annex — expanded research for the Connected Capital real-estate app

**Date:** 2026-07-17 · Produced by a 28-agent research workflow (6 researchers, 22
adversarial verifiers; 0 errors). Every key claim below was independently
attack-verified; verdicts are inline. Companion to `HOUSING-ACCEPTANCE-TEST.md`.

## Synthesis — what the research adds to the test result

1. **The engine is exactly the null we tested.** The deployed fit is an
   unconditional stationary mu/sigma on the full return history, conditioned on
   nothing [CONFIRMED]. A horizon-conditional prior plugs in as one additive term
   at `compute.ts:53` and is parity-safe by construction [CONFIRMED]. The Python
   path already contains a (never-deployed) precedent: `rate_regime_mu_adj`.
2. **The evidence repo does NOT cover this domain — and says so.** No
   housing-index family exists; its protocol explicitly rules smoothed/illiquid
   series noncomparable with executable public-market returns [CONFIRMED]. Its
   `method-tsfm` verdict ("Reject zero-shot TSFMs as a default financial return
   forecaster", conf. C) is about executable *alpha* on public markets
   [CONFIRMED] — our result is a *base-rate prior* on the platform's own index
   series, a different claim that the repo's rules deliberately do not
   adjudicate. Do not cite the families JSON as supporting the overlay; cite
   this test.
3. **The literature independently predicts our result.** Case & Shiller (1989):
   25-50% annual follow-through [CONFIRMED]. Guren (JPE 2018): 2-3y momentum
   robust across index methodologies. Glaeser & Nathanson: 5-year mean
   reversion (-0.24 to -0.57) [CONFIRMED] — which is why the overlay must decay
   to (or past) the unconditional mu at long horizons.
4. **The deal-level haircut is quantified.** Individual-home forecasting R^2
   never exceeded 0.04 in Case & Shiller's data; Giacoletti: idiosyncratic risk
   is up to ~60% of capital-gains volatility of resales at 1-year holds
   [CONFIRMED]. Index skill of 0.2-0.56 therefore shrinks dramatically at deal
   level — the tilt must stay capped like the yield edge.
5. **Precedent exists and is sobering in the right way.** HouseTS
   (arXiv:2506.00765) benchmarked TimesFM/Chronos-2 on monthly ZIP-level ZHVI:
   competitive, but lightweight fitted DLinear beat zero-shot TSFMs in most
   configs [CONFIRMED]. So before production: also test a fitted lightweight
   conditional model against the TSFMs under this same harness.
6. **Cursor's benchmark lib is sound for its published use, with three
   confirmed reuse traps** (table below) — all three were checked against our
   housing run and none affected it (window spacing 13.7 > H=12; 0/130
   all-positive contexts; equal-length forecast/actual lists).

## Adversarial review of `benchmark_lib.py` — verdicts

| Verdict | Sev | Line | Finding (condensed) |
|---|---|---|---|
| **REFUTED** | critical | 261 | summarize_task hardwires the zero-return random walk as the skill and DM benchmark (rw_abs = \|actual\|), silently ignoring whatever the model named 'RandomWalk' actually forecasts — on drifting monthly housing returns '… |
| **CONFIRMED** | major | 98 | rolling_origins places 10 evenly spaced origins with no guard that spacing >= horizon, so a short evaluation segment silently yields overlapping windows whose duplicated months break the pooled DM test (simulated null re… |
| **CONFIRMED** | major | 237 | Pooling 10 disjoint windows' multi-horizon errors into one d vector and treating it as a contiguous series makes the DM test only approximately valid: autocovariances at lags 1..h-1 are computed across window seams (mean… |
| **CONFIRMED** | major | 168 | TimesFMForecaster leaves ForecastConfig.infer_is_positive at its default True, so any series whose entire context is non-negative has ALL forecast quantiles (including the median used as the point forecast) clamped at ze… |
| **REFUTED** | minor | 146 | forecast_ar1's OLS fit has the standard near-unit-root small-sample downward bias which compounds over the iterated 12-step horizon, materially handicapping the AR(1) baseline on persistent monthly housing returns, and t… |
| **REFUTED** | minor | 263 | summarize_task hard-requires a model literally named 'SeasonalNaive' (KeyError otherwise) and special-cases only the exact name 'RandomWalk'; renaming baselines for the monthly protocol (e.g. 'SeasonalNaive-12', 'RW-drif… |
| **CONFIRMED** | minor | 268 | zip(fc_windows, actuals_by_window) silently truncates when a model's forecast list is longer than the actuals list, producing valid-looking but stale results instead of an error. |

Refutations in short: the 'critical' zero-RW-benchmark finding is the function's
documented contract (and our housing script computes DM against explicit
benchmark error vectors, never via `summarize_task`); the AR(1) small-sample
bias is real but demonstrably does not flip any conclusion on the actual data;
the naming constraint fails loudly, not silently.

## Claim audit (adversarial verification of the 15 key research claims)

| Verdict | Unit | Claim (condensed) |
|---|---|---|
| **CONFIRMED** | engine | The return distribution is an unconditional stationary fit: fitDistribution takes the arithmetic mean/sd of the full historical per-period simple-return series (sigma with ddof=1 + c4 de-bias), annual… |
| **CONFIRMED** | engine | A horizon-dependent conditional market prior would plug in as an additional additive term at compute.ts line 53 (`biasMu: ddq.biasMu + yieldEdgeMu`, with `holding` already in scope), expressed as an A… |
| **CONFIRMED** | engine | parity.ts runs 16 assertions of the TS engine against a frozen Python golden snapshot (lib/golden.json): 5 deterministic (tolerances 1e-6 to 0.0015), 6 Monte Carlo (tolerances 0.01–0.04, ±6 on confide… |
| **CONFIRMED** | evidence | The repo contains no direct housing-index (ZHVI/Case-Shiller) predictability family; the closest citable verdicts are reit-returns ("Not established", confidence B, key_caveat: "Net return predictabil… |
| **CONFIRMED** | evidence | Index-smoothing serial correlation is citable only as a measurement fact, not predictability support: ILLIQ-COUTS-GONCALVES-ROSSI-2024-UNSMOOTH (stage EXT, tag ++, predictive_assessment not-applicable… |
| **CONFIRMED** | evidence | Zero-shot time-series foundation models carry the verdict "Not established" (family method-tsfm, confidence C, key_caveat verbatim: "Reject zero-shot TSFMs as a default financial return forecaster."),… |
| **CONFIRMED** | data | The processed store holds 8 usable series (6 FRED single-column CSVs, 2 price+returns engine fits) all baked 2026-06-08; all are monthly levels except fred_mortgage30us which is weekly (2,880 obs, 197… |
| **CONFIRMED** | data | distribution_catalog.csv already catalogs fitted return-distribution parameters (mu_ann, sigma_ann_raw, lag1_autocorr, sigma_ann_desmoothed) for 1,394 metro series: 895 Zillow ZHVI (2000-01 to 2026-04… |
| **CONFIRMED** | data | zillow_zhvi_metro_raw.csv is wide format (896 rows x 321 cols): 5 id columns (RegionID, SizeRank, RegionName, RegionType, StateName) then 316 month-end date columns 2000-01-31 to 2026-04-30; the verif… |
| **REFUTED** | tsfm-web | arXiv:2606.27100 ('Pretrained Time-Series Foundation Models for Financial Return Forecasting', Noguer i Alonso & Franklin) exists and matches the described protocol (AAPL/AMZN/GOOG/JPM/META, L=512, H=… |
| **CONFIRMED** | tsfm-web | Chronos-2 is a 120M encoder-only model released October 2025 with a zero-shot quantile API (quantile_levels list), 8192-step max context and 1024-step max prediction length, and monthly data (M4 Month… |
| **CONFIRMED** | tsfm-web | HouseTS (arXiv:2506.00765) is published work applying pretrained TSFMs (TimesFM and Chronos-2, zero-shot and fine-tuned) to monthly ZIP-level ZHVI forecasting at 3/6/12-month horizons, finding them co… |
| **CONFIRMED** | housing-lit | Case & Shiller (1989) found metro house-price index changes are followed the next year by same-direction changes one-quarter to one-half as large, while noise in individual home prices caps forecastin… |
| **CONFIRMED** | housing-lit | Glaeser & Nathanson document momentum at one-year horizons and mean reversion at five-year horizons, with the correlation of five-year price changes on lagged five-year changes ranging from -0.24 in t… |
| **CONFIRMED** | housing-lit | Giacoletti shows idiosyncratic risk makes up to 60% of the capital-gains volatility of home resales after a one-year holding period (under 20% after five years), so index-level predictability does not… |

The single REFUTED research claim is a citation nuance: arXiv:2606.27100 *does*
include AR(1)/EWMA baselines in its appendix (Tables 8-9), though the main-text
benchmark set is random walk + seasonal naive only.

---

# Full agent reports (verbatim)


---

## Annex A — Engine internals

# Monte Carlo engine — research findings

## 1. mu/sigma estimation: unconditional stationary fit
`fitDistribution` (netlify/functions/lib/engine.ts:97-105; mirror src/model/mc_reference.py:163-215) fits the arithmetic per-period mean and sd of the FULL historical simple-return series — conditioned on nothing (no horizon, regime, or macro state). Sigma uses ddof=1 + c4 small-sample de-bias (engine.ts:53-56,100). Annualization: mu geometric `(1+muP)^ppy − 1` (engine.ts:101), sigma `s·√ppy` (engine.ts:102). The deployed TS path is purely **empirical**: IID bootstrap of the per-period log-return pool, compounded over `holding×ppy` periods, annualized as bullet CAGR (`simulateIrrs`, engine.ts:122-132). The Python reference also has a `lognormal` parametric mode (arithmetic→log moment conversion, mc_reference.py:306-313) and block bootstrap (mc_reference.py:339-353); the TS port has neither (block=1 equivalent).

## 2. Bias/haircut knobs + where a horizon-conditional mu prior plugs in
Knobs: `bias_mu` (annual arithmetic haircut; DDQ cap ±0.10, ddq.ts:11,83; Python feature-map clamp [−0.10,+0.03], scoring.py:258); `bias_sigma_mult`/`sigmaMult` (DDQ product clamp [0.6,2.5], ddq.ts:12); Geltner de-smoothing with autocorr cap 0.6 (engine.ts:86-88; mc_reference.py:141); idiosyncratic sigma in quadrature (compute.ts:43-44, clamp [0,0.6] default 0.18); yield-edge mu ±0.30%/yr (compute.ts:50-51); sigma floor 1e-4 → ABSTAIN (engine.ts:13,153); Kelly book-corr shrink, fraction 0.5, cap 0.25 (engine.ts:150-161); confidence from n_obs + bootstrap-CI width, never n_sims (engine.ts:163-172). Python-only: `rate_regime_mu_adj = −0.01·max(0, mortgage−6.0)` (connectors.py:124) and mu_adj clamp [−0.12,+0.07] (scoring.py:215) — NOT in the deployed TS path.

**Plug-in point**: compute.ts:53 — `biasMu: ddq.biasMu + yieldEdgeMu`; `holding` is already in scope (clamped 1-30, compute.ts:31), so a horizon prior is `+ muAdjByHorizon(bl, holding)`. It flows into `adjustEmpiricalPool` (engine.ts:108-119), which shifts the pool so the ANNUALIZED ARITHMETIC return moves by exactly the bias, shape-preserving, identity at (0,1).

**Invariants**: (a) units — annual arithmetic decimal; pool is per-period LOG returns; simple returns must stay in (−1,∞) (mc_reference.py:42-54; clip −0.999 engine.ts:117). (b) parity suite gates the build (`"build": "npm run parity && tsc -b && vite build"`, package.json); parity replicates the golden scenario with `biasMu = ddq.biasMu` only (parity.ts:33-34), so an additive term in compute.ts is parity-safe, but any change inside fitDistribution/geltnerUnsmooth/adjustEmpiricalPool/applyDdq is checked at 1e-6..0.0015 tolerance. (c) both honest and naive runs share `common.biasMu` (compute.ts:53-55); zero adjustment must reproduce today's scores.

## 3. parity.ts: 16 assertions, TS vs frozen Python golden (lib/golden.json)
- 5 deterministic: fit.mu ±0.0015, fit.sigma ±0.0015, nObs exact, ddq.bias_mu ±1e-6, eff sigma_mult ±0.01 (parity.ts:26-31).
- 6 Monte Carlo (40k sims/400 boot, seed 7): P(target) ±0.03, Expected ±0.02, P(loss) ±0.04, VaR ±0.03, Position ±0.01, Confidence ±6 (parity.ts:36-42).
- 5 structural regressions: neg-edge→0%, constant-series→ABSTAIN, Kelly edge≤0→0, VaR positive on risky deal, DDQ bias moves the distribution (parity.ts:44-64). Exit 1 on any failure (parity.ts:67). It is TS vs a frozen snapshot of the numpy reference — statistically equivalent, not bit-identical (different RNGs, engine.ts:10).

## 4. Market data → deal score (deployed)
`POST /api/score` (netlify/functions/score.ts) → `computeScore` (compute.ts:25). Baselines = **metros.json** (~895+ Zillow ZHVI metro/county/city quarterly histories, `{label, ppy:4, returns[], qInc}`) merged with **baselines.json** (named national baselines; `re_value_add` = Case-Shiller U.S. HPI + 4% income, ppy 4, 155 obs) at compute.ts:12-15; default "Miami, FL". Bakes: `scripts/add_zillow_cities.py`/`add_zillow_counties.py` (quarter-end pct change + income proxy, ≥40 returns), then `scripts/apply_income_proxy.py` rewrites the flat +1%/q income to market-level carry `qInc = clamp(0.60·grossYield, 2%, 8%)/4` in place. **market-edge.json** baked by `scripts/build_market_edge.py` from public/market-context.json + metros.json (within-state gross-yield percentile) → `yieldEdgeMu = ((pct−50)/50)·0.003` at compute.ts:50-51. `MACRO` (mortgage 6.48, CS YoY 0.67, asof 2026-03-31) is a hardcoded display constant (compute.ts:9); live FRED connectors (src/data/connectors.py) feed only the Python path, not the deployed function.

---

## Annex B — Evidence-repo verdicts + wiki status

# Citable verdicts — market-predictability evidence repo (cutoff 2026-07-14, v1.1)

Files read (all under `/Users/friday/Projects/ai-diligence-tool/.claude/worktrees/heuristic-kilby-b9c42b/reference/market-predictability-evidence/`): `financial-market-predictability-protocol.md`, `financial-market-predictability-families.json` (49 families, read fully), `financial-market-predictability-evidence.csv` (198 scoped claims + header).

## 1. Real-estate / housing-index-relevant families

**Important negative finding first:** the repo has **no family for direct residential housing indices** (no ZHVI, Case–Shiller, or house-price-index family). Real estate enters only as (a) "listed real estate" under equities and (b) boundary evidence: "private equity, private real estate, hedge funds, and other illiquid assets… reported separately because appraisal/NAV smoothing and sparse transactions make their apparent predictability noncomparable with executable public-market returns" (protocol, Prespecified scope). Any ZHVI-momentum claim for the pilot must be built on the smoothing/serial-correlation evidence below, not on a direct housing verdict.

### `reit-returns` — Listed REIT return predictability
- verdict: **"Not established"**, confidence: **"B"**, scores p=2 e=1 r=2 i=2 t=1 b=2
- summary (verbatim): "Gross REIT persistence exists historically, but OOS and cost-adjusted tests are mostly null or fragile. Dynamic model averaging finds only pockets of value."
- key_caveat (verbatim): "Net return predictability not established for listed REITs."
- Supporting CSV rows: REIT-NELLING-GYOURKO-1998-MOM (IS, `-`): "Monthly returns are statistically predictable, but the magnitude does not cover typical transaction costs"; REIT-LING-NARANJO-RYNGAERT-2000-OOS (POOS, `-`): "OOS predictability is far below in-sample fit, is effectively absent in the 1990s, and modest gross active returns largely disappear after transaction costs"; REIT-AKINSOMI-ETAL-2016-DMA (POOS, `+?`); REIT-GUIDOLIN-PEDIO-PETROVA-2023-OOS (POOS, `H`): "Markov-switching models deliver pockets of OOS accuracy and utility, strongest for smoothed private real estate… the stronger private-market result is mechanically aided by appraisal persistence and is not comparable with executable REIT returns."

### `reit-vol` — REIT volatility forecasting
- verdict: **"Promising"**, confidence: **"C"**, scores p=2 e=2 r=2 i=3 t=2 b=2
- summary (verbatim): "High-frequency realized moments and global conditions improve REIT volatility forecasts."
- key_caveat (verbatim): "Risk forecasting supported; not return alpha."
- CSV: REIT-BONATO-CEPNI-GUPTA-PIERDZIOCH-2022-RV (POOS, `++`, positive); REIT-SALISU-GUPTA-BOURI-2023-GECON (POOS, `+?`). Negative_evidence: "Overlapping-author lines and no prospective risk-decision test."

### `private-persistence` — Private equity reported-performance persistence (carries the appraisal/index-smoothing evidence)
- verdict: **"Not established"**, confidence: **"B"**, scores p=2 e=1 r=3 i=0 t=2 b=2
- summary (verbatim): "…Appraisal/NAV smoothing makes reported returns noncomparable to public markets."
- Effect sizes (CSV, ILLIQ-COUTS-GONCALVES-ROSSI-2024-UNSMOOTH, stage EXT, tag `++`, protocol_confidence B, predictive_assessment **not-applicable**): "Common spurious autocorrelation survives traditional unsmoothing; the generalized method raises private-CRE public-market beta from 0.07 to 0.34 and lowers annual alpha from 4.3% observed to 1.6%." ILLIQ-GELTNER-1991-APPRAISAL (IS, `+?`, not-applicable): "Appraisal smoothing mechanically lowers measured second moments and induces persistence; appraisal returns require unsmoothing before risk inference." Per protocol, `++` on `predictive_assessment: not-applicable` rows "marks a strong descriptive or measurement finding, not positive forecast evidence — such rows must not be counted as predictability support." So smoothing-induced serial correlation is citable as a *measurement* fact, not as a predictability edge.

### Momentum families (not real-estate-scoped, quote scope if cited)
- `eq-momentum-xs` (cross-sectional equity momentum): verdict **"Supported pre-live"**, confidence "B" (p=3 e=3 r=4 i=3 t=3 b=3); key_caveat: "Production candidate only with explicit crash controls, borrow, and turnover governance." Scope: "US and international equities" — not housing.
- `eq-ts-trend` (liquid-futures time-series trend): verdict **"Supported pre-live"**, confidence "B"; negative_evidence notes Huang-Li-Wang-Zhou (2020) "argue TSMOM per se is not statistically distinct from a simple mean effect once pooled."

## 2. TSFM / ML / zero-shot forecasting verdicts

### `method-tsfm` — Time-series foundation models for financial returns
- verdict: **"Not established"**, confidence: **"C"**, scores p=1 e=0 r=1 i=1 t=1 b=2
- summary (verbatim): "Off-the-shelf TSFMs do not reliably beat strong econometric or tree baselines for returns; any gains are sample-efficiency / calibration effects, not proven net alpha."
- key_caveat (verbatim): **"Reject zero-shot TSFMs as a default financial return forecaster."**
- CSV: noguer-franklin-2026 (HOLD, `-`, confidence D): "only isolated stock-model pairs significantly beat the random walk"; zeng-chen-zhang-xu-2023 (POOS, `-`): "Simple one-layer linear models outperform sophisticated Transformer forecasters… repeating the last value is especially hard to beat for exchange rates"; marconi-2025 (POOS, `H`): "Zero-shot foundation models are competitive when little task-specific data are available, while specialized or trained-from-scratch models catch up or win as more local history is supplied."
- Corrections log: this family "moved from Ineffective to Not established under the mixed-evidence and adequately-powered-adverse rules" in v1.1.

### Related ML families
- `eq-ml-xs`: verdict **"Promising"**, confidence "C"; key_caveat: "Research-to-specialist transition only; no audited LIVE-X net alpha."
- `cmdty-ml`: verdict **"Promising"**, confidence "C"; key_caveat: "Promising only; not supported pre-live."
- `crypto-ml`: verdict **"Not established"**, confidence "D"; key_caveat: "Research only under the strict standard."
- `eq-llm-agents` (generic LLM/agentic investing): verdict **"Ineffective in tested scope"**, confidence "B"; key_caveat: "Point-in-time models remain research-grade; generic LLM investing is not established."
- `method-combinations` (forecast combinations/shrinkage): verdict **"Promising"**, confidence "B"; key_caveat: "Supported as variance control/regularization, not universal alpha."

## 3. Repo's own rules for a citable verdict (protocol.md)

- Scoping: "Every rating is scoped to a market, target, horizon, and implementation." Unit of evidence: `market × instrument × geography × target × horizon × predictor × method × benchmark × evaluation period × implementation`.
- Verdict gates (verbatim): "**Established effective**: all six dimensions at least 3, confidence A, and credible live execution for an exact implementation." "**Supported pre-live**: predictive, economic, replication, stability, and bias-control scores at least 3, but audited live execution is absent." "**Promising**: valid positive OOS evidence exists, but replication, costs, stability, or capacity remain incomplete" (and "'Promising' requires positive evidence at POOS-or-better stage, not in-sample-only positives"). "**Not established**: evidence cannot clear the required gates." "**Ineffective in tested scope**… requires at least one `-` (or `EQ`) tagged row at POOS-or-better stage in the family's evidence set; heterogeneity (`H`) or data-integrity critiques (`X`) alone cannot ground it, and equal-tier positive and negative evidence yields 'Not established' per the mixed-evidence rule."
- "No paper count or citation count can override a failed integrity gate." "Equal-tier positive and negative evidence yields a heterogeneous or mixed verdict, not a paper-count average."
- Predictability is explicitly NOT: "market inefficiency; abnormal return after risk adjustment; a profitable trading strategy; scalable alpha; evidence that one model class is universally superior."
- Risk-forecast carve-out: for volatility/default forecasts, `E` "refers to the prespecified decision loss or risk-management value rather than a forced trading return" — verdicts must state which basis was used.
- Self-limitation (carry through when citing): "protocol-documented, PRISMA-inspired public-web evidence map, not a registered systematic review… compiled in a single pass by one reviewer (an AI agent with web access)"; headline: **0 families "Established effective"** ("requires LIVE-X; none found in the public ledger").

## 4. Wiki grep (`~/wiki/wiki`, status-gated — statuses carried exactly)

8 hits; all have frontmatter `status: verified`:
- `projects/web/ai-diligence-tool-project.md` — **verified** (verified_by: user-confirmed) — the Connected Capital pilot node itself (matched "Connected Capital", "diligence", "ZHVI"); notes HANDOFF.md/SETUP-NOTES are confidential and excluded from wiki.
- `projects/web/usa-crime-3d-game-project.md` — **verified** (user-confirmed) — Market Quest 3D tab built from real ZHVI data (matched "ZHVI", "diligence").
- `projects/web/portfolio-risk-engine.md` — **verified** (verified_by: hub-asserted) — delivered client risk-scoring tool; matched "diligence" only.
- `projects/web/us-crime-map-project.md` — **verified** (user-confirmed) — crime-overlay data source; matched "diligence" via Related link only.
- `projects/web/ai-center-dx-lab.md` — **verified** (on-disk) — unrelated analytics project; matched "diligence" via Related link only.
- `projects/web/spark-lab.md` — **verified** (user-confirmed) — unrelated; matched "diligence" via Related link only.
- `_index/projects-hub.md` — **verified** (on-disk) — catalog; matched "diligence" in roster.
- `_index/moc-infra-and-research.md` — **verified** — MOC index; matched "diligence" in link list.

**No wiki node matched "market predictability"** — the evidence repo itself is not wiki-ingested (it appears only in auto-memory, which is a capture buffer, not the compile target). Per the wiki-first rule, the families-JSON verdicts are citable as the repo's own protocol-gated conclusions, but they are not wiki-`verified` facts; note also that individual facts inside `verified` nodes carry their own per-fact `{status}` tags (e.g. us-crime-map has one `unverified` fact).

---

## Annex C — Local data inventory

# Local data inventory — monthly housing-index forecasting benchmark

## 1. Processed series — `/Users/friday/Projects/ai-diligence-tool/.claude/worktrees/session-7fcda3/data/processed/`

All meta/CSVs baked 2026-06-08. Two directory layouts exist:

**Layout A — FRED pulls** (`latest.csv`, 2 cols: `observation_date`, `<source>_<timestamp>`):

```python
import pandas as pd
def load_fred(name):
    p = f"/Users/friday/Projects/ai-diligence-tool/.claude/worktrees/session-7fcda3/data/processed/{name}/latest.csv"
    s = pd.read_csv(p, index_col="observation_date", parse_dates=True).iloc[:, 0]
    s.name = name
    return s
```
(NOTE: the value column name embeds a bake timestamp, e.g. `fred_houst_20260608_191811` — never hardcode it; use `.iloc[:, 0]`.)

| dir | series | freq | units/kind | n_obs | range |
|---|---|---|---|---|---|
| `fred_csushpinsa` | Case-Shiller US National HPI (NSA) | monthly (1st-of-month stamps) | index level (Jan-2000=100 base family; 63.7→329.9) | 471 | 1987-01-01 → 2026-03-01 |
| `fred_zhvi_us` | Zillow ZHVI US (via FRED) | monthly | price level, USD ($123,427→$368,198) | 316 | 2000-01-01 → 2026-04-01 |
| `fred_houst` | Housing starts (HOUST) | monthly | level, thousands of units SAAR | 808 | 1959-01-01 → 2026-04-01 |
| `fred_mortgage30us` | 30-yr fixed mortgage rate | **weekly** (the one non-monthly series) | level, percent (7.33→6.48) | 2880 | 1971-04-02 → 2026-06-04 |
| `fred_actlis` | Active listing count (Realtor.com) | monthly | level, count of listings (~1.0–1.5M) | 119 | 2016-07-01 → 2026-05-01 |
| `fred_exhosl` | Existing home sales | monthly | level, units SAAR (~4.0M) | 13 only | 2025-04-01 → 2026-04-01 |

**Layout B — engine-fit dirs** (`latest_prices.csv` + `latest_returns.csv` + `latest_fit.json`):

```python
base = "/Users/friday/Projects/ai-diligence-tool/.claude/worktrees/session-7fcda3/data/processed"
prices  = pd.read_csv(f"{base}/fhfa_hpi_master/latest_prices.csv",  index_col=0, parse_dates=True)["price"]
returns = pd.read_csv(f"{base}/fhfa_hpi_master/latest_returns.csv", index_col=0, parse_dates=True)["0"]
```
(Prices: unnamed date index col + `price`. Returns: unnamed date index col + literal column name `"0"`; values are **simple** monthly returns — verified 100→100.41 gives exactly 0.0041.)

| dir | series | freq | units/kind | n | range | fit (from meta.json) |
|---|---|---|---|---|---|---|
| `fhfa_hpi_master` | FHFA purchase-only HPI | monthly (1st-of-month) | index level, 1991-01=100 (→441.55) | 423 prices / 422 returns | 1991-01-01 → 2026-03-01 | mu_ann 0.0433, sigma_ann 0.0167, lag1_ac 0.761, smoothing_flag true |
| `zillow_national_zhvi` | Zillow ZHVI US national | monthly (**month-END** stamps) | price level, USD | 316 / 315 | 2000-01-31 → 2026-04-30 | mu_ann 0.0427, sigma_ann 0.0186, lag1_ac 0.978, smoothing_flag true |
| `ncreif_recent_odce` | NCREIF ODCE | (quarterly, ppy=4) | **meta.json only — NO CSV**; note says full series is gated, parsed from public snapshot PDF | — | — | "use ppy=4 + geltner + bias" |

## 2. Distribution catalog — `.../session-7fcda3/data/catalog/`

`distribution_catalog.md`: **1,394 metro return series already fit through the engine** — 895 Zillow ZHVI (Home Values, 2000-01→2026-04, ~315 obs each) + 499 Zillow ZORI (Rents, 2015-01→2026-04, 135 obs each). The .md shows top-40 tables per source; the .csv holds all 1,394 rows (1,395 lines incl. header). Columns: `source, metro, what, start, end, n_obs, mu_ann, sigma_ann_raw, lag1_autocorr, smoothing_flag, sigma_ann_desmoothed`. So what's cataloged is **fitted lognormal params (mu/sigma) + Geltner de-smoothed vols per metro** — not the raw series themselves. Parse: `pd.read_csv(".../catalog/distribution_catalog.csv")` (quoted metro names contain commas; plain read_csv handles it).

## 3. Zillow metro raw — `/Users/friday/Projects/ai-diligence-tool/data/zillow_zhvi_metro_raw.csv` (main checkout, gitignored)

**WIDE format**: 896 rows (1 country + 895 metros) x 321 cols. ID cols: `RegionID, SizeRank, RegionName, RegionType, StateName`; then 316 monthly date columns named as ISO **month-end** dates `2000-01-31` … `2026-04-30`. Row 1 is `United States` (RegionType=`country`, SizeRank=0); metros are RegionType=`msa` with SizeRank starting at 1. Values are ZHVI price levels in USD.

Top 10 metros by SizeRank (1–10): New York NY, Los Angeles CA, Chicago IL, Dallas TX, Houston TX, Washington DC, Philadelphia PA, Miami FL, Atlanta GA, Boston MA.

**Verified recipe** (ran clean on the project venv `/Users/friday/Projects/ai-diligence-tool/.venv/bin/python`, pandas installed there — system python3.14 lacks pandas):

```python
import pandas as pd

df = pd.read_csv("/Users/friday/Projects/ai-diligence-tool/data/zillow_zhvi_metro_raw.csv")
id_cols = ["RegionID", "SizeRank", "RegionName", "RegionType", "StateName"]
top10 = df[df["RegionType"] == "msa"].nsmallest(10, "SizeRank")
long = top10.melt(id_vars=id_cols, var_name="date", value_name="zhvi")
long["date"] = pd.to_datetime(long["date"])
panel = long.pivot(index="date", columns="RegionName", values="zhvi").sort_index()
# panel: 316 monthly rows, 2000-01-31 → 2026-04-30, 10 metro columns
```
Output verified: shape (316, 10); only missing value in the whole panel is 1 NaN for Dallas, TX (n=314 in catalog agrees). Sibling files, same wide schema: `zillow_zhvi_county_raw.csv` (3k+ counties, extra id cols `State, Metro, StateCodeFIPS, MunicipalCodeFIPS`) and `zillow_zhvi_city_raw.csv` (92 MB), both also ending 2026-04-30.

## 4. Other local metro/state series — one-liners

In `/Users/friday/Projects/ai-diligence-tool/data/` (all wide Zillow-style unless noted):
- `heat_dtp_msa.csv` — **TIME SERIES**: days-to-pending, monthly 2018-03-31→2026-04-30, 787 MSA rows, same wide schema.
- `heat_inv_msa.csv` / `heat_inv_county.csv` — **TIME SERIES**: for-sale inventory counts, monthly 2018-03→2026-04 (county file adds FIPS id cols).
- `heat_mlp_msa.csv` / `heat_mlp_county.csv` — **TIME SERIES**: median list price USD, monthly 2018-03→2026-04.
- `zori_msa.csv` / `zori_county.csv` / `zori_city.csv` — **TIME SERIES**: Zillow ZORI rents USD, monthly 2015-01-31→2026-04-30 (720 MSAs).
- `irs_inflow.csv` / `irs_outflow.csv` — **CROSS-SECTIONAL SNAPSHOT**: single-year IRS county-to-county migration flow pairs (`n1, n2, agi`), no date column.
- `deep_dive_master.csv` — **CROSS-SECTIONAL SNAPSHOT**: 20,215 markets x 43 derived features (mu_ann, rent, yields, migration, permits, crime…), one row per market, no time dimension.
- `zillow_us_national_zhvi_prices.csv` — TIME SERIES: national ZHVI, 316 monthly rows, cols `(unnamed date), zhvi`.

Worktree `src/` JSONs:
- `src/us-market.json` — **SNAPSHOT** (asof 2026-06-30): 24 series' summary stats only (`latest, yoy, n, annReturn, annVol, annVolDesmoothed`) + corr matrices; no dated observation arrays.
- `src/market3d-data.json` — **mostly snapshot**: 150 metros with fitted `mu/sigma/rentMu` only, BUT includes three compact national time series as `{start, end, points}` value arrays (no per-point dates; reconstruct with `pd.period_range(start, end, freq="M")`): `zhvi` (316 pts, 2000-01→2026-04, rounded to $1), `mortgage` (663 pts, 1971-04→2026-06 — 663 ≠ weekly count, so downsampled/monthlyish), `houst` (808 pts, 1959-01→2026-04).

## Benchmark-relevant takeaways
- Best monthly national targets: FHFA HPI (423 obs to 2026-03), Case-Shiller NSA (471 obs to 2026-03), ZHVI (316 obs to 2026-04).
- Best metro panel: `zillow_zhvi_metro_raw.csv` (895 metros, 316 months) with ZORI/heat_* as monthly exogenous features from 2015/2018.
- All processed data is stale-dated 2026-06-08 (a month+ old); mortgage rate series is weekly and needs resampling for a monthly benchmark; NCREIF dir is metadata-only.

---

## Annex D — TSFM + paper web research

# Web research: TSFM verification (4 questions)

## 1. arXiv:2606.27100 — verified, one protocol mismatch

**Exists.** "Pretrained Time-Series Foundation Models for Financial Return Forecasting" — Miquel Noguer i Alonso and Rodolfo Pereira Franklin, submitted 25 Jun 2026 ([arxiv.org/abs/2606.27100](https://arxiv.org/abs/2606.27100)).

Protocol check against the given description (verified from abstract page + full PDF text):
- **Matches:** five equities AAPL, AMZN, GOOG, JPM, META; unified context L=512; horizon H=20 business days; 10 rolling-origin windows; MAE + skill score (1 − MAE/MAE_RW) + rMAE vs seasonal-naive; one-sided Diebold–Mariano with Harvey–Leybourne–Newbold finite-sample correction against t_{n−1}.
- **Matches (conclusion):** only two model–ticker pairs significantly beat the random walk in Table 7: **Chronos (v1) on AMZN, p = 0.0421** and **Moirai-2.0 on GOOG, p = 0.0421** — so "~2 pairs, p≈0.042" is exactly right. Paper frames TSFMs as "useful practical priors," not reliable alpha engines; iTransformer (trained from scratch) wins both META tasks.
- **Mismatch:** there is **no AR(1) baseline**. Benchmarks are random walk (zero-return) and 5-business-day seasonal-naive only; the other baselines are train-from-scratch neural models (NBEATS, NHITS, PatchTST, iTransformer, KAN). Note also the significant Chronos is **v1**, not Chronos-2 (both were evaluated).
- Paper itself flags that p-values are raw (no family-wise correction) and Bonferroni/BH would erase significance.

## 2. Chronos-2 (amazon/chronos-2, ~120M)

- **Release:** technical report arXiv:2510.15821 dated 17 Oct 2025; Amazon Science announcement 20 Oct 2025 ([amazon.science blog](https://www.amazon.science/blog/introducing-chronos-2-from-univariate-to-universal-forecasting)).
- **Model:** 120M-param encoder-only (T5-style) with group attention; univariate/multivariate/covariate tasks in one model ([HF card](https://huggingface.co/amazon/chronos-2)).
- **Quantile API:** zero-shot quantiles requested via `quantile_levels=[0.1, 0.5, 0.9]`; native multi-step quantile outputs (21 quantile levels trained). Context up to **8192 steps** (2048 pretrain, extended in post-training), prediction length up to **1024 steps** per the HF card.
- **Monthly/low-frequency:** no explicit monthly-specific guidance published. Evidence it's in-envelope: pretraining corpus includes M4 Monthly (48k series, Table 6 of [arXiv:2510.15821](https://arxiv.org/abs/2510.15821)); it ranks first among pretrained models on GIFT-Eval, which spans 10 frequencies incl. monthly ([arXiv:2410.10393](https://arxiv.org/abs/2410.10393)); and third-party HouseTS benchmark ran Chronos-2 on monthly ZHVI (see Q4). **A 12-step monthly horizon is comfortably within design limits** (1024-step max), though GIFT-Eval "emphasizes high-frequency series," so monthly is a relatively thin slice of published evals.

## 3. TimesFM-2.5 (google/timesfm-2.5-200m-pytorch)

- 200M params; **max context 16,384** ("up to 16k context length, up from 2048"); example `ForecastConfig(max_context=1024, max_horizon=256, use_continuous_quantile_head=True, fix_quantile_crossing=True, ...)` ([HF card](https://huggingface.co/google/timesfm-2.5-200m-pytorch), [GitHub README](https://github.com/google-research/timesfm)).
- **Quantile head:** optional 30M-param continuous quantile head, "supports continuous quantile forecast up to 1k horizon"; output shape (batch, horizon, 10) = mean + 10th–90th percentiles.
- **Frequency handling:** 2.5 "gets rid of the `frequency` indicator" that 1.x/2.0 required (0/1/2 categories; monthly was category 1) — the model is now frequency-agnostic with no monthly-specific switch or published monthly guidance. **12-step monthly horizon is within envelope** (well under both the 256 default max_horizon and the 1k quantile-head limit); HouseTS provides independent monthly-ZHVI evidence (below).

## 4. TSFMs on house-price indices + Zillow ZHVF

- **HouseTS** ([arXiv:2506.00765](https://arxiv.org/abs/2506.00765)) is the most direct published work: monthly ZIP-level dataset (6,000+ ZIPs, 30 metros, 2012–2023) with **ZHVI as forecast target**, benchmarking 16 model families **including TimesFM and Chronos-2** (zero-shot and fine-tuned) at 3/6/12-month horizons. Finding: foundation models are "competitive but do not surpass the strongest lightweight baselines" — DLinear beat both TSFMs in most configurations (e.g., 3-month multivariate: DLinear Log-RMSE 0.0108 vs fine-tuned Chronos-2 0.0166); fine-tuning helped over zero-shot.
- No published paper/blog/Kaggle work found applying TSFMs specifically to Case-Shiller or FHFA indices; adjacent TSFM-econ work exists (e.g., zero-shot economic forecasting with Chronos/TimeGPT/Moirai, [arXiv:2506.15705](https://arxiv.org/abs/2506.15705)) but doesn't confirm housing series.
- **Zillow ZHVF:** "a month-ahead, quarter-ahead and year-ahead forecast of the Zillow Home Value Index (ZHVI)," built on the all-homes mid-tier ZHVI cut, published raw and smoothed/seasonally adjusted ([zillow.com/research/data](https://www.zillow.com/research/data/)). Since Jan 2023 it runs on the neural-Zestimate-based ZHVI; over the Jan 2020–Sep 2022 backtest, one-month-ahead systematic error dropped to ~zero and 3–12-month MAE improved ([2023 methodology revision](https://www.zillow.com/research/methodology-neural-zhvi-32128/)). Methodology combines a leading-indicator forecast + error-correction model + seasonality, modeling the acceleration rate of appreciation. **Published absolute accuracy is sparse:** Zillow publishes no headline ZHVF MAPE table publicly; closest published figures are the per-property Zestimate 12-month forecast backtest (average absolute % error table on the [Zestimate Forecast Methodology page](https://www.zillow.com/research/zestimate-forecast-methodology/)) and its older Case-Shiller forecast claim of being "within 0.25 percentage points ~96% of the time since 2014" ([zillow.com/research/zillow-case-shiller-forecast-14308](https://www.zillow.com/research/zillow-case-shiller-forecast-14308/)). Caveat: zillow.com blocks automated fetches (PerimeterX 403), so Zillow specifics above come from search-index excerpts of those pages, not full-page reads.

---

## Annex E — Housing-predictability literature

# Housing-index predictability: what the literature actually supports

## 1. Case & Shiller (1989), "The Efficiency of the Market for Single-Family Homes" (AER 79(1): 125–137)

Using repeat-sales prices of 39,210 individual homes in Atlanta, Chicago, Dallas, and San Francisco/Oakland over 1970–86, Case and Shiller rejected weak-form efficiency: city-level home prices do **not** follow a random walk. Headline momentum magnitude: *"a city-wide real log price index change in a given year tends to be followed by a city-wide real log price index change in the same direction (and between a quarter to a half as large in magnitude) in the subsequent year"* — i.e., an annual follow-through of roughly **25–50%** of this year's index move ([NBER w2506](https://www.nber.org/papers/w2506); [AER listing](https://ideas.repec.org/a/aea/aecrev/v79y1989i1p125-37.html)). They also found real-interest-rate information was not incorporated into prices. Critically for deal-level use, the same paper reports that noise in individual house prices is so large that **R² in forecasting regressions for annual real price changes of individual homes never exceeds 0.04** ([NBER w2506](https://www.nber.org/papers/w2506)). A later critique (Cheng, Lin & Liu 2009) argues even the index-level tests/trading implications were overstated once the repeat-sales estimator's specification and real-world trading frictions are accounted for ([SSRN 1491725](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1491725)).

## 2. Momentum and mean reversion: established magnitudes and horizons

- **Guren (JPE 2018, "House Price Momentum and Strategic Complementarity")**: house prices exhibit *"substantially more momentum, positive autocorrelation in price changes over two to three years, than existing theories can explain"*; momentum *"lasts for two to three years before prices mean revert, a time horizon far greater than most other asset markets."* His Appendix A shows momentum holds *"across metropolitan areas in the U.S., countries, time periods, and price index construction methodologies"* — i.e., annual-frequency momentum is not purely an index artifact ([Guren paper PDF](https://people.bu.edu/guren/Guren_momentum.pdf); [JPE version](https://www.journals.uchicago.edu/doi/abs/10.1086/697207)). Search-friction models (Head, Lloyd-Ellis & Sun, AER 2014) generate only **~40% of the observed one-year autocorrelation and no momentum at two years** ([AER 104(4):1172](https://www.aeaweb.org/articles?id=10.1257%2Faer.104.4.1172); fraction quoted in [Guren's JMP](https://scholar.harvard.edu/files/guren/files/gurenjmp.pdf)); Guren's concave-demand strategic complementarity amplifies any underlying friction by a **factor of 2–3**, and matches three years of positively autocorrelated price changes with 26.5% backward-looking sellers.
- **Glaeser & Nathanson ("Housing Bubbles," NBER w20426, 2014)**: the stylized facts are positive serial correlation of price changes at one-year frequency and mean reversion at 3–5+ years — *"the correlation of price changes on lagged price changes over five year periods ranging from −.24 in the Sunbelt to −.57 in Coastal metropolises"* ([NBER w20426](https://www.nber.org/papers/w20426); [working-paper PDF](https://scholar.harvard.edu/files/glaeser/files/housing_bubbles_nberwp.pdf)).
- **Glaeser & Nathanson ("An Extrapolative Model of House Price Dynamics," JFE 2017 / NBER w21037)**: modest extrapolation by buyers reproduces the trio of facts — momentum at one-year horizons, mean reversion at five-year horizons, excess long-run volatility relative to fundamentals ([NBER w21037](https://www.nber.org/papers/w21037)). Glaeser & Gyourko ("Housing Dynamics," NBER w12787) call the strong serial correlation in annual price changes one of the two biggest housing-market puzzles: rational spatial-equilibrium models explain the 5-year mean reversion but **not** the high-frequency momentum ([NBER w12787](https://www.nber.org/papers/w12787)).

**Bottom line for docs:** positive autocorrelation in ANNUAL index returns (roughly 0.25–0.5 pass-through in Case-Shiller's original estimate; robustly positive for ~2–3 years per Guren) and NEGATIVE autocorrelation (mean reversion) at 3–5-year horizons (−0.24 to −0.57 over 5-year windows) are among the best-established facts in real-estate economics. Monthly index returns show even higher measured autocorrelation, but that is partly mechanical (next section).

## 3. Index construction bakes in smoothing — some measured autocorrelation is artifact

- **ZHVI (Zillow)** is model-based, not transaction-based: it is built from monthly changes in Zestimates (mean of the 35th–65th percentile of the property universe), chained backward, **smoothed with a 3-month moving average**, and seasonally adjusted with LOESS decomposition; since Jan 2023 it uses the "neural Zestimate" ([ZHVI methodology](https://www.zillow.com/research/zhvi-methodology/); [2019 deep dive](https://www.zillow.com/research/zhvi-methodology-2019-deep-26226/); [2023 revision](https://www.zillow.com/research/methodology-neural-zhvi-32128/); FRED labels the series "smoothed, seasonally adjusted": [FRED ZHVI](https://fred.stlouisfed.org/series/USAUCSFRCONDOSMSAMID)). A valuation-model input adds its own persistence on top of the explicit 3-month MA.
- **S&P CoreLogic Case-Shiller** is by construction a **3-month moving average**: each monthly index point uses sales pairs from that month and the two preceding months ([S&P methodology PDF](https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-cotality-cs-home-price-indices.pdf); [Wikipedia summary](https://en.wikipedia.org/wiki/Case%E2%80%93Shiller_index)). **FHFA HPI** uses a variant of the same weighted-repeat-sales methodology ([S&P/FHFA methodology comparison](https://legalclarity.org/how-the-sp-corelogic-case-shiller-home-price-index-works/)). Any 3-month MA mechanically induces positive autocorrelation in month-over-month returns at lags 1–2 regardless of true price dynamics.
- **Appraisal-based indices (NCREIF NPI)** are the extreme case: appraisal lag and stale appraisals artificially inflate serial correlation and understate volatility; **Geltner's (1991/1993) unsmoothing** recovers series with much less autocorrelation (though still some positive first-order AC) and substantially higher volatility ([Geltner-lineage review](https://www.tandfonline.com/doi/abs/10.1080/10835547.2022.2069654); [Fisher-Geltner-Webb revision](https://www.researchgate.net/publication/5151713_Unsmoothing_Commercial_Property_Returns_A_Revision_to_Fisher-Geltner-Webb%27s_Unsmoothing_Methodology); [unsmoothing explainer](https://portfoliooptimizer.io/blog/combating-volatility-laundering-unsmoothing-artificially-smoothed-returns/)).
- **Honest framing:** short-lag (monthly) autocorrelation in ZHVI/Case-Shiller is partly index artifact and not a tradeable signal; but the *annual-horizon* momentum survives across index construction methodologies (Guren, Appendix A), so it is a real market phenomenon — just not one an individual buyer can cheaply monetize.

## 4. The critical caveat: index predictability ≠ deal alpha

- **Idiosyncratic dispersion around the index is huge.** Giacoletti ("Idiosyncratic Risk in Housing Markets," RFS 2021; LA/San Diego/SF resale micro-data): *"Idiosyncratic risk makes up to 60% of capital gains volatility of home resales after one year, while it accounts for less than 20% after five years"* — and house-specific risk behaves like a single shock realized at sale (it does **not** scale with √holding-period), consistent with illiquidity/price-uncertainty rather than quality changes; accounting for it reduces housing Sharpe ratios and makes them holding-period dependent ([JMP PDF](https://finance.unibocconi.eu/sites/default/files/files/media/attachments/MarcoGiacolettiJMP20170116082355.pdf); [RFS 2021](https://academic.oup.com/rfs/article-abstract/34/8/3695/6187964); [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2995323)). Secondary literature summarizes Giacoletti as idiosyncratic risk accounting for ~45–70% of individual house price variance ([Nature HSSC 2025 review](https://www.nature.com/articles/s41599-025-05260-6); see also [Kotova & Zhang, "Search Frictions and Idiosyncratic Price Dispersion in the US Housing Market"](https://bfi.uchicago.edu/wp-content/uploads/sfipd.pdf)).
- **Case & Shiller's own numbers make the point:** metro momentum is 25–50% follow-through, but forecasting an *individual* home's annual real price change tops out at **R² ≈ 0.04** ([NBER w2506](https://www.nber.org/papers/w2506)).
- **Transaction costs swamp the drift.** Round-trip housing transaction costs are roughly **6–12% of value in OECD markets** ([Global Property Guide](https://www.globalpropertyguide.com/transaction-costs)); US sellers alone typically pay ~8–10% (commission ~5–6% plus 2–4% closing/transfer costs) ([Zillow costs-to-sell](https://www.zillow.com/sellers-guide/costs-to-sell-a-house/)). A momentum edge of a few percent per year at the index level cannot be arbitraged through physical houses — which is precisely why the momentum persists (Guren: predictable changes "should be arbitraged away by households" yet are not; [Guren PDF](https://people.bu.edu/guren/Guren_momentum.pdf)). Cheng, Lin & Liu additionally argue Case-Shiller-style trading profits vanish under realistic transaction costs and time-on-market ([SSRN 1491725](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1491725)).
- **Implication for a diligence tool:** index momentum shifts the *distribution mean* for a metro 12-month outlook by low single-digit percentage points; the idiosyncratic standard deviation of a single deal around that mean (per Giacoletti, majority of 1-year variance) plus a 6–12% round-trip cost means index-level predictability translates far less than 1:1 into deal-level alpha. Use it as a market-context prior, not a deal return forecast.

## 5. Institutional forecast accuracy and the Zillow Offers cautionary tale

- **ZHVF (Zillow Home Value Forecast)** is a month/quarter/year-ahead forecast of ZHVI, back-tested by Zillow via out-of-sample historical runs summarizing average absolute percentage error of 12-month forecasts ([Zestimate/ZHVF forecast methodology](https://www.zillow.com/research/zestimate-forecast-methodology/)). Zillow's near-term Case-Shiller forecasts show median absolute errors of only 0.1–0.3 pp — but that is monthly/near-horizon, where smoothing makes indices highly persistent ([Zillow research](https://www.zillow.com/research/zillow-case-shiller-forecast-14308/)).
- **12-month-ahead is where it breaks.** In April–May 2020 Zillow's baseline forecast called for US home prices to **fall 2–3% through end-2020** and only recover to pre-COVID levels by Q3 2021 ([Zillow Research, Apr 2020](https://www.zillow.com/research/prices-sales-forecast-coronavirus-26975/); [GeekWire](https://www.geekwire.com/2020/zillows-housing-market-projections-home-sales-will-fall-60-prices-will-dip-2-3/)). Actual outcome: ZHVI up **11.6% YoY by April 2021** ([Zillow mediaroom](https://zillow.mediaroom.com/2021-05-18-Record-Growth-Drives-Typical-Home-Values-Up-11-6-Over-Last-Year)) and up ~19.5% during calendar 2021 ([Zillow Sept 2021 report](https://www.zillow.com/research/september-2021-market-report-30226/amp/)) — a ~15–20 pp directional miss at the 12–18-month horizon.
- **Zillow Offers (iBuying) failure, Nov 2021:** Zillow announced wind-down on Nov 2, 2021, taking a **~$304M Q3-2021 inventory write-down plus an expected further $240–265M in Q4** on homes bought above resale value, cutting ~25% of its workforce ([Zillow Q3 2021 8-K](https://www.sec.gov/Archives/edgar/data/1617640/000161764021000101/exhibit991.htm); [Inman](https://www.inman.com/2021/11/02/zillow-to-shut-down-ibuying-program-zillow-offers/)); full-year 2021 losses on the segment ran to roughly **$881M** ([Zillow 10-K FY2021](https://www.sec.gov/Archives/edgar/data/1617640/000161764022000013/z-20211231.htm); [summary](https://re-brokerage.com/zillow-offers-lost-881m-in-2021-shutdown/)). CEO Rich Barton's stated reason: *"the unpredictability in forecasting home prices far exceeds what we anticipated."* What actually went wrong, briefly: the pricing models (Zestimate-derived offer engine, deliberately tuned aggressive in mid-2021 in "Project Ketchup") systematically overpaid ~7,000 homes just as appreciation decelerated, and the buy-side algorithm suffered adverse selection — sellers accept algorithmic offers precisely when the algorithm overprices ([WUSA9/Verify](https://www.wusa9.com/article/news/verify/zillow-lost-millions-on-its-ibuying-operating-zillow-offers-real-estate-market/65-0494c99d-deb8-4c08-8018-ef16e589c460); [case study](https://iceberg.digital/trust-incident-zillow/)). Lesson for honest-limits docs: a firm with the largest housing dataset and a model good to ~2% median error on index nowcasts still could not forecast 6–12-month price paths accurately enough to survive a ~6–12% transaction-cost + volatility envelope at the individual-home level.

## Suggested honest-limits statements (supported by the above)

1. Annual metro-index returns are positively autocorrelated (~0.25–0.5 follow-through; momentum persists 2–3 years) and mean-revert over 3–5 years (5-year correlation −0.24 to −0.57). This is market-context signal, not deal-level alpha.
2. Monthly index autocorrelation is inflated by construction (ZHVI: model-based + 3-month MA + seasonal adjustment; Case-Shiller: 3-month rolling sales pairs; appraisal indices need Geltner unsmoothing) — do not treat short-lag persistence as tradeable.
3. At the individual-property level, idiosyncratic dispersion dominates (up to ~60% of 1-year resale capital-gain volatility; individual-home forecast R² ≤ 0.04 in the founding study) and round-trip costs of 6–12% exceed any plausible 12-month index drift; even Zillow's institutional-grade forecasts missed by 15–20 pp at 12–18 months in 2020–21 and its iBuying arm lost ~$881M.
