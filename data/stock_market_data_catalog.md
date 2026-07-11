# Stock Market Data Catalog & Two-Way Correlation Map

**Compiled 2026-07-10** via a six-track verification pass (real-time access, EOD APIs, deep history, official/regulatory — live endpoint probes, market-adjacent series, and the correlation-evidence literature). Companion to `public_economic_data_catalog.md`; same legend: ✅ web-verified this pass / ◻ stable knowledge / ⚠ verify before building. Free-tier terms in this space change fast (§1b) — re-check ⚠ items before wiring them in. Answers:

1. Where to get equity market data — **live**, **current**, and **all of its history** — and what is genuinely free vs licensed.
2. What data is related/correlated with the stock market **in both directions**: what leads/drives stocks (Direction A), and what stocks lead/drive (Direction B), weighted by correlation/causation evidence.

## 0. The licensing reality (read first)

US consolidated real-time equity data (every trade/quote across exchanges — the CTA/UTP SIP feeds) is **licensed, never free**. Everything "free real-time" is a subset: one exchange's own feed (IEX), delayed data (15–20 min), or end-of-day. Deep history is where free is actually excellent (academic datasets to 1871+). Plan accordingly: EOD + official/regulatory data free forever; true real-time = pay or accept IEX-only coverage (~2% of volume).

## 1. Live / real-time

Bottom line ✅: **free + legal + real-time + programmatic US equities = essentially one option (Alpaca's IEX feed)**. Everything else free is delayed, display-only, or crypto.

- **The SIPs (CTA/UTP consolidated tapes)** ✅ — every US trade/quote + NBBO, real-time: **licensed only**, via executed vendor/subscriber agreements with per-user reporting. Fee magnitudes (Cboe DataShop summary): non-pro display $3/user/mo, pro $66–92/user/mo, real-time access ~$3.5k/mo, **non-display ~$9.5k/mo**, redistribution ~$3k/mo. Delayed (15-min) data is cheap/lightly licensed — that's what free APIs legally resell. Schedules: `ctaplan.com/pricing`, `utpplan.com`.
- **IEX Exchange** ✅ — real-time TOPS/DEEP went **paid Jan 2022** ($500/mo TOPS, $2.5k DEEP, signed Data Subscriber Agreement, direct feed only — no public API). Free remainder: **delayed TOPS/DEEP** and **HIST** (T+1 full-feed gzipped pcaps at `iextrading.com/trading/market-data/`). **IEX Cloud shut down Aug 31, 2024** — anything on `cloud.iexapis.com` is dead.
- **Alpaca Markets** ✅ — the genuinely-free real-time path: **IEX-sourced feed** (~2–3% of volume; prices ≠ NBBO), WS `wss://stream.data.alpaca.markets/v2/iex` (**30 concurrent symbols** free) + REST `data.alpaca.markets/v2` (**200 req/min**), 7+ yrs history (most recent 15 min of SIP history blocked on all plans); **$99/mo** upgrades to full SIP + unlimited WS. Free keys.
- **Tradier** — real-time equity + **options chains with greeks** free with a no-minimum brokerage account (`api.tradier.com/v1/markets/`, OAuth, ~120 req/min); free sandbox is 15-min delayed. Cheapest legitimate real-time options. ◻
- **Schwab Trader API** — TD Ameritrade's replacement (TDA retired 2024): real-time quotes/chains/history free with a Schwab account; manual app approval. ◻
- **Cboe delayed JSON (no key)** ✅ — verified live by direct fetch: `https://cdn.cboe.com/api/global/delayed_quotes/quotes/{SYM}.json` (equities: `AAPL`; indices underscore-prefixed: `_SPX`, `_VIX`) — full quote incl. bid/ask sizes, OHLC, IV30; options chains at `.../delayed_quotes/options/{SYM}.json`. 15-min delayed, **display-grade** (no published API ToS — don't redistribute). Best free options/index snapshot.
- **Finnhub** — free key, 60 calls/min: US quotes marketed real-time but **degraded/limited** post-2024 ⚠ (conflicting 2026 reports incl. a ~300/day cap; official pages unfetchable); WS ~50 symbols free; **historical candles removed from free tier (2024)** ✅.
- **Tiingo** ✅ — ⚠ **IEX real-time no longer free**: since **Feb 2025** the TOPS-based feed requires the **$30/mo Power plan + a signed IEX market-data agreement**; free Starter tier (50 req/hr, 1k/day, 500 symbols/mo) remains good for EOD/fundamentals/news.
- **Polygon.io → "Massive"** ✅ — **rebranded Oct 30, 2025** (`polygon.io` 301s to `massive.com`; `api.polygon.io` still honored "for an extended period"). Free tier: delayed/EOD, 5 calls/min, no WS. Paid: ~$29 delayed-unlimited / ~$79 real-time / ~$199 unlimited+WS ⚠ (JS-walled pricing — confirm in browser).
- **Twelve Data** ✅ — free 8 credits/min, 800/day; own-aggregation "real-time" US on free, WS trial-only. **marketdata.app** — free ~100 req/day incl. options ◻.
- **Databento** ✅ — the cheap *licensed* path: usage-priced per GB, **$125 free credits** (historical, 6-mo expiry); **Standard $179/mo adds live**; 45+ venues (CME, OPRA, US equities incl. TotalView-class depth, `IEXG.TOPS`); DBN/CSV/JSON, Python/C++/Rust clients.
- **Crypto (24/7 risk-appetite proxy)** ✅ — genuinely free full real-time, keyless: Binance `wss://stream.binance.com:9443` or market-data mirror `wss://data-stream.binance.vision` (24h connections, 1,024 streams/conn, 300 conn-attempts/5min/IP; US persons → binance.us); Coinbase Exchange `wss://ws-feed.exchange.coinbase.com` (subscribe within 5s) + Advanced Trade WS (`level2`/`ticker`/`candles` keyless, 8 conn/s/IP); REST `api.binance.com/api/v3/klines` keyless.
- **Display-only traps** ✅ — TradingView license bans all automated collection AND all non-display use (algo decisions, price referencing); Yahoo ToS ban scraping — **yfinance is unofficial**, regularly breaks, never a product's live path; Nasdaq.com quote bar is real-time NLS display (internal `api.nasdaq.com` is bot-protected, ToS-gray); NYSE.com delayed.

## 1b. Landscape changes 2024–26 (will break older assumptions)

Verified ✅ unless noted: **IEX Cloud dead** (Aug 31, 2024); **Polygon.io → Massive** (Oct 30, 2025; dual domains); **Tiingo IEX feed paid** (Feb 2025, $30/mo + IEX agreement); TD Ameritrade API retired (2024) → Schwab ◻; **Alpha Vantage free = 25 req/day** + `DAILY_ADJUSTED` premium; **Finnhub candles off free** (403); FMP free ~5yr US-only; Marketstack v2 free = 100 req/month; Yahoo 429 waves 2024–26 (yfinance now needs `curl_cffi`); **Databento live equities moved to subscription Jan 2025** (Standard ~$179–199/mo ⚠ conflicting reports); **FRED: Wilshire deleted Jun 2024, ICE BofA spreads truncated to 3-yr window Apr 2026** (§4b); **NAAIM subscription from Aug 1, 2026** (§4b); **CFTC COT halted Oct 1–Nov 12, 2025** (shutdown; cleared Dec 29); **T+1 settlement live May 2024** ◻; SEC tick-size/access-fee/odd-lot reforms ~Nov 2025 (tick history changes character across that date) ◻; **24X National Exchange** approved + NYSE/Nasdaq extended-hours push ◻ — "the close" is becoming a configuration decision; **Texas Stock Exchange** approved 2025 ◻; CoinGecko now requires a (free) demo key ◻; Nasdaq Data Link WIKI still dead ✅; Wilshire Indexes reportedly in administration early 2026, 5000 reacquired by Wilshire Advisors ⚠.

## 2. Current & recent history (free EOD APIs) — verified 2026-07-10

| Source | Free calls | EOD history depth | Adjusted? | Redistribution |
|---|---|---|---|---|
| **Tiingo** ✅ | 1,000/day, 50/hr, 500 symbols/mo | 30+ yrs, 108k securities | Yes (`adjClose` + `divCash`/`splitFactor`) | No — "internal use only" |
| **Stooq** ✅ | unpublished per-IP daily cap | ^SPX spliced "to 1789", stocks decades | Yes (splits; dividends optional) | Unclear — hobby service |
| **yfinance** ✅ | unofficial; Yahoo 429 waves | to 1962+; ^GSPC 1927 | Yes (`auto_adjust`) | No — personal research |
| **Twelve Data** ✅ | 800 credits/day, 8/min | full daily history (US) | param | No |
| **Massive (ex-Polygon)** ✅ | 5/min | 2 yrs on free | split-adj default | No |
| **Alpha Vantage** ✅ | **25/day** | 20+ yrs raw; **adjusted = premium** | Premium | No |
| **FMP** ✅ | 250/day | 5 yrs, US-only on free | — | No |
| **EODHD** ✅ | 20/day (demo key: 6 tickers unlimited) | 1 yr on free | Yes | Personal |
| **Marketstack** ✅ | **100/month** | 1 yr on free | v2 adj close | Paid only |
| **Finnhub** ✅ | 60/min | **no candles on free** (403) | — | No |
| **Nasdaq Data Link** ✅ | 50k/day registered | **no living free equity dataset** (WIKI frozen 2018) | — | per-dataset |

- **Retrieval patterns**: Tiingo `api.tiingo.com/tiingo/daily/{tkr}/prices?startDate=...&format=csv&token=KEY`; Stooq `stooq.com/q/d/l/?s=aapl.us&i=d` (+`d1=`/`d2=`; bulk zips at `/db/h/`, CAPTCHA-gated; "Exceeded the daily hits limit" on abuse); Massive `api.polygon.io/v2/aggs/ticker/{tkr}/range/1/day/{from}/{to}?apiKey=` (limit ≤50k); Alpha Vantage `alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=full`. ✅
- **yfinance status** ✅: v1.5.1 (Jun 2026), `curl_cffi` now mandatory; persistent Yahoo 429/crumb battles 2024–26; fine for occasional pulls with hard throttling + cache + non-datacenter IPs; never a production dependency. **Survivorship-biased** (delisted tickers vanish) — same for Stooq.
- **Engineer's takeaway** ✅: **Tiingo is the only free tier with production-shaped limits**; Stooq is the deep-history backfill; Massive free covers 2-yr bars; AV/EODHD/Marketstack are demo-grade; Finnhub free has no candles.
- **FRED equity series (licensing windows, all verified on series pages)** ✅ — `SP500` + `DJIA`: **rolling 10-year window only** (S&P DJI agreement); `NASDAQCOM`: full 1971→; `NASDAQ100`: 1986→; `VIXCLS`: full 1990→; **all Wilshire series deleted Jun 3, 2024**. Licensed series can't be redistributed — pull at runtime. FRED HTML/fredgraph 403s datacenter clients — use the API.

## 3. Deep history (free, academic/official) — verified 2026-07-10

- **Shiller data** ✅ — monthly S&P composite price, dividends, earnings, CPI, long rate, **CAPE** (+ Total-Return CAPE) back to **1871**. ⚠ **The maintained home is now `shillerdata.com`** (republished 2026-07-08; scrape the "ie_data (xls)" button link — the blob URL's `?ver=` stamp rotates). **The old Yale page's `ie_data.xls` is frozen at Oct 2023** — do not use it. XLS has header/footnote rows + fractional dates (`YYYY.MM`, `.1` = October).
- **Ken French Data Library** ✅ — US market return **daily since 1926-07**, monthly factors (SMB/HML/RMW/CMA/momentum), industry portfolios, international factors; current through May 2026, updated monthly ~1mo in arrears; direct zips, no key: `mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip` (+`_daily_`). Note: built from CRSP's new CIZ format since Jan 2025. CSVs have preamble rows + multiple sub-tables; returns in percent. The correlation/beta backbone.
- **Jordà-Schularick-Taylor Macrohistory** ✅ — equity/housing/bond/bill **total returns, 18 countries, annual 1870–2020**; current release still **R6 (2022)** — treat as static. Stata/XLSX at `macrohistory.net/database`. ⚠ **License CC BY-NC-SA 4.0 — non-commercial only**; forbids resale.
- **Damodaran (NYU Stern)** ✅ — annual US stocks/bonds/bills returns **1928–2025** (`pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls`); **implied ERP monthly** (`.../pc/implprem/ERPbymonth.xlsx`, Sep 2008→; July 2026 reading: 4.18%); annual full refresh each January (last: Jan 9, 2026). Free, cite Damodaran.
- **Goyal-Welch predictor dataset** ✅ — the standard equity-premium predictor panel, **1871–2025**, monthly/quarterly/annual tabs; updated annually via Google Drive links on Amit Goyal's site (`sites.google.com/view/agoyal145`). ⚠ series break: lty/ltr/corpr sourced from Bloomberg from 2022 on.
- **Jay Ritter IPO data (U. Florida)** ✅ — IPO counts + first-day returns (monthly since 1980, aggregates since 1960), long-run returns, VC/tech splits, 55-country underpricing; **updated Jan–Mar 2026**; free XLS at `site.warrington.ufl.edu/ritter/ipo-data/`.
- **Baker-Wurgler sentiment index** ✅ — monthly SENT/SENT⊥ **Jul 1965–Dec 2023**; `pages.stern.nyu.edu/~jwurgler/data/SENTIMENT.xlsx`. ⚠ **stale** — file last touched Jun 2024; plan for ~annual-or-worse lag.
- **CRSP** (survivorship-bias-free stock-level, Dec 1925→) — paid WRDS institutional access only; the reason free sources can't do serious cross-sectional backtests. ◻ **MeasuringWorth** ✅ — DJA daily from **Feb 16, 1885** + 1790s-era annual indices; live/current; **non-profit educational use with citation, no bulk/API**. **Global Financial Data** (1600s→, institutional paid). ◻ **NBER Macrohistory** (pre-WWII series, free). ◻
- **Community/other**: **DoltHub `post-no-preference`** — free daily-updated SQL databases incl. **options 2019→ (~2k underlyings)**, stocks, earnings ✅ (community-run — validate before trusting); **OpenBB Platform** ✅ (open-source aggregation layer over ~100 providers, AGPLv3 — a normalization shim, not a source); intraday archives: FirstRate Data / Kibot / AlgoSeek (paid flat files, 1-min to ~2000) ◻; NYSE TAQ (tick, 1993→, enterprise/WRDS) ◻.

## 4. Official & regulatory market data (all free)

All live-probed 2026-07-10 unless noted. Bot-walls everywhere: SEC wants UA `Name contact@email`; spglobal/theocc/msci/stoxx want a browser UA.

- **SEC** ✅ (live-probed) — XBRL **companyfacts/companyconcept/frames** (`data.sec.gov/api/xbrl/...`) = point-in-time fundamentals with filing timestamps (look-ahead-bias-safe; frames can silently mix fiscal calendars); `submissions/CIK##########.json` (<1s freshness); nightly bulk `companyfacts.zip`/`submissions.zip`; full-text search `efts.sec.gov/LATEST/search-index?q=` (2001→). **Insider Transactions Data Sets** — quarterly Forms 3/4/5 TSV zips, **2006q1–2026q2** (`/files/structureddata/data/insider-transactions-data-sets/{yyyy}q{n}_form345.zip`; newest quarter moved to `/files/datastandardsinnovation/...` — scrape the page); near-real-time Form 4s: poll submissions + parse ownershipDocument XML. **13F datasets** 2013q2→ (naming switched to date-window form after 2023q4). **Fails-to-deliver** — `sec.gov/data-research/sec-markets-data/fails-deliver-data`, `cnsfails{yyyymm}{a|b}.zip`, current through Jun 2026a; CNS aggregates only. **MIDAS still published** (quarterly zips, 2012Q1–2025Q4). **N-PORT** — quarterly zips 2019q4→; only the 3rd month of each quarter goes public (monthly-disclosure amendments pushed to Nov 2027 and being scaled back per Feb 2026 proposal). **Rule 605 modernization compliance: Aug 1, 2026** (reports live on each broker/market-center's own site — no central repo). Free Form-4 screener layer: **openinsider.com** (CSV exports; 403s datacenter IPs); avoid secform4 free (6-mo delayed).
- **FINRA** ✅ (live-probed) — Query API `api.finra.org/data/group/{group}/name/{dataset}`: **`consolidatedShortInterest`** (bi-monthly, latest settlement 2026-06-30), **`regShoDaily`** (daily short-sale volume), **`weeklySummary`** (OTC/ATS venue volumes), `treasuryWeeklyAggregates`. Anonymous GET currently works on public sets but is undocumented — register the free "Public" OAuth credential for production (1,200 req/min; 5k records/sync response; `/partitions/` + `/metadata/` helpers; sorting requires partition-key EQUAL filters). No-auth flat files: `cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt` (history from Aug 2009). **Margin statistics**: monthly debit balances, **Excel back to Jan 1997**, published 3rd week of following month (consolidated series effectively begins 2010).
- **CFTC COT** ✅ (live-probed, current through 2026-07-07) — Socrata, no key: legacy `6dca-aqww`, **TFF `gpe5-46if`** (equity-index positioning: E-mini S&P `13874A`, Micro `13874U`, **S&P 500 Consolidated `13874+`**; Nasdaq-100/Russell in same report), disaggregated `72hh-3qpy`. Released Fri 3:30pm ET for Tuesday positions. **Halted Oct 1–Nov 12, 2025 (shutdown); normal schedule resumed Dec 29, 2025** — tolerate multi-week gaps. (The hack-related delay was ION ransomware, Feb–Mar 2023, not 2025.)
- **Cboe** ✅ (live-probed) — index history CSVs `cdn.cboe.com/api/global/us_indices/daily_prices/{SYMBOL}_History.csv` — verified for **VIX (1990→, current), SKEW, VVIX, VIX9D, VIX3M, RVX**; catalog at `.../definitions/all_indices.json`; delayed quotes/options JSON (§1). **Put/call ratios**: frozen archives 2006–Oct 2019 at `cdn.cboe.com/resources/options/volume_and_call_put_ratios/` (`totalpc.csv`, `equitypc.csv`…); current dailies on `cboe.com/us/options/market_statistics/daily/` (date-selectable — scrape per date; post-2019 bulk history = paid DataShop).
- **OCC** ✅ (live-probed, no auth) — `marketdata.theocc.com/daily-volume-statistics?reportDate=YYYYMMDD&format=csv` + `daily-open-interest?reportDate=MM/DD/YYYY&action=download&format=csv`.
- **ICI** ✅ — weekly combined fund+ETF flows with free Excel (`ici.org/research/stats/combined_flows`; `flows_data_2026.xls` fetched OK), monthly Trends workbooks, ETF net issuance. The retail-flow gauge.
- **Index providers (free slices)** — **S&P DJI**: quarterly **buyback history XLSX** ✅ (`.../additional-material/sp-500-buyback.xlsx`, ~2.5-mo lag) + earnings & estimates sheet (`sp-500-eps-est.xlsx`) ⚠ **Silverblatt retired Jan 2026; last confirmed update Jan 23, 2026 — verify continuation before depending on it**; **MSCI** EOD index search (form-driven, no API, no redistribution) ✅; **FTSE Russell** free daily values page + factsheets ✅ (reconstitution goes semi-annual 2026); **STOXX** free history files dead/frozen-2016 ✅ — use ECB Data Portal for SX5E history; **WFE** statistics behind free registration ✅.
- **Breadth & short interest odds-and-ends** ✅ — **no official free NYSE/Nasdaq A/D feed exists** (confirmed) — compute from constituents; NYSE Group short interest is a **paid** product (use FINRA's consolidated set instead); Nasdaq per-symbol short interest via unofficial `api.nasdaq.com/api/quote/{SYM}/short-interest` (browser UA). Universe files: **Nasdaq Trader symbol directories** ✅ (`nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt` + `otherlisted.txt`, nightly, + Daily Market Summary page); SEC `company_tickers.json`; **OpenFIGI** + **GLEIF LEI** for symbology ◻.
- **Fed system (ownership & context)** — **Z.1** (corporate equities by holder sector + net equity issuance F.223, quarterly), **DFA** (equity ownership by wealth percentile), **TIC** (foreign holdings of US equities), SF Fed news sentiment. Main catalog §3.1/§3.5. ◻

## 4b. Market-adjacent free series — verified specifics & deadlines ✅

- **Credit spreads on FRED — ⚠ URGENT**: `BAMLH0A0HYM2` (HY OAS), `BAMLC0A0CM`, BBB/CCC variants remain daily, **but starting April 2026 FRED serves only a rolling ~3 years** of ICE BofA history (was 1996→). Long history: pull pre-Apr-2026 vintages from **ALFRED** now and pin locally. ICE is a third-party beneficiary of the ToU — don't redistribute the raw series.
- **Rate expectations — no free API**: CME FedWatch web tool is free, its API is paid (~$25/mo EOD); FRED carries no fed-funds futures. Free path: **Atlanta Fed Market Probability Tracker** (daily, SOFR-options-based; scrape its chart-pod JSON) or `pyfedwatch` + your own ZQ prices.
- **Term premium / ERP**: NY Fed **ACM term premia** (daily, 1961→, XLS from the term-premia page; 403s bots — browser UA); FRED `THREEFYTP10` (Kim-Wright) as the easy mirror; **Damodaran implied ERP** monthly (§3).
- **AAII sentiment survey** — weekly bull/bear since Jul 1987; full-history `sentiment.xls` behind an AAII **account login** (free-vs-paid unclear; Imperva blocks bots) — plan a logged-in browser download.
- **NAAIM Exposure Index — ⚠ DEADLINE**: weekly manager equity exposure since Jul 2006, free full-history XLSX scraped from `naaim.org/programs/naaim-exposure-index/` — **moves to subscription Aug 1, 2026. Download the history file now.**
- **IPO stats**: Ritter (§3, the standard); stockanalysis.com/ipos (free lists/calendar/stats); Nasdaq IPO calendar via unofficial `api.nasdaq.com/api/ipo/calendar?date=YYYY-MM` (browser headers; `finance_calendars` wrapper); Finnhub/FMP free-tier IPO calendars.

## 5. Direction A — what leads/drives the stock market

**The sobering baseline first** ✅: most published return predictors fail out-of-sample (Welch & Goyal 2008, *RFS*), and the updated **Goyal, Welch & Zafirov 2024 (*RFS* 37(11))** re-test of 29 newer predictors found over a third lose significance even in-sample, half the rest fail out-of-sample. Anomalies decay after publication: **−26% out-of-sample, −58% post-publication** (McLean & Pontiff 2016, *JF* — exact figures verified). Horizon is everything — almost nothing predicts next month; a few things predict the next decade. The two GWZ-robust survivors are in the table.

| Driver | Role | Horizon | Evidence strength | Free dataset (§ ref) |
|---|---|---|---|---|
| **Monetary policy surprises** | CAUSAL | event–quarters | Strong: 25bp surprise cut → ~+1% S&P same day (Bernanke & Kuttner 2005, *JF*) — the best-identified causal Direction-A result | FOMC calendar, H.15 (§4, main §3.1) |
| **Aggregate short interest** ✅ | LEADING | 1–12 mo | **GWZ survivor** — annual in/OOS R² ~13%, arguably the strongest aggregate predictor (Rapach-Ringgenberg-Zhou 2016, *JFE*) | FINRA short interest API (§4) |
| **Q4 (year-end) consumption growth** ✅ | LEADING | 1 yr | **The most robust GWZ survivor** (Møller & Rangvid 2015, *JFE*; GWZ 2024) | BEA PCE (main §3.3) |
| **Credit spreads / EBP** | LEADING | 6 mo–2 yr | Strong for real activity (Gilchrist-Zakrajšek 2012, *AER*); credit froth → downturns ~2yr (López-Salido-Stein-Zakrajšek 2017, *QJE*) | FRED HY OAS (⚠ 3-yr window from Apr 2026 — §4b), Fed EBP CSV |
| **Variance risk premium** (VIX² − realized var) | LEADING | 1–6 mo | Peak R² ~5–8% at quarterly horizon (Bollerslev-Tauchen-Zhou 2009, *RFS*); internationally replicated | Compute: Cboe VIX + realized vol (§4) |
| **CAPE / valuation** | LEADING | 7–10+ yr | R² ~0.3–0.43 for 10-yr real returns; ~nil at 1 yr; Siegel earnings critique; ECY variant for rate regimes | Shiller XLS (§3) |
| **Payout/net issuance** | LEADING | 1–5 yr | Net payout yield beats dividend yield (Boudoukh et al 2007, *JF*); equity-share-of-issuance (Baker-Wurgler 2000) weak OOS | S&P buyback XLSX (§4b), Z.1 F.223 |
| **Time-series momentum** | LEADING | 1–12 mo | MOP 2012 *JFE*; weakened live 2010–19 (Huang et al 2020, *JFE*) — decay in action | Any EOD series (§2) |
| **"Net liquidity"** (Fed BS − TGA − RRP) | context only | weeks | ✅ Correlation ~0.8–0.95 in 2020–22, then **broke decisively: QT −$2.1T Sep 2022–Mar 2026 while S&P +78%**; no peer-reviewed causal support | WALCL + WTREGEN + RRPONTSYD (FRED) |
| **Sentiment** (Baker-Wurgler; AAII/II contrarian) | LEADING | months | Cross-sectional, concentrated in speculative stocks (Baker-Wurgler 2006, *JF*); surveys contrarian at extremes only, fragile (Fisher-Statman 2000; Brown-Cliff 2004) | B-W XLSX (§3, stale ⚠), AAII (§4b) |
| **Positioning** (COT TFF, margin debt, flows) | LEADING | weak; extremes | Weak/coincident; flows are contrarian ("dumb money" — Frazzini-Lamont 2008 *JFE*; flow reversal ~10mo — Ben-Rephael et al 2012) | CFTC COT, FINRA margin, ICI flows (§4) |
| **Macro announcements** ✅ | structural (risk timing) | event days | **11.4bp on announcement days vs 1.1bp other days; >60% of the equity premium on ~13% of days** (Savor & Wilson 2013, *JFQA*); **pre-FOMC drift (+49bp, Lucca-Moench 2015) disappeared post-2015** (Kurov et al 2021) — decay's cleanest example | BLS/Fed release calendars |
| **Earnings revisions** | LEADING | weeks–months | Real but good data (IBES) is paid; free proxies coarse | S&P DJI estimates sheet, FactSet Earnings Insight PDF ◻ |
| **Oil / dollar / geopolitics** | conditional CAUSAL | event | Sign depends on shock source (Kilian 2009); GPR spikes → short-lived drawdowns | main catalog §3.8/§5.5 |

## 6. Direction B — what the stock market leads/drives

**Headline calibration** ✅: Direction A is mostly a graveyard; **Direction B has the genuinely causal, well-identified channels** — several are mechanical or quasi-experimental. For a weighting model, Direction B deserves higher causal weight than almost any Direction A predictor.

| Outcome | Role | Horizon | Evidence strength (verified where ✅) | Dataset that operationalizes it |
|---|---|---|---|---|
| **Consumption & local employment (wealth effect)** | CAUSAL | 1–8 quarters | ✅ **MPC ≈ 3.2¢/$ of stock wealth/yr; a +20% market (absent Fed offset) raises the aggregate labor bill ≥1.7% and hours ≥0.7% at 2 yrs**, effects in nontradable industries (Chodorow-Reich, Nenov & Simsek 2021, *AER* — county-level causal design). Housing MPC larger (Case-Quigley-Shiller); MPC falls sharply with wealth (Di Maggio et al 2020) | Z.1 + DFA holdings, county QCEW (response), retail sales |
| **State/federal tax revenue** | CAUSAL (mechanical) | 0–4 quarters (realization lag) | ✅ Cap-gains realizations hit **8.7% of GDP in 2021** vs ~3.7% long-run; **>14% of federal individual income tax FY2021–22** (CBO); **1% S&P rise → ~0.7% realizations growth** (CBO elasticity). **California: cap gains = 25% of PIT liability in 2021 → 13% in 2022** (LAO); ~3× as volatile as the rest of the base | IRS SOI, CBO projections, CA LAO/DOF, QTAX (main §4.1) |
| **VC / PE / IPO windows** | CAUSAL | 2–4 quarters | Strong: IPO volume tracks trailing returns/sentiment (Lowry 2003 *JFE*; Loughran-Ritter 1995); VC investment responds to industry Q + Nasdaq returns, exits gate fundraising (Gompers-Lerner 2000; Gompers et al 2008, *JFE*) | Ritter IPO data (§3), Form D + S-1 (EDGAR), Nasdaq index |
| **Pension funded status** | CAUSAL (mechanical) | 0–1 quarter | ✅ Public plans ~**82.5–84.2% funded in 2025** (Equable; Milliman PPFI), improvement attributed directly to market gains; ~$1.3T unfunded. Drawdowns → contribution pressure → state/local fiscal stress | Public Plans Data (BC CRR, free), Equable/Milliman |
| **Retirement timing / labor supply** | CAUSAL | 1–2 yr | ✅ Realized asset returns explain **>80% of 2020–21 "excess retirements"**; pandemic wealth gains ≈ **1pp of the LFPR decline ages 51–65** (St. Louis Fed 2022–23); 1990s precedent (Coronado-Perozek 2003) | CPS LFPR by age, SSA claims |
| **GDP / recessions** | LEADING (weak) | 1–2 quarters | Weak/episodic: "nine of the last five recessions" (Samuelson 1966); unstable (Stock-Watson 2003, *JEL*); corr ~0.2–0.35; an LEI component, not a standalone signal | any index series |
| **Global risk appetite** | CAUSAL (outbound) | days–quarters | ✅ US returns lead other developed markets, not vice versa (Rapach-Strauss-Zhou 2013, *JF*); one global financial cycle tied to VIX/US policy (Rey 2013). **Foreign holdings of US equities: $19.86T as of June 2025** — 56% of all foreign US-securities holdings (vs 23% in 2009; Treasury TIC SHL) — US drawdowns are mechanically global wealth events | TIC (main §3.5), BIS, VIX |
| **M&A / corporate behavior** | quasi-CAUSAL (currency channel) | 1–4 quarters | Merger waves cluster in high-valuation markets; misvaluation drives stock-financed deals (Shleifer-Vishny 2003; Rhodes-Kropf et al 2005, *JFE*) | EDGAR filings |
| **Consumer sentiment** | feedback loop | weeks | Two-way contamination — never use sentiment and stocks as independent features | UMich/Conf Board |
| **Distributional cap** | constraint | — | ✅ **Top 10% of households hold ~87% of corporate equities** (Fed DFA, through Q1 2026; ~92–93% on SCF-based measures incl. indirect); bottom 50% ~1%; top 1% ~50% — the consumption channel runs through a thin, low-MPC slice, which is exactly why aggregate MPC is ~3¢ not housing-sized | Fed DFA (quarterly, free) |

## 7. Two-direction weighting table

Same 1–5 scale as the main catalog. **Strength** = documented correlation/causation robustness; **Actionability** = free-data quality × timeliness.

| # | Data family | Direction | Role | Horizon | Strength | Actionability |
|---|---|---|---|---|---|---|
| 1 | Monetary policy surprises → stocks | A | CAUSAL | event | 5 | 4 |
| 2 | Stocks → state cap-gains revenue | B | CAUSAL (mechanical) | 0–4 q | 5 | 4 |
| 3 | Stocks → consumption/local employment (wealth effect) | B | CAUSAL (quasi-experimental) | 1–8 q | 5 | 3 |
| 4 | Stocks → pension funded status | B | CAUSAL (mechanical) | 0–1 q | 5 | 4 |
| 5 | Stocks → VC/PE/IPO windows | B | CAUSAL | 2–4 q | 4 | 4 |
| 6 | Aggregate short interest → returns | A | LEADING (GWZ survivor) | 1–12 mo | 4 | 4 |
| 7 | Credit spreads/EBP → stocks & activity | A | LEADING | 6 mo–2 yr | 4 | 5 (⚠ §4b window) |
| 8 | CAPE → 10-yr returns | A | LEADING | 7–10 yr | 4 | 5 |
| 9 | Stocks → global risk appetite | B | CAUSAL (outbound) | days–q | 4 | 3 |
| 10 | Stocks → retirements/labor supply | B | CAUSAL | 1–2 yr | 4 | 3 |
| 11 | Q4 consumption growth → returns | A | LEADING (GWZ survivor) | 1 yr | 3 | 4 |
| 12 | Variance risk premium → stocks | A | LEADING | 1–6 mo | 3 | 4 |
| 13 | Payout/net issuance → returns | A | LEADING | 1–5 yr | 3 | 3 |
| 14 | Macro announcement calendar (premium timing) | A | structural | event days | 3 | 5 |
| 15 | Sentiment/positioning/flows extremes | A | LEADING (contrarian) | months | 2 | 4 |
| 16 | Stocks → GDP/recession | B | LEADING (weak) | 1–2 q | 2 | 5 |
| 17 | Net liquidity → stocks | A | context only | weeks | 1 | 5 |
| 18 | Stocks ↔ consumer sentiment | both | feedback | weeks | 2 | 4 |

## 8. Pitfalls

1. **Out-of-sample failure is the norm** ✅ — Welch-Goyal 2008 + GWZ 2024 (*RFS*); McLean-Pontiff 2016: −26% OOS, −58% post-publication. The pre-FOMC drift's death (§5) is the cleanest single-signal example. Weight decade-horizon valuation and event-scale causal effects; distrust monthly-horizon signals.
2. **Data mining / publication bias** — 300+ published factors; demand t ≥ 3.0 (Harvey, Liu & Zhu 2016, *RFS*). Assume any linked "predictor" was selected from a much larger tried set. **Econometric traps**: persistent regressors (Stambaugh 1999 bias), overlapping long-horizon returns inflating t-stats.
3. **Regime dependence** — predictability concentrates in recessions (Henkel et al 2011, *JFE*; Rapach et al 2010, *RFS*); full-sample R² overstates expansion usefulness. Net liquidity breaking in 2022–26 is the same disease.
4. **Survivorship bias in every free stock-level source** — Yahoo/Stooq lose delisted tickers; only CRSP-class data is survivorship-free. Index-level data dodges this; single-stock backtests on free data flatter results. **Look-ahead bias** — use EDGAR filing timestamps and ALFRED vintages.
5. **Return concentration — "the market" is not "stocks"** ✅ — ~4 of 7 US stocks since 1926 had lifetime returns below T-bills; **the best 4% of firms account for ALL net wealth creation** (Bessembinder 2018, *JFE*; 2023 global update: top 2.4% = all $75.7T). And **top-10 S&P names = ~37–41% of index cap mid-2026** (vs ~27% at the 2000 peak) — one 2026 rally saw 10 stocks drive 69% of index gains. Historical index correlations may not transfer to what is increasingly ~8 firms' AI-capex cycle.
6. **Licensing traps** — index levels (S&P/MSCI/FTSE) and consolidated real-time are licensed; display-only ToS on Yahoo/TradingView; FRED windows (SP500/DJIA 10-yr; ICE BofA 3-yr from Apr 2026). Pin what you can legally store; prefer official/academic sources for anything redistributed. JST is CC BY-NC-SA (non-commercial).
7. **Feedback loops** — stocks↔sentiment↔flows are mutually contaminated; never treat them as independent features in one model.

## 9. Engine integration

**Do these two now (deadlines):** (1) pull the pre-April-2026 **ICE BofA HY OAS full history from ALFRED** and pin it (FRED now serves only 3 years — §4b); (2) download the **NAAIM full-history XLSX before Aug 1, 2026** (goes subscription — §4b).

**Recommended free stack** (all §1–§4): **Tiingo** (keyed EOD workhorse, 1k req/day) + Stooq (deep-history backfill) + **Ken French factors** (correlation backbone — already flagged in `data_sources_inventory.md`) + **Shiller monthly from shillerdata.com** (long-run base rates; NOT the frozen Yale file) + FRED (`NASDAQCOM`, `VIXCLS`, HY OAS w/ pinned vintages) + Cboe VIX/SKEW CSVs + FINRA short interest/short volume/margin + CFTC COT + SEC companyfacts/insider datasets + ICI flows + Damodaran ERP + Ritter IPO + S&P buyback XLSX.

**Diligence-platform relevance (Direction B is the payload here):**
- **REIT total returns ↔ private RE beta** — already in the RE inventory (§8 there); Ken French industry portfolios add sector betas free.
- **State fiscal exposure** — cap-gains-dependent states (CA, NY, WA, MA…) inherit equity-market risk in their revenue base → feed into any state-level fiscal-health feature (main catalog §2.3 QTAX row).
- **Wealth-effect geography** — metros with high equity ownership (DFA + IRS SOI dividend/cap-gains income by ZIP) see consumption/housing demand co-move with the market — a legitimate micro feature for high-end markets.
- **VC/IPO-window exposure** — startup-heavy metros (SF, SJ, Seattle, Austin, NYC) have employment/income tied to Nasdaq regimes and exit windows (Ritter volume as the gauge).
- **MC engine inputs** — equity series feed `fit_distribution` the same way as HPIs (returns, not levels; `periods_per_year=252/12`); public-market factors for the correlation matrix in portfolio paths.
