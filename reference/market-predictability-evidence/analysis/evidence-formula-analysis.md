# Predictive formula & external connections — market-predictability evidence map

> **⚠ SUPERSEDED IN PART — read [real-data-findings.md](real-data-findings.md) first.**
> A later pass fit the rule space blind (both floor and ceiling forms, waivers
> searched rather than hand-set) and validated it against real market data. It
> **overturned three claims below**:
> 1. **`min(R,T,B) ≥ 3` scores 44/47 = 93.6%, not 45/47 = 95.7%.** The
>    target-conditional carve-outs ("E waived for risk, P for methodology") are
>    **logical no-ops** — `min(R,T,B)` contains neither E nor P. The 95.7% is
>    unreproducible under any reading of the rule as stated.
> 2. **The load-bearing dimension is `I` (implementability), not the R/T/B
>    "credibility floor".** Banning I from the search costs accuracy; banning P, E,
>    R, T, or B *individually* costs zero. The best rule is `min(P,I) ≥ 3` at
>    **46/47 = 97.9%** (permutation p < 0.0001) — and 46/47 is the *provable Bayes
>    ceiling*, because `crypto-vol` shares a bit-identical scorecard with two
>    *Promising* families. That makes crypto-vol a **labeling contradiction in the
>    data**, not a rule failure.
> 3. **`reit-vol` is NOT an over-grade** (I=3 clears the real gate). Only
>    `crypto-vol` is anomalous, and for a different reason than given below.
>
> The "structural finding" section below (credibility axes gate the top) is
> therefore **wrong as written**. The verdict-count, ledger-physics, and external
> -connection sections are unaffected and were independently re-verified.

*Analysis of `financial-market-predictability-families.json` (47 families) +
`financial-market-predictability-evidence.csv` (184 studies). All internal numbers
re-derived from source with `python3`; external numbers marked by how they were
obtained. Generated 2026-07-14.*

## What a formula over this data can and cannot be

This ledger is **meta-evidence** — it scores *studies and claims about* market
predictability. It contains no prices or returns. So no formula fit here predicts
markets; anyone who tells you otherwise is overfitting a rating sheet. What *is*
recoverable, and what this document delivers, is the **implicit decision rule of the
rating system itself**: a formula that predicts a family's **verdict** from its
P/E/R/I/T/B scores and the composition of its cited evidence. That is genuinely
useful — it exposes what the raters actually reward, where they deviated from their
own written protocol, and how their verdicts line up against the external
replication-crisis and live-track-record literature.

## The formula (three nested gates)

Fitting was exhaustive over one- and two-feature threshold rules with
**leave-one-out cross-validation** (rule re-fit inside each fold; n=47).

### Gate 1 — Supported pre-live ⟺ the credibility floor `min(R, T, B) ≥ 3`

A blind single-feature search picks `min(R,T,B) ≥ 3` (replication **and** temporal
stability **and** bias-resistance all ≥ 3): **44/47 = 93.6%** train, **91.5% LOOCV**.
Adding the protocol's target-type carve-outs lifts it to **45/47 = 95.7%**, with
**zero false positives** — no lesser-verdict family sneaks through:

```
Supported pre-live  ⟺   min(R,T,B) ≥ 3
                        AND (P ≥ 3         OR family is methodology)
                        AND (E ≥ 3         OR target is a risk/statistical forecast)
```

The carve-outs come from the protocol itself: for volatility/default/hazard
forecasts, **E means decision/risk value, not trading alpha** (so `credit-default-hazard`
is Supported with E=0), and for methodology families P is inapplicable
(`method-eval-integrity` is Supported with P=0 on R4/I4/T4/B4).

The naive reading of the written gate, `min(P,E,R,T,B) ≥ 3`, scores only **5/12**
Supported families (85% overall) — it misses **all five** risk-forecast families and
**both** methodology families. The target-conditional form is the real rule.

### Gate 2 — Ineffective ⟺ `P ≤ 1` (predictive accuracy scored 0–1)

**43/47 = 91.5%** train, **91.5% LOOCV**. `posshare ≤ 0.29` (share of a family's cited
studies tagged positive) is an almost-as-good alternative (89.4%). But this gate is
**partial**: only ~6–7 of the 9 Ineffective families have P≤1; the rest carry P=2
("adequately-powered adverse") and are separated from Not-established only by
adverse-tag dominance, not by a score threshold.

### Gate 3 — Promising vs Not-established is **not** score-computable

Best single-threshold rule reaches **76.9%** against a **65.4%** base rate — barely
better than guessing the majority. Matched pairs prove it: `cmdty-ml` (P2 E2 T1,
**Promising**, no adverse studies) vs `cmdty-momentum` (P2 E2 T1, **Not established**,
two H studies + decay evidence) have identical scores. The operative distinction is
qualitative — *incomplete-but-untested* vs *affirmatively contradicted* — a genuine
human-judgment layer the numbers don't encode.

**Combined**, the two computable gates classify **41/47 = 87%** of the map (Promising
folded into Not-established, since scores can't split them). The honest summary:
**the top gate is a formula; the bottom two-thirds is judgment.**

## The structural finding: evidence-quality gates the top, performance tracks the rank

Correlation of each dimension with verdict rank (Ineffective=0 … Supported=3):

| Dim | corr | Ineff→Supported means |
|---|---|---|
| **T** temporal stability | **+0.73** | 1.11 → 3.00 |
| **P** predictive accuracy | +0.68 | 1.11 → 3.08 |
| **E** economic value | +0.60 | 0.33 → 2.00 |
| **B** bias resistance | +0.60 | 1.67 → 2.92 |
| **I** implementability | +0.49 | 1.56 → 3.33 |
| **R** replication | +0.37 | 2.11 → 3.17 |

R correlates *weakest* with the rank yet *gates* the top — because R is
non-monotonic: Ineffective families still score R≈2.1 (they replicate — as
**failures**; "independent reimplementation of a null" is R=2). R only discriminates
in **conjunction** (that's why the formula uses `min(R,T,B)`, not R alone). The
takeaway: **a family is promoted to Supported by surviving on the credibility axes
(replication, stability, bias-control), not by having the highest performance
scores.** Temporal stability (T) is the single best predictor of where a claim lands.

## Verified ledger structure (the "evidence physics")

- **Stage gradient.** In-sample rows are weak-positive boilerplate (66% "+?"); true
  holdouts carry the clear wins (HOLD 50% "++"). External replication is the
  system's **filter**: adverse results are **29% at EXT vs 7% elsewhere** (OR 5.54,
  Fisher p=0.0002; OR 6.3 within equities alone — not an asset-mix artifact).
- **No decay panic, but a heterogeneity explosion.** Positive-share by year is
  non-monotone and stage-confounded; the real temporal signal is unresolved
  heterogeneity (H) hitting **44% of 2023+ studies vs 15% before** (OR 4.3,
  p=0.0004) — the LLM/TSFM wave arriving without settled results.
- **Confidence is a stage proxy.** protocol_confidence B/C/D = 50/70/56 (no A
  exists). 100% of B-studies are HOLD/EXT/LIVE-P/METHOD; 75% of D-studies are
  in-sample. Supported families cite significantly less D-evidence (16% vs 34%,
  p=0.01).
- **Connectors are shared audit infrastructure, not prosecutors.** 30 studies are
  cited by >1 family; the 9 cited ≥3× are **8/9 external-replication or methodology**
  audits, split evenly between validators (Asness-Moskowitz-Pedersen, Jensen-Kelly-
  Pedersen, Chen-Zimmermann) and prosecutors (Hou-Xue-Zhang, Green-Hand-Zhang,
  Harvey-Liu-Zhu). They are the map's multiple-testing police.
- **The ladder ends at EXT.** Exactly **1 of 184** studies is LIVE-P and **0** are
  LIVE-X, which is why **0/47 families reach "Established effective"** — a structural
  ceiling of the public-paper scope, not a judgment.

## External connections (research)

Verified against fetched sources where noted; `[snippet]` = search-result text only.

### Replication-crisis literature calibrates the T and B scales

- **McLean & Pontiff (2016, JF)** — 97 predictors decay **26% out-of-sample, 58%
  post-publication**, but *not to zero* `[snippet; matches the map's own CSV row]`.
  58% partial decay is literally the map's **T=2** definition ("one later period
  survives with substantial decay"), which is why value/momentum stay Supported (T=3
  via re-validation) rather than folding into Ineffective.
- **Harvey, Liu & Zhu (2016, RFS)** — 316 factors; a new factor needs **t > 3**, not
  2 `[fetched NBER]`. This *is* the map's B-scale: B=1 = "single-test t~2 winner"
  (the regime HLZ rejects), B=3 = "dependence-aware correction" (HLZ's framework).
- **Hou, Xue & Zhang (2020, RFS)** — **65% of 452 anomalies fail** |t|>1.96 once
  microcaps are controlled (82% at t>2.78) `[fetched NBER WP + snippet]`. Grounds the
  `eq-size` and `eq-anomaly-zoo` Ineffective verdicts.
- **Jensen, Kelly & Pedersen (2023, JF)** — the lenient pole: **82.4% replicate** as
  CAPM alphas across 93 countries `[fetched NBER + AQR]`. Cited by exactly the three
  equity families rated Supported for alpha — it licenses their R/T scores.
- **Chen & Zimmermann (2022, CFR)** — **98% numerically reproduce**; publication bias
  shrinks returns only 10–15% `[fetched RePEc + arXiv]`. The 98%-reproduce vs
  65%-fail contrast is the empirical basis for the map's core axiom: *numerical
  reproduction (R) is not economic replication (E)* — a family can have R=3 and still
  be Ineffective on E.
- **Consistency verdict.** The map is **9 Ineffective + 17 Not-established = 55%
  not-positive** (74% counting Promising as not-yet-cleared). That sits **deliberately
  between the poles** — much harsher than JKP's 18% theme-failure (JKP is gross alpha,
  no costs), and inside HXZ's 65–82% signal-failure band once Promising counts as
  not-cleared. It is **internally consistent**, because the map reserves "Ineffective"
  for *powered adverse* evidence (HXZ "failure" is mostly non-rejection → the map's
  "Not established"). Fresh 2024–2026 work (Falck-Rej-Thesmar 43% Sharpe decay
  accelerating ~5pp/yr; Chen-Velikov ~4bp/mo net; Chen-Welch 48→19→7 bp) all
  **tightens, none overturns** the verdict layer `[mix of fetched + snippet]`.

### Live track records — where "pre-live" is most conservative

The ledger caps at EXT by scope (academic papers), but real live evidence exists
outside it for the risk-forecast families especially:

1. **`vol-rv-forecast`** — the **Basel VaR traffic-light regime is a standing,
   regulator-audited daily live backtest** across every large bank. Fed FEDS note:
   ~1% design coverage held everywhere except the March-2020 tail `[fetched Fed]`.
   Closest thing to LIVE-X in the entire map.
2. **`credit-default-hazard`** — **40+ years of published live discrimination
   stats**: S&P one-year Gini 82.6% weighted-avg 1981–2023; Moody's EDF-X flags 87% of
   defaulters one month out on a 2004–2020 live sample; Altman Z persists ~80–90%
   accurate 50 years post-publication `[fetched Moody's + S&P/Altman snippets]`. Risk
   *ranking* shows **no McLean-Pontiff decay** — unlike alpha.
3. **`eq-ts-trend`** — **26 years net-of-fee live index** performance (SG Trend CAGR
   4.9%, Sharpe ~0.6; crisis alpha +20.9% in 2008, +27.3% in 2022) plus audited funds
   (AQMIX 4.1%/yr since 2010), with a real but *cyclical* "lost decade" ~1.8%/yr in
   the 2010s `[fetched TTU/BarclayHedge + AQR snippet]`.
4. **`eq-momentum-xs`** — intermediate: MSCI USA Momentum live 10-yr premium ~+2pp/yr,
   MTUM 16.25%/yr — a positive but measurable **live haircut**; AQR's AMOMX *lagged*
   its benchmark. The 73%-Sharpe backtest-to-live haircut (Suhonen et al.) and
   "Smart-Beta Mirage" (post-launch ~0%) are the base rates it beats `[fetched MSCI +
   snippets]`.
5. **`eq-value`** — live Russell Value-vs-Growth spread is **~zero/negative over 46
   years**: here "pre-live" is *accurate, not conservative* `[snippet]`.

## Actionable deltas for the maintainer

1. **Two genuine over-grades.** `crypto-vol` (P3 E2 **R2 I2 T2 B2**, conf C, 2 POOS
   studies) and `reit-vol` (P3 E2 **R2 I3 T2 B2**, conf C, 2 POOS studies) are
   **Supported despite three dimensions at 2** — violating the gate under *any*
   reading. Proof of over-grade: `credit-structured` has the same R/I/T/B profile and
   got only **Promising**; the *only* difference is recorded E (0 vs 2), which the
   protocol says should not gate a risk-forecast verdict. → Re-verdict both to
   Promising, or document an explicit exception. (Note: they are also the *only* two
   Supported families at confidence C — the confidence layer already flags them.)
2. **Four confidence-B definition violations.** B requires "genuine holdout plus
   independent/external evidence," but `eq-aggregate-valuation-macro`, `fx-carry`,
   `fx-technical`, and `reit-returns` cite **no HOLD/EXT/LIVE-P study at all** (only
   IS/POOS), and their family confidence B exceeds the protocol_confidence of every
   study they cite. → Downgrade to C.
3. **Candidate new EXT rows** (all tighten the map): Falck-Rej-Thesmar 2022, Chen-
   Velikov 2023, Chen-Welch 2026. **Do not add** the withdrawn arXiv 2512.11913
   ("18-month half-life") — retracted 2025-12-27; treat as X/preprint-withdrawn.

## Caveats

- Everything here describes **the rating system's behavior**, fit in-sample on the
  same 47 families; it is not out-of-sample validated and predicts **verdicts, not
  returns**.
- Result tags and stages are the maintainer's codings, not re-derived from the
  underlying papers; all statistics inherit that coding. Studies share datasets and
  authors, so Fisher p-values are anti-conservative.
- The target-type carve-out (risk vs alpha vs methodology) was inferred from
  target/label text on 47 families — descriptive of practice, not a validated rule.
- External live numbers embed selection/survivorship (CTA indexes), gross-vs-net gaps
  (MSCI factsheets are partly backtested), and vendor self-reporting (Moody's, S&P);
  none is third-party-audited LIVE-X, so they justify a "live-corroborated"
  annotation, not an automatic verdict upgrade. `[snippet]`-tagged claims were not
  fetched to source and should be treated as leads, not settled facts.

---
*Method: exhaustive threshold-rule search + LOOCV and Fisher-exact tests in stdlib
Python over the two data files; external research via a 10-agent fan-out
(quant analysis + web research, adversarially cross-checked), with all internal
figures independently re-derived from source for this writeup.*
