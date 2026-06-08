# Data Sources Inventory for AI Investment Diligence Platform (100+ Sources)

**Purpose**: Comprehensive list of downloadable (or easily fetchable) public/semi-public data sources to feed the Monte Carlo engine (`mc_reference.py` / `src/model/mc_reference.py`).

**How these map to the model** (per reference docs and review findings):
- **Price levels / AVMs** (Zillow ZHVI, Redfin, Case-Shiller, FHFA, Census median prices, assessor data): Use `prices_to_returns(prices)` then `fit_distribution(returns, periods_per_year=12 or 4)`.
- **Periodic returns series** (NCREIF-style quarterly total returns, REIT total returns, FRED HPI changes): Direct to `fit_distribution(..., periods_per_year=4 or 1 or 12)`. Apply `geltner_unsmooth` for appraisal-smoothed (NCREIF, some HPIs). Use `bias_mu < 0` and `bias_sigma_mult > 1` for survivorship/appraisal bias.
- **Cross-sectional** (Preqin-like since-inception IRRs/TVPI, fund performance): `fit_cross_sectional_irr`.
- **Macro / drivers for mu_adj or scenarios**: FRED rates, starts, employment, inflation, credit spreads, etc. (feed into `_compute_mu_adj_from_features_and_weights` or custom bias).
- **Comps / n_obs for confidence**: Long histories (Zillow 25+ yrs → n_obs=300+ → high confidence 100; client past deals for alpha edge).
- **Correlations / portfolio**: REIT indices, public market factors (Ken French), multiple HPIs for book corr.
- **VC / power-law**: Cambridge/Preqin/PitchBook benchmarks (use empirical mode or `vc_mixture_returns` helper); deal-level from PitchBook/Crunchbase samples.
- **Validation / units guards**: All sources must be converted/normalized per reference (no raw prices/TVPI into return fitter).
- **Bias correction**: Public indices often need explicit haircuts (appraisal smoothing, survivorship in private data).

**Access notes**: "Direct CSV" = free public download. "FRED direct" = per-series CSV/TXT. Gated noted. Many municipal open data portals have transaction/assessment CSVs for local returns estimation (aggregate to series).

**Total: 120+ entries** (Zillow ~20, FHFA ~15, FRED 20+ specific + category note, Census/HUD 15+, Kaggle/GitHub 15+, portals 10+, REIT/PE 10+, others).

## 1. Zillow Research (20+ direct public CSVs, price levels + rents + activity; ideal for `prices_to_returns` + ppy=12; heavily smoothed → geltner + bias)
Updated ~monthly on the 16th. Geos: National/US, Metro, State, County, City, ZIP, Neighborhood. Direct from https://www.zillow.com/research/data/

- ZHVI All Homes (SFR + Condo/Co-op), Smoothed Seasonally Adjusted, Mid-Tier ($)
- ZHVI All Homes, Raw, Mid-Tier
- ZHVI Top Tier / Bottom Tier
- ZHVI Single-Family Homes
- ZHVI Condo/Co-op
- ZHVI by Bedroom Count (1BR to 5+BR)
- ZHVF (Home Value Forecasts) MoM/QoQ/YoY, smoothed/raw
- ZORI (Observed Rent Index) Smoothed: All Homes + Multifamily, SFR, MF
- ZORF (Rent Forecasts)
- For-Sale Inventory (Smooth/Raw, All Homes / SFR, Monthly/Weekly)
- New Listings (Smooth/Raw)
- Newly Pending Listings
- Median / Mean List Price (Smooth/Raw, All/SFR)
- Sales Count Nowcast (All Homes, SFR)
- Median / Mean Sale Price (Nowcast)
- Sale-to-List Ratio (Mean/Median)
- Percent of Sales Above/Below List
- Days to Pending (Mean/Median, Smooth/Raw)
- Days to Close (Mean/Median)
- Share of Listings With Price Cut (Smooth/Raw, All/SFR)
- Mean / Median Price Cut ($, %)
- Market Heat Index (All Homes)
- New Construction Sales Count, Median/Mean Sale Price, Price per Sqft (Raw)
- Affordability series: New Homeowner/Renter Income Needed, Affordable Home Price, Years to Save, % of Income on Housing (20%/10%/5% down variants)
- Mortgage Payment estimates (various down payments)
- Total Monthly Payment (incl. taxes/insurance/maintenance)
- ZTRAX (Zillow Transaction and Assessment Dataset) - deeper transaction/assessor data (separate page, large)

**Relevance**: Primary for residential price appreciation comps/base rates. Long n_obs → high confidence. Convert levels to returns. Note: no income yield (add separately or use with client IRRs).

## 2. FHFA House Price Index (HPI) Datasets (15+ direct files, repeat-sales + all-transactions; free CSVs/TXT/XLSX/JSON from https://www.fhfa.gov/data/hpi/datasets)
Back to mid-1970s, national to tract/ZIP/county/metro/state/division. Purchase-only (sales), All-Transactions (sales + appraisals), Expanded-Data.

- Master HPI (appends monthly/quarterly, CSV/JSON/XML/SQL + dictionary/specs)
- Monthly Purchase-Only (US & Census Divisions SA/NSA, latest 18-mo summaries XLSX)
- Quarterly Purchase-Only: US/Census, States, 100 largest MSAs, Distress-Free, Puerto Rico, Manufactured Homes (TXT/CSV/XLSX)
- All-Transactions: US/Census (TXT/CSV/XLSX), States, MSAs/Divisions, Nonmetro, Puerto Rico, 3-digit ZIP, Manufactured, House Price Changes tables (PDF)
- Expanded-Data Indexes (US, Divisions, States, MSAs)
- Annual HPI (developmental): National, States, CBSAs, Counties, 3/5-digit ZIP, Census Tracts (XLSX/CSV)
- Summary: Median prices for manufactured (PO/AT), Loan purposes/refi share
- State Volatility Parameters (PO and AT)
- Related: Comparisons to Case-Shiller, lookup tables, weights, old delineations

**Relevance**: Excellent repeat-sales transaction-based (less smoothed than some). Use as price series or derived returns. Many geos for local comps.

## 3. FRED (Federal Reserve Economic Data) - Housing & Real Estate (20+ specific high-relevance series listed; category has ~47,000 total series; direct per-series CSV/TXT downloads from https://fred.stlouisfed.org/)
Search by tag "housing", "real estate", "residential". Bulk options available. Macro drivers + some price/volume series.

Specific high-value:
- CSUSHPINSA (S&P Cotality Case-Shiller US National HPI, monthly)
- USAUCSFRCONDOSMSAMID (Zillow ZHVI US)
- COMREPUSQ159N (Commercial Real Estate Prices US, quarterly)
- QUSR628BIS (Real Residential Property Prices US, BIS)
- HOUST / HOUST1F / HOUST5F / HOUSTNSA (Housing Starts, total/SF/MF)
- PERMIT (Building Permits)
- EXHOSLUSM495S (Existing Home Sales)
- HOSMEDUSM052N / MSPUS (Median sales prices, existing/new)
- ACTLISCOUUS / HOSINVUSM495N (Active listings / inventory)
- MSACSR (Months supply new houses)
- MORTGAGE30US (30y fixed mortgage rate)
- RHORUSQ156N (Homeownership rate)
- ETOTALUSQ176N (Total housing units estimate)
- Delinquency rates, foreclosure, home equity, etc.
- Many more: regional variants, manufactured, new sales by price tier, etc.

**Relevance**: Macro for mu_adj / bias / scenarios / correlations. Some HPI for returns. FRED is the backbone for base rates.

## 4. Census Bureau / HUD / BLS Housing Data (15+ direct downloads)
- Building Permits Survey (BPS): Monthly/annual by national/region/state/CBSA/county/place. Excel, text, comma-delimited. https://www.census.gov/permits or construction/bps
- New Residential Construction (starts, authorized, under construction, completions): https://www.census.gov/construction/nrc/
- New Residential Sales (sold/for sale, median/avg prices, by stage): https://www.census.gov/construction/nrs/ (data files)
- American Community Survey (ACS) 5-year estimates: Detailed housing tables (value, rent, tenure, rooms, year built, mortgage status, etc.) at block group to national. data.census.gov or API. Hundreds of tables.
- HUD: Income Limits (MTSP), Fair Market Rents (FMRs), LIHTC data, RHFS (Rental Housing Finance Survey).
- HUD Open Data / GIS: Residential construction permits by county, etc.

**Relevance**: Supply (permits/starts/completions) for macro drivers. ACS for local demographics / stock / affordability comps. Prices/rents for returns.

## 5. Case-Shiller / S&P Cotality (multiple free CSVs)
- National and city-level via FRED (direct download per series).
- datahub.io/core/house-prices-us: national-month.csv, cities-month-SA.csv, cities-month-NSA.csv (direct CSV downloads).
- S&P Dow Jones Indices site for additional.

**Relevance**: Repeat-sales transaction price index. Good for `prices_to_returns`.

## 6. Redfin Data Center (direct downloads)
- https://www.redfin.com/news/data-center/ and /downloads/ : Housing Market Tracker (weekly & monthly), inventory, prices, sales, etc. across US markets. CSV exports.

## 7. NAR (National Association of Realtors) Existing-Home Sales & Related
- Existing-Home Sales (national, regional, some metro; volume + median prices): Reports + some historical data files (realtor.com/research-and-statistics).
- Pending Home Sales Index, Housing Affordability Index, metro statistics.
- Many series mirrored on FRED.

## 8. Public REIT / Listed Real Estate Indices (total returns, direct spreadsheets)
- FTSE Nareit US Real Estate Index Series: Historical Values & Returns (monthly/annual), sector indices from reit.com/data-research/reit-indexes (spreadsheets).
- Global/EPRA variants (some member access).
- Individual REIT total returns via Yahoo Finance / FRED proxies or direct downloads.

**Relevance**: Public market proxy for RE returns (total, levered). Good for correlations / beta in portfolio path. Annualized easily.

## 9. NCREIF (Public snapshots for recent quarters; full historical gated)
- ncreif.org/news/ : Press Releases + Snapshot Reports (PDFs) with quarterly NPI (Property Index) and NFI-ODCE (Open-End Diversified Core Equity) total/income/appreciation returns, recent + some historical tables.
- Public summaries in third-party reports (RCLCO, etc.).
- Full detail spreadsheets/CSV back to 1977s gated (members).

**Relevance**: Gold-standard unlevered institutional total returns (exactly the "NCREIF quarterly" the model was designed for). Use ppy=4 + geltner + bias_mu <0 for appraisal + selection bias. Recent quarters free; longer history via paid or proxies.

## 10. Commercial Real Estate Price / Transaction Indices (public reports + some data)
- Green Street CPPI (Commercial Property Price Index): Monthly public updates / press (real-time via REIT portfolios).
- Moody's / RCA (now MSCI) CPPI: Transaction-based; public summaries, reports, some index values in press/research.
- CoStar CCRSI (Commercial Repeat-Sales Index): Public commentary + data points.
- MSCI Real Estate / IPD indices (some public summaries).

**Relevance**: For commercial RE base rates / beta. Transaction vs. appraisal distinction important for bias.

## 11. Private Markets / VC / PE Benchmarks (free tiers + public stats)
- Cambridge Associates Private Investment Benchmarks: Selected statistics free (https://www.cambridgeassociates.com/private-investment-benchmarks/).
- Preqin: Free account for selection of private capital benchmarks; periodic free reports/brochures; full gated.
- PitchBook: Public Private Market Indexes, Return Barometers, VC Dealmaking Indicator, some free insights / league tables.
- Burgiss: High-quality (often via LPs/institutions); referenced in academic comparisons.
- Academic/FOIA extracts in papers (e.g., Brown/Harris/Jenkinson/Kaplan/Robinson studies with vintage IRR/TVPI tables from multiple providers).

**Relevance**: Cross-sectional for `fit_cross_sectional_irr` or empirical bootstrap. Use VC mixture helper for power-law. Bias haircuts critical (survivorship/backfill).

## 12. Kaggle & GitHub Housing / Real Estate Datasets (15+ CSVs, great for testing / local comps)
- California Housing Prices (camnugent/california-housing-prices)
- Ames Housing (house-prices-advanced-regression-techniques competition)
- Melbourne Housing Market
- Boston / Indian cities / Buenos Aires / etc. price datasets
- Many "housing.csv" for regression (median income, age, rooms, population → price)
- GitHub repos mirroring or extending (e.g., dmarks84 California, dipalira Melbourne)

**Relevance**: Price prediction features for DDQ feature engineering or local n_obs comps. Convert where possible to returns series.

## 13. US Government Open Data Portals & Municipal (hundreds of property-level CSVs for aggregation to returns)
- data.gov: 350k+ datasets; search "housing", "property", "real estate", "permits", "assessor", "transactions". Many county/city level.
- NYC Open Data, Chicago, Philadelphia, Detroit, Milwaukee, etc.: Property sales/transfers, assessments, tax, building permits, violations (granular; aggregate by geo/time for local HPI/returns series).
- HUD Open Data / ArcGIS: Residential construction permits, etc.
- GSA REXUS (federal buildings inventory).
- County assessor/recorder portals (most US counties have downloadable CSV/Excel of recent sales/assessments).

**Relevance**: Hyper-local transaction data for custom comps or thin-history deals. Aggregate to periodic returns.

## 14. International & Global
- Eurostat, OECD, World Bank, IMF: Housing price indices, rents, construction, affordability (many CSV downloads).
- National stats offices (UK HPI, Canada, Australia, etc.).
- BIS real residential/commercial property prices (via FRED or direct).
- MSCI / IPD global real estate indices (summaries public).
- EPRA / FTSE EPRA Nareit global REIT indices.

## 15. Additional / Niche Public Sources
- Freddie Mac House Price Index (FMHPI).
- CoreLogic / ATTOM public releases or samples (property data).
- NAR Commercial Research reports.
- NAHB / NAHB Economics (starts/permits forecasts + data).
- Ken French Data Library (public market factor returns for correlations / public proxies).
- Google Open Buildings (building footprints/counts as stock proxy).
- BLS (employment, wages by metro for macro / demand drivers).
- Treasury / Fed flow of funds (real estate holdings, etc.).
- Academic SSRN / university repos with cleaned series or FOIA data.
- Kaggle "private equity" or "venture capital" performance datasets (vintage-level).
- Municipal + state open data (thousands of property records).
- Realtor.com data releases (some public via reports).
- CoStar public news / indices commentary.
- Green Street, RCA/MSCI research reports with index values.
- EPRA total returns.
- Various city/county transaction logs (e.g., Philadelphia real estate transfers).

## Notes on Usage & Gaps
- **Free direct CSVs (high priority for model)**: Zillow (many), FHFA (many), FRED (per series), Census BPS/new construction/sales, Redfin, datahub Case-Shiller, reit.com Nareit historical, most open data portals, Kaggle.
- **Gated or summary-only**: Full NCREIF historical, full Preqin/PitchBook/Burgiss, detailed CoStar/Green Street beyond public indices.
- **Workarounds**: Use recent public snapshots for NCREIF (PDF tables → manual/OCR to series); academic papers for vintage PE/VC tables; FRED mirrors for many private indices; aggregate public transaction CSVs for local "custom NCREIF".
- **Volume warning**: Raw metro Zillow or full county assessor files can be large (GBs). Start with national/tidy extracts (as done for US ZHVI).
- **Next steps for platform**: 
  1. Extend `src/data/connectors.py` with loaders for FHFA master, Census BPS, NAR via FRED or direct, Nareit spreadsheets, etc.
  2. Add `scripts/fetch_data_sources.py` that pulls a starter set (Zillow national, FHFA US, key FRED, Nareit returns, recent NCREIF snapshots).
  3. For each source, document exact `periods_per_year`, recommended `geltner` / `bias_*`, and sample `score_opportunity` call.
  4. Wire into DDQ (e.g., "source = 'Zillow ZHVI national'" → auto bias_sigma_mult=1.05 + smoothing flag).
  5. For VC phase: pull Cambridge/Preqin free benchmarks + use mixture mode.

**Sources compiled from**: Zillow Research data page, FHFA datasets page, FRED, Census/HUD sites, reit.com, ncreif.org, Cambridge/Preqin/PitchBook public pages, data.gov, Kaggle, academic comparisons (Brown et al.), Redfin Data Center, S&P/Case-Shiller, NAR research, open data portals, and targeted searches (as of June 2026). List is non-exhaustive; FRED + municipal open data alone push well over 100 usable series/files when counting variants/geos.

Update this file as new pulls are added (e.g., via `scripts/pull_data.py`). Always validate units and apply bias/de-smoothing per the reference implementation and review findings (41 confirmed defects, especially risk understatement from smoothed data + wrong annualization + negative-edge Kelly floor). 

For the full adversarial-verified engine, see `reference/mc_invest_score.py` and `src/model/mc_reference.py`.