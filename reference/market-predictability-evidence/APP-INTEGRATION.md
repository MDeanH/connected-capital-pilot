# Market-predictability evidence map → Connected Capital pilot integration

Source: private repo `MDeanH/financial-market-predictability-evidence`
(protocol + 198-study ledger + 49 family effectiveness ratings, cutoff
2026-07-14, corrected 2026-07-14). A synced copy lives in this directory.

## Why it matters for the pilot

Institutional LPs' first diligence question about an "AI probability engine"
is *why should we believe these probabilities?* The evidence map lets the
pilot answer with the literature instead of assertion: the engine's design
choices line up with what the public evidence supports, and it deliberately
avoids the claim types the evidence rates as not established or ineffective.

## Engine ↔ evidence family mapping

| Platform component | Evidence family (verdict) | Use |
| --- | --- | --- |
| MC volatility modeling / de-smoothed vol | `vol-rv-forecast` — **Supported pre-live**, one of only 6 | The engine's risk core stands on the single best-established predictability result in finance (volatility forecastability). Citable. |
| De-smoothing step (honest volatility) | `private-persistence` (Not established) + the Couts-Gonçalves-Rossi 2024 unsmoothing row | Direct citation for *why* appraisal/NAV smoothing must be removed before risk estimates mean anything. The pilot uses transaction-based (Zillow) indices, which sidesteps NAV smoothing — say so explicitly. |
| Yield edge (±0.30%/yr, within-state gross-yield percentile) | value/carry family type (`eq-value`, `rates-carry-roll` analogues) | The app's one return predictor is an income/value-type signal — the family type with the strongest support in the map. The cap and transparency match the map's cost/decay warnings. |
| No national-market timing (cross-sectional ranking + Kelly sizing only) | `eq-aggregate-valuation-macro` — **Not established** | The engine's *refusal* to time the aggregate market is itself evidence-aligned. Defensive talking point. |
| DDQ/document AI (extraction & synthesis, not stock-picking) | `eq-llm-agents` — **Ineffective in tested scope** | Differentiator: we can cite evidence that generic LLM investing does not beat benchmarks — and explain that our AI does diligence work, not return prediction. |
| Permits headwind, crime-as-context | protocol's association-vs-forecast discipline | The app already labels crime as context-not-predictor; the map's IS/POOS vocabulary gives that discipline a citable standard. |
| Default/credit risk (future underwriting feature) | `credit-default-hazard` — **Supported pre-live** | If/when the pilot adds borrower or sponsor default scoring, the hazard-model literature is the supported basis (decision value, not tradable alpha). |

## Grade our own backtests by the map's rubric (credibility ladder)

The yield-edge backtest (8 of 9 county/city vintages 2016-2022, Q5−Q1 ≈
+2-3%/yr) is retrospective pseudo-out-of-sample → **POOS / P2** on the map's
scale — honest label: "Promising-grade internal evidence," not proof.
Cheap upgrade path, straight from the protocol's evidence-stage ladder:

1. **HOLD**: freeze the signal spec, evaluate once on a never-touched vintage
   (e.g. 2023-2025 data as it matures).
2. **LIVE-P**: publish timestamped quarterly market forecasts to the private
   pilot repo under a frozen protocol. After 4+ quarters this is prospective
   evidence — the level *zero* public families reached (the map's headline:
   nothing in the public literature clears "Established effective").
3. Adopt the protocol's exclusion rules as engine QA gates (already largely
   in place): point-in-time vintages (DataStatus), no random time splits,
   parity suite as computational-reproduction check, costs stated separately
   from gross results.

## Product surfaces

- **Evidence page** in the app (or pilot deck appendix): render
  `financial-market-predictability-families.json` as a browsable table —
  which families the engine leans on, which it deliberately avoids, with
  verdicts. The landing page's how-it-works already auto-syncs numbers from
  rebakes; "grounded in a 198-study evidence review" can join that pipeline.
- **DDQ rationale**: diligence questions that touch return assumptions can
  cite the family verdict behind the question.
- **Marketing honesty**: the map's own headline — 0 families "Established
  effective" without live execution — is the strongest possible framing for
  why the pilot reports *probabilities with uncertainty*, not promised alpha.

## Files in this directory

- `financial-market-predictability-protocol.md` — methodology + rubric
- `financial-market-predictability-evidence.csv` — study ledger
- `financial-market-predictability-families.json` — family ratings (the file
  an Evidence page would render)
- Upstream: https://github.com/MDeanH/financial-market-predictability-evidence
  (private). Treat as read-only here; correct upstream and re-sync.
