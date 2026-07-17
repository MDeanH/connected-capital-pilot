# Housing acceptance test — conditional market prior vs the engine's unconditional drift

**Date:** 2026-07-17 · **Status:** VERIFIED (all numbers below reproduced by running
`housing_zhvi_benchmark.py` on this machine; raw outputs in `housing_results/`)

## Why this test exists

The equity benchmark in this directory (Cursor's replication of arXiv:2606.27100)
ends with a claim: zero-shot time-series foundation models that *cannot* beat
"predict zero" on daily equities should still be credible as a **conditional
market-path prior** on the platform's housing series, because housing indices are
massively more serially dependent — and it names the acceptance gate: the same
rolling-origin + one-sided HLN-corrected Diebold–Mariano protocol, run on
ZHVI/FHFA, against the null the engine actually embodies (an unconditional
stationary μ). This document is that test.

## Protocol

- **Tasks (13):** US ZHVI, US FHFA HPI (monthly master), US Case-Shiller NSA,
  plus ZHVI for the 10 largest metros (New York, Los Angeles, Chicago, Dallas,
  Houston, Washington, Philadelphia, Miami, Atlanta, Boston). Monthly linear
  returns of price levels; data straight from the repo's own bakes
  (`data/processed/…`) and the local Zillow metro file.
- **Windows:** context L=120 months, horizon H=12 months, 10 rolling origins
  evenly spaced 2015-01 → 2025-05 (FHFA/CS: → 2025-04).
- **Models:** RandomWalk (zero return), **DriftRW** (context-mean drift — the
  analog of the engine's unconditional μ, and the null that matters), Seasonal
  Naive (m=12), AR(1), and zero-shot **Chronos-2** (amazon/chronos-2) and
  **TimesFM-2.5** (google/timesfm-2.5-200m-pytorch), median point forecasts.
- **Tests:** MAE; skill vs both nulls; one-sided Diebold–Mariano with HLN
  correction (pooled across windows, lag truncation h=H), exactly as in
  `benchmark_lib.py`.

## Headline result

The equity finding **inverts** on the platform's own domain:

| | Daily equity returns (Cursor run) | Monthly housing indices (this run) |
|---|---|---|
| DM tests beating zero-RW at 5% | **0 / 40** (best p ≈ 0.10) | **40 / 65** |
| DM tests beating unconditional drift at 5% | not run | **32 / 65** |
| Best skill vs the null | ±0.02 (noise) | **+0.56** (Chronos-2, US ZHVI) |

- **Task wins (lowest MAE):** TimesFM-2.5 7, AR(1) 3, Chronos-2 3.
  Average MAE rank: TimesFM-2.5 **1.46**, Chronos-2 2.00, AR(1) 2.77,
  SeasonalNaive 3.92, DriftRW 5.15, RandomWalk 5.69. The two zero-shot TSFMs
  beat every locally-fit statistical baseline on rank, and drift/zero rank last
  almost everywhere.
- Both TSFMs and AR(1) beat drift significantly on **US ZHVI itself**
  (p ≤ 0.0001), the series the pilot engine actually bootstraps.
- Where it *doesn't* work is informative: **Los Angeles** (no model significant
  vs drift) and Case-Shiller AR(1) — momentum alone isn't enough everywhere.
- **Interval calibration:** pooled q10–q90 coverage of the zero-shot TSFMs is
  close to nominal 80% on 11 of 13 tasks (TimesFM median ≈ 0.83, Chronos ≈ 0.80).
  The failure is Dallas (0.51–0.58 coverage — the 2021–22 boom/bust blew through
  the intervals), a useful reminder that regime breaks defeat zero-shot intervals.

## Robustness: the signal survives de-smoothing

Objection: "housing indices are smoothed; you're forecasting the smoothing
filter." Re-running the protocol on **Geltner-unsmoothed** returns (the app's own
de-smoother, removed autocorr capped at 0.6 exactly like the engine) on 7 tasks:

- **19 / 28** model–task pairs still significantly beat drift at 5%.
- **TimesFM-2.5: significant on all 7 tasks** (p ≤ 0.0042); Chronos-2 all 7.
- **AR(1) collapses** on FHFA (p = 0.99) and Case-Shiller (p = 0.39) — its edge
  *was* largely the lag-1 smoothing artifact. The TSFMs keep 0.15–0.47 skill:
  they exploit longer-range and seasonal structure beyond lag-1 autocorrelation.

This is the strongest single argument for a TSFM prior over a plain AR(1)
overlay. (`housing_results/geltner_robustness.csv`)

## App test results (same session)

- **Engine parity suite:** 16/16 PASS (fresh run, `npm run parity` in this
  worktree — deterministic fit, MC metrics vs Python golden, structural
  regressions).
- **Full production build:** PASS (`npm run build`: parity + tsc + vite;
  pre-existing chunk-size warning only).
- **Live site** (diligence.mdeanproductions.com): landing page renders with
  correct synced stats (the how-it-works counters animate to 20,216 / 20,000 /
  10,801 / 7,372 / 11); Deal Score computes a Miami sample deal end-to-end
  (P(target) 27.6%, honest P(loss) 19.1% vs naïve 0.1%, allocation capped 25%);
  `/api/score` and `/api/data-status` return 200; US Market renders 24 national
  series incl. the new SOFR; zero console errors.

## What this means for the engine

1. **The gate is passed, with a specific winner.** A conditional 12-month market
   prior on the platform's housing series clears the pre-registered acceptance
   test — including against the drift null and after de-smoothing. TimesFM-2.5
   is the best point forecaster on 7/13 tasks and the most robust; Chronos-2 is
   competitive and slightly better-calibrated on some tasks.
2. **Integration shape (unchanged from the equity notebook's sketch, now with
   evidence):** TSFM quantile paths on the market series → a horizon-dependent
   `mu_adj` (year-1 tilt toward the conditional median path, decaying to the
   unconditional μ by year 3–5 per the mean-reversion literature), with σ left
   to the engine's existing de-smoothing + idiosyncratic build-up. The TSFM
   supplies only the market base rate; the analyst layer stays on top.
3. **Honest-limits haircuts still apply.** Index predictability ≠ deal alpha:
   Case & Shiller's own individual-home forecasting R² never exceeded 0.04, and
   Giacoletti finds idiosyncratic risk is up to ~60% of resale capital-gains
   volatility at 1-year holds. Dallas coverage (0.51) shows zero-shot intervals
   fail in regime breaks — so any `mu_adj` tilt should be capped (like the
   yield edge's ±0.30%/yr cap, but calibrated from the skill numbers here) and
   CI-widened, not taken raw. The mean-reversion literature (Glaeser–Nathanson:
   5-year autocorrelation −0.24 to −0.57) says the tilt must decay to — or
   past — the unconditional μ at long horizons.
4. **Statistical caveats, stated plainly (adversarially reviewed):** pooling 10
   windows into one DM vector is only approximately valid — a simulation study
   in the lib review (CONFIRMED by an independent refuter) puts the null
   rejection rate at ~7.5–11% at nominal 5% even with disjoint windows, and
   metros are cross-correlated, so the 65 tests are not independent. The
   p ≈ 1e-4 results survive any reasonable size correction; borderline
   p ≈ 0.03–0.05 rows should not be leaned on. The effect sizes (0.2–0.56
   skill) and the de-smoothing robustness carry the conclusion, not the
   p-value census. Three reuse traps in `benchmark_lib.py` were confirmed and
   checked against this run: window spacing (13.7 mo > H=12, no overlap),
   TimesFM's `infer_is_positive` zero-clamp (0/130 contexts all-positive), and
   forecast/actual list alignment (equal by construction).
5. **Zero-shot is the floor, not the ceiling.** HouseTS (arXiv:2506.00765) —
   the closest published precedent, monthly ZIP-level ZHVI — found lightweight
   fitted DLinear beat zero-shot TimesFM/Chronos in most configs. Before
   production, run a fitted lightweight conditional baseline through this same
   harness; adopt the TSFM only if it holds up.

## Files

| File | What |
|---|---|
| `housing_zhvi_benchmark.py` | the test (stages: baselines / tsfm / report) |
| `housing_results/summary.csv` | per-task MAE, skill, DM p-values |
| `housing_results/dm_tests.csv` | all 130 DM tests |
| `housing_results/coverage.csv` | TSFM q10–q90 coverage |
| `housing_results/geltner_robustness.csv` | de-smoothed re-run |
| `housing_results/housing_acceptance_test.png` | summary figure |

*Research annex (engine internals, evidence-repo verdicts, literature, and the
adversarial review of `benchmark_lib.py`) in `RESEARCH-ANNEX.md`.*
