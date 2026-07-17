# Real-data findings — what can and cannot be predicted

*Fit on real market data, not on the evidence ledger. Sources: Open Source Asset
Pricing (Chen & Zimmermann) — 212 published equity predictors, monthly long-short
returns 1926-01..2024-12, joined to publication years via SignalDoc; Ken French
Data Library — monthly factors 1926-07..2026-05. Every number below was re-derived
from the raw files and adversarially re-checked by independent agents; corrections
they forced are marked ⚠ and are retained deliberately as a record.*

## The headline

**You cannot predict which published strategy will work. You can predict, with a
wide band, how much of its claimed edge will survive — and you can rank.**

That is the whole product. It is a base rate, not a forecast of any market.

## 1. The null result (the most important finding)

Predicting a predictor's **post-publication return from information available at
publication** (in-sample t-stat, in-sample return, sample length, category,
journal, publication year), validated **forward** — train on predictors published
before a cutoff, test on those published after:

| target | honest forward OOS R² | verdict |
|---|---|---|
| post-publication return **level** | **≈ +0.03** (range −0.03..+0.08) | ~nothing |
| post-publication **decay ratio** | **≈ 0.00** | nothing at all |

- The **in-sample t-stat is not a usable screen**: slope +0.33 pp/yr per unit of t,
  se 0.20, **t = 1.65 (n.s.)**, R² = 0.015. A published t of 4 vs 2 buys ~0.65 pp/yr
  of expected post-publication return against a **6 pp/yr residual SD**.
- The t-stat has **zero incremental value** once the in-sample return is known: in
  `post ~ is_ann + tstat`, the t-stat coefficient **flips negative** (−0.07, t=−0.35)
  and adds 0.0006 of R².
- Sample length and publication year carry **no signal** (|r| ≤ 0.12).
- Citations appear to predict — but `GScholarCites202509` is a 2025-vintage count,
  i.e. **strictly lookahead**. Struck from the feature set. ⚠ (caught in review)

**Against the naive baseline, the expert layer does no better.** At n=182 — the only
test with real power — the correlation between a paper's original in-sample t-stat
and realized decay is **ρ = −0.002 (p = 0.98)**. Pure noise. The baseline everyone
reaches for is itself worthless.

## 2. What *does* survive: a level and a rank

**The level.** Through-origin fit on the paper's **own reported** in-sample return
(what a diligence reader actually has):

```
expected post-publication return  ≈  0.34 × reported in-sample return
residual SD ≈ 6.05 pp/yr
```

⚠ Use **~1/3, not ~1/2**. The shrinkage estimated on training cohorts
*systematically overstates* what later cohorts realize, and is still drifting down:
K_train → K_realized was 0.55→0.39, 0.58→0.36, 0.50→0.36, 0.44→0.32 at the
1995/2000/2005/2010 cutoffs. Fitting on OSAP's *replicated* in-sample return gives
K=0.41, but that number is **contaminated** — the replicated series shares
construction DNA (universe, weighting, vendor) with the target, and correlates only
+0.57 with the paper's own reported figure. On paper-reported inputs, K = 0.339.

**The rank.** ⚠ My first pass called this null; adversarial review overturned that,
and the correction reproduces exactly. Ranking by the paper's own reported in-sample
return is **real and forward-validated**:

| pub-year cutoff | n | Spearman | top half | bottom half | spread |
|---|---|---|---|---|---|
| 2000 | 111 | **+0.368** | 5.06 %/yr (7% neg) | 1.09 %/yr (26% neg) | +3.97 pp |
| 2005 | 93 | **+0.371** | 4.96 %/yr (9% neg) | 0.97 %/yr (23% neg) | +3.99 pp |
| 2010 | 41 | +0.253 (n.s.) | 5.13 %/yr (0% neg) | −0.62 %/yr (32% neg) | +5.75 pp |

Low R² **and** significant rank correlation is not a contradiction: the signal is
real but swamped by level/scale noise under a squared-error baseline. You can sort;
you cannot price.

## 3. Base rates for any published predictor (n=182, post-publication)

| outcome | rate |
|---|---|
| still significant, t > 1.96 | **28%** |
| clears Harvey-Liu-Zhu t > 3 | **11%** |
| goes outright **negative** | **15%** |
| mean retention of in-sample return | **~40%** |

Even a strategy published with a **10 %/yr in-sample return has a ~25% chance of a
negative post-publication decade**. These are gross of costs; costs move everything
down.

## 4. McLean-Pontiff: partial replication ⚠ (a claim I had to retract)

I initially reported an "exact match" to MP's 32pp publication effect. **That was an
artifact and is retracted.** It survives only under (a) an undocumented filter and
(b) the fragile mean-of-ratios estimator. Correcting either breaks it:

| statistic | mean-of-ratios (n=182) | **pooled** (n=182) | pooled (n=208) | MP published |
|---|---|---|---|---|
| post-publication decay | 63.1% | **60.3%** | 56.9% | **58%** ✅ |
| out-of-sample decay | 31.1% | **41.8%** | 40.5% | **26%** ❌ |
| publication effect | 32.0pp | **18.5pp** | 16.4pp | **32pp** ❌ |

**Only the post-publication decay leg replicates** (60.3% vs 58%). The OOS leg and
the publication-effect decomposition **do not**. MP estimate by pooled regression,
not by averaging per-predictor ratios — and the per-predictor ratio divides by a
near-zero in-sample mean, producing a −2.40..+12.47 range where 4 predictors move
the headline by 20pp.

⚠ **Sample definition:** n=182 requires two filters I failed to state — SignalDoc
`T-Stat` non-blank (drops 24, *including BM and EP, the two canonical value
anomalies*) and POST ≥ 24 months (drops 2). The stated filter alone gives **n=208**.
The undisclosed filter *raises* measured decay by 1.5pp. Conditioning the sample on
the availability of the t-stat — the very variable used as the baseline — is a real
selection problem.

⚠ **Survivorship runs the opposite way to intuition:** 17 series go stale before the
panel ends; they decay 160%, and excluding them *lowers* decay from 61.6% to 52.8%.
Stale signals inflate decay; they do not hide it.

## 5. The Ken French factors ⚠ (numbers materially revised)

My first-pass French numbers used a **different publication-split convention** than
the OSAP analysis (IS = year<pub, POST = year≥pub, vs IS = original study window,
POST = year>pub) — so the two halves were **not comparable**. Under an
OSAP-consistent convention:

| factor | family | map T | decay (first pass) | **decay (corrected)** | post-pub t |
|---|---|---|---|---|---|
| SMB | eq-size | 1 | 92% | **93.8%** | 0.08 |
| ST_Rev | eq-short-reversal | 3 | 87% | **85.1%** | — |
| LT_Rev | eq-long-reversal | 2 | 79% | **71.9%** | — |
| HML | eq-value | 3 | 47% | **60.4%** | 1.09 |
| Mom | eq-momentum-xs | 3 | 40% | **52.1%** | 1.62 |
| RMW | eq-profitability-quality | 3 | 49% | **37.2%** | 0.93 |

**No classic factor is significant post-publication** — but state it precisely: *no
factor reaches t = 2.0, with RMW at 1.99 in the matched-end-date spec.* A marginally
different window flips it.

⚠ **RMW is not usable for any claim**: its decay ranges **−31.9% to +49.2%** purely
on the split rule and end date. Under all four 2024-end conventions RMW's decay is
**negative** — i.e. profitability got *stronger* after publication.

## 6. What I got wrong about the map's dimensions ⚠

I hypothesized that **implementability (I)** is what separates claims that survive,
based on ST_Rev (T=3 but I=1, decayed 87%). **The real data does not support this.**
Across the six French factors, dimensions track realized decay at ρ = R −0.84,
E −0.83, P −0.82, **I −0.71, T −0.68**, B −0.62 — I does *not* beat T, and R/E/P beat
I. At n=6 with six dimensions tested, the best raw p=0.033 dies under
multiple-comparison correction; the −0.62..−0.84 spread is noise. Two factors
differing on one dimension is an anecdote, not a test.

⚠ Independent review adds that every family-level correlation (n=6–8) **flips sign
with the aggregation choice**, and that my ρ(T, decay) = −0.94 / ρ(T, post-return) =
+1.00 are artifacts of one convention among many.

**And the deeper point:** the map was authored 2026-07-14; the data ends 2026-05.
**The genuinely out-of-sample subset is empty.** The raters knew these realized
returns. No correlation between their scores and realized decay can validate
forecasting power — it is hindsight calibration at best.

## 7. The verdict formula, corrected

Predicting the map's **own verdicts** from its scores (an internal-coherence
question, unrelated to markets):

- **`I ≥ 3` is the single load-bearing gate.** Banning I from the search costs
  accuracy; banning **P, E, R, T, or B individually costs exactly zero**. The
  protocol's written gate ("P,E,R,T,B ≥ 3") **omits I entirely** — the one dimension
  that actually decides.
- The winner `min(P,I) ≥ 3 [waive P for methodology]` scores **46/47 = 97.9%**,
  permutation **p < 0.0001** (best-of-search null on shuffled labels: mean 78.0%,
  max ~42–43/47, seed-dependent). ⚠ But **P is not identified** — 6 rule spellings
  collapse to one prediction vector, and banning P costs nothing.
- ⚠ **46/47 is the provable Bayes ceiling, not a residual failure.** `crypto-vol`
  (P3 E2 R2 T2 I2 B2, conf C) has a **bit-identical scorecard** to `eq-ml-xs` and
  `credit-spread-value`, both rated *Promising*. No score-based rule can ever
  separate them. **crypto-vol is a labeling contradiction in the data**, not a model
  error — an actionable bug for the maintainer.
- ⚠ **Fable 5's `min(R,T,B) ≥ 3` scores 44/47 = 93.6%, not the claimed 45/47 =
  95.7%** (errors: eq-short-reversal, crypto-vol, reit-vol). Its stated carve-outs
  ("E waived for risk, P for methodology") are **logical no-ops** — `min(R,T,B)`
  contains neither E nor P. The 45/47 is unreproducible under any reading of its own
  rule. Consequently **`reit-vol` is NOT an over-grade** (I=3 clears the real gate);
  only crypto-vol is anomalous, and for a different reason than Fable 5 gave.

⚠ **Framing caveat that must travel with this result:** scores and verdict live in
the same record, assigned by the same raters in the same rubric pass. Predicting one
from the other is a **self-consistency check on a rubric**; a label shuffle destroys
that coherence, so the null is near-strawman and any coherent rubric beats it. This
validates that the map is internally consistent and that its hidden gate is I. It
says **nothing** about whether I ≥ 3 predicts market returns.

## What this means for the diligence product

1. **Ship the base rate, not a prediction.** `diligence_prior.py`: reported
   in-sample return → expected post-publication return (×0.33), a ±6pp/yr band,
   P(negative), and the bucket's historical realization.
2. **The screen is a sort, not a score.** Rank by the paper's own reported in-sample
   return; top half realized ~5%/yr vs ~1%/yr, 8% vs 25% negative. Don't pretend to
   a point estimate.
3. **Refuse the t-stat screen.** It is the industry's instinct and it is worthless
   here (ρ = −0.002 with decay; zero incremental R² over the return).
4. **The honest sales line is the null.** ~28% of published predictors stay
   significant, 15% go negative, ~1/3 of the edge survives — and *nobody, including
   this model, can tell you in advance which*. That is a defensible, falsifiable,
   real-data claim. A tool that claimed more would be claiming exactly what this
   literature spent 30 years disproving.

---
*Method note: 8-agent adversarial fan-out (4 analysts, each independently
re-verified). The verifiers overturned my "exact MP match", my French decay figures,
my "I is load-bearing on real data" hypothesis, and my "rank is null" call — all
corrections are folded in above and marked ⚠. Every surviving number was re-derived
by the orchestrator from the raw files.*
