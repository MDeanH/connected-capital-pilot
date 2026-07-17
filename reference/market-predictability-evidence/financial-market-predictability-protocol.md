# Financial-Market Predictability Evidence Review: Protocol

Cutoff date: **2026-07-14**

## Status and claim

This is a protocol-documented, PRISMA-inspired public-web evidence map, not a
registered systematic review or a literal census of the internet. It was
compiled in a single pass by one reviewer (an AI agent with web access): there
was no dual screening, no inter-rater reconciliation, and no dated
registration of this protocol before the results existed, so "prespecified"
below means "fixed within the compilation pass," not externally preregistered.
The search strategy is documented so a third party can approximate the
process, but not every executed query string was recorded, so re-execution
reproduces the approach rather than the exact record set. Literal
exhaustiveness is impossible because indexing changes, proprietary research is
not observable, some full texts are paywalled, and web engines cap or reorder
results. The defensible claim is:

> A broad, cutoff-dated map of publicly discoverable evidence on financial-
> market predictability, searched across prespecified markets, forecast targets,
> horizons, information families, methods, and evidence-quality dimensions.

The review prioritizes evidence quality over paper count. It preserves null and
negative findings and does not treat ten papers sharing the same data and code
as ten independent replications.

## Research question and unit of evidence

The question is whether information available at a real forecast origin
predicts a prespecified financial target better than a relevant benchmark, and
whether that improvement remains useful after realistic implementation costs.

The unit of extraction is a scoped study claim:

`market × instrument × geography × target × horizon × predictor × method × benchmark × evaluation period × implementation`

One paper can therefore support several rows when its claims materially differ.
Conversely, working-paper and published versions of the same claim are merged
into one versioned record.

Predictability is not automatically:

- market inefficiency;
- abnormal return after risk adjustment;
- a profitable trading strategy;
- scalable alpha;
- evidence that one model class is universally superior.

## Prespecified scope

### Markets

- Equities: aggregate markets, sectors, portfolios, individual stocks, listed
  real estate, developed, emerging, and frontier markets.
- Government rates and fixed income: policy rates, money markets, sovereign
  yields, curves, term premia, bond returns, swaps, and rate derivatives.
- Credit: corporate and sovereign bonds, CDS, loans, structured credit,
  default, recovery, spread, and return targets.
- Foreign exchange: spot, forwards, NDFs, futures, options, and carry-inclusive
  returns.
- Commodities: spot and futures, storable and non-storable contracts, curve,
  inventory, carry, momentum, and seasonal information.
- Derivatives and volatility: implied and realized volatility, option returns,
  variance and tail-risk premia, densities, and option-implied signals.
- Crypto and digital assets: spot, perpetuals, futures, options, on-chain
  variables, stablecoins, venues, and market microstructure.
- Boundary evidence: private equity, private real estate, hedge funds, and
  other illiquid assets. These are reported separately because appraisal/NAV
  smoothing and sparse transactions make their apparent predictability
  noncomparable with executable public-market returns.

### Targets

- total, excess, abnormal, and risk-adjusted returns;
- direction, rank, threshold, and quantile outcomes;
- price, yield, curve, spread, carry, and basis;
- volatility, variance, covariance, correlation, and beta;
- liquidity, order flow, depth, impact, and execution probability;
- jumps, drawdowns, defaults, depegs, and tail risk;
- full conditional distributions and decision or portfolio outcomes.

### Horizons

- H0: event or sub-second;
- H1: intraday;
- H2: overnight or one session;
- H3: more than one day through one month;
- H4: more than one month through one year;
- H5: more than one through five years;
- H6: more than five years.

Formation window, forecast frequency, holding period, rebalance frequency,
instrument maturity, and overlap are stored separately. Sampling frequency is
not treated as forecast horizon.

### Information and method families

Information families:

- valuation and macroeconomic variables;
- fundamentals, accounting, and cash flows;
- characteristics and factors;
- momentum, reversal, trend, seasonality, and technical rules;
- carry, basis, curve, inventory, and hedging pressure;
- microstructure, order flow, positioning, and flows;
- options and implied information;
- events;
- news, filings, calls, sentiment, and attention;
- alternative and proprietary data;
- on-chain and tokenomics variables;
- cross-asset signals.

Model families are coded on a separate axis:

- historical mean, random walk, and no-change benchmarks;
- predictive regressions, ARIMA, VAR, factor, state-space, term-structure,
  volatility, regime-switching, Bayesian, shrinkage, and forecast combinations;
- trees, boosting, kernels, neural networks, transformers, foundation models,
  graph models, NLP/LLM pipelines, and reinforcement learning.

## Sources searched

Core public discovery and metadata:

- OpenAlex;
- Crossref;
- Semantic Scholar;
- RePEc/IDEAS;
- SSRN;
- NBER and CEPR;
- arXiv, IEEE, ACM, and DBLP for computational work;
- publisher and journal landing pages;
- Google Scholar-style web discovery for citation chaining.

Institutional repositories:

- BIS, IMF, World Bank, OFR;
- Federal Reserve Board and regional Federal Reserve Banks;
- ECB, Bank of England, Reserve Bank of Australia, and other central banks.

Transparent practitioner evidence was searched and tagged separately:

- Financial Analysts Journal and Journal of Portfolio Management;
- CFA Institute;
- AQR, Man AHL, Robeco, Research Affiliates, MSCI, and S&P DJI.

Practitioner studies can support implementation or live-execution claims only
when data period, benchmark, strategy construction, costs, and conflicts are
disclosed. Marketing backtests are not affirmative evidence.

Subscription-only Scopus, Web of Science, and EconLit bulk exports were not
available in this environment. Their publisher-indexed records, DOI metadata,
public preprints, and citation graphs were searched where publicly accessible.
This is a known coverage limitation, not silently treated as full database
access.

## Search design

### Master query

```text
(predict* OR forecast* OR "out-of-sample" OR "return predictability"
 OR "market timing")
AND
(equit* OR stock* OR bond* OR yield* OR "interest rate*" OR credit
 OR currenc* OR "exchange rate*" OR commodit* OR futures OR option*
 OR volatil* OR crypto* OR REIT* OR "limit order book")
AND
(return* OR premium OR price* OR direction* OR volatil* OR liquidity
 OR "tail risk" OR spread* OR default*)
```

No OOS term was required in the first high-recall pass because that would
exclude foundational evidence. OOS, real-time, costs, replication, and
post-publication terms were used in targeted quality passes.

### Reusable query blocks

```text
RETURN = ("return predictab*" OR "expected return*" OR "excess return*"
          OR "risk prem*" OR "market timing" OR "return forecast*")
RISK   = ("volatility forecast*" OR "variance forecast*" OR "tail risk"
          OR drawdown OR "value at risk" OR "expected shortfall" OR density)
MICRO  = ("order flow" OR "order book" OR imbalance OR liquidity
          OR "price impact" OR spread OR depth)
DESIGN = ("out-of-sample" OR "pseudo out-of-sample" OR "real time"
          OR backtest* OR "walk-forward" OR "rolling window")
IMPL   = ("transaction cost*" OR slippage OR turnover OR capacity
          OR profitability OR Sharpe OR drawdown)
REVIEW = (survey OR review OR "meta-analysis"
          OR "systematic literature review")
```

Each market block was crossed with return, risk, microstructure, and review
passes. Supplementary passes crossed every market with each information and
model family listed above.

### OpenAlex coverage audit

The following broad OpenAlex search counts were recorded on 2026-07-14 with a
publication-date filter ending on the cutoff. Counts are discovery diagnostics,
not eligible-study denominators:

- Equities — returns 18,901; risk 11,553; microstructure 8,114; reviews 3,214.
- Rates — returns 3,533; risk 2,070; microstructure 1,432; reviews 622.
- Credit — returns 2,807; risk 2,153; microstructure 2,071; reviews 299.
- FX — returns 8,881; risk 4,914; microstructure 3,612; reviews 1,750.
- Commodities — returns 4,777; risk 3,661; microstructure 1,368; reviews 922.
- Derivatives — returns 4,792; risk 4,769; microstructure 2,141; reviews 515.
- Crypto — returns 1,396; risk 1,174; microstructure 467; reviews 604.
- Listed real estate — returns 601; risk 374; microstructure 254; reviews 43.

For example, the exact equities-return audit query was:

```text
equity stock market return predictability forecast out-of-sample
```

The remaining cells substituted the market block and one of:

```text
return predictability forecast out-of-sample
volatility tail risk forecast out-of-sample
order flow limit order book liquidity prediction
systematic review survey meta-analysis predictability
```

The public-web screening cap was 200 ranked records per supplementary query.
All records from seed surveys and replication projects were eligible for
backward and forward citation chaining regardless of rank.

Reproducibility caveats for this audit: only the equities-return cell's exact
query string is recorded above; the per-market block strings for the other
cells were not archived, so those 28 counts cannot be exactly reconstructed by
a third party. The boolean master query above describes search intent — it is
not executable verbatim against OpenAlex, whose search API rejects wildcards
(including wildcards inside quoted phrases). PRISMA-S-style per-source,
per-query reporting was not achieved, and no identified/screened/excluded/
included flow counts were kept from the discovery universe down to the 184
extracted rows; selection between discovery and extraction is therefore not
mechanically auditable.

## Citation chaining and saturation

Seed classes included:

- broad forecasting and efficient-market surveys;
- market-specific surveys for equities, rates, FX, commodities, volatility,
  crypto, microstructure, and real estate;
- large anomaly and factor replications;
- forecast-evaluation, multiple-testing, data-vintage, transaction-cost, and
  capacity studies;
- recent 2024–2026 benchmark, leakage, and live-evaluation work.

For each seed, searches covered:

1. backward references;
2. forward citations and related-work graphs;
3. author and title variants;
4. working-paper, accepted, published, corrigendum, and retraction versions;
5. explicit replication, comment, reply, erratum, and post-publication tests.

Two sequential rounds of market-specific and cross-method citation chaining
were completed by the same reviewer (they were not independent in the
systematic-review sense of separate searchers). The second round added
narrower studies but no new top-level market, target, predictor, or method
family. A separate 2024-07-01 through 2026-07-14 top-up search was then run.
This saturation rule was applied during the review rather than preregistered
as an ex ante stopping condition, and it does not imply that every paper was
found.

## Eligibility

Affirmative evidence requires enough information to identify:

- forecast origin and information set;
- target and horizon;
- benchmark;
- evaluation period;
- market and investable universe;
- statistical or decision metric.

Included source types:

- peer-reviewed empirical studies;
- working papers and preprints, clearly labeled;
- institutional research;
- transparent practitioner studies;
- surveys and methodological papers used for discovery or quality assessment.

Studies can remain in the map with low credibility or an invalid tag when they
are influential but fail affirmative-evidence requirements.

Excluded from positive evidence:

- contemporaneous explanation presented as forecasting;
- in-sample fit without a held-out or independent test;
- random train/test splits for time-dependent targets;
- unresolved target or timestamp leakage;
- final revised data unavailable at the forecast origin;
- survivorship-only universes without qualification;
- simulations without market validation;
- opaque marketing backtests;
- duplicate paper versions counted as independent evidence.

No language restriction was intended, but public discovery and verification
were English-dominant. This is a residual bias.

## Deduplication and version policy

- Primary key: DOI; fallbacks: normalized title, author set, and working-paper
  identifier.
- Published versions supersede working papers for bibliographic metadata.
- Earlier versions are retained when the sample, result, or design materially
  changed.
- Corrigenda, retractions, and verified data/code errors are linked to the
  affected claim.
- Studies sharing authors, data, code, or a nearly identical signal are grouped
  into one evidence lineage for replication scoring.

## Study-level extraction schema

Required fields in the accompanying CSV:

- identity: `study_id`, year, authors, title, venue, source tier, URL/DOI;
- scope: asset class, market, geography, target, horizon, predictor family,
  model family;
- design: sample, benchmark, evidence stage, point-in-time status, search and
  leakage controls;
- result: native metric or qualitative result, direction, statistical finding,
  economic finding;
- implementation: costs, turnover, borrow, financing, delay, impact, capacity;
- validation: replication, post-sample and post-publication evidence, openness;
- judgment: limitation, confidence, family claim linkage.

Evidence-stage tags:

- `IS`: exploratory or in-sample;
- `POOS`: retrospective pseudo-out-of-sample, including rolling or recursive
  designs whose test window was chosen retrospectively;
- `HOLD`: genuinely segregated chronological holdout — a single untouched test
  split, not a rolling/recursive scheme;
- `EXT`: external market, data, period, or independent replication;
- `LIVE-P`: timestamped prospective forecasts or paper portfolio;
- `LIVE-X`: actual executed deployment;
- `METHOD`: methodological, survey, or evaluation-infrastructure papers that
  inform quality assessment but are not themselves predictability evidence.

Result tags:

- `++`: uncertainty supports exceeding a meaningful threshold. For rows whose
  `predictive_assessment` is `not-applicable`, `++` marks a strong descriptive
  or measurement finding, not positive forecast evidence — such rows must not
  be counted as predictability support;
- `+?`: positive but imprecise or economically unclear;
- `EQ`: adequately powered equivalence or upper bound rules out useful effect;
- `-`: benchmark-superior or adverse result;
- `H`: material, unresolved heterogeneity;
- `X`: invalid because of leakage or a fatal construction problem;
- `NA`: not applicable — used for `METHOD`-stage rows with no result to grade.

A nonsignificant result is not coded `EQ` unless equivalence or power evidence
supports that conclusion. No row in the current ledger qualifies for `EQ`;
"Ineffective in tested scope" verdicts therefore rest on `-`-tagged adverse
rows at POOS-or-better stages, as listed in each family's evidence set.

`pit_status` uses a leading code from {`PIT`, `PARTIAL`, `NOT-PIT`,
`NOT-APPLICABLE`} followed by free-text justification.

## Family-level effectiveness ratings

Every rating is scoped to a market, target, horizon, and implementation. Scores
range from 0 to 4; `U` means not assessed and `X` means invalid. Scores are not
summed because their meaning and applicability differ across forecast targets.

### P — Predictive accuracy

- 0: credible evidence rules out useful incremental accuracy or favors the
  benchmark.
- 1: mainly in-sample, weak-benchmark, uncorrected, or leakage-prone evidence.
- 2: valid POOS improvement with point-in-time information and suitable loss.
- 3: locked or high-quality external OOS improvement above a useful threshold.
- 4: repeated prospective forecasts under a frozen protocol.

### E — Economic or decision value

- 0: credible net value is nonpositive or below the decision threshold.
- 1: gross return, raw alpha, or accuracy without a decision mapping.
- 2: positive historical utility or net value under plausible basic costs.
- 3: positive value after all relevant costs, constraints, parameter
  uncertainty, and conservative stress tests.
- 4: traceable prospective or live decision value after realized costs.

For volatility, default, and risk forecasts, `E` refers to the prespecified
decision loss or risk-management value rather than a forced trading return.
This carve-out applies inside the verdict gates below: a risk-forecast family
whose decision-loss value meets the `E` anchor qualifies on that basis, and
the family's `positive_evidence`/`key_caveat` fields must state which basis
was used.

### R — Independent replication

- 0: strong independent failures dominate or a correction removes the result.
- 1: original-author evidence or exact computational reproduction only.
- 2: independent reimplementation on the same data, or fresh evidence from the
  same team.
- 3: independent team plus fresh market, data, or era with compatible results.
- 4: multiple independent lineages and orthogonal data, with heterogeneity
  reconciled.

### I — Implementability and capacity

- 0: impossible timing, unavailable instruments, or non-executable prices.
- 1: timestamps, liquidity, shorting, turnover, or operational assumptions are
  materially incomplete.
- 2: executable at small scale with point-in-time data and basic frictions.
- 3: signal-to-trade timing, spread, fees, borrow, financing, delay, impact,
  constraints, and capacity are stress-tested.
- 4: live fills, impact, operations, and capacity are validated across regimes.

### T — Temporal stability and decay

- 0: adequately powered later evidence shows disappearance or reversal.
- 1: evidence is confined to the discovery era or a selected subperiod.
- 2: one later period survives with substantial decay or instability.
- 3: multiple nonoverlapping eras or prespecified regimes retain usefulness.
- 4: prospective or live usefulness persists under a frozen monitoring policy.

### B — Resistance to publication and data-mining bias

- 0: confirmed leakage, survivorship, outcome switching, or undisclosed tuning.
- 1: selected winner with unknown trial count and conventional single-test
  inference.
- 2: candidate universe disclosed with partial holdout or multiplicity control.
- 3: dependence-aware search correction, nested validation, and versioned
  code/data.
- 4: preregistration or sealed test, complete outcome reporting, prospective
  archive, and independent audit.

## Confidence and verdicts

Confidence measures certainty in the scoped conclusion, not whether the
conclusion is positive:

- `A`: at least two independent high-quality lineages, locked/prospective
  evidence, realistic implementation treatment, and no unresolved equal-tier
  contradiction.
- `B`: genuine holdout plus independent or external evidence, plausible costs,
  and later-period testing.
- `C`: one valid POOS lineage or material unresolved heterogeneity.
- `D`: predominantly in-sample, selected, opaque, or preprint-only evidence.
- `X`: fatal leakage, unidentified estimand, retraction, or indispensable timing
  information missing.

Verdicts:

- **Established effective**: all six dimensions at least 3, confidence A, and
  credible live execution for an exact implementation.
- **Supported pre-live**: predictive, economic, replication, stability, and
  bias-control scores at least 3, but audited live execution is absent.
- **Promising**: valid positive OOS evidence exists, but replication, costs,
  stability, or capacity remain incomplete.
- **Not established**: evidence cannot clear the required gates.
- **Ineffective in tested scope**: adequately powered evidence rules out useful
  accuracy or shows nonpositive net value in the stated scope. This requires at
  least one `-` (or `EQ`) tagged row at POOS-or-better stage in the family's
  evidence set; heterogeneity (`H`) or data-integrity critiques (`X`) alone
  cannot ground it, and equal-tier positive and negative evidence yields
  "Not established" per the mixed-evidence rule.
- **Invalid**: fatal timing, leakage, construction, or identification flaw.
- **Methodology — not rated**: families of evaluation methods, vintage
  infrastructure, or backtest-integrity tooling. These are scored `U` on P and
  E (they make no predictability claim) and receive no effectiveness verdict;
  they are excluded from headline verdict counts.

Verdicts are derived from the scores through the gates above; where two
families have similar score vectors but different verdicts, the deciding facts
must be visible in the evidence set (for example, the evidence stage of the
positive rows: "Promising" requires positive evidence at POOS-or-better stage,
not in-sample-only positives).

No paper count or citation count can override a failed integrity gate.

## Metric and synthesis rules

- OOS R², MAE/RMSE, QLIKE, AUC, directional accuracy, rank IC, alpha, Sharpe,
  certainty-equivalent return, and drawdown are not interchangeable.
- Comparisons require the same target, horizon, information set, benchmark,
  evaluation dates, and loss or utility.
- Overlapping horizons and cross-sectional dependence require HAC or block
  methods.
- Nested forecast models require a suitable adjustment such as Clark–West;
  nonnested comparisons may use Diebold–Mariano or conditional predictive
  ability tests.
- Hyperparameters, features, preprocessing, and regime selection must be fit
  inside the training loop.
- A repeatedly consulted “test” period is treated as in-sample.
- Gross, quoted-cost, modeled-impact, and realized-execution results are kept
  separate.
- Equal-tier positive and negative evidence yields a heterogeneous or mixed
  verdict, not a paper-count average.
- A corrected result supersedes the original for the same implementation, but
  not automatically for neighboring claims.

## Coverage gaps and known blind spots

- Proprietary live performance, alternative data, dealer order flow, and
  institutional execution records are rarely independently auditable.
- Subscription-only database exports and some paywalled full texts were
  unavailable.
- Recent 2025–2026 publications may not yet be indexed or independently
  replicated.
- Old, non-digitized, non-English, and unpublished null studies remain at risk
  of omission.
- Citation and web ranking favor highly cited and English-language research.
- Realistic impact, short borrow, taxes, financing, crowding, and capacity are
  absent from much of the literature.
- Crypto histories are vulnerable to delisting, wash trading, exchange failure,
  stablecoin, funding, and venue-fragmentation biases.
- Private-market persistence is mechanically affected by appraisal/NAV
  smoothing, stale marks, endogenous sales, and cash-flow timing.
- The free-text `horizon` column is not fully normalized (formation vs
  forecast horizon wording varies across rows); `horizon_tags` is the
  band-coded field to filter on.
- Several prespecified scopes remain thin or undelivered in this version:
  macro-announcement/FOMC event premia, intraday/overnight return patterns,
  insider-trading and short-interest signals, fund/ETF/retail flows,
  ESG/carbon, hedge-fund and mutual-fund persistence, swaps and rate
  derivatives, loans/CLOs, FX options/NDFs, stablecoin depegs, and
  non-storable commodities (power). These are acknowledged omissions, not
  evidence of absence.

These limitations are reflected in study tags and family confidence grades.

## Deliverables (this review)

- Protocol: [financial-market-predictability-protocol.md](financial-market-predictability-protocol.md)
- Study ledger (198 scoped claims): [financial-market-predictability-evidence.csv](financial-market-predictability-evidence.csv)
- Family ratings (49 claims): [financial-market-predictability-families.json](financial-market-predictability-families.json)
- An interactive report (`financial-market-predictability.canvas.tsx`) exists in
  the originating workspace but is not included in this repository.

### Headline results under the rigorous standard

- **Established effective:** 0 families (requires LIVE-X; none found in the public ledger).
- **Supported pre-live:** 6 families — equity value, cross-sectional equity
  momentum, profitability/quality, liquid-futures time-series trend, corporate
  default/distress ranking, and realized-volatility forecasting (the last two
  qualify on the documented risk-forecast decision-value basis for `E`, not
  tradable alpha).
- **Promising:** 15 families (e.g., equity ML, short-term reversal, text
  signals, government-bond carry, slow credit-spread value, FX carry and
  momentum, FX order flow, commodity ML, implied-volatility information, VRP
  return prediction, crypto and REIT volatility forecasting, forecast
  combinations/shrinkage).
- **Ineffective in tested scope:** 6 families (standalone size, the
  indiscriminate anomaly zoo, generic equity technical rules, generic LLM
  investing, the corporate-bond factor zoo, FX technical rules).
- **Not established:** 21 families with mixed or incomplete evidence after
  costs, decay, or replication (including aggregate equity-premium timing,
  PEAD, low-volatility/betting-against-beta, crypto momentum, zero-shot
  TSFMs, and alternative data).
- **Methodology — not rated:** 1 family (forecast-evaluation and backtest-
  integrity methods; no predictability claim to grade).

Statistical risk forecasting and default ranking can be Supported without implying tradable alpha. Numerical reproduction of published anomalies is not economic replication after costs and post-publication tests.

## Corrections log

**2026-07-14 (v1.1).** A 54-agent adversarial review of v1.0 produced 45
verified findings; this version applies them. Verdict layer: the v1.0 headline
of 12 "Supported pre-live" families did not survive the protocol's own gate
(P, E, R, T, B ≥ 3) — seven violated it. Verdicts and scores were reconciled
gate-by-gate (six families now qualify; volatility/default families qualify
via the now-documented risk-forecast `E` carve-out; crypto/REIT volatility,
implied-volatility information, bond carry, and forecast combinations moved
to Promising; the evaluation-integrity family moved to a new "Methodology —
not rated" designation; aggregate equity-premium timing, crypto momentum, and
zero-shot TSFMs moved from Ineffective to Not established under the
mixed-evidence and adequately-powered-adverse rules; FX carry and FX momentum
moved up to Promising on their POOS-or-better positive rows; alt-data moved
down to Not established for lack of any valid positive OOS row). Schema: the
previously undefined `METHOD` stage and `NA` result tag are now defined;
`pit_status` uses an enumerated leading code; the `family_claim` column now
joins mechanically to `claim_id`; rolling/recursive designs miscoded as
`HOLD` were restaged to `POOS` (with dependent P scores recapped); one
result-tag miscode (`ericsson-jacobs-oviedo-2009`, `+?` on a row whose own
fields declare it invalid) was corrected to `X`. Coverage: 14 web-verified
rows and two new families (PEAD and low-volatility/betting-against-beta) were
added, plus canonical missing counter-evidence (Goyal-Welch-Zafirov 2024;
Huang et al. 2020; Canina-Figlewski 1993; Moreira-Muir 2017 with the
Cederburg et al. 2020 adverse replication; Hurst-Ooi-Pedersen 2017). Process
language about reproducibility, independence, and prespecification was
rewritten to match what a single-pass single-reviewer web review can
actually claim. Bibliographic fixes: Welch/Goyal byline order, Heqing Zhu,
the FinSABER study_id, and the Lopez-Lira-Tang venue.
