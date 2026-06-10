# Cross-Market Correlation Deep Dive

**Generated:** 2026-06-10 · **Code:** `scripts/deep_dive_correlations.py` (runnable end-to-end; every
number below is printed by that script) · **Machine-readable results:** `data/deep_dive_results.json`
· **Master table:** `data/deep_dive_master.csv` · **Charts:** `reference/deep-dive-charts/`

This is the full statistical audit of every cross-market dataset the platform has assembled —
return histories, rents, yields, incomes, hazard, migration, lending, permits, flood claims,
insurance, and crime — to determine which relationships are real, strong, and stable enough to
matter for deal scoring. The existing analysis (`scripts/crime_correlations.py`) only correlated
crime against return metrics; this covers the whole field, with false-discovery control, confound
controls, and true out-of-sample backtests.

---

## 1. Data and methodology

**Master cross-section** (`data/deep_dive_master.csv`): 20,215 markets — 893 metros, 2,538
counties, 16,784 cities — each with the product's return metrics computed from
`netlify/functions/lib/metros.json` (quarterly total-return series since 2000: ZHVI price change
+ a flat 1%/quarter income proxy):

| metric | definition |
|---|---|
| `mu_ann` | annualized mean total return, full history |
| `sigma_ann` | annualized volatility |
| `sharpe_like` | mu/sigma |
| `growth_5y` | annualized return, last 20 quarters |
| `max_drawdown` | worst peak-to-trough of the cumulative series (negative number) |

Joined to: all 24 `public/market-context.json` fields (coverage varies: yield 5,687 markets,
county-level fields ≈2,487), FBI 2025 crime rates (10,622 markets joined; MSA-key/agency
name-collision joins excluded as geographically wrong), BEA county population (2024), and derived
per-capita fields (`netMigRate`, `netAGIperCap`, `inAGIRatio` = in-migrant household AGI ÷
resident per-capita income, `claimsPer1k`).

**Backtests** use raw *price* levels (`data/zillow_zhvi_*_raw.csv`, monthly 2000-01..2026-04;
894 metros / 3,072 counties / 21,419 cities), ZORI rent levels (2015+), BEA CAINC1 per-capita
income and population 1969–2024 by county FIPS, and Census BPS county permits 2020–2025. The flat
1%/q proxy is deliberately excluded there.

**Statistics.** Pearson r computed on 1/99-winsorized values (as in the published methodology);
Spearman ρ on raw values; exact p-values (scipy); minimum n = 100 per pair. Multiple comparisons:
Benjamini-Hochberg FDR at 0.05 across **all** computed pairs. Confound control: **partial
correlations after removing state fixed effects (within-state demeaning) and log10(population)**
— both as plain partial-r and as partial rank-r (Spearman analogue). Backtest effect sizes are
reported as **top-vs-bottom signal-quintile spreads in forward outcome units (%/yr)**, which is
the number that actually matters for a deal score.

**Known biases, stated up front**

- *Survivorship*: the return engine excluded markets with <40 quarters of ZHVI history, and
  Zillow's current files only contain regions it still publishes. Backtest vintages additionally
  require data at both endpoints — the 2005 momentum vintage covers only 413 metros vs 854 for
  2020. Early-vintage results lean toward larger, longer-lived markets.
- *Income proxy*: the engine's `mu_ann` credits every market the same 4.06%/yr income, so
  cross-market spreads in `mu_ann` are purely price-appreciation spreads. This materially distorts
  yield-related findings (§3.1).
- *Backward-looking outcomes*: every Stage-2 cross-sectional correlation relates **today's**
  context fields to **past** returns. Several context fields (priceToIncome, listVsZhvi,
  daysToPending) are partly *consequences* of past returns. Only the Stage-3 backtests are
  genuinely predictive.

---

## 2. Cross-sectional mining (Stage 2)

391 variable pairs computed; **293 pass BH-FDR(0.05)** on Spearman p. With n in the thousands,
significance is nearly free — r = 0.05 "passes" and is worthless. The bar used below is effect
size that survives controls.

### 2.1 Confound map (predictor × predictor) — read this first

| pair | r | ρ | n | implication |
|---|---|---|---|---|
| pop_log × nriScore | **+0.852** | **+0.856** | 2,444 | FEMA NRI *score* is essentially population/exposure in disguise |
| netMigRate × netAGIperCap | +0.752 | +0.796 | 2,372 | the two migration fields are one signal |
| v × p (violent × property crime) | +0.651 | +0.705 | 10,622 | one crime dimension, not two |
| priceToIncome × rent_log | +0.673 | +0.688 | 1,035 | PTI ≈ "expensive market" |
| netAGIperCap × inAGIRatio | +0.685 | +0.676 | 2,371 | |
| listVsZhvi × denialRate | +0.583 | +0.583 | 2,269 | credit-tightness/cheap-market cluster |
| grossYield × priceToIncome | −0.555 | −0.546 | 1,035 | yield is the inverse of valuation |
| pop_log × sfShare | −0.372 | −0.474 | 2,224 | |

### 2.2 Strongest return-metric correlations (raw, pooled)

Top pairs by |ρ| (all FDR-pass; full list in `data/deep_dive_results.json → pairwise`):

| pair | r | ρ | r² | n |
|---|---|---|---|---|
| rent_log × sigma_ann | +0.392 | +0.443 | 0.153 | 5,687 |
| rent_log × max_drawdown | −0.312 | −0.420 | 0.097 | 5,687 |
| rent_log × mu_ann | +0.395 | +0.411 | 0.156 | 5,687 |
| denialRate × sharpe_like | −0.412 | −0.361 | 0.170 | 2,508 |
| grossYield × mu_ann | −0.333 | −0.357 | 0.111 | 5,687 |
| priceToIncome × mu_ann | +0.331 | +0.316 | 0.110 | 2,509 |
| listVsZhvi × sharpe_like | −0.365 | −0.310 | 0.133 | 3,408 |
| denialRate × growth_5y | −0.437 | −0.307 | 0.191 | 2,508 |
| listVsZhvi × growth_5y | −0.384 | −0.280 | 0.148 | 3,408 |
| priceToIncome × growth_5y | +0.265 | +0.245 | 0.070 | 2,509 |
| permitsPer1k × growth_5y | +0.197 | +0.233 | 0.039 | 2,416 |
| daysToPending × growth_5y | −0.303 | −0.233 | 0.092 | 888 |
| nonRenewalRate × sigma_ann | +0.229 | +0.242 | 0.053 | 2,493 |
| nriScore × sigma_ann | −0.168 | −0.187 | 0.028 | 2,487 |

Even the strongest context→return relationship explains ≤ ~19% of variance (denialRate ×
growth_5y, r² = 0.191); most explain < 10%.

### 2.3 Partial correlations (state fixed effects + log population)

The decisive table. "partial rank-r" is the Spearman analogue after removing state means and log
population from both variables. Selected rows (full table in results JSON → `partials`):

| predictor | outcome | raw ρ | partial r | partial rank-r | n | FDR |
|---|---|---|---|---|---|---|
| priceToIncome | growth_5y | +0.245 | **+0.346** | **+0.340** | 2,447 | pass |
| priceToIncome | mu_ann | +0.316 | +0.327 | +0.336 | 2,447 | pass |
| grossYield | sharpe_like | −0.022 | −0.307 | −0.241 | 4,068 | pass |
| netAGIperCap | mu_ann | +0.208 | +0.187 | +0.218 | 2,366 | pass |
| listVsZhvi | sharpe_like | −0.310 | −0.300 | −0.217 | 2,455 | pass |
| permitsPer1k | sharpe_like | +0.244 | +0.117 | +0.216 | 2,408 | pass |
| inAGIRatio | mu_ann | +0.149 | +0.193 | +0.208 | 2,365 | pass |
| listVsZhvi | growth_5y | −0.280 | −0.318 | −0.204 | 2,455 | pass |
| denialRate | sharpe_like | −0.361 | −0.261 | −0.180 | 2,477 | pass |
| netMigRate | mu_ann | +0.120 | +0.169 | +0.176 | 2,366 | pass |
| grossYield | mu_ann | −0.357 | −0.162 | −0.140 | 4,068 | pass |
| denialRate | growth_5y | −0.307 | −0.269 | −0.130 | 2,477 | pass |
| **v (violent crime)** | **growth_5y** | **−0.145** | **−0.073** | **−0.032** | 10,602 | pass |
| v | sharpe_like | −0.059 | −0.127 | −0.081 | 10,602 | pass |
| nriScore | sigma_ann | −0.187 | +0.024 | **+0.153 (sign flip)** | 2,438 | FAIL |
| nonRenewalRate | sigma_ann | +0.242 | +0.059 | +0.107 | 2,463 | pass |
| rent_log | sigma_ann | +0.443 | −0.010 | +0.034 | 4,068 | FAIL |
| claimsPer1k | mu_ann | −0.156 | −0.019 | −0.077 | 2,473 | FAIL |
| sfShare / invYoY / permitsVs5y / incomeGrowth5y × (anything) | | <0.20 | ≈0 | <0.08 | | mostly FAIL |

**What controls kill:** rent-level × volatility/drawdown (a coastal-state effect), insurance
non-renewal × volatility (FL/CA/LA composition), NRI × everything (population), flood claims,
single-family share, inventory YoY, permits-vs-own-norm, income growth. **What survives:**
valuation (priceToIncome, listVsZhvi), yield (with a sign caveat, §3.1), mortgage denial rate,
migration quality (netAGIperCap, inAGIRatio), permits per 1k.

### 2.4 Segment stability (msa / county / city Spearman)

The survivors are sign-stable across segments; e.g. grossYield × mu_ann: −0.467 (703 metros),
−0.385 (1,075 counties), −0.327 (3,909 cities). rentYoY × growth_5y: +0.180 / +0.219 / +0.159.
listVsZhvi × growth_5y: −0.249 / −0.266 / −0.509 (city n = 209). Crime × growth_5y: −0.097
(2,254 counties) vs −0.156 (8,368 cities) raw — both die under state FE (§5).

---

## 3. Predictive backtests (Stage 3) — the real value

### 3.1 Gross yield as a predictor — **the best actionable signal**

Historical yield vintages (ZORI×12/ZHVI at the vintage date) vs forward 3-year **price** growth
and forward 3-year rent growth:

| level | vintage | ρ (fwd price) | Q5−Q1 price spread | ρ (fwd rent) | Q5−Q1 rent | n |
|---|---|---|---|---|---|---|
| msa | 2016 | −0.224 | −1.76%/yr | −0.391 | −2.08%/yr | 230 |
| msa | 2018 | +0.019 | −0.10%/yr | −0.107 | −0.52%/yr | 279 |
| msa | 2020 | −0.001 | −0.20%/yr | +0.046 | +0.19%/yr | 296 |
| msa | 2022 | +0.328 | +2.50%/yr | +0.178 | +1.20%/yr | 362 |
| county | 2016 | +0.026 | +0.32%/yr | −0.175 | −0.91%/yr | 425 |
| county | 2018 | +0.239 | +1.50%/yr | +0.115 | +0.89%/yr | 519 |
| county | 2020 | +0.185 | +2.12%/yr | +0.191 | +1.46%/yr | 553 |
| county | 2022 | +0.360 | +2.89%/yr | +0.194 | +1.21%/yr | 643 |
| city | 2016 | +0.202 | +1.98%/yr | −0.073 | −0.39%/yr | 698 |
| city | 2018 | +0.357 | +2.78%/yr | +0.280 | +1.91%/yr | 951 |
| city | 2020 | +0.297 | +2.61%/yr | +0.342 | +2.91%/yr | 1,080 |
| city | 2022 | +0.312 | +1.96%/yr | +0.245 | +1.30%/yr | 1,498 |

Within-state robustness (state-demeaned ranks, city level): **+0.502 (n=658, 2016), +0.546
(n=907, 2018), +0.230 (n=1,041, 2020), +0.055 (n=1,466, 2022)**. The signal is *strongest* within
state pre-COVID — it is not a sunbelt bet — and weakest in the 2022 vintage, where most of the raw
+0.31 was cross-state composition.

High-yield cities/counties beat low-yield by ≈ **+2 to +3%/yr in price growth alone** over the
following 3 years — and that is before the carry: the Q5 yield median is 7.98% gross vs 3.78% for
Q1 (+4.2%/yr gross carry difference). Buying high-yield markets worked on both legs in this
sample. Caveats: ZORI starts 2015, so this spans only one macro cycle (2016–2025); ZORI coverage
skews to larger rental markets (n = 698–1,498 cities of 21k); the metro level is noisier (2016
metro vintage was −0.224, the one negative).

**Product bug this exposes:** in the engine, `grossYield × mu_ann = −0.357` — high-yield markets
look like *worse* long-run performers, because the flat 1%/quarter proxy denies them their carry.
From the master table: yield-Q5 markets have engine mu_ann 7.69%/yr vs 8.81%/yr for Q1 (−1.12%/yr
price-side deficit), but their gross carry advantage is +4.20%/yr — even with a 50% expense
haircut, true total return ranks *invert* the engine's. Markets are mis-ranked today.

### 3.2 Valuation (price-to-income) as a crash predictor — works in credit booms only

County ZHVI ÷ BEA per-capita income (prior year), vs forward outcomes. "Stretch" = PTI vs the
county's own 2000–02 average:

| vintage | outcome | raw PTI ρ | stretch ρ | Q5−Q1 (stretch) | n |
|---|---|---|---|---|---|
| 2005 | fwd 5y growth | −0.315 | −0.322 | −3.06%/yr | 1,182 |
| **2007** | **fwd 5y growth** | **−0.592** | −0.512 | −5.73%/yr | 1,289 |
| **2007** | **max DD 2007-12** | **−0.576** | −0.509 | **−19.85 pts of drawdown** | 1,296 |
| 2012 | fwd 5y growth | +0.061 | −0.220 | −2.22%/yr | 2,338 |
| 2016 | fwd 5y growth | +0.112 | +0.030 | +0.15%/yr | 2,506 |
| 2019 | fwd 5y growth | +0.189 | +0.108 | +0.23%/yr | 2,934 |
| 2021 | fwd 4y growth | +0.163 | +0.108 | +0.66%/yr | 2,957 |

2007 stretch-Q5 counties drew down ~20 points more than Q1 through the GFC, and the relationship
holds within state (PTI-2007 → GFC drawdown, state-demeaned rank-r = **−0.301**, n = 1,280 — not
just Florida/Arizona/Nevada). But from 2012 on, high PTI predicted mildly *positive* relative
returns. PTI is a **conditional tail-risk signal** (it matters when credit is loose and valuations
are extended nationally), not an unconditional return predictor. Note the contrast with Stage 2's
priceToIncome × growth_5y partial of **+0.340**: cross-sectionally, expensive markets *kept
outperforming* in the 2010s–20s regime — the two findings together say "stretch ≠ short, but
stretch = fragility in a credit event."

### 3.3 Momentum / mean reversion — era-dependent, no stable law

Past 5y growth vs next 5y growth:

| vintage (prior→fwd) | msa ρ (n) | county ρ (n) | city ρ (n) | county Q5−Q1 fwd |
|---|---|---|---|---|
| 2005 (00-05 → 05-10) | −0.288 (413) | −0.254 (996) | −0.359 (8,628) | −2.91%/yr |
| 2010 (05-10 → 10-15) | −0.279 (493) | −0.205 (1,205) | −0.272 (10,286) | −1.81%/yr |
| 2015 (10-15 → 15-20) | +0.133 (765) | +0.157 (2,015) | +0.166 (13,844) | +0.76%/yr |
| 2020 (15-20 → 20-25) | +0.317 (854) | +0.293 (2,521) | +0.165 (16,505) | +2.47%/yr |

GFC window: 2000–06H1 boom growth vs 06H1–12H1 outcome: ρ = −0.512 (msa, n=426), −0.452 (county,
n=1,020), −0.556 (city, n=8,658); boom growth vs GFC drawdown ρ ≈ −0.47 to −0.55. **But** within
state the GFC reversal shrinks to −0.096 (n=996 counties) — the great reversal was mostly a
cross-state sand-state phenomenon. The modern momentum (2020 vintage) does hold within state:
+0.173 (n=2,514). Verdict: the sign flips with the macro regime; momentum is **not shippable as a
scoring rule**, only as an honest Correlations-tab exhibit.

### 3.4 Volatility persists; crash history does not

| level | vol(2001-12) vs vol(2013-25) ρ (n) | GFC DD vs 2022-25 DD ρ (n) |
|---|---|---|
| msa | +0.413 (544) | +0.159 (842) |
| county | +0.249 (1,316) | **+0.000 (2,427)** |
| city | +0.385 (10,808) | +0.101 (15,709) |

Historical volatility is a legitimate forward risk proxy (ρ ≈ +0.25–0.41 across a 12-year wall) —
this *validates* using `sigma_ann` in the Deal Score. A market's GFC drawdown tells you nothing
about its 2022–25 drawdown (county ρ = 0.000) — "this market crashed badly in 2008" should never
be used as a risk flag.

### 3.5 Supply: heavy permitting → weak forward **rent** growth

Permits per 1k residents (BPS 2020+2021 avg, BEA 2021 pop) vs 2022-01→2026-01 outcomes, counties:

- vs forward **price** growth: ρ = +0.107 (n = 2,892), Q5−Q1 +1.83%/yr — supply is swamped by the
  demand boom in prices.
- vs forward **rent** growth: **ρ = −0.505 (n = 626), Q5−Q1 = −2.45%/yr**; within state
  **−0.327** (n = 592). High-permit counties saw rents grow ~2.5%/yr slower over the next four
  years.

This is the textbook supply-elasticity result and it survives the state control. Caveats: one
vintage (2020-21), one macro episode (the post-COVID rent spike and cooldown), and the n=626
counties with ZORI coverage skew urban. Strong enough for a context-card insight; not yet for a
score weight.

---

## 4. Replication of published crime findings (Stage 4)

Re-derived independently (winsorized-crime Pearson, published methodology) vs
`public/crime-correlations.json` "all" segment. Join: 10,622 markets (we exclude MSA-key joins
where an agency merely shares the metro's name; published used 10,801):

| metric | mine r | published r | verdict |
|---|---|---|---|
| v × mu_ann | −0.056 | −0.065 | OK |
| v × sigma_ann | +0.107 | +0.095 | OK |
| v × sharpe_like | −0.110 | −0.106 | OK |
| v × growth_5y | −0.146 | −0.139 | OK |
| v × max_drawdown | −0.154 | −0.147 | OK |
| v × pop_log | +0.261 | +0.287 | OK |
| v × grossYield | +0.156 | +0.172 | OK |
| v × priceToIncome | +0.078 | +0.071 | OK |
| v × nriScore | +0.239 | +0.239 | OK |
| v × rentYoY | −0.024 | −0.012 | OK |
| v × incomeGrowth5y | −0.039 | −0.041 | OK |

**Every published number replicates** (max |Δr| = 0.026, attributable to the join difference).
The arithmetic is right. The *interpretation* needs a correction:

> **v × growth_5y decomposition (rank-r, n = 10,602):** raw = −0.145 → with state fixed effects
> only = **−0.031** → with log-pop only = −0.136 → both = −0.032.

The headline "high-crime markets grew slower" is ~80% a **state-composition artifact** (which
states have high reported crime vs which states boomed in 2020–25), not a within-state,
crime-causes-weak-appreciation effect. Population, notably, is *not* the confound — state is.
Similarly, the published v × nriScore +0.24 mostly reflects nriScore × pop_log = +0.85; and
v × grossYield (+0.156) is the yield↔cheap-market↔crime triangle, which *does* persist modestly.
Nothing published is wrong; the causal-sounding framing is.

---

## 5. Synthesis — what's real, ranked

Criteria: effect size after state+population partialling, FDR survival, sign stability across
segments, and (where testable) out-of-sample predictive performance.

| # | relationship | strength (best honest number) | real? | actionable for the product? | caveats |
|---|---|---|---|---|---|
| 1 | **Gross yield → forward 3y price growth** (+ carry on top) | positive in all 8 county/city vintages (ρ +0.03…+0.36, ≥ +0.19 in 7 of 8); within-state +0.06…+0.55; Q5−Q1 ≈ +2-3%/yr | **yes — best in class** | **Deal Score adjustment** (yield percentile, ideally within-state); fix the flat income proxy | one macro cycle (2015-25); metro level noisy; 2022 vintage mostly cross-state |
| 2 | **PTI stretch → crash severity in credit booms** | 2007: ρ −0.58 vs GFC drawdown, −19.9 pts Q5−Q1, within-state −0.30 | yes, **regime-conditional** | risk flag / context card ("valuation stretch"), NOT a return predictor | sign was mildly *positive* 2012-21; fires rarely |
| 3 | **Volatility persistence** | ρ +0.25…+0.41 over a 12-yr wall, n up to 10,808 | yes | validates `sigma_ann` in Deal Score as-is | drawdown *history* does not persist (county ρ 0.000) |
| 4 | **Permits per 1k → weak forward rent growth** | ρ −0.505 (n=626), within-state −0.33, −2.45%/yr Q5−Q1 | yes (one era) | context-card insight on rent outlook; pairs with `permitsPer1k` already shipped | single vintage; urban-skewed ZORI sample; price effect ≈ 0 |
| 5 | **Mortgage denial rate ↔ weak market** | raw ρ −0.36 (sharpe), partial −0.18, n=2,477 | yes, modest | context card copy; weak score input | partly mechanical (denials high where prices stagnant); not backtested |
| 6 | **listVsZhvi / daysToPending ↔ recent weakness** | partial −0.20…−0.22 | yes, but **lagging** | already-shipped context fields; descriptive only | consequences of weakness, not predictors |
| 7 | **Migration quality (netAGIperCap, inAGIRatio) ↔ returns** | partial rank-r +0.21 / +0.21 (mu_ann), n≈2,366 | yes, modest | context card ("wealth-attracting market") | vs backward returns; circularity (people chase winners) |
| 8 | **Cross-market momentum** | −0.36…+0.32 depending on era | sign unstable | Correlations-tab exhibit only | flips at regime breaks — exactly when it matters |
| 9 | priceToIncome × recent growth (cross-sec) | partial +0.34 | statistically yes | do **not** ship as "expensive = good" | reverse causation; contradicts #2 in crash regimes |

### Popular hypotheses that FAILED in this data

- **"High crime → weak appreciation"** — raw −0.145 collapses to **−0.032** under state fixed
  effects (n = 10,602). It's mostly geography-of-states, not crime.
- **"FEMA hazard risk hurts returns / raises volatility"** — nriScore is ρ +0.856 with
  population; its partials are small and **sign-flip** (σ: −0.187 raw → +0.153 partial, FDR
  fail). No usable signal in the NRI *score*; use rating/hazard composition descriptively only.
- **"Flood claims history predicts returns"** — claimsPer1k, claimsTrend: all partials |r| < 0.10,
  most FDR-fail.
- **"Insurance non-renewal rate marks risky markets"** — raw σ-correlation +0.24 shrinks to +0.06
  (Pearson partial; +0.11 rank) — it's mostly an FL/CA/LA state effect.
- **"GFC crash history marks fragile markets"** — GFC drawdown vs 2022-25 drawdown: ρ **0.000**
  at county level.
- **"Investor share marks froth"** — investorShare × growth_5y partial +0.086; nothing.
- **inventory YoY, permitsVs5y, sfShare, incomeGrowth5y** — nothing survives controls (all
  partial |r| ≤ 0.13, most FDR-fail).

---

## 6. What to ship

1. **Fix the income proxy (highest impact).** Replace the flat 1%/quarter with a market-level
   carry estimate where ZORI exists (e.g. 60% × grossYield, expense-adjusted), falling back to 1%
   where it doesn't. Today high-yield markets are *penalized* in `mu_ann` (−1.12%/yr price-side)
   when their true total return advantage is positive. This silently mis-ranks every yield-driven
   deal the tool scores.
2. **Add a "yield edge" Deal Score adjustment.** The only signal that predicted forward returns
   in the right direction in 8 of 9 county/city vintages, within state. Score the market's gross
   yield as a within-state percentile; reward Q4-Q5, modestly. Show the backtest (Q5−Q1 ≈
   +2-3%/yr price growth, 2016-25) as the receipts.
3. **Add a "valuation stretch" risk flag, regime-framed.** When a market's PTI is far above its
   own long-run norm AND national credit/valuation conditions are extended, show the 2007 numbers
   (ρ −0.58 with GFC drawdown; stretched-quintile counties fell ~20 pts further). Frame as tail
   risk, not expected return.
4. **Correct the Correlations tab on crime.** Keep the scatter (it replicates), add the
   decomposition: "within a state, the crime-growth link nearly disappears (rank-r −0.03);
   the raw −0.14 is mostly which *states* boomed." This is more credible and more interesting
   than the current framing. Drop or de-emphasize NRI-score correlations (population artifact).
5. **Permits → rent outlook on the context card.** Counties permitting in the top quintile
   (per 1k) saw rents grow ~2.5%/yr slower over 2022-26 (ρ −0.51, within-state −0.33). Phrase as
   rent-growth headwind for high-`permitsPer1k` markets; price impact was ≈ nil.
6. **Keep `sigma_ann` weighting; kill any GFC-history framing.** Volatility persists (ρ up to
   +0.41); 2008 drawdowns don't (ρ 0.00).

### Reproduction

```
.venv/bin/python scripts/deep_dive_correlations.py
```
(~3 min; needs the raw CSVs in the main checkout's `data/`; writes
`data/deep_dive_master.csv`, `data/deep_dive_results.json`, `reference/deep-dive-charts/*.png`,
and prints every number in this report.)

### Charts

- `deep-dive-charts/yield2018_fwd_city.png` — yield vintage 2018 vs forward 3y growth, cities
- `deep-dive-charts/pti2007_vs_dd.png` — PTI Jan-2007 vs GFC drawdown, counties (ρ −0.58)
- `deep-dive-charts/momentum_counties.png` — 2015-20 vs 2020-25 growth, counties
- `deep-dive-charts/gfc_boom_vs_dd.png` — boom growth vs GFC drawdown, counties
- `deep-dive-charts/yield_vs_mu.png` — the engine-bias exhibit (yield vs engine mu_ann)
- `deep-dive-charts/pop_vs_vol.png` — size vs volatility
