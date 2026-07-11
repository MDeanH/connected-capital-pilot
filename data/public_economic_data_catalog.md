# Public Economic Data Catalog & Impact Weighting

**Compiled 2026-07-10** via a four-track research pass (US federal, state/local, international, indicator-evidence), with live web verification of retrieval endpoints and 2025–26 landscape changes. ~200 source families.

Purpose: the economy-wide superset of `data_sources_inventory.md` (which is the real-estate-focused list feeding the MC engine). Equity-market data (live/historical) and its two-way correlation map live in the companion `stock_market_data_catalog.md`. This catalog answers three questions:

1. What data do US federal and state governments publish, and exactly how do you retrieve it?
2. What non-US ("world") data can be collected that impacts the US economy, short- and long-term?
3. How much weight should each source get, based on its probability of correlation and/or causation with economic outcomes — at the macro (national), micro (household/firm/deal), state, and country lens?

Verification legend (per the house rule that verified beats spec):
- ✅ = retrieval details verified via live web check during the 2026-07-10 research pass
- ◻ = from model knowledge, historically stable API — low risk, but re-verify on first integration
- ⚠ = known to have changed recently or uncertain — verify before building on it

Engine flags: **[INGESTED]** = already pulled by this repo (see `public/data-vintages.json`).

---

## 1. Weighting methodology

Every source is scored 1–5 on six dimensions:

| Dim | Meaning | 5 looks like | 1 looks like |
|---|---|---|---|
| **C** Causal force | Does the variable *drive* outcomes, not just reflect them | Fed funds rate, oil supply shock, tariff schedule | Any purely reactive statistic |
| **L** Lead time | How far ahead of the real economy it moves | Yield curve (6–18 mo) | Lagging confirmations (unemployment rate) |
| **P** Predictive evidence | Documented out-of-sample record in the literature | Credit spreads / EBP, claims | Stock market ("nine of the last five recessions") |
| **G** Granularity | Finest reliable geography/unit | Tract/ZIP/loan-level | National only |
| **T** Timeliness | Frequency × publication lag | Daily/weekly, ~0 lag | Annual, 18–24 mo lag |
| **R** Reliability | Inverse of revision risk + sampling error in real time | QCEW (census, tiny revisions) | State-level CES (large revisions), early GDP vintages |

Composite weight per lens (dimensions weighted differently per lens):

- **Macro lens** = .30·C + .25·L + .25·P + .15·T + .05·R  (granularity irrelevant)
- **Micro lens** = .35·G + .25·P + .15·C + .15·R + .10·T  (deal/household level: granularity is king)
- **State lens** = .30·G + .25·P + .20·R + .15·T + .10·L  (state sampling error is the binding constraint)
- **Country lens** = .35·C + .25·T + .25·P + .15·L  (transmission-channel strength dominates)

Each top source also gets a **role** label — the correlation-vs-causation answer the weighting question asks for:

- **CAUSAL** — moves the economy (policy, supply shocks). Both correlated *and* causal.
- **LEADING** — correlate that systematically precedes outcomes; not causal (or only weakly), but high predictive value.
- **COINCIDENT** — defines/anchors the current state; causation not applicable, correlation ≈ 1 by construction.
- **LAGGING** — confirms after the fact; useful for validation, not prediction.
- **STRUCTURAL** — slow-moving causal fundamentals (demographics, debt, climate) that set the long-run trend, not the cycle.

And a **horizon**: SHORT (0–2y cycle) / LONG (2–20y trend) / BOTH.

*(Evidence citations backing the P scores are in §7.)*

---

## 2. Master weighting table

Scores 1–5 on the six rubric dimensions; **Weight** = the lens-specific composite from §1. Role: CAUSAL / LEADING / COINCIDENT (COIN) / LAGGING / STRUCTURAL (STRUCT).

### 2.1 Macro lens (national cycle: GDP, recession risk, inflation)

| # | Source (§ ref) | Role | Horizon | C | L | P | T | R | Weight |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Fed policy path — FOMC/SEP, H.15, fed funds futures (§3.1) | CAUSAL | BOTH | 5 | 4 | 5 | 5 | 5 | **4.75** |
| 2 | Oil prices — EIA/OPEC/JODI (§3.8, §5.3) | CAUSAL | BOTH | 5 | 3 | 4 | 5 | 5 | **4.25** |
| 3 | Credit spreads / EBP / NFCI (§3.1, §3.7) | LEADING | SHORT | 3 | 4 | 5 | 5 | 5 | **4.15** |
| 4 | Fiscal stance — MTS/DTS, CBO, tariff schedule (§3.5, §5.1) | CAUSAL | BOTH | 5 | 3 | 4 | 4 | 4 | **4.05** |
| 4b | Yield curve 10y–3m (§3.5) | LEADING | SHORT | 2 | 5 | 4 | 5 | 5 | **3.85** |
| 6 | Supply-chain pressure — GSCPI, freight, ports (§5.4) | CAUSAL | SHORT | 4 | 4 | 3 | 4 | 3 | **3.70** |
| 7 | Building permits/starts — Census BPS (§3.4) | LEADING | SHORT | 2 | 5 | 4 | 4 | 4 | **3.65** |
| 7b | New-tenant rent leads — Zillow ZORI / BLS NTRI → shelter CPI (§3.2) | LEADING | SHORT | 2 | 4 | 5 | 4 | 4 | **3.65** |
| 8 | Weekly UI claims — DOL ETA (§3.9) | LEADING | SHORT | 1 | 4 | 5 | 5 | 4 | **3.50** |
| 9 | SLOOS lending standards (§3.1) | LEADING | SHORT | 3 | 4 | 4 | 2 | 5 | **3.45** |
| 10 | ISM/PMI new orders (§5.5) | LEADING | SHORT | 1 | 4 | 4 | 5 | 5 | **3.30** |
| 11 | Immigration/labor-supply flows — CBP, visas (§3.9) | CAUSAL | BOTH | 4 | 3 | 3 | 3 | 2 | **3.25** |
| 12 | CPI/PCE inflation (§3.2, §3.3) | LAGGING* | SHORT | 2 | 1 | 5 | 4 | 4 | **2.90** |
| 13 | Payrolls — CES first print (§3.2) | COIN | SHORT | 1 | 2 | 4 | 5 | 2 | **2.65** |
| 14 | Unemployment rate / Sahm trigger (§3.2) | COIN | SHORT | 1 | 1 | 4 | 5 | 4 | **2.55** |
| 15 | Consumer sentiment (UMich/Conf. Board) | LEADING | SHORT | 1 | 3 | 2 | 5 | 4 | **2.50** |

\* CPI is reactive, but it scores P=5 because it *triggers* the #1 causal actor (the Fed). Weight it as a policy-reaction input, not a forward signal.

### 2.2 Micro lens (household / firm / deal / neighborhood)

| # | Source | Role | C | G | P | T | R | Weight |
|---|---|---|---|---|---|---|---|---|
| 1 | IRS SOI migration + ZIP income (§3.5) | STRUCT | 3 | 5 | 4 | 1 | 5 | **4.05** |
| 2 | HMDA loan-level (§3.6) | COIN | 2 | 5 | 4 | 2 | 5 | **4.00** |
| 3 | ZIP/tract house prices — FHFA annual, Zillow (§3.6) | COIN | 1 | 5 | 4 | 4 | 4 | **3.90** |
| 4 | QCEW county×industry (§3.2) | COIN | 1 | 5 | 4 | 2 | 5 | **3.85** |
| 5 | FEMA NRI + NFIP claims (§3.8) | STRUCT | 3 | 5 | 3 | 2 | 4 | **3.75** |
| 6 | ACS 5-yr (block group) (§3.4) | STRUCT | 1 | 5 | 4 | 2 | 4 | **3.70** |
| 7 | Building permits, place-level (§3.4) | LEADING | 2 | 4 | 4 | 4 | 4 | **3.70** |
| 8 | FDIC Summary of Deposits / bank micro (§3.7) | COIN | 3 | 4 | 3 | 2 | 5 | **3.55** |
| 9 | LEHD LODES/QWI commuting & job flows (§3.4) | COIN | 1 | 5 | 3 | 2 | 4 | **3.45** |
| 10 | BEA county GDP/income (§3.3) | COIN | 1 | 4 | 4 | 1 | 5 | **3.40** |

### 2.3 State lens

| # | Source | Role | G | P | R | T | L | Weight |
|---|---|---|---|---|---|---|---|---|
| 1 | Weekly state UI claims (§3.9) | LEADING | 3 | 5 | 4 | 5 | 4 | **4.10** |
| 2 | State/county permits (§3.4) | LEADING | 4 | 4 | 4 | 4 | 5 | **4.10** |
| 3 | QCEW (§3.2) | COIN (truth) | 5 | 4 | 5 | 2 | 1 | **3.90** |
| 4 | BFS business applications by state (§3.4) | LEADING | 3 | 4 | 4 | 5 | 4 | **3.85** |
| 5 | LAUS (§3.2) | COIN | 5 | 4 | 3 | 4 | 1 | **3.80** |
| 6 | Philly Fed state coincident + leading indexes (§3.1) | LEADING | 3 | 4 | 4 | 4 | 4 | **3.70** |
| 7 | BEA state GDP / personal income (§3.3) | COIN | 4 | 4 | 4 | 3 | 1 | **3.55** |
| 8 | Census QTAX / state revenue (§3.4) | COIN | 3 | 4 | 4 | 3 | 2 | **3.35** |
| 9 | CES State & Metro (SAE) (§3.2) | COIN | 4 | 3 | 2 | 4 | 1 | **3.05** |

### 2.4 Country lens (foreign → US transmission)

| # | Source family | Channel | Role | C | T | P | L | Weight |
|---|---|---|---|---|---|---|---|---|
| 1 | Global financial conditions — BIS rates, dollar, foreign CB policy (§5.1–5.2) | Financial | CAUSAL | 4 | 5 | 4 | 4 | **4.25** |
| 2 | Global oil supply — OPEC/IEA/JODI (§5.3) | Commodity | CAUSAL | 5 | 4 | 4 | 3 | **4.20** |
| 3 | Tariff/trade policy — WTO, USTR, TPU (§5.1, §5.5) | Trade | CAUSAL | 5 | 4 | 3 | 4 | **4.10** |
| 4 | Supply-chain/shipping — GSCPI, Kiel, freight rates (§5.4) | Supply | CAUSAL | 4 | 4 | 3 | 4 | **3.75** |
| 5 | Geopolitical risk — GPR index (§5.5) | Tail risk | LEADING | 4 | 5 | 2 | 3 | **3.60** |
| 6 | China activity & credit — NBS, customs, TSF (§5.2) | Trade+supply | CAUSAL | 4 | 3 | 3 | 3 | **3.35** |
| 7 | Euro area — ECB, Eurostat, Ifo/ZEW (§5.2) | Financial+trade | LEADING | 3 | 4 | 3 | 3 | **3.25** |
| 8 | Global PMIs / OECD CLI (§5.1, §5.5) | Foreign demand | LEADING | 1 | 4 | 4 | 4 | **2.95** |
| — | UN demographics / climate / global debt (§5.6) | Structural | STRUCT | 5 | 1 | 5 | 5 | **4.00** (LONG lens only) |

---

## 2A. 2025–26 data-landscape warnings (verified 2026-07-10)

Structural changes any pipeline built on this catalog must handle:

1. ✅ **Permanent October 2025 hole in federal data.** The 43-day shutdown (Oct 1–Nov 12, 2025) meant **October 2025 CPI, PPI, the Employment Situation (no national or state unemployment rate), Real Earnings, and Import/Export Price Indexes were never published and cannot be retroactively collected** — unprecedented gaps in series continuous since 1921 (CPI) and 1948 (unemployment). A second partial shutdown starting Jan 31, 2026 delayed Dec-2025/Jan-2026 releases. Reference: `bls.gov/bls/2025-lapse-revised-release-dates.htm`. Downstream series (LAUS, Philly Fed indexes) inherit the gap. Treat 2025-10 as NA, not zero, in any panel.
2. ✅ **Colorado suspended in BLS state data.** BLS suspended Colorado CES + LAUS publication from January 2025 (state UI-system modernization corrupted QCEW inputs). 50-state panels are actually 49-state panels until this resolves.
3. ✅ **BLS collection cuts.** CPI collection fully suspended in Lincoln NE + Provo UT (Apr 2025) and Buffalo NY (Jun 2025), ~15% sample cut in remaining areas — **subnational/item-level CPI is now more volatile** (national impact <0.01pp). **~350 PPI indexes discontinued** in phases Aug 2025–Feb 2026. **CES State & Area: ~900 detailed-industry series discontinued** with Jan 2026 data. CPS 2020-census sample redesign phases in Apr 2025–Jul 2026; a proposed 5,000-household CPS cut is paused but live.
4. ✅ **BEA discontinued metro-area (MSA/CSA) GDP and personal income** as of the 2024-vintage county release. County + state continue. **Connecticut is now on planning regions, not counties** (breaks county FIPS joins).
5. ✅ **NCES effectively dismantled** (March 2025 RIF, >95% of staff; ~half of collections inactive; first post-layoff IPEDS release late with errors). Federal education aggregates unreliable going forward; pull state education agencies directly.
6. ✅ **Survey terminations/breaks**: Household Pulse ended Sept 2024 (successor HTOPS: bi-monthly, national-only); **USDA Household Food Security Survey terminated Sept 2025**; **American Housing Survey 2025 wave not conducted** (first break since the 1980s); USDA ERS international baseline projections not produced in 2026.
7. ✅ **NOAA retired the Billion-Dollar Disasters product** (May 2025, archive frozen 1980–2024; continued privately by Climate Central since Oct 2025 with the same methodology). Build federal disaster-cost series from OpenFEMA + NCEI Storm Events instead.
8. ✅ **Mass dataset removals, early 2025** — ~3,000 datasets pulled from data.gov/agency sites (CDC/HHS: 203 datasets; partial restoration under the Feb 2025 *Doctors for America v. OPM* court order, some with altered fields). Treat any dataset URL last used before 2025 as unverified; pin local copies of anything load-bearing; DataLumos (ICPSR) and the CBPP "Federal Data Are Disappearing" tracker are the canaries.
9. ✅ **Payroll benchmark credibility** — the benchmark revisions were historically large: March 2024 preliminary −818k (final −598k); **March 2025 preliminary −911k, the largest on record (final −898k, Feb 2026)** — CES over-reporting vs QCEW plus nonresponse bias; BLS commissioner fired Aug 2025 over revisions. Real-time payroll strength in 2023–25 was overstated by roughly 50–75k/month. Widen error bars on all first prints; anchor to QCEW (Philly Fed publishes *Early Benchmark Revisions* — QCEW-rebenchmarked state payrolls ahead of official benchmarks).
10. ✅ **Socrata SODA3** shipped 2025 — new `/api/v3/views/{id}/query.json` endpoints require an app token; SODA2 still works per-dataset.
11. ✅ **API retirements**: USPTO PatentsView legacy API retired May 1, 2025 (HTTP 410) — use PatentSearch API (`search.patentsview.org/api/v1/`, key required), migrating again to `data.uspto.gov`; ProPublica Congress API defunct (use Congress.gov API); OpenFEMA NFIP v1 endpoints deprecated (use v2).
12. ✅ **Institutional risk watch**: FY2026 President's Budget proposes consolidating **BLS + BEA + Census under Commerce** (not enacted — expect endpoint/branding churn if it proceeds); CFPB minimally staffed through the 2025 defunding fight (Dec 2025 court order forced continued funding — HMDA/complaints still publishing; complaint-system overhaul June 2026 creates intake series breaks). Re-verify this catalog roughly quarterly; `hrecht.com/census-api-datasets/` diffs the Census API inventory.

---

## 3. US federal sources

Format per entry: what it measures | geography | frequency & lag | **retrieval** | role/horizon tags.

### 3.1 Federal Reserve System

- **FRED / ALFRED (St. Louis Fed)** ✅ — ~825k+ aggregated series from 100+ sources; the single best first stop for any US macro series (mirrors BLS/BEA/Census/market data). Geography: national→county for many. **Retrieval:** `https://api.stlouisfed.org/fred/` (free API key, **120 req/min**, JSON/XML; key endpoints `series/observations`, `series/search`, `release/dates`); keyless CSV at `fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES`; ALFRED = real-time vintages via `realtime_start/realtime_end` (critical for backtesting what was known when). **[INGESTED — us-market macro]** LEADING/COINCIDENT mix, BOTH horizons.
- **Federal Reserve Board statistical releases** ✅ — H.15 (daily rates), H.4.1 (weekly Fed balance sheet, Thu), Z.1 Financial Accounts (quarterly household net worth, sector balance sheets, ~10wk lag), G.17 (industrial production), G.19 (consumer credit), H.8 (weekly bank credit), H.6 (money stock), H.10 (FX), SLOOS (quarterly lending standards — strong leading indicator of credit supply), FOMC SEP/dot plot, **DFA Distributional Financial Accounts** (quarterly wealth by percentile). **Retrieval:** Data Download Program `federalreserve.gov/datadownload/` — stable parameterized CSV/SDMX-XML URLs, no key (chart feature retired Dec 2025; charting delegated to FRED); most mirrored on FRED. Also: **Survey of Consumer Finances** (triennial household balance-sheet microdata; 2022 latest, 2025 wave in field) ◻. CAUSAL (policy) + LEADING (SLOOS), BOTH.
- **NY Fed** ✅ — reference rates (SOFR, EFFR, OBFR + repo/Treasury ops, primary-dealer stats) via `markets.newyorkfed.org/api/` (no key, JSON/CSV/XLSX; e.g. `/api/rates/all/latest.json`) **[INGESTED — SOFR]**; **Staff Nowcast** (weekly Fridays — active, revived Sept 2023); **Weekly Economic Index** (Tuesdays); **GSCPI** (monthly — active, direct xlsx §5.4); recession-probability model (yield-curve probit, monthly); **Survey of Consumer Expectations** (monthly + microdata); Household Debt & Credit (quarterly, Equifax panel, state cuts); Empire State survey. LEADING, SHORT.
- **Atlanta Fed GDPNow** ✅ — running nowcast of current-quarter real GDP, updated ~6–7×/mo after each major release; XLSX/CSV history + FRED series `GDPNOW`. COINCIDENT (nowcast), SHORT. Also Wage Growth Tracker, Sticky-Price CPI.
- **Philadelphia Fed** ✅ — Survey of Professional Forecasters (quarterly; the oldest US forecast survey; XLSX incl. individual forecasts + Anxious Index), **state coincident indexes** (monthly, all 50 states — the best single state-cycle series), state leading indexes (6-mo ahead), **Early Benchmark Revisions of state payrolls** (QCEW-rebenchmarked CES ahead of official benchmarks), ADS business conditions (daily), GDPplus, Real-Time Data Set for Macroeconomists (vintage data). LEADING (state), SHORT.
- **Chicago Fed** — NFCI (weekly financial conditions, long history), CFNAI (monthly activity index, 85 indicators). ◻ LEADING, SHORT.
- **Dallas Fed** — Trimmed-Mean PCE (best underlying-inflation gauge), Texas manufacturing/service surveys (energy-state signal), Banking Conditions survey. ◻ SHORT.
- **Kansas City / Richmond / SF / Boston Fed** — KC LMCI (labor composite) + manufacturing survey + KC Financial Stress Index; Richmond surveys + CFO Survey (w/ Duke); SF Fed Daily News Sentiment, cyclical-vs-acyclical inflation; Boston Fed Beige Book textual indicators (2025 WP shows recession-forecasting value). ◻ SHORT.
- **OFR (Office of Financial Research)** ✅ — Financial Stress Index (daily), **Short-Term Funding Monitor API** (repo volumes/rates), Hedge Fund Monitor — free JSON APIs, no key, `financialresearch.gov`. LEADING (stress), SHORT.

### 3.2 BLS (labor & prices)

**Retrieval (all programs):** ✅ API v2 `https://api.bls.gov/publicAPI/v2/timeseries/data/` (POST JSON with `seriesid` list) — free registration key: 500 queries/day, 50 series/query, 20 yrs/query. Unregistered v1: 25/day. No geographic query language — construct series IDs (e.g. `LAUCN{fips}...`). Bulk flat files: `download.bls.gov/pub/time.series/{program}/` — **requires a descriptive User-Agent header with contact email** (403 otherwise; verified by direct HTTP test 2026-07-10). QCEW has its own keyless CSV slice API (§4.1).

- **CES national (Employment Situation)** — payrolls, hours, earnings; monthly, first Friday, ~1wk lag. The market-moving anchor. Caveats: two rounds of monthly revisions + annual QCEW benchmark (2024 preliminary benchmark revision was −818k; treat first prints with error bars). COINCIDENT, SHORT.
- **CES State & Metro (SAE)** — payroll jobs by state/MSA/industry; monthly, ~6wk lag; noisy at state level, benchmark-revised. COINCIDENT (state), SHORT.
- **CPS** — unemployment rate, participation, flows; monthly. Microdata via IPUMS-CPS. COINCIDENT.
- **LAUS** — unemployment rate/employment for states, counties, metros, cities; monthly ~1–2mo lag. The micro/state labor anchor. COINCIDENT (state/local), SHORT.
- **JOLTS** — openings, hires, quits (quits = worker-confidence leading signal); monthly ~5wk lag; small sample, big revisions. LEADING, SHORT.
- **CPI** — monthly ~2wk lag; sub-indices, metro CPIs (bimonthly for most metros); research series: **New Tenant Rent Index** (leads shelter CPI ~4 quarters — one of the highest-confidence mechanical leads available, §7). ✅ 2025 collection cutbacks per §2A.3: subnational/item detail now noisier; Oct 2025 missing. LAGGING (headline) / LEADING (NTRI for shelter), SHORT.
- **PPI + import/export price indexes** — monthly; pipeline inflation pressure, **tariff pass-through visibility**. ✅ ~350 PPI indexes discontinued 2025–26 (list: `bls.gov/ppi/notices/2025/`); Oct 2025 missing. LEADING (for CPI goods), SHORT.
- **ECI** — quarterly; the compositionally-clean wage growth measure the Fed watches. LEADING (for services inflation), SHORT.
- **QCEW** — quarterly census of employment & wages from UI records: county × NAICS, near-population coverage; ~5.5mo lag. **Ground truth** for state/local employment (use to discipline CES/SAE). COINCIDENT (delayed truth), state/micro anchor.
- **OEWS** — occupational employment & wages by metro; annual (May ref, ~10mo lag). STRUCTURAL, micro.
- **Productivity & Costs; ATUS; Consumer Expenditure Survey; Employment Projections (10-yr)** — quarterly/annual; long-horizon inputs. STRUCTURAL, LONG.

### 3.3 BEA (national & regional accounts)

**Retrieval:** ✅ `https://apps.bea.gov/api/data?UserID={key}&method=GetData&datasetname=...` — free 36-char UserID (`apps.bea.gov/api/signup/`); JSON/XML; throttle ~100 req/min + 100MB/min (429 with Retry-After). Discovery: `GetDatasetList`/`GetParameterValues`. Interactive tables + bulk at `apps.bea.gov/itable/`, regional zips at `apps.bea.gov/regional/downloadzip.htm`. API user guide current (Apr 2026). ⚠ Watch the proposed Commerce consolidation (§2A.12).

- **NIPA** — GDP (advance ~4wks after quarter-end, then 2 revisions + annual/comprehensive), PCE monthly (the Fed's inflation target variable), corporate profits, saving rate. COINCIDENT, SHORT.
- **Regional** — **state quarterly GDP (SQGDP)** ~3mo lag; **state quarterly personal income (SQINC)**; **county annual GDP + personal income (CAGDP/CAINC)** ~11–12mo lag **[INGESTED — county income]**; state PCE, RPPs (regional price parities — the official cost-of-living deflator). ✅ Metro-area (MAGDP etc.) series discontinued going forward (§2A.4) — historical vintages remain queryable. The state/county income backbone. COINCIDENT (state), BOTH.
- **International** — ITA (BoP quarterly), trade in services, direct investment & MNE activity (annual). COINCIDENT, BOTH.
- **Industry** — GDP-by-industry (quarterly), Input-Output tables (supply-use; the shock-propagation map for any sectoral scenario model). STRUCTURAL, LONG.

### 3.4 Census Bureau

**Retrieval:** ✅ `https://api.census.gov/data` — **1,788 dataset endpoints** as of mid-2026 (81 added, 0 removed since Jul 2025); key free (keyless ≈500 req/day/IP); JSON (2-D array format). Discovery: `api.census.gov/data.html`; Microdata API added Jun 2026. Bulk: `data.census.gov`, FTP `www2.census.gov`. Geocoder: `geocoding.geo.census.gov` (free, no key). TIGER/Line shapefiles for all geography.

- **ACS** — 1-yr (geos ≥65k pop, ~9mo lag) and 5-yr (down to block group, ~12mo lag): income, rent, value, tenure, commute, education, industry — the micro denominator for nearly everything local. COINCIDENT/STRUCTURAL, micro anchor.
- **PEP** — annual population estimates + components (births/deaths/domestic & intl migration) for states/counties/metros. STRUCTURAL, LONG.
- **BFS (Business Formation Statistics)** — weekly + monthly business applications by state; **high-propensity applications** are a validated leading indicator of firm entry/job creation. LEADING, SHORT.
- **BPS (Building Permits Survey)** — monthly permits by place/county/CBSA/state **[INGESTED]**; with New Residential Construction (starts/completions) and New Home Sales. Permits = the classic housing-cycle leading indicator. LEADING, SHORT.
- **MARTS/MRTS retail** (monthly, ~2wk lag, advance), **M3 manufacturers' shipments/orders**, **MWTS wholesale**, **QSS services**. COINCIDENT, SHORT.
- **HVS** (quarterly homeownership/vacancy), **AHS** (biennial housing detail). COINCIDENT.
- **International trade (FT-900)** — monthly goods/services trade; district/HS detail via **USA Trade Online** (free account) or `api.census.gov/data/timeseries/intltrade`. COINCIDENT, SHORT.
- **CBP/ZBP** — county/ZIP business patterns (annual, ~16mo lag): establishments, employment, payroll × NAICS. STRUCTURAL, micro.
- **QWI / LEHD LODES** — quarterly workforce indicators (hires, separations, earnings by county×industry×demographics; API `/data/timeseries/qwi/sa`); LODES block-level origin-destination commuting — ✅ **v8.4 released Dec 2025, adds 2023** (2023 lacks AK & MI); `lehd.ces.census.gov/data/lodes/LODES8/`. Micro gold for labor-shed analysis. COINCIDENT (lagged), micro.
- **HTOPS** (successor to Household Pulse ✅ — bimonthly panel, national-only, microdata-first). SHORT. **SIPP** continues (2024 data published ✅).
- **BDS** (Business Dynamics Statistics — firm entry/exit, job creation/destruction 1978→; ✅ added to API Sept 2025) + **BTOS** (biweekly business trends, incl. AI-use module ✅) + **BED** (quarterly gross job gains/losses from QCEW universe) ◻. LEADING/STRUCTURAL mix.
- **Economic Census** (5-yearly, NAICS detail), **SUSB**, **ABS** (business owners), **NES** (nonemployers). STRUCTURAL, LONG.
- **Government finances:** **QTAX** (quarterly state/local tax revenue by type), Annual Survey of State & Local Government Finances, Census of Governments (5-yearly). The uniform state fiscal dataset. COINCIDENT (state fiscal), SHORT/LONG.

### 3.5 Treasury / IRS

- **Treasury FiscalData** ✅ — `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/{endpoint}` (no key; JSON/CSV/XML; paginate `page[size]`): Debt to the Penny (daily), **MTS/DTS** (monthly/daily federal cash flows — a real-time fiscal pulse), MSPD, auction results (also TreasuryDirect Web APIs ✅), average interest rates, **daily par yield curves**. CAUSAL (fiscal stance) + COINCIDENT, BOTH. Yield curve = LEADING (§2 — downgraded post-2022, condition on credit spreads).
- **TIC (Treasury International Capital)** ✅ — monthly foreign holdings of US securities by country (~6–7wk lag; next release verified on schedule). **No REST API — scrape the fixed CSV/zip URLs**; pauses during shutdowns. Foreign demand for Treasuries → term premium channel. LEADING (financial), BOTH.
- **OFAC Sanctions List Service** ✅ — `sanctionslist.ofac.treas.gov`, stable download URLs, XML/CSV (legacy formats retired 2023); event-driven updates. Sanctions = trade/finance policy input.
- **IRS SOI** ✅ — **county-to-county & state migration flows** (latest 2022–23, page updated Mar 2026; ~2.5yr lag; inflows/outflows with AGI — who is moving and how much income moves with them; new return-matching methodology from 2022-23 = minor series break) **[INGESTED]**; ZIP-code income by AGI bracket (TY2022 released Feb 2025); no API — flat CSV/XLSX; release list at `irs.gov/pub/irs-soi/soipublicreleaselist.xlsx`. STRUCTURAL (migration = long-run local demand), micro/state.

### 3.6 Housing & mortgage regulators

- **HUD (HUD USER)** ✅ — Fair Market Rents (annual, ZIP-level SAFMRs), Income Limits, CHAS affordability tabs, **USPS ZIP↔tract/county crosswalk API** (the standard geo-join tool). **Retrieval:** `huduser.gov/hudapi/public/{fmr|il|chas|usps}` — free Bearer token, **60 req/min**. Also: USPS vacancy data (quarterly tract, restricted registration), PIT homelessness (annual XLSX, HUD Exchange), LIHTC ◻. ⚠ **AHS 2025 wave skipped** (§2A.6). STRUCTURAL, micro.
- **FHFA** ✅ — HPI family (monthly purchase-only; quarterly all-transactions; **annual county/ZIP3/ZIP5/tract** CSVs at `fhfa.gov/data/hpi/datasets`), **UAD Aggregate Statistics** (appraisal-level aggregates national→tract, quarterly, dashboards + CSV — FHA added), **PUDB** (Enterprise loan purchases, annual), **NMDB** quarterly mortgage-market statistics. No key. (Detailed HPI file list in `data_sources_inventory.md` §2.) COINCIDENT (prices), micro.
- **CFPB / FFIEC** ✅ — **HMDA loan-level** (annual; **2025 national files released Jun 23, 2026**; every mortgage application: rate spread, denial, income, tract) **[INGESTED]** via `ffiec.cfpb.gov/data-browser/` (filter API, no key) + bulk LAR zips; consumer complaints API (daily; ⚠ June 2026 system overhaul = intake series break; agency minimally staffed but publishing — §2A.12). COINCIDENT (credit demand truth), micro.
- **GSEs** ✅ — **Fannie Mae** Single-Family Loan Performance (free registration, Data Dynamics; quarterly refresh) + **Freddie Mac** Loan-Level Dataset (~55M loans 1999→, free registration via Clarity) — the default/prepay estimation standard; Ginnie Mae bulk disclosures (`bulk.ginniemae.gov`) ◻. micro.

### 3.7 Financial regulators & markets

- **SEC EDGAR** ✅ — no key, **10 req/s with declared User-Agent + contact email**: submissions JSON `data.sec.gov/submissions/CIK##########.json` (sub-second freshness); **XBRL companyfacts/companyconcept/frames** `data.sec.gov/api/xbrl/` (every reported financial-statement fact, standardized); **nightly bulk `companyfacts.zip` + `submissions.zip`**; full-text search `efts.sec.gov/LATEST/search-index?q=` (2001→); 13F structured datasets; Form D private raises; fails-to-deliver (twice-monthly CSV); N-MFP money-market funds; Form PF aggregates. (EDGAR Next 2025 affects *filers*, not retrieval.) COINCIDENT (firm micro), BOTH.
- **FDIC** ✅ — BankFind Suite API `banks.data.fdic.gov/api/` (no key; JSON/CSV + bulk): every bank's quarterly financials (deposits, loans, NPLs; branch-level deposits annual via Summary of Deposits — a county credit-supply map); QBP aggregates. **FFIEC CDR** ✅ (`cdr.ffiec.gov/public/` — raw call reports, bulk per period) + UBPR + CRA small-business lending by tract ◻; NCUA credit-union call reports ◻. COINCIDENT (credit supply), state/micro.
- **FINRA** ✅ — `developer.finra.org`: **free public credentials** for equity short interest (bi-monthly), OTC/ATS weekly volumes, Treasury weekly aggregate TRACE, bond-market aggregates (trade-level TRACE = licensed). LEADING (positioning/stress), SHORT.

### 3.8 Energy, agriculture, environment

- **EIA** ✅ — `https://api.eia.gov/v2/{route}` (free key; JSON; 5,000 rows/request, paginate `offset`; bulk manifest zips; API v2.1.11 current, v1 deprecated): weekly petroleum status (Wed 10:30), weekly nat-gas storage (Thu 10:30), electricity incl. hourly RTO demand, retail gasoline (Mon), **STEO** monthly short-term forecast, AEO long-term, international. Energy = causal input cost channel. CAUSAL + COINCIDENT, BOTH.
- **USDA** — NASS **QuickStats API** ✅ (`quickstats.nass.usda.gov/api`, free key, 50k records/query; county-level crop production/prices/yields), **WASDE** monthly world supply/demand ◻, FAS **PSD/GATS/export-sales APIs** ✅ (`apps.fas.usda.gov/opendatawebv2/`, free key), AMS Market News API ◻, ERS data products (farm income, food price outlook — ⚠ 2025–26 cuts: food security survey terminated, intl baseline skipped, §2A.6), FNS SNAP participation ◻. CAUSAL (food prices) + micro (farm states), BOTH.
- **FEMA** ✅ — **OpenFEMA API** (`fema.gov/api/open/v2/{dataset}`, no key; JSON/CSV, OData filters; **v1 deprecated — use v2**): disaster declarations (county, 1953→), IA/PA grants, **NFIP Redacted Claims v2** (2M+ claims, ~monthly) + **Policies v2** (80M+) **[INGESTED]**; **National Risk Index** (county/tract composite hazard×vulnerability) **[INGESTED]**. STRUCTURAL (climate exposure), LONG, micro.
- **NOAA/USGS** — NCEI Climate Data Online API (free token, ~5 req/s; GHCN station data) ◻, Storm Events DB (county-level event damage) ◻, Drought Monitor (weekly county) ◻; USGS earthquake API + mineral commodity summaries ◻. ✅ **Billion-Dollar Disasters retired May 2025** — archive frozen 1980–2024; Climate Central continues it privately (same methodology). STRUCTURAL, LONG.

### 3.9 Government activity, transport, innovation, demographics

- **USASpending** ✅ — `api.usaspending.gov/api/v2/` (no key; async bulk downloads; monthly full-DB snapshots): every federal contract/grant/loan by county, agency, NAICS — the federal fiscal-flow map (defense spending shocks to local economies, etc.). SAM.gov APIs (entity/exclusions, key via api.data.gov) ◻. CAUSAL (fiscal, local), state/micro.
- **DOL ETA UI claims** ✅ — **weekly state-level initial & continued claims**, `oui.doleta.gov/unemploy/claims.asp` + bulk at `.../DataDownloads.asp` (~1wk lag; state = advance + NSA). The highest-frequency official state labor signal. National release Thursdays 8:30. **DOL developer API** (`developer.dol.gov`, key): OSHA enforcement, **OFLC LCA/PERM visa-certification microdata** (labor-demand signal) ◻. State **WARN notices** — per-state pages, no federal feed ⚠. LEADING, SHORT — top-tier.
- **Transportation** — BTS TranStats (airline T-100/on-time, DB1B fares, Transportation Services Index monthly) ◻, FHWA Travel Volume Trends (monthly VMT, ~2mo) ◻, **TSA checkpoint throughput** ✅ (daily counts, updated weekdays, `tsa.gov/travel/passenger-volumes` — HTML scrape; still publishing 2026), USACE waterborne commerce ◻, port TEU stats (LA/LB/NYNJ publish monthly) ◻, STB weekly rail carloads + waybill public sample ◻. COINCIDENT (high-freq), SHORT.
- **USPTO** ✅ — legacy PatentsView API **retired May 2025 (410)**; use **PatentSearch API** `search.patentsview.org/api/v1/patent/` (key via service desk) or bulk TSVs; migrating to `data.uspto.gov` (expect URL churn). Patents by assignee/inventor/county — innovation geography. NSF NCSES R&D surveys + **NIH ExPORTER** grant-level R&D ◻. STRUCTURAL, LONG.
- **CMS / CDC-NCHS** — data.cms.gov API (Medicare utilization/enrollment, no key) ◻, National Health Expenditures (annual) ◻; NCHS births/deaths (provisional weekly/monthly via VSRR), **CDC WONDER** (county mortality; XML POST API, small-cell suppression) ◻; ✅ 2025 caveat: 203 CDC/HHS datasets pulled Jan–Feb 2025, mostly restored under court order, some with altered fields — check dataset changelogs. **HRSA AHRF** county health-economic panel ◻. Health = 17% of GDP + demographic inputs. STRUCTURAL, LONG.
- **NCES / College Scorecard** — ⚠ NCES gutted (§2A.5); IPEDS/CCD delayed with reduced QA. College Scorecard API (api.data.gov key; earnings by program) ◻. Urban Institute mirror `educationdata.urban.org` has a cleaner API and archives vintages ◻. STRUCTURAL, LONG.
- **Immigration** — DHS OHSS yearbook + monthly tables (⚠ cadence irregular in 2025 — verify vintages), **CBP monthly encounters** (border flows), State Dept monthly visa issuances by country/category, USCIS quarterly. Labor-supply channel; policy-volatile 2025–26 (§7: net migration turned negative in 2025 — first time in ≥50 years; breakeven payrolls collapsed). ⚠ CAUSAL (labor supply), BOTH.
- **Trade policy (US side)** — **USITC DataWeb** (`dataweb.usitc.gov`, free account + token, REST API): tariff-line imports/exports with duty treatment — essential for 2025–26 tariff analysis; **CBP monthly duty collections** (incl. §301/§232) ◻; ITA `developer.trade.gov` APIs (steel imports, I-94 visitor arrivals) ◻. CAUSAL, SHORT.
- **FCC BDC broadband map** ✅ (semiannual location-level; bulk CSV free; **API needs FCC username + self-generated token**), **SSA** county beneficiaries & wage index ◻, **OPM FedScope** ⚠ (verify still published), **SBA** ✅ `data.sba.gov` (CKAN): 7(a)/504 loan-level FOIA files since 1990 (quarterly refresh) + full PPP loan-level. STRUCTURAL, micro.
- **Congress/budget** — **CBO** 10-year Budget & Economic Outlook (XLSX incl. historical projection vintages; long-term 30-yr outlook — the canonical debt trajectory; no API) ◻, OMB Historical Tables (⚠ whitehouse.gov URLs churned 2025; GovInfo mirrors) ◻, **Congress.gov API** ✅ (key via api.data.gov, 5,000 req/hr; ProPublica Congress API is defunct), **Federal Register API** (`federalregister.gov/api/v1`, no key — regulatory-flow analysis) ◻, GovInfo API ◻. STRUCTURAL/CAUSAL (fiscal policy pipeline), LONG.
- **data.gov** ✅ — CKAN metadata API `catalog.data.gov/api/3/action/package_search` (~300k datasets). Catalog of catalogs — discovery only, and **not complete post-2025 purges** (§2A.8).
- **Microdata access layer** — **IPUMS** (not federal; free registration + API) is the practical harmonized path to CPS/ACS/decennial microdata. ◻

## 4. State & local sources

Key principle: **most "state data" is best retrieved federally.** States feed cooperative federal programs (LAUS, CES-SAE, QCEW, UI claims, QTAX, vital stats) that normalize 50 different formats into one feed. Go to the state itself only for: (a) faster/fresher cuts, (b) data with no federal aggregate (assessor rolls, WARN detail, business registrations detail), (c) state-specific programs.

### 4.1 The standard pattern — every state has these

| Category | What | Best retrieval point |
|---|---|---|
| Labor market | State/metro/county employment, unemployment, wages | **Federal**: BLS LAUS + SAE + QCEW (uniform, one API). QCEW has its own keyless CSV slice API: `data.bls.gov/cew/data/api/{year}/{qtr}/area/{area_fips}.csv`. State LMI office only for: sub-county custom cuts, occupational projections (uniform at `projectionscentral.org`), vacancy surveys. ✅ (see §2A items 1–3 for the Oct-2025 hole, Colorado suspension, SAE cull) |
| UI claims | Weekly initial/continued claims by state | **Federal**: DOL ETA — query `oui.doleta.gov/unemploy/claims.asp` (ETA 539), bulk CSVs at `oui.doleta.gov/unemploy/DataDownloads.asp` (also ETA 5159/203/207 program detail). State numbers are advance + NSA; SA national only. FRED mirrors every state series ({ST}ICLAIMS). ✅ |
| Layoff notices | WARN Act 60-day advance notices | **State-by-state** — nearly every state posts a WARN log (formats vary; no official federal feed). Third-party aggregators (e.g., layoffdata.com) compile them. ⚠ |
| Tax revenue | Monthly/quarterly collections by tax type | **Federal**: Census QTAX (uniform quarterly, ~2.5-mo lag — Q4-2025 released 2026-03-12 ✅); API `api.census.gov/data/timeseries/eits/qtax` ◻; FRED release 455 ✅. **State monthlies (1–2 mo faster)**: Texas Comptroller Revenue Watch (`comptroller.texas.gov/transparency/revenue/watch/` ✅), CA DOF Finance Bulletin + Controller cash statements, NY OSC monthly cash report ◻. **Urban Institute STER** — quarterly 50-state collections analysis. ✅ |
| Budget/fiscal health | Enacted budgets, rainy-day funds, balances | **NASBO** Fiscal Survey of States (2×/yr, PDF+XLSX, nasbo.org ✅), **Pew Fiscal 50** (live, downloadable — Mar 2026 update: median rainy-day fund fell to 47.8 days, first decline since the GR ✅), state ACFRs (systematically retrievable via EMMA continuing disclosure). |
| Population | Estimates/projections | **Federal**: Census PEP for estimates. State demographers (FSCPE agencies) for official *projections* — Census no longer publishes state projections: CA DOF, Texas Demographic Center, FL BEBR, WA OFM. ◻ |
| Business registrations | New entity formations | **Federal**: Census BFS (uniform; weekly now at national/region/state/**county**, ~5-day lag ✅; FRED releases 443/468). Entity-level SoS bulk: free — **CO** (data.colorado.gov full file), **OH** (monthly bulk), **OR/CT** (open-data APIs), IA, MN, NY ✅; most others paid; **Delaware sells no bulk data, no API** ✅. Caveat: BFS counts EIN applications, not registrations. |
| Property records | Assessor rolls, deeds, sales | **County-level** (~3,000 counties, no national free feed). Best statewide: **Florida DOR** — annual NAL (parcel), SDF (sales), NAP rolls for all 67 counties, CSVs, NAL back to 2002/sales to 2009 (`floridarevenue.com/property/` Data Portal) ✅. **Texas**: per-CAD certified roll exports (Tarrant, Travis, Collin…) ✅. Also statewide: MD SDAT, NJ MOD-IV, MT Cadastral, NC parcels, WI parcel map, Cook County full roll ◻. Deeds: rarely bulk-free — NYC ACRIS is the exception. ZTRAX is dead. |
| Traffic | State DOT counts/VMT | Federal FHWA TVT for monthly state VMT; state DOT AADT usually an ArcGIS FeatureServer (`.../FeatureServer/0/query?where=1=1&f=geojson`). ◻ |
| Education | Enrollment, spending, outcomes | ⚠ **NCES unreliable post-2025 RIF (§2A.5)** — pull state DOE files directly (CA DataQuest, TEA PEIMS/TAPR, data.nysed.gov). |
| Energy | State energy data | **Federal EIA**, not state offices: SEDS annual + monthly state electricity/gas via `api.eia.gov/v2`. ◻ |
| Vital statistics | Births/deaths | Federal NCHS (states feed it). ◻ |

### 4.2 State open data portals (state-specific programs, faster local data)

Platforms & programmatic access ✅:
- **Socrata / Tyler Data & Insights** (most states): SODA2 `https://{domain}/resource/{4x4-id}.json?$where=...` (SoQL; app token recommended). **SODA3 (2025)**: `/api/v3/views/{id}/query.json` — better, but token/auth required.
- **Discovery API** — enumerate every asset across all Socrata domains: `https://api.us.socrata.com/api/catalog/v1?domains=data.ny.gov&q=...`. The best way to inventory state portals programmatically.
- **CKAN** (data.ca.gov et al.): `/api/3/action/package_search`, then `datastore_search_sql`.
- **ArcGIS Hub**: DCAT catalog at `/api/feed/dcat-us/1.1.json`; data via `FeatureServer` REST.

Notable portals: data.ny.gov (deepest economic content — state tax collections, local sales tax ✅), data.ca.gov (CKAN ✅), data.texas.gov (Comptroller ledgers ✅), data.colorado.gov (incl. full business registry ✅), data.pa.gov ✅, data.wa.gov, data.ct.gov, opendata.maryland.gov, data.illinois.gov, data.nj.gov, data.oregon.gov, data.iowa.gov, data.virginia.gov ◻. **Directory:** no perfectly maintained 50-state list; `data.gov/open-gov/` publishes a downloadable CSV of known state/local portals ✅. Coverage varies wildly — treat portals as supplements, not systematic inputs.

### 4.3 Aggregators that normalize the 50-state mess

- **Philadelphia Fed state coincident & leading indexes** — monthly, all 50 states, one XLSX; days after each BLS state release; current through May 2026. ✅ The best single "state cycle" series (inherits §2A holes).
- **Census QTAX + Annual Survey of State & Local Gov Finances (FY2023 released Jul 2025 ✅) + Census of Governments** (5-yearly; next 2027) — the fiscal backbone (see §3.4).
- **BEA regional accounts** — state GDP/income/PCE/RPP (see §3.3; metro series discontinued §2A.4 ✅).
- **Urban Institute SLF-DQS** — normalized Census gov-finance series 1977→ (`slfdqs.taxpolicycenter.org` ✅); **Urban STER** quarterly state tax analysis ✅; **Government Finance Database** (Willamette U.) — cleaned unit-level panel of the full Census gov-finance history ✅.
- **Federation of Tax Administrators** (rates tables), **NCSL** (budget/tax action tracking). ◻
- **MERIC cost-of-living index** — quarterly state COLI, free HTML table (Q1-2026 published ✅). Caveat: built from voluntary C2ER city samples.
- **Tax Foundation / ALEC-style indexes** — state tax burden rankings (advocacy-adjacent; use as features, not truth). ◻

### 4.4 Local / municipal

- **Major city/county open data portals** ◻ (platform pattern stable): NYC (**PLUTO** parcels, **DOF Rolling Sales**, **ACRIS** deeds/mortgages — the rare free recorder feed), Chicago, **Cook County** (full assessor roll + sales on Socrata — best big-county assessment data in the country), LA city/county, Miami-Dade (ArcGIS), Philadelphia (OpenDataPhilly catalog → Carto), King County (assessor extracts), SF, Austin, Seattle, Boston.
- **MSRB EMMA** (`emma.msrb.org`) — every muni official statement + continuing disclosure (incl. state/city ACFRs = local fiscal stress signals). Free search; **no free API** — bulk is a paid subscription. ✅ Watch: FDTA machine-readable muni disclosure rulemaking still pending. ◻
- **Census of Governments / Annual Surveys** — the only *normalized* local-government finance data (~90k units in COG years), ~2-yr lag. ✅

State-lens weighting note: state-level *sampling* series (SAE payrolls, LAUS model estimates) carry meaningful noise — always anchor levels to QCEW when it arrives (~5.5 mo), and treat state monthly prints as directional. This is dimension **R** in the rubric and is why QCEW/QTAX/BEA outrank faster state series for *levels*, while UI claims + Philly Fed indexes win for *turning points*.

## 5. International sources

Organized by **transmission channel to the US** (the country-lens causal question), with multilaterals as retrieval infrastructure. Verification pass run 2026-07-10.

### 5.0 Cross-cutting retrieval notes ✅

- **SDMX is the lingua franca** (IMF, OECD, BIS, ECB, Eurostat, ILO, Bundesbank, INEGI, StatCan): one query grammar — `{base}/data/{flow}/{key}?startPeriod=...&format=csv` — covers ~60% of this section. Python `sdmx1` has tested source definitions for all of them.
- **DB.nomics** (`api.db.nomics.world/v22/`, no key) mirrors 80+ providers behind one API — the fallback when a primary migrates. ◻
- **2024–26 migrations to code around** ✅: IMF `dataservices.imf.org` → **dead** (2025); IFS retired/split into thematic dataflows; OECD stats.oecd.org → sdmx.oecd.org; ECB SDW → Data Portal; ILO base moved to `sdmx.ilo.org/rest`; Destatis SOAP shut down mid-2025 (token now required); Copernicus CDS new API + tokens; exchangerate.host now keyed (use **Frankfurter** `api.frankfurter.dev` instead — free, no key); ONS v0 retired; **India rebased CPI (2024 base) and GDP (2022-23 base) in Feb 2026 — series breaks**.
- **Free keys required:** UN Comtrade, WTO, e-Stat (Japan), Destatis, INEGI, Banxico, USDA FAS, NOAA CDO, Copernicus, UN Data Portal. **No key:** World Bank, OECD, BIS, ECB, Eurostat, ILO, ONS, BoC Valet, StatCan, IBGE/BCB, Bundesbank, UCDP, UNHCR, VIX CSV, GSCPI xlsx, PortWatch, Pink Sheet, JODI, EPU/GPR/WUI.

### 5.1 Multilateral statistical infrastructure

- **IMF** ✅ — rebuilt **data.imf.org** (SDMX 2.1 + 3.0 REST; `sdmx1` sources `IMF_DATA`/`IMF_DATA3`; no key for basic use). Easiest JSON path to WEO: **DataMapper API** `https://www.imf.org/external/datamapper/api/v1/{INDICATOR}/{ISO3}` (e.g. `/NGDP_RPCH/USA`, no key). Datasets: WEO (global growth baseline for US export demand), DOT (bilateral trade), COFER (USD reserve share — dollar-hegemony channel), Fiscal Monitor, BOP, **Global Debt Database** (via DataMapper). Legacy endpoints are dead — do not use `dataservices.imf.org`. BOTH horizons.
- **World Bank** — WDI API v2 (`api.worldbank.org/v2/`, no key — stable a decade) ◻; **Commodity "Pink Sheet"** — monthly XLSX, ~70 commodities (scrape landing page for the current hashed URL) ✅; Global Economic Monitor (monthly high-frequency macro, ~200 countries) ◻; **WITS** (bilateral tariffs) ✅.
- **OECD** ✅ — SDMX API `https://sdmx.oecd.org/public/rest/` (no key; SDMX-CSV recommended; get exact queries from the Data Explorer's "Developer API" button). Key series: **Composite Leading Indicators** (monthly, ~2wk lag — 6–9-mo turning-point signal for trading-partner demand), quarterly GDP, STES indicators (legacy MEI codes need remapping ⚠), confidence indices. LEADING (foreign cycle), SHORT.
- **BIS** ✅ — Data Portal `data.bis.org`, SDMX API (`stats.bis.org/api-doc/v2/`) + zipped-CSV bulk, no key: **policy rates for all major central banks** (one feed), credit-to-GDP gaps (banking-stress early warning), property prices (60 countries), effective FX rates, **global liquidity** (offshore USD credit — dollar-funding stress), international banking exposures. LEADING (financial cycle), BOTH.
- **UN Comtrade** ✅ — bilateral trade at HS detail. `comtradeapi.un.org`; free key via `comtradedeveloper.un.org` → 500 calls/day, 100k records/call (keyless preview: 500 records). Official Python wrapper `comtradeapicall`. ~1–3mo lag. Use Census FT-900 for US-side speed; Comtrade for partner-side and world structure. COINCIDENT, BOTH.
- **WTO** ✅ — `apiportal.wto.org` (free key): Timeseries API — merchandise/services trade, **bound/applied/preferential tariffs** (with USTR/USITC DataWeb on the US side, the direct causal input for the 2025–26 tariff regime). CAUSAL, SHORT.
- **UNCTAD** ✅ — UNCTADstat Data Hub (no registration; bulk + API): trade indices, FDI, **liner shipping connectivity**, world-trade nowcasts. **ILO ILOSTAT** ✅ (`sdmx.ilo.org/rest`, no key). **FAO Food Price Index** — monthly, free CSV, ~first Friday ◻; AMIS grain monitor ◻.

### 5.2 Foreign-economy sources that matter most for the US

- **China** — largest goods supplier; channels: supply chains, commodity demand, export markets, Treasury holdings. **NBS**: English portal web-query only; undocumented JSON endpoint is unstable — scrape defensively or use DB.nomics/FRED mirrors ⚠. **Customs (GACC)**: monthly trade, CAPTCHA-gated, no API ✅ — go through Comtrade (lagged) for programmatic. **PBoC**: TSF/M2 (credit impulse) HTML/XLS only ◻. **PMI**: official NBS PMI + S&P Global China PMI — ⚠ **Caixin sponsorship ended mid-2025; now published as "RatingDog PMI"** ✅ (headline free in press releases). SHORT+LONG.
- **Euro area** ✅ — **Eurostat** `ec.europa.eu/eurostat/api/dissemination` (SDMX 2.1 + JSON + TSV bulk, no key; Comext trade on a separate base). **ECB Data Portal** — API host `data-api.ecb.europa.eu/service/data/{FLOW}/{KEY}` (no key): policy rates, €STR, bank lending survey, FX (also static `eurofxref-hist.zip`), yield curves (flow `YC`). #1 trade/investment partner bloc + financial linkage. SHORT.
- **Japan** — **e-Stat API** (free appId) ◻, BoJ time-series search (CSV builder, no API) ◻, ESRI GDP, **Tankan** (quarterly, free tables). Channel: yen carry trade → US rates/vol spillovers; top foreign Treasury holder. SHORT (financial), LONG.
- **UK / Germany** — **ONS API** ✅ (`api.beta.ons.gov.uk/v1`, no key, 120 req/10s) + BoE IADB (CSV-by-URL, no modern API) ◻; **Destatis GENESIS** ✅ (REST/JSON, registration + token now required) + **Bundesbank SDMX** ✅ (`api.statistiken.bundesbank.de/rest`, no key — Bund yield curve). **Ifo climate + ZEW sentiment** = Europe's best free leading surveys ◻. SHORT.
- **Canada & Mexico** — top-2 trade partners, USMCA supply chains, remittances, nearshoring. **StatCan WDS** (no key) ◻, **BoC Valet API** (`bankofcanada.ca/valet/`, no key, clean) ◻; **INEGI** (free token; SDMX at `sdmx.snieg.mx` ✅), **Banxico SIE API** (free Bmx-Token — policy rate, FX, **remittances**) ◻. SHORT+LONG.
- **India / Brazil** — **MOSPI eSankhyiki** ✅ (APIs + **beta MCP server since Feb 2026** — CPI/IIP/national accounts; mind the Feb 2026 rebasing breaks), RBI data portal ◻; **IBGE SIDRA** + **BCB SGS/Olinda APIs** (no key; Selic, FX, Focus expectations) ◻. Growing trade/services channels. LONG.

### 5.3 Energy & commodities (fastest causal channel)

- **Oil triangle**: **OPEC MOMR** (monthly, free PDF + data appendix, `momr.opec.org`) ◻ + **IEA** ✅ (free account → data browser + real-time electricity tracker; **OMR full report paid, becomes free after ~3 months**; free monthly summary page) + **JODI** ✅ (free full CSV bundles — monthly production/demand/stocks, 100 countries, ~2mo lag). With EIA (§3.8) = the global supply picture. CAUSAL, SHORT — oil shocks are the classic exogenous US recession trigger.
- **Breadth**: World Bank Pink Sheet (§5.1) monthly; **USDA FAS OpenData API** ✅ (`apps.fas.usda.gov/opendatawebv2/`, free key: PSD world crop supply/demand, GATS ag trade, weekly export sales). **LME/CME**: no free APIs (delayed web quotes only) ✅ — use FRED mirrors (WTI, Brent, copper, natgas) for daily programmatic access. ◻

### 5.4 Trade / supply-chain / shipping nowcasts

- **IMF PortWatch** ✅ — `portwatch.imf.org`: daily AIS-based port calls + trade estimates for 2,065 ports and **28 chokepoints** (Suez, Panama, Hormuz…), updated weekly; **fully open — CSV/GeoJSON + ArcGIS REST API per dataset**. The best free chokepoint-disruption early-warning feed.
- **CPB World Trade Monitor** ✅ — monthly world trade & IP volumes (free XLSX, ~8wk lag). The canonical world-trade series.
- **Kiel Trade Indicator** ✅ — AIS-based nowcast of trade for 75 countries; updated ~5th + ~20th monthly; free CSV at `trade.ifw-kiel.de/KTI/`.
- **NY Fed GSCPI** ✅ — **active** (no suspension); monthly ~4th business day; direct file `newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx` (page 403s bots, xlsx fetches fine).
- **Container rates**: Freightos FBX — weekly values free via Terminal free tier, **no free API** ✅; Drewry WCI — weekly headline free on site ◻; **Baltic Dry — no free official feed** ✅ (display-only mirrors: Trading Economics, stooq). CTS monthly container volumes free ◻.
- **Port throughput** — LA (`portoflosangeles.org/business/statistics`), Long Beach, NY/NJ monthly TEUs, free pages ◻. Tariff-front-running + import-demand visibility. **AIS/flights genuinely free**: OpenSky Network (research API), aisstream.io (websocket); PortWatch is the free *processed* alternative. ◻

### 5.5 Surveys, uncertainty & risk indices (free, research-grade)

- **S&P Global PMIs** ✅ — headline flash/final for ~40 economies free in press releases (`pmi.spglobal.com/Public/Home/PressRelease/...`); history paid. **ISM** (US) headline + sub-indices free in monthly release ◻. LEADING, SHORT.
- **EPU (Baker-Bloom-Davis)** ✅ — free Excel at `policyuncertainty.com`: US daily/monthly, 22 countries, Global EPU (also FRED `GEPUCURRENT`), categorical splits. **TPU (Trade Policy Uncertainty)** — `matteoiacoviello.com/tpu.htm` ◻ — *the* index for the 2025–26 tariff regime. LEADING, SHORT.
- **GPR (Caldara-Iacoviello)** ✅ — monthly + daily geopolitical risk from 1985 (historical to 1900), country sub-indices, acts-vs-threats split; free `.xls` at `matteoiacoviello.com/gpr.htm`. LEADING (tail-risk), BOTH.
- **World Uncertainty Index** ✅ (143 countries, quarterly, free). **VIX** ✅ — official free CSV `cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv` (also FRED VIXCLS). **MOVE** — no official free feed ✅ (unofficial Yahoo `^MOVE` only). **OFR FSI** (§3.7) daily. 
- **GDELT** — free global news event/tone feeds, 15-min updates + BigQuery ◻; **Global Trade Alert** — event-level protectionism database ◻; **Yale Budget Lab / PIIE tariff trackers** — running US effective-tariff-rate estimates (HTML/CSV) ◻.

### 5.6 Long-term structural

- **UN World Population Prospects (WPP 2024)** ✅ — projections to 2100, 237 countries; bulk CSVs at `population.un.org/wpp/downloads`; Data Portal API (`/dataportalapi/api/v1/`, bearer token ⚠). Demographics = the deepest LONG driver (labor supply, housing demand, entitlement math).
- **Climate** — **Copernicus CDS/ERA5** ✅: new platform API `cds.climate.copernicus.eu/api` with Personal Access Token (`cdsapi` client; old v2 endpoints dead); NOAA NCEI CDO API (free token) ◻. Physical-risk, ag-yield, energy-demand channels.
- **Global leverage** — IMF Global Debt Database (free via DataMapper) + BIS credit gaps (§5.1); World Bank IDS for EM external debt. **IIF Global Debt Monitor is paid** — don't plan on it. ✅/◻
- **Conflict & migration** — **UCDP** (free, no key: `ucdpapi.pcr.uu.se`, monthly candidate events) ◻ — the free programmatic conflict feed; **ACLED** ✅ — registration-tiered, API on paid/institutional tiers only, ToS prohibits ML-training use ⚠; Fragile States Index (annual XLSX) ◻; **UNHCR API** (no key, refugee flows) ◻, IOM DTM displacement ◻. Border-pressure → labor-supply leading indicators.
- **Tech cycle** — **SIA/WSTS global semiconductor billings** (monthly, free in press releases) ◻; **Ember** global electricity data + API (real-time activity proxy for China/EU) ◻.

## 6. Transmission channels — how the data connects to outcomes

### 6.1 Short term (0–2 years, the cycle)

| Channel | Causal chain | Data to watch (§ ref) | Documented magnitude |
|---|---|---|---|
| Monetary policy | Fed rate path → housing/credit/investment → jobs → inflation | FOMC/SEP, H.15, fed funds futures (§3.1) | 100bp shock → IP ≈ −2 to −4% trough at ~24mo; price effects only after 1.5–2yrs (Romer-Romer 2004; Ramey 2016) |
| Energy prices | Oil/gas supply shocks → CPI + real income squeeze | EIA + OPEC/JODI (§3.8, §5.3) | Post-shale, ~10% oil rise → ≲0.1–0.2pp GDP drag, +~0.2pp headline CPI; *supply*-driven rises contractionary, demand-driven not (Kilian 2009) |
| Fiscal impulse | Deficits/transfers → demand | MTS/DTS, CBO, USASpending (§3.5, §3.9) | Purchases multiplier ≈0.6–1.0 aggregate, ~1.5–2 regional (Nakamura-Steinsson 2014); tax shocks −2 to −3% GDP per 1%-of-GDP rise (Romer-Romer 2010) |
| Trade policy | Tariff schedules → import prices, retaliation → exports | WTO/USITC DataWeb, TPU, port data (§5.1, §5.4, §3.9) | ✅ 2025–26: essentially **full pass-through ~7 months** after each tariff change; core-goods PCE +3.1% cumulative through Feb 2026 (Fed FEDS Note Apr 2026); CBO: +0.4pp/yr inflation 2025–26; PIIE: −0.9pp GDP growth 2025 |
| Credit supply | Bank health/standards → SME lending → employment | SLOOS, EBP/spreads, FDIC, SLOOS (§3.1, §3.7) | Lender-health shocks explain ⅓–½ of SME job losses post-Lehman (Chodorow-Reich 2014); EBP is the single best-performing financial predictor (§7) |
| Supply chains | Foreign disruption → goods prices, production halts | GSCPI, PortWatch chokepoints, freight rates (§5.4) | ~60% of the 2021–22 above-trend inflation run-up (FRBSF 2023-14); regime-dependent — near-zero signal in calm periods |
| Labor supply | Immigration flows → labor force growth → breakeven payrolls | CBP encounters, visas, CBO projections (§3.9) | ✅ 2025 net migration **negative** (first in ≥50yrs) → breakeven payrolls 20–50k/mo late 2025 vs 160–230k in 2023–24 (Brookings Jan 2026). Re-normalize every jobs threshold |
| Confidence/uncertainty | Policy uncertainty → investment deferral | EPU/TPU, GPR, VIX (§5.5) | Documented but second-order; sentiment *levels* now partisan-contaminated (§7) |
| Global financial cycle | Dollar/VIX → global credit → US net exports feedback | BIS, broad dollar, foreign CB rates (§5.1) | Mostly *outbound from* the US (Rey 2013); ~10% dollar appreciation ≈ −0.4 to −0.6pp US GDP over 2–3yrs |

### 6.2 Long term (2–20 years, the trend)

| Driver | Data (§ ref) | Why it dominates the horizon |
|---|---|---|
| Demographics | Census PEP, UN WPP, state demographers (§3.4, §5.6, §4.1) | Labor-force growth + household formation = potential GDP + housing demand; entitlement math |
| Migration (domestic) | IRS SOI flows, USPS proxies, ACS (§3.5) | The regional winner/loser selector — income follows people; 1–2yr lead on local housing demand |
| Productivity & innovation | BLS productivity, patents, R&D, BDS firm dynamism (§3.2, §3.9, §3.4) | The only sustainable per-capita growth source; AI diffusion watch: BTOS AI module |
| Fiscal trajectory | CBO long-term outlook, debt service (§3.9, §3.5) | r-vs-g debt dynamics → term premium, crowding-out risk |
| Climate exposure | FEMA NRI, NFIP, NOAA/Climate Central, ERA5 (§3.8, §5.6) | Insurance repricing, migration, asset devaluation — already visible in FL/CA insurance markets |
| Deglobalization / industrial policy | I-O tables, FDI/MNE data, Comtrade structure, tariff regime persistence (§3.3, §5.1) | Supply-chain reconfiguration → capex geography (nearshoring: Mexico data §5.2) |
| Human capital | NCES (⚠ degraded), state DOE, College Scorecard (§3.9) | Long-run regional productivity differentials |
| Energy transition | EIA AEO, FERC, Ember (§3.8, §5.6) | Capital reallocation + regional winners/losers (TX/Gulf vs rust belt dynamics) |

### 6.3 State/micro transmission (how national shocks localize)

National shock × **local exposure** = local outcome. The exposure maps, all in this catalog:
- **Industry mix** — QCEW county×NAICS + BEA I-O (Bartik shift-share: the workhorse local-demand predictor — Blanchard-Katz 1992)
- **Rate sensitivity** — construction/RE share (QCEW), mortgage stock rate structure (NMDB, HMDA)
- **Trade exposure** — state export composition (Census state trade) × tariff/retaliation schedules (2018-19 precedent: retaliation targeted agriculture; farm-state losses compensated by $23B USDA payments)
- **Fiscal exposure** — federal contracts/grants share (USASpending), federal workforce (OPM)
- **Energy exposure** — production states (TX, ND, NM, LA…) win from price rises that squeeze consumer states (EIA SEDS)
- **Climate exposure** — NRI composite, NFIP claims history
- **Migration sensitivity** — in/out-flow trends (IRS SOI), affordability gaps (RPP, FMR vs income)

---

## 7. Evidence base for the weights

The P (predictive evidence) scores in §2 come from this literature. Full citations from the 2026-07-10 research pass; ✅ = verified via web this session.

### 7.1 Real-time discipline (affects every R score)

- Real-time vintages materially change conclusions; results on revised data overstate achievable performance (Croushore & Stark 2001, *J. Econometrics*; Croushore 2011, *JEL*). Revisions are biased and predictable, not noise (Aruoba 2008, *JMCB*). Real-time output gaps are unreliable — revisions as large as the gap itself (Orphanides 2001, *AER*; Orphanides & van Norden 2002, *REStat*).
- Composite leading indexes look better ex post than in real time because components/weights get revised retrospectively (Diebold & Rudebusch 1991, *JASA*).
- **Rule**: backtest on ALFRED / Philly Fed RTDSM vintages; bonus for unrevised series (market prices, claims, ISM, CPI NSA, unemployment rate); penalty ∝ mean absolute revision (GDP advance→latest ~1.2–1.3pp annualized; payroll first prints ~50–70k MAR pre-COVID, worse after — §2A.9).

### 7.2 The 2022–2026 out-of-sample scorecard ✅ (the single most useful weighting input)

- **Broke / false-positived:** 10y–3m yield curve (26-month inversion Oct 2022–Dec 2024, no recession — longest on record); NY Fed probit (peaked ~66–71% mid-2023); Conference Board LEI (21-month recession call, retracted Feb 2024); Sahm rule (triggered Jul 2024 at 0.53, reversed, no recession — rise was immigration/supply-driven, as Sahm herself flagged); temporary-help employment (multi-year decline, no recession — structurally broken); ISM manufacturing (long sub-50 stretch = goods recession only); consumer sentiment levels (record lows amid solid spending, 2022 and May 2026 — now partisan-contaminated).
- **Worked:** initial claims (stayed low, correctly); **excess bond premium / credit spreads** (stayed tight, correctly — KC Fed Aug 2024; the star of the cycle); coincident labor/output data; **new-tenant-rent → shelter-CPI lead** (called the 2023–24 shelter disinflation ~4 quarters ahead: Zillow ZORI leads CPI rent 6–10mo, BLS NTRI ~4 quarters — KC Fed; Brookings); GSCPI (tracked the goods-inflation impulse up and down; ~60% of 2021–22 above-trend inflation — FRBSF 2023-14).
- **Regime-shifted (re-normalize, don't discard):** breakeven payroll growth (immigration-driven: 160–230k/mo 2023–24 → 20–50k late 2025, possibly negative 2026 — Brookings Jan 2026).

### 7.3 Classic anchors behind each §2 score

- **Yield curve**: best single recession predictor 1968–2020 at 4–6 quarter horizons (Estrella & Mishkin 1996, 1998; Harvey 1988) — now downgraded one notch by the 2022–24 false positive; term-premium critique says condition it on credit spreads.
- **EBP/credit spreads**: Gilchrist & Zakrajšek 2012 (*AER*) — dominates other financial indicators; confirmed 2022–26.
- **Claims**: administrative, near-universal, unrevised, weekly — top of the timeliness×reliability frontier (Barnichon & Nekarda 2012).
- **Permits/housing**: "Housing IS the business cycle" — residential investment is the most reliable leading GDP component, weak before 8 of 10 postwar recessions (Leamer 2007, Jackson Hole). Local: high permitting vs household formation predicts price/rent weakness 1–3yrs out (Glaeser-Gyourko-Saiz 2008; Saiz 2010); confirmed by the 2023–25 Sunbelt apartment supply wave.
- **House-price momentum**: the best-documented predictable pattern in US asset markets — metro appreciation serially correlated ~0.4–0.7 at 1yr, mean-reverting 3–5yrs (Case & Shiller 1989; Guren 2018; Glaeser & Nathanson 2017). High weight for 1-yr-ahead local direction.
- **Migration**: persistent local employment shocks absorbed by migration (Blanchard & Katz 1992); IRS flows = accurate but stale; USPS COA = the real-time proxy.
- **Sentiment**: modest incremental power even before the partisan break (Carroll-Fuhrer-Wilcox 1994; Ludvigson 2004 — "quite small" after controls; Bram & Ludvigson 1998: Conference Board > Michigan).
- **Stocks**: "predicted nine of the last five recessions" (Samuelson 1966); unstable predictor (Stock & Watson 2003, *JEL*); and ✅ ~28–41% of S&P 500 revenue is foreign — it isn't even a purely US signal.
- **Inflation expectations**: SPF beats models out-of-sample (Ang-Bekaert-Wei 2007); household 1-yr is biased + now partisan-split (✅ Michigan spiked ~6.5% spring 2025 on tariff fears vs far lower realized); breakevens carry liquidity premia. Rank: SPF > breakevens > household.
- **Wages**: do NOT lead prices (Knotek & Zaman 2014; Peneva & Rudd 2017; Bernanke & Blanchard 2023) — confirmatory only. ECI > AHE (composition).
- **Money (M2)**: unusable routinely (Estrella & Mishkin 1997); matters only at multi-SD extremes (Borio et al 2023).
- **State data**: QCEW = truth, CES state prints noisy (Philly Fed Early Benchmark Revisions exist because of this); LAUS is model-smoothed; Philly Fed indexes built per Crone & Clayton-Matthews 2005 — mind double-counting with national inputs.
- **Foreign shocks**: 1pp China slowdown → ~0.1–0.25pp US GDP (IMF spillovers; Fed IFDP 1260); euro-area similar; the *financial* channel (dollar, VIX, global rates) is bigger than direct trade for the US.
- **Composite-index warning**: LEI contains the yield spread, stock prices, ISM orders, permits, claims, hours — never weight it alongside its own components.
- **Goodhart's law**: any indicator adopted as a target degrades (monetary aggregates post-1979; arguably the Sahm rule post-popularization).

---

## 8. Integration guidance for this engine

Already ingested (per `public/data-vintages.json`): Zillow ZHVI/ZORI/inventory, FBI crime, FRED macro incl. SOFR, HMDA, IRS migration, Census permits, BEA county income, FEMA NRI + NFIP.

**Highest-value next adds** (weight × not-yet-ingested × retrieval ease):

1. **Weekly state UI claims** (DOL ETA CSVs, no key) — #1 state-lens weight; the only weekly official state labor signal; trivially small data.
2. **QCEW county×industry** (keyless CSV slice API) — the truth anchor for every market's employment/wage level; disciplines everything else; also gives industry-mix exposure vectors (§6.3).
3. **Census BFS weekly/state business applications** (FRED mirrors it) — validated leading indicator of local firm entry.
4. **Philly Fed state coincident + leading indexes** (one XLSX) — instant 50-state cycle signal, ~zero engineering.
5. **Credit conditions block** — EBP (Fed updates monthly on FEDS Notes page), NFCI (weekly CSV), SLOOS — the best-performing recession block of 2022–26.
6. **FHFA annual ZIP/tract HPI + UAD aggregates** — extends price coverage below metro without licensing.
7. **New-tenant rent lead** — already have ZORI; wire it explicitly as a 12-month-ahead shelter-inflation feature rather than only a level.
8. **Tariff/trade block** (2025–26 regime): USITC DataWeb + TPU index + port TEUs — the live causal driver this cycle.
9. **FDIC Summary of Deposits** — county credit-supply map, annual, free API.
10. **IMF PortWatch chokepoint feed** — free ArcGIS REST; the cheapest global-disruption early warning.

**Pipeline hygiene** (from §2A): treat 2025-10 as NA economy-wide; exclude/flag Colorado in state panels from 2025-01; join Connecticut on planning regions post-2024; shade CES first prints toward QCEW; pin local copies of any federal file you depend on; re-verify endpoints quarterly.

**Weighting in practice**: for a market score, use the §2.2/§2.3 micro+state weights as feature priors; for scenario/MC work, the §2.1 macro CAUSAL rows (Fed path, oil, fiscal/tariff) are the shock inputs and the LEADING rows (spreads, curve, claims, permits) set state probabilities; §6.3 exposure maps localize the shocks. Never feed a composite (LEI) and its components simultaneously; score real-time vintages, not revised history (§7.1).
