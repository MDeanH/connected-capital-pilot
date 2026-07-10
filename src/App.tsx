import { useState, useMemo, useEffect, useRef, lazy, Suspense, useTransition } from 'react'
import { Settings, BarChart3, MessageSquare, Upload, Target, Home as HomeIcon, Send, ClipboardList, BookOpen, FileText } from 'lucide-react'
import Plot from './LazyPlot'
import Home from './Home'
import ErrorBoundary from './ErrorBoundary'

// Each tab pane is its own async chunk — the entry bundle ships only the shell
// and Home, and a tab's code downloads the first time it's opened.
const PANE_LOADERS = {
  intake: () => import('./DealIntake'),
  score: () => import('./DealScore'),
  engine: () => import('./EngineExplainer'),
  usmarket: () => import('./USMarket'),
  underwrite: () => import('./Underwrite'),
  riskmodel: () => import('./RiskModel'),
  ddqx: () => import('./DDQ'),
  combined: () => import('./CombinedVerdict'),
}
const DealIntake = lazy(PANE_LOADERS.intake)
const EngineExplainer = lazy(PANE_LOADERS.engine)
const DealScore = lazy(PANE_LOADERS.score)
const CombinedVerdict = lazy(PANE_LOADERS.combined)
const USMarket = lazy(PANE_LOADERS.usmarket)
const Underwrite = lazy(PANE_LOADERS.underwrite)
const RiskModel = lazy(PANE_LOADERS.riskmodel)
const DDQ = lazy(PANE_LOADERS.ddqx)
import { Info } from './Info'
import type { ParseResult } from './excel'

// Types (ported from Python model)
interface Opportunity {
  id: string
  name: string
  sub_type: 'Development' | 'Value-Add'
  sponsor_exits: number
  ltv: number
  execution_risk: 'Low' | 'Medium' | 'High'
  rate_environment: 'low' | 'elevated'
  projected_gross_irr?: number
  notes?: string
}

interface PastDeal {
  id: string
  sub_type: string
  sponsor_exits: number
  ltv: number
  execution_risk: string
  realized_irr: number
  outcome_label: string
}

interface ModelConfig {
  target_return_default: number
  feature_weights: {
    sponsor: number
    market: number
    structure: number
    macro: number
    qual: number
  }
  version: string
  mcParams?: {
    n_sims: number
    holding_years: number
    autocorrelation: number
  }
}

interface ScoreResult {
  p_hit_target: number
  expected_return: number
  p_loss: number
  confidence: number
  top_drivers: string[]
  recommended_size_pct: number
  risk_note: string
  model_version: string
  // Grounded MC additions (exact PoC parity)
  median_irr?: number
  var_5pct?: number
  cvar_5pct?: number
  de_smoothed_sigma?: number
  mu_adj?: number
  mc_note?: string
  sims?: number[]   // for real histogram
}

// Sample data (ported from src/data/sample.py)
const SAMPLE_PAST_DEALS: PastDeal[] = [
  { id: "past_001", sub_type: "Value-Add", sponsor_exits: 5, ltv: 0.62, execution_risk: "Medium", realized_irr: 0.19, outcome_label: "hit_target" },
  { id: "past_002", sub_type: "Development", sponsor_exits: 1, ltv: 0.78, execution_risk: "High", realized_irr: 0.08, outcome_label: "missed" },
  { id: "past_003", sub_type: "Value-Add", sponsor_exits: 7, ltv: 0.55, execution_risk: "Low", realized_irr: 0.27, outcome_label: "hit_target" },
]

const INITIAL_OPPORTUNITIES: Opportunity[] = [
  { id: "opp_dev_downtown", name: "Downtown Core Dev", sub_type: "Development", sponsor_exits: 3, ltv: 0.72, execution_risk: "High", rate_environment: "elevated", projected_gross_irr: 0.24, notes: "Strong location but heavy lift on entitlements" },
  { id: "opp_va_suburban", name: "Suburban Value-Add Portfolio", sub_type: "Value-Add", sponsor_exits: 6, ltv: 0.58, execution_risk: "Medium", rate_environment: "elevated", projected_gross_irr: 0.18, notes: "Stabilized assets, light reno, good cash flow" },
  { id: "opp_dev_mixed", name: "Mixed-Use Infill Dev", sub_type: "Development", sponsor_exits: 2, ltv: 0.68, execution_risk: "Medium", rate_environment: "elevated", projected_gross_irr: 0.21, notes: "Slightly better sponsor history than downtown" },
]

// =====================================================================
// Exact de-biased MC port (matches Python src/model/scoring.py grounded PoC)
// =====================================================================

function randomNormal(mean = 0, stdev = 1): number {
  // Box-Muller transform
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return mean + stdev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function desmoothVariance(reportedReturns: number[], autocorrelation = 0.7): { mu: number; sigma: number } {
  const n = reportedReturns.length
  const reportedMu = reportedReturns.reduce((a, b) => a + b, 0) / n
  const mean = reportedMu
  const variance = reportedReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / n
  const reportedSigma = Math.sqrt(variance)
  const trueSigma = reportedSigma / Math.sqrt(1 - autocorrelation)
  return { mu: reportedMu, sigma: trueSigma }
}

function monteCarloIRR(
  mu: number,
  sigma: number,
  holdingYears = 4,
  nSims = 10000,
  target = 0.20,
  muAdj = 0.0
): { pHit: number; expected: number; median: number; pLoss: number; var5: number; cvar5: number; kellyPct: number; sims: number[]; note: string } {
  const adjMu = mu + muAdj
  const logMu = Math.log(1 + adjMu) - 0.5 * sigma * sigma

  const irrs: number[] = []
  for (let s = 0; s < nSims; s++) {
    let cumLog = 0
    for (let y = 0; y < holdingYears; y++) {
      const annualLog = randomNormal(logMu, sigma)
      cumLog += annualLog
    }
    const irr = Math.exp(cumLog) ** (1 / holdingYears) - 1
    irrs.push(irr)
  }

  irrs.sort((a, b) => a - b)
  const pHit = irrs.filter(r => r >= target).length / nSims
  const pLoss = irrs.filter(r => r < 0).length / nSims
  const expected = irrs.reduce((a, b) => a + b, 0) / nSims
  const median = irrs[Math.floor(nSims * 0.5)]
  const var5 = irrs[Math.floor(nSims * 0.05)]
  const tail = irrs.filter(r => r <= var5)
  const cvar5 = tail.reduce((a, b) => a + b, 0) / tail.length

  const rf = 0.04
  const kelly = sigma > 0 ? ((expected - rf) / (sigma * sigma)) * 0.5 : 0
  const kellyPct = Math.min(Math.max(kelly, 0.01), 0.25) * 100

  return {
    pHit: Math.round(pHit * 1000) / 1000,
    expected: Math.round(expected * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    pLoss: Math.round(pLoss * 1000) / 1000,
    var5: Math.round(var5 * 1000) / 1000,
    cvar5: Math.round(cvar5 * 1000) / 1000,
    kellyPct: Math.round(kellyPct * 10) / 10,
    sims: irrs,
    note: `De-smoothed MC • ${nSims.toLocaleString()} sims • mu_adj=${muAdj >= 0 ? '+' : ''}${(muAdj * 100).toFixed(1)}%`,
  }
}

function computeMuAdj(opp: Opportunity, weights: ModelConfig['feature_weights']): number {
  // Mirrors Python _compute_mu_adj_from_features_and_weights (transparent drift adjustment)
  let adj = 0
  const sponsorW = weights.sponsor ?? 0.28
  const qualW = weights.qual ?? 0.12
  const macroW = weights.macro ?? 0.20
  const structureW = weights.structure ?? 0.18
  const marketW = weights.market ?? 0.22

  const exits = opp.sponsor_exits ?? 2
  const sponsorStrength = Math.min(1, exits / 8)
  adj += (sponsorStrength - 0.4) * 0.08 * (sponsorW / 0.28)

  const er = opp.execution_risk
  if (er === 'High') adj -= 0.055 * ((qualW + structureW) / 0.3)
  else if (er === 'Low') adj += 0.025 * ((qualW + structureW) / 0.3)

  if (opp.ltv > 0.72) adj -= 0.035 * (marketW / 0.22)
  else if (opp.ltv < 0.55) adj += 0.015 * (marketW / 0.22)

  if (opp.rate_environment === 'elevated') adj -= 0.065 * (macroW / 0.20)
  else adj += 0.02 * (macroW / 0.20)

  const notes = (opp.notes || '').toLowerCase()
  if (notes.includes('strong sponsor') || notes.includes('excellent execution')) adj += 0.015

  return Math.max(-0.12, Math.min(0.07, adj))
}

// JS port of the Python scoring logic — now the exact grounded de-biased MC
function computeScore(opp: Opportunity, config: ModelConfig, pastDeals: PastDeal[]): ScoreResult {
  const w = config.feature_weights
  const target = config.target_return_default
  const mc = config.mcParams || { n_sims: 10000, holding_years: 4, autocorrelation: 0.7 }

  // 1. De-smooth using client's own past realized IRRs (the moat)
  const realized = pastDeals.map(d => d.realized_irr).filter((v): v is number => typeof v === 'number')
  const base = realized.length >= 3
    ? desmoothVariance(realized, mc.autocorrelation)
    : desmoothVariance([0.085, 0.092, 0.076, 0.105, 0.068, 0.089, 0.094, 0.081, 0.098, 0.072], mc.autocorrelation)

  // 2. mu_adj from current weights + opp features (DDQ, LTV, sponsor, macro) — same mapping as Python
  const muAdj = computeMuAdj(opp, w)

  // 3. Run the exact grounded MC (lognormal compounding, de-smoothed vol)
  const mcRes = monteCarloIRR(
    base.mu,
    base.sigma,
    mc.holding_years,
    mc.n_sims,
    target,
    muAdj
  )

  // 4. Keep the old driver logic for explainability (transparent)
  const sponsorScore = Math.min(1.0, (opp.sponsor_exits || 2) / 8.0) * w.sponsor
  const marketScore = (0.5 + 0.5 * (1.0 - Math.min(1.0, opp.ltv || 0.65))) * w.market
  const qualScore = (opp.execution_risk === 'High' ? 0.4 : 0.75) * w.qual

  const drivers = [
    ["Sponsor track record", sponsorScore, sponsorScore > 0.15 ? "positive" : "negative"],
    ["Market / supply-demand & leverage", marketScore, marketScore > 0.12 ? "positive" : "negative"],
    ["Execution / qual risk (DDQ)", qualScore, qualScore < 0.08 ? "negative" : "positive"],
  ].sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number)).slice(0, 3) as [string, number, string][]

  const nComps = pastDeals.length
  const confidence = Math.min(0.92, 0.45 + 0.04 * Math.min(nComps, 25) + 0.15 * ((opp.sponsor_exits || 2) / 6))

  const riskNote = `De-smoothed (ρ=${mc.autocorrelation.toFixed(2)}) • mu_adj=${muAdj >= 0 ? '+' : ''}${(muAdj * 100).toFixed(1)}% (weights+DDQ). P(IRR≥${(target * 100).toFixed(0)}%)=${(mcRes.pHit * 100).toFixed(1)}% | Median=${(mcRes.median * 100).toFixed(1)}% | VaR5=${(mcRes.var5 * 100).toFixed(1)}%. Kelly ~${mcRes.kellyPct.toFixed(1)}%.`

  return {
    p_hit_target: mcRes.pHit,
    expected_return: mcRes.expected,
    p_loss: mcRes.pLoss,
    confidence: Math.round(confidence * 100) / 100,
    top_drivers: drivers.map(d => d[0]),
    recommended_size_pct: mcRes.kellyPct,
    risk_note: riskNote,
    model_version: config.version,

    // Full grounded outputs
    median_irr: mcRes.median,
    var_5pct: mcRes.var5,
    cvar_5pct: mcRes.cvar5,
    de_smoothed_sigma: Math.round(base.sigma * 10000) / 10000,
    mu_adj: Math.round(muAdj * 10000) / 10000,
    mc_note: mcRes.note,
    sims: mcRes.sims,   // real simulated IRRs for the histogram
  }
}

// What each tab does — fed to the copilot so "what does this tab do?" answers
// reflect where the user actually is.
const TAB_GUIDE: Record<string, { name: string; guide: string }> = {
  home: {
    name: 'Home / Upload',
    guide: 'Landing page. Step 1: drag-and-drop an Excel/CSV with the client\'s past deals (realized IRRs) and current opportunities — parsed in-browser, never uploaded to a server; a downloadable template shows the expected columns. Uploaded past deals replace the sample history that de-smooths the Monte Carlo; uploaded opportunities replace the sample pipeline. Step 2 is a how-to-use-the-site guide with clickable cards for each tab.',
  },
  intake: {
    name: 'Deal Intake',
    guide: 'Structured deal intake for Gate 1. Flow: bring in a deal (upload dropzones for the OM PDF and pro forma XLSX are placeholders — AI extraction lands next milestone; today you load the client\'s sample deal or enter fields manually) → review every field grouped by Deal & Sponsor, Capital Stack, Operations, and Structure & Exit, with missing required fields highlighted → confirm & score. Scoring runs the server-side Gate 1 engine live: 18 checks — 10 hard kills (sponsor integrity, entitlements, LTC, dev spread, contingency, co-invest, track record, single-exit refi dependence, GMP on big jobs, and the mini-stress equity-multiple test) and 8 watch flags (yield-on-cost vs benchmark, exit cap vs market, interest reserve, land basis, rents vs comps, absorption, profit margin, completion guarantee). Any kill = FAIL; missing data = REVIEW (missing never passes); flag points map to PASS / CONDITIONAL / FAIL bands. Thresholds resolve per asset class and the current macro posture (green/yellow/red — kill lines tighten as conditions worsen). Analysts can apply judgment adjustments to any numeric threshold — reason required, always logged, and the rulebook\'s baseline verdict is kept alongside the adjusted one. RECORD DECISION persists an append-only, replayable decision row stamped with config version and macro snapshot.',
  },
  score: {
    name: 'Deal Score',
    guide: 'The engine-backed single-deal scorer. Pick any of 20,216 US markets (metros, counties, cities — natural language like "miami dade county florida" works), set target return, risk-free rate, holding period, idiosyncratic volatility, book size, ticket, and answer the due-diligence questionnaire. The Netlify engine runs a 20,000-path Monte Carlo on that market\'s real Zillow price history plus a market-level rent carry (60% of observed gross yield, expense-adjusted; 4%/yr fallback where rents aren\'t observed), de-smoothed to honest volatility, and returns P(hit target) with confidence intervals, expected return, P(loss), VaR/CVaR, and a fractional-Kelly suggested allocation. A transparent "yield edge" adjustment (max ±0.30%/yr) rewards a market\'s within-state gross-yield percentile — the one signal that predicted forward returns in this platform\'s own backtests. A Crime context card shows FBI violent/property rates per 100k vs the US average. A Market context card shows open-data context for the selected market: Zillow rents & gross yield, inventory/days-to-pending market heat, BEA income & price-to-income, FEMA hazard risk, IRS migration flows, HMDA investor share & denial rates (demand quality), Census building permits (supply pipeline), and FEMA NFIP flood claims (realized losses).',
  },
  combined: {
    name: 'Combined Verdict',
    guide: 'The bridge between the two sides of the platform: Connected Capital\'s own methodology (Underwrite gates, Risk Model v2 composite, Institutional DDQ grade) combined with the market-evidence Monte Carlo into one blended probability. The Tier-1 underwriting gates act as hard filters — any gate failure marks the deal rejected regardless of the modeled probability. The Risk Model composite (−3…+3) and the DDQ grade (1–5, explicitly down-weighted 50% until genuinely distinct mid/low calibration exemplars are provided) map through disclosed linear formulas to a bounded return tilt (±2.5%/yr max combined) and risk multiplier (0.75–1.4×), which the scoring engine applies ON TOP of its own de-smoothed market history for the selected market — the formulas and every intermediate number are shown on the tab. The combination weights are transparent assumptions, not fitted statistics: they await calibration against the client\'s realized track record. Reads the deal from the Underwrite tab (localStorage), the scorecard from the Risk Model tab, and the DDQ from the Institutional DDQ tab — score those first or load their fictional samples.',
  },
  engine: {
    name: 'How It Works',
    guide: 'A six-step, plain-language walkthrough of the scoring engine, written so anyone — an analyst, a client, or someone learning the method for the first time — can follow the how AND the why of each step: (1) start from the market\'s real quarterly history plus rent carry, (2) Geltner de-smoothing to recover hidden volatility (echo capped at 0.6, roughly doubles measured risk on smoothed series), (3) due-diligence answers become two bounded dials — a return tilt capped at ±10%/yr and a risk multiplier bounded 0.6×–2.5× — that recenter/rescale but never replace the evidence, (4) bootstrap simulation of thousands of hold-period lifetimes drawing real quarters with replacement (no bell-curve assumption, real crash quarters stay in the tail), (5) read P(hit target), median IRR, P(loss) and VaR/CVaR straight off the simulated outcomes, with bootstrap confidence intervals in production, (6) half-Kelly position sizing capped at 25% with a correlation haircut, allowed to say PASS. The page is interactive: the step-3 dials run a live 2,000-path miniature of the production engine in the browser, and the step-4 path fan, step-5 histogram/stats and step-6 sizing bar all recompute as the dials move. Production uses 20,000 paths, seeded RNG for reproducibility, and 16 golden parity tests against the reference implementation.',
  },
  underwrite: {
    name: 'Underwrite',
    guide: 'Deal-gates underwriter, liabilities first. Tier 1 survival gates: DSCR (<1.20 fail, <1.25 flag), exit-cap discipline (exit cap must be ≥ going-in cap — deals priced on cap compression are rejected), leverage LTC, breakeven occupancy cushion, loan-maturity-vs-hold refi dependence, debt yield (NOI÷loan, lenders want ≥10%), and a +200bps rate stress for floating debt. Tier 2 return quality: going-in unlevered yield (Y1 NOI ÷ total cost, the margin-of-safety number), cash-on-cash, levered IRR and equity multiple from the stated exit cap. Live SOFR / Fed Funds / 10Y Treasury / Mortgage-30Y overlay from the platform\'s FRED refresh — cap-rate spread to Treasuries computed live. No single metric decides; a Tier-1 failure means the deal can die before the upside matters.',
  },
  riskmodel: {
    name: 'Risk Model',
    guide: 'The pilot\'s 9-category sponsor/deal risk scorecard (Risk Model v2): Operational, Credit, Funding, Cash Flow, Liquidity, Regulatory, Market, Competition — each scored −3…+3 across Historical / YTD / Forward (forward weighted 50%), with editable category weights, intake-variable checklists (realistic ranges + edge cases), notes, and a weighted Capital-Risk composite mapped to High / Mid / Low grade bands calibrated to the three completed DDQ exemplars. Red-flags any category at ≤−2. Scores persist locally and export to JSON.',
  },
  ddqx: {
    name: 'Institutional DDQ',
    guide: 'The full ILPA DDQ 2.0-aligned institutional due-diligence questionnaire as a digital intake with grading. Sections A (Firm & Organizational Overview) and B (Fund Terms & Structure) in full, plus the Real Estate Development and RE Acquisition modules — 116 questions, 46 of them objective fields that auto-score 1–5 against calibration values extracted from three completed sample DDQs (Evercrest high-grade, Marston Bridge mid, Halcyon Peak low/distressed). The analyst adds a subjective 1–5 per risk category against exemplar-anchored rubrics; category weights come from the Risk Model v2 workbook (Manager & Team 20%, Investment Strategy 15%, Track Record 15%, etc., editable). Weighted composite maps to HIGH (≥4.0) / MID (≥2.75) / LOW grade bands, with hard-fail overrides (active regulatory enforcement, suspended LP distributions, undisclosed litigation) that cap the grade at LOW regardless of score, plus a red-flag list of every field graded 1/5. Section-by-section progress, autosave to this browser, JSON export/import — nothing uploads anywhere. Different from the quick "DDQ Intake" tab, which is a lightweight 9-question form that feeds the dashboard.',
  },
  usmarket: {
    name: 'US Market',
    guide: 'National real-estate context: US base rates built from Zillow ZHVI across 895 metros, plus cross-asset correlations and macro series (mortgage rates, Case-Shiller, housing starts). Use it to sanity-check a deal against the market backdrop.',
  },
  dashboard: {
    name: 'Client Dashboard',
    guide: 'Ranks every opportunity in the pipeline (sample or uploaded) by probability of hitting the target return, with expected return, P(loss), confidence, top driver, and suggested sizing. Click a row for full risk detail and the simulated return histogram. Filter by minimum probability and deal subtype.',
  },
  opps: {
    name: 'Opportunities',
    guide: 'Raw tables of the current opportunities and the historical past deals (the training signal whose realized IRRs de-smooth the Monte Carlo).',
  },
  ddq: {
    name: 'DDQ Intake',
    guide: 'Add a new opportunity through a short due-diligence questionnaire (sponsor exits, peak LTV, execution risk, qualitative notes). Saving scores it immediately and adds it to the dashboard.',
  },
  model: {
    name: 'Analyst Model Studio',
    guide: 'Live-editable feature weights (sponsor, market, structure, macro, qual). Moving a slider immediately recomputes every score on the dashboard. Shows the full model config JSON.',
  },
  corr: {
    name: 'Correlations',
    guide: 'Answers "does crime predict returns?" with real data: latest-year FBI crime rates correlated against 10,000+ markets\' return histories and open-data context. Headline findings: crime explains only ~2% of return differences, and even that mostly evaporates within a state (rank-r −0.03 after state + population controls) — the raw link reflects which STATES boomed, not crime. Its real correlates are market size (density/reporting) and rent yield (higher-crime markets pay higher yields — risk gets priced). Shows ranked correlation bars with plain-language strength labels, a scatter of every market with a trend line, a "find your market" search with percentile readouts, and a full matrix table for quants. Cross-asset macro correlations (the real 23×23) live on the US Market tab.',
  },
}

const DEFAULT_CONFIG: ModelConfig = {
  target_return_default: 0.20,
  feature_weights: { sponsor: 0.28, market: 0.22, structure: 0.18, macro: 0.20, qual: 0.12 },
  version: "v0.3-debiased-mc",
  mcParams: { n_sims: 10000, holding_years: 4, autocorrelation: 0.7 }
}

export default function App() {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_CONFIG)
  const [opportunities, setOpportunities] = useState<Opportunity[]>(INITIAL_OPPORTUNITIES)
  const [pastDeals, setPastDeals] = useState<PastDeal[]>(SAMPLE_PAST_DEALS)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'home' | 'intake' | 'score' | 'engine' | 'underwrite' | 'riskmodel' | 'ddqx' | 'combined' | 'usmarket' | 'dashboard' | 'opps' | 'ddq' | 'model' | 'corr'>('home')
  // Transition keeps the current pane visible while a lazy tab's chunk loads
  // (no "Loading…" flash); tabPending dims the pane as feedback meanwhile.
  const [tabPending, startTabSwitch] = useTransition()
  const [minProb, setMinProb] = useState(0)
  const [selectedSubtypes, setSelectedSubtypes] = useState<('Development' | 'Value-Add')[]>(['Development', 'Value-Add'])
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [copilotOpen, setCopilotOpen] = useState(false)
  const copilotMessagesRef = useRef<HTMLDivElement>(null)

  // DDQ form state
  const [ddqSponsorExits, setDdqSponsorExits] = useState(3)
  const [ddqLtv, setDdqLtv] = useState(0.65)
  const [ddqExecRisk, setDdqExecRisk] = useState<'Low' | 'Medium' | 'High'>('Medium')
  const [ddqNotes, setDdqNotes] = useState('')

  const weights = config.feature_weights

  // Computed scores
  const scoredOpps = useMemo(() => {
    return opportunities.map(opp => ({
      ...opp,
      score: computeScore(opp, config, pastDeals)
    }))
  }, [opportunities, config, pastDeals])

  const filtered = scoredOpps.filter(o =>
    o.score.p_hit_target >= minProb &&
    selectedSubtypes.includes(o.sub_type)
  )

  const selected = selectedOppId ? scoredOpps.find(o => o.id === selectedOppId) : null

  // Update weights
  const updateWeight = (key: keyof typeof weights, value: number) => {
    setConfig(prev => ({
      ...prev,
      feature_weights: { ...prev.feature_weights, [key]: value }
    }))
  }

  const recompute = () => {
    // Triggers re-render via state
  }

  // Add from DDQ
  const addFromDDQ = () => {
    const newOpp: Opportunity = {
      id: `ddq_${Date.now()}`,
      name: "New DDQ Opportunity",
      sub_type: "Development",
      sponsor_exits: ddqSponsorExits,
      ltv: ddqLtv,
      execution_risk: ddqExecRisk,
      rate_environment: "elevated",
      notes: ddqNotes || "Added via DDQ form"
    }
    setOpportunities(prev => [...prev, newOpp])
    setActiveTab('dashboard')
    setSelectedOppId(newOpp.id)
    // reset form
    setDdqNotes('')
  }

  // Client data upload (Home tab) — replaces the sample data so every score
  // is computed from the client's own history/pipeline
  const handleDataLoaded = (result: ParseResult, fileName: string) => {
    if (result.pastDeals.length > 0) setPastDeals(result.pastDeals)
    if (result.opportunities.length > 0) {
      setOpportunities(result.opportunities)
      setSelectedOppId(null)
    }
    setUploadedFileName(fileName)
  }

  // Real copilot - calls Netlify function (works in production + with `netlify dev`)
  const [isCopilotThinking, setIsCopilotThinking] = useState(false)

  // Keep the copilot panel scrolled to the latest message
  useEffect(() => {
    const el = copilotMessagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatHistory, isCopilotThinking])

  // Warm the lazy tab chunks after first paint so the first click on any tab
  // is usually instant; failures are ignored (the tab retries on click).
  useEffect(() => {
    const t = setTimeout(() => {
      Object.values(PANE_LOADERS).forEach(load => { load().catch(() => {}) })
    }, 2000)
    return () => clearTimeout(t)
  }, [])

  const sendChat = async () => {
    const trimmed = chatInput.trim()
    if (!trimmed) return

    const userMsg = trimmed
    setCopilotOpen(true)
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }])
    setChatInput('')
    setIsCopilotThinking(true)

    // Build rich context for the model (grounded in the live de-biased MC + analyst state)
    const tab = TAB_GUIDE[activeTab]
    const context = `
The user is currently looking at the "${tab?.name ?? activeTab}" tab.
What this tab does: ${tab?.guide ?? 'n/a'}
(If the user asks "what does this tab do", "where am I", or similar, answer from the tab description above. The other tabs are: ${Object.values(TAB_GUIDE).map(t => t.name).join(', ')}.)

Current model (de-biased MC engine):
- Target: ${(config.target_return_default * 100).toFixed(0)}%
- Weights: ${JSON.stringify(config.feature_weights)}
- MC params: ${JSON.stringify(config.mcParams)}

Current filtered opportunities (live de-smoothed MC scores):
${filtered.slice(0, 5).map(o => 
  `- ${o.name} (${o.sub_type}): P(IRR≥${(config.target_return_default*100).toFixed(0)}%)=${(o.score.p_hit_target*100).toFixed(1)}%, E[IRR]=${(o.score.expected_return*100).toFixed(1)}%, Median=${((o.score.median_irr||o.score.expected_return)*100).toFixed(1)}%, P(loss)=${(o.score.p_loss*100).toFixed(1)}%, VaR5=${((o.score.var_5pct||0)*100).toFixed(1)}%, Kelly=${o.score.recommended_size_pct.toFixed(1)}%, deσ=${((o.score.de_smoothed_sigma||0)*100).toFixed(1)}%, mu_adj=${((o.score.mu_adj||0)*100).toFixed(1)}%`
).join('\n')}

Selected opportunity: ${selected ? `${selected.name} — ${selected.score.risk_note}` : 'None'}

Recent past deals (used for de-smoothing base returns):
${pastDeals.slice(0, 3).map(d => `- ${d.id}: realized ${(d.realized_irr*100).toFixed(1)}% (${d.outcome_label})`).join('\n')}
`.trim()

    try {
      const res = await fetch('/api/grok/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userMsg }],
          context
        })
      })

      const data = await res.json()

      if (data.error) {
        throw new Error(data.error)
      }

      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: data.reply || "No response from the model." 
      }])
    } catch (err: any) {
      console.error('Copilot request failed:', err)
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: "The copilot couldn't reach the AI service. Please try again in a moment."
      }])
    } finally {
      setIsCopilotThinking(false)
    }
  }

  // Real crime × market correlations (baked by scripts/crime_correlations.py)
  const [crimeCorr, setCrimeCorr] = useState<any>(null)
  const [corrPickQuery, setCorrPickQuery] = useState('')
  const [corrPick, setCorrPick] = useState<string | null>(null)
  useEffect(() => {
    fetch('/crime-correlations.json')
      .then(r => (r.ok ? r.json() : null))
      .then(setCrimeCorr)
      .catch(() => setCrimeCorr(null))
  }, [])

  return (
    <div className="app">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>AI Diligence Platform <span style={{ fontSize: '0.65rem', fontWeight: 700, verticalAlign: 'middle', background: '#fdf2f4', color: '#c2384a', border: '1px solid #f5c2c7', borderRadius: 6, padding: '2px 8px', letterSpacing: '0.06em' }}>INSTITUTIONAL PILOT · CONFIDENTIAL</span></h1>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Probability of hitting target return • Risk quantification • Transparent drivers</div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
            Netlify • v0.3-debiased-mc • client-history de-smoothed MC
            <div>{uploadedFileName ? `Data: ${uploadedFileName}` : 'Data: sample (upload yours on Home)'}</div>
          </div>
        </div>

        {/* Diligence Copilot — pinned to the top on every tab */}
        <div className="copilot-bar">
          <MessageSquare size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="copilot-label">🧠 Copilot</span>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Ask the diligence copilot anything — e.g. why is the downtown deal scoring low?"
          />
          <button onClick={sendChat} disabled={isCopilotThinking} title="Send">
            <Send size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
            {isCopilotThinking ? 'Thinking…' : 'Ask'}
          </button>
          {chatHistory.length > 0 && (
            <button className="secondary" onClick={() => setCopilotOpen(o => !o)}>
              {copilotOpen ? 'Hide chat' : `Show chat (${chatHistory.length})`}
            </button>
          )}
        </div>

        {copilotOpen && (
          <div className="copilot-panel" ref={copilotMessagesRef}>
            {chatHistory.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                Ask about drivers, scenarios, or recommendations. The copilot sees the live scores, weights and your uploaded deals.
              </div>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>{m.content}</div>
            ))}
            {isCopilotThinking && <div className="message assistant" style={{ color: 'var(--muted)' }}>Thinking…</div>}
          </div>
        )}
      </header>

      <div className="tabs">
        {[
          { label: null, items: [
            { id: 'home', label: '🏠 Home / Upload', icon: HomeIcon },
            { id: 'intake', label: 'Deal Intake', icon: FileText },
          ]},
          { label: 'YOUR METHODOLOGY', items: [
            { id: 'underwrite', label: '🏦 Underwrite', icon: Target },
            { id: 'riskmodel', label: '⚖️ Risk Model', icon: Settings },
            { id: 'ddqx', label: '📋 Institutional DDQ', icon: ClipboardList },
          ]},
          { label: 'MARKET EVIDENCE', items: [
            { id: 'score', label: '🎯 Deal Score', icon: Target },
            { id: 'usmarket', label: '🇺🇸 US Market', icon: BarChart3 },
            { id: 'corr', label: 'Correlations', icon: BarChart3 },
            { id: 'engine', label: '📖 How It Works', icon: BookOpen },
          ]},
          { label: 'TOGETHER', items: [
            { id: 'combined', label: '⚡ Combined Verdict', icon: Target },
          ]},
          { label: 'PIPELINE', items: [
            { id: 'dashboard', label: '📊 Client Dashboard', icon: BarChart3 },
            { id: 'opps', label: 'Opportunities', icon: Target },
            { id: 'ddq', label: 'DDQ Intake', icon: Upload },
            { id: 'model', label: 'Analyst Model Studio', icon: Settings },
          ]},
        ].map((grp, gi) => (
          <div className="tabgroup" key={gi}>
            {grp.label && <span className="tabgroup-label">{grp.label}</span>}
            {grp.items.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  className={`tab ${activeTab === t.id ? 'active' : ''}`}
                  style={tabPending ? { opacity: 0.7 } : undefined}
                  onClick={() => startTabSwitch(() => setActiveTab(t.id as any))}
                >
                  <Icon size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="main" style={tabPending ? { opacity: 0.6, transition: 'opacity 0.15s' } : undefined}>
       <ErrorBoundary>
       <Suspense fallback={<div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>}>
        {/* HOME — client data upload + how-to guide */}
        {activeTab === 'home' && (
          <Home
            pastDealsCount={pastDeals.length}
            oppsCount={opportunities.length}
            uploadedFileName={uploadedFileName}
            onDataLoaded={handleDataLoaded}
            goTo={(tab) => setActiveTab(tab as any)}
          />
        )}

        {/* DEAL INTAKE — Gate 1 intake → review → score (Netlify /api/gate1/*) */}
        {activeTab === 'intake' && <DealIntake />}

        {/* DEAL SCORE — engine-backed (Netlify /api/score) */}
        {activeTab === 'score' && <DealScore />}

        {/* HOW IT WORKS — live step-by-step walkthrough of the engine */}
        {activeTab === 'engine' && <EngineExplainer />}

        {/* COMBINED VERDICT — client methodology × market evidence */}
        {activeTab === 'combined' && <CombinedVerdict />}

        {/* PILOT: deal-gates underwriter (liabilities first) */}
        {activeTab === 'underwrite' && (
          <div className="card"><h2>Deal Underwriting — survival gates first</h2><Underwrite /></div>
        )}

        {/* PILOT: Risk Model v2 sponsor scorecard */}
        {activeTab === 'riskmodel' && (
          <div className="card"><h2>Risk Model v2 — sponsor &amp; deal scorecard</h2><RiskModel /></div>
        )}

        {/* PILOT: full institutional DDQ — digital intake with exemplar-calibrated grading */}
        {activeTab === 'ddqx' && (
          <div className="card"><h2>Institutional DDQ — ILPA-aligned intake &amp; grading</h2><DDQ /></div>
        )}

        {/* US MARKET — national RE base rates + cross-correlations */}
        {activeTab === 'usmarket' && <USMarket />}

        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
          <>
            <div className="grid-4">
              <div className="card">
                <div className="metric-label">Avg. Hit Probability</div>
                <div className="metric-value">{(scoredOpps.reduce((s, o) => s + o.score.p_hit_target, 0) / scoredOpps.length * 100).toFixed(0)}%</div>
              </div>
              <div className="card">
                <div className="metric-label">High-Confidence Deals</div>
                <div className="metric-value">{scoredOpps.filter(o => o.score.confidence >= 0.65).length}</div>
              </div>
              <div className="card">
                <div className="metric-label">Target Return</div>
                <div className="metric-value">{(config.target_return_default * 100).toFixed(0)}%</div>
              </div>
              <div className="card">
                <div className="metric-label">Model Version</div>
                <div className="metric-value" style={{ fontSize: '1.1rem' }}>{config.version}</div>
              </div>
            </div>

            <div className="filters">
              <label>Min Probability: {(minProb * 100).toFixed(0)}%</label>
              <input type="range" min="0" max="1" step="0.05" value={minProb} onChange={e => setMinProb(parseFloat(e.target.value))} />
              <div>
                {['Development', 'Value-Add'].map(st => (
                  <label key={st} style={{ marginRight: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedSubtypes.includes(st as any)}
                      onChange={e => {
                        if (e.target.checked) setSelectedSubtypes(prev => [...prev, st as any])
                        else setSelectedSubtypes(prev => prev.filter(s => s !== st))
                      }}
                    /> {st}
                  </label>
                ))}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>P(Hit)</th>
                  <th>Expected</th>
                  <th>P(Loss)</th>
                  <th>Conf.</th>
                  <th>Top Driver</th>
                  <th>Suggested %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id} onClick={() => { setSelectedOppId(o.id); setActiveTab('dashboard') }} style={{ cursor: 'pointer' }}>
                    <td>{o.name}</td>
                    <td>{o.sub_type}</td>
                    <td className={o.score.p_hit_target > 0.7 ? 'prob-high' : o.score.p_hit_target > 0.4 ? 'prob-med' : 'prob-low'}>
                      {(o.score.p_hit_target * 100).toFixed(0)}%
                    </td>
                    <td>{(o.score.expected_return * 100).toFixed(1)}%</td>
                    <td>{(o.score.p_loss * 100).toFixed(0)}%</td>
                    <td>{(o.score.confidence * 100).toFixed(0)}%</td>
                    <td>{o.score.top_drivers[0]}</td>
                    <td>{o.score.recommended_size_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selected && (
              <div style={{ marginTop: '2rem' }} className="card">
                <h3>{selected!.name} — {selected!.sub_type}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                  <div>
                    <div style={{ marginBottom: '0.5rem' }}>Probability of Hitting Target</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 700, color: selected!.score.p_hit_target > 0.65 ? 'var(--success)' : 'var(--warning)' }}>
                      {(selected!.score.p_hit_target * 100).toFixed(0)}%
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                      <strong>Risk to earn the target:</strong><br />
                      {selected!.score.risk_note}
                    </div>
                    <div style={{ marginTop: '0.75rem' }}>
                      <strong>Recommended allocation:</strong> ~{selected!.score.recommended_size_pct}% of book (fractional Kelly, capped)
                    </div>
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                      <div>Median: <strong>{((selected!.score.median_irr ?? selected!.score.expected_return) * 100).toFixed(1)}%</strong></div>
                      <div>VaR 5%: <strong>{((selected!.score.var_5pct ?? -0.05) * 100).toFixed(1)}%</strong></div>
                      <div>CVaR 5%: <strong>{((selected!.score.cvar_5pct ?? -0.08) * 100).toFixed(1)}%</strong></div>
                      <div>True σ: <strong>{((selected!.score.de_smoothed_sigma ?? 0.09) * 100).toFixed(1)}%</strong></div>
                    </div>
                  </div>

                  <div>
                    <div style={{ marginBottom: '0.5rem' }}>Top Drivers</div>
                    {selected!.score.top_drivers.map((d, i) => (
                      <div key={i} style={{ margin: '4px 0', padding: '4px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4 }}>{d}</div>
                    ))}

                    <div style={{ marginTop: '1rem' }}>
                      <Plot
                        data={[{
                          x: (selected!.score.sims && selected!.score.sims.length > 0)
                            ? selected!.score.sims
                            : Array.from({ length: 2000 }, () => randomNormal(selected!.score.expected_return || 0.12, (selected!.score.de_smoothed_sigma || 0.09))),
                          type: 'histogram',
                          marker: { color: '#3b5bdb' }
                        }]}
                        layout={{
                          height: 220,
                          margin: { t: 10, b: 30, l: 30, r: 10 },
                          paper_bgcolor: 'rgba(0,0,0,0)',
                          plot_bgcolor: 'rgba(0,0,0,0)',
                          font: { color: '#11161f', family: 'Poppins, system-ui, sans-serif' },
                          title: 'De-biased Monte Carlo (real sims from client history + weights)',
                          shapes: [
                            { type: 'line', x0: config.target_return_default, x1: config.target_return_default, y0: 0, y1: 12, line: { color: '#eab308', dash: 'dash' } },
                            ...(selected!.score.median_irr ? [{ type: 'line' as const, x0: selected!.score.median_irr, x1: selected!.score.median_irr, y0: 0, y1: 8, line: { color: '#22c55e', dash: 'dot' } }] : []),
                          ]
                        }}
                        config={{ displayModeBar: false }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Other tabs (simplified but functional) */}
        {activeTab === 'opps' && (
          <div>
            <h2>Opportunities &amp; Past Deals</h2>
            <h3>Current Opportunities</h3>
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Sponsor Exits</th><th>LTV</th><th>Risk</th></tr></thead>
              <tbody>
                {opportunities.map(o => <tr key={o.id}><td>{o.name}</td><td>{o.sub_type}</td><td>{o.sponsor_exits}</td><td>{(o.ltv*100).toFixed(0)}%</td><td>{o.execution_risk}</td></tr>)}
              </tbody>
            </table>

            <h3 style={{ marginTop: '2rem' }}>Historical / Past Deals (training signal)</h3>
            <table>
              <thead><tr><th>ID</th><th>Type</th><th>Sponsor Exits</th><th>Realized IRR</th><th>Outcome</th></tr></thead>
              <tbody>
                {pastDeals.map(d => <tr key={d.id}><td>{d.id}</td><td>{d.sub_type}</td><td>{d.sponsor_exits}</td><td>{(d.realized_irr*100).toFixed(1)}%</td><td>{d.outcome_label}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'ddq' && (
          <div className="card">
            <h2>DDQ Intake (RE Dev / Value-Add)</h2>
            <div style={{ display: 'grid', gap: '1rem', maxWidth: 520 }}>
              <label>Sponsor exits (last 10 yrs): {ddqSponsorExits}<br />
                <input type="range" min="0" max="12" value={ddqSponsorExits} onChange={e => setDdqSponsorExits(+e.target.value)} />
              </label>
              <label>Peak LTV: {(ddqLtv*100).toFixed(0)}%<br />
                <input type="range" min="0.4" max="0.85" step="0.01" value={ddqLtv} onChange={e => setDdqLtv(+e.target.value)} />
              </label>
              <label>Execution risk:
                <select value={ddqExecRisk} onChange={e => setDdqExecRisk(e.target.value as any)}>
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </label>
              <textarea placeholder="Key qualitative notes / red flags" value={ddqNotes} onChange={e => setDdqNotes(e.target.value)} rows={4} style={{ width: '100%' }} />
              <button onClick={addFromDDQ}>Save DDQ &amp; Add Opportunity</button>
            </div>
            <p className="disclaimer">In a full version this would run LLM extraction on uploaded PDFs and feed structured fields into the model.</p>
          </div>
        )}

        {activeTab === 'model' && (
          <div className="card">
            <h2>Analyst Model Studio</h2>
            <p>Live editable weights (changes immediately affect scores on the Dashboard).</p>
            {Object.keys(weights).map((k) => (
              <div key={k} style={{ margin: '12px 0' }}>
                <label>{k.charAt(0).toUpperCase() + k.slice(1)}: {(weights as any)[k].toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.01" value={(weights as any)[k]} onChange={e => updateWeight(k as any, parseFloat(e.target.value))} />
              </div>
            ))}
            <button onClick={recompute}>Recompute All</button>
            <pre style={{ marginTop: '1rem', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '1rem', borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}

        {activeTab === 'corr' && !crimeCorr && (
          <div className="card">Loading correlation data…</div>
        )}

        {activeTab === 'corr' && crimeCorr && (() => {
          // "all" segment has the best joint coverage of the county-level context fields
          const seg = crimeCorr.segments?.all || crimeCorr.segments?.cities
          if (!seg) return null
          const M = seg.matrix

          // plain-language metric names + what each one means
          const INFO: Record<string, [string, string]> = {
            growth_5y: ['Recent 5-yr growth', 'Annualized price return over the last five years.'],
            mu_ann: ['Long-run total return', "The market's annualized return over its full history (since 2000)."],
            sigma_ann: ['Volatility (risk)', 'How much the market swings quarter to quarter.'],
            sharpe_like: ['Return per unit of risk', 'Long-run return divided by volatility.'],
            max_drawdown: ['Worst historical crash', 'Deepest peak-to-trough fall on record (more negative = worse). A negative correlation means higher-crime markets crashed harder.'],
            pop_log: ['Market size (population)', 'Bigger, denser jurisdictions report more crime per 100k — partly density, partly reporting coverage.'],
            grossYield: ['Rent yield', 'Annual rent ÷ home value. A positive correlation means higher-crime markets pay higher yields — the market prices the risk.'],
            rentYoY: ['Rent growth (1 yr)', 'Change in rents over the last year.'],
            invYoY: ['Inventory growth (1 yr)', 'Change in homes listed for sale — rising inventory cools prices.'],
            priceToIncome: ['Price-to-income', 'Home value vs local per-capita income — affordability stretch.'],
            incomeGrowth5y: ['Income growth (5 yr)', 'Per-capita income growth in the county.'],
            nriScore: ['Natural-hazard risk', "FEMA's composite hazard score — hurricane, flood, wildfire and 15 more."],
            netMigRate: ['Net migration rate', 'Households moving in minus moving out, per resident (IRS).'],
            investorShare: ['Investor buyer share', 'Share of home purchases by investor / second-home buyers (HMDA).'],
            denialRate: ['Mortgage denial rate', 'Share of purchase mortgage applications denied (HMDA).'],
            permitsPer1k: ['Building permits / 1k residents', 'New housing units permitted per 1,000 residents — the supply pipeline.'],
            permitsVs5y: ['Permit surge vs own norm', "This year's permits vs the county's own 5-year average."],
            claimsTrend: ['Flood-claims trend', 'Flood insurance claims, recent 5 years vs the prior 5.'],
          }
          const strength = (r: number) => {
            const a = Math.abs(r)
            return a < 0.05 ? 'no link' : a < 0.15 ? 'very weak' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : 'strong'
          }
          const fmtR = (r: number) => (r > 0 ? '+' : '') + r.toFixed(2)

          const bars = Object.keys(INFO)
            .map(m => ({ m, r: M?.v?.[m]?.pearson as number | undefined, n: M?.v?.[m]?.n }))
            .filter(b => typeof b.r === 'number')
            .sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!))

          const rOf = (m: string) => M?.v?.[m]?.pearson as number | undefined
          const r5y = rOf('growth_5y'), rPop = rOf('pop_log'), rYield = rOf('grossYield')

          // user-selected market on the scatter
          const sc = crimeCorr.scatter
          const pts: any[] = sc?.points || []
          const sel = corrPick ? pts.find(p => p.k === corrPick) : null
          const pctile = (get: (p: any) => number, v: number) =>
            Math.max(1, Math.min(99, Math.round((100 * pts.filter(p => get(p) < v).length) / pts.length)))
          const suggestions = corrPickQuery.trim().length >= 2 && !sel
            ? pts.filter(p => p.k.toLowerCase().includes(corrPickQuery.trim().toLowerCase())).slice(0, 12)
            : []
          // display sample: ~3k points draw identically to 10k under overplotting,
          // render as SVG (mobile-friendly, screenshot-able); stats use ALL points
          const dispStep = Math.max(1, Math.ceil(pts.length / 3000))
          const disp = pts.filter((_, i) => i % dispStep === 0)

          return (
            <>
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <h2>Does crime predict returns?</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--muted)', maxWidth: 780 }}>
                  We correlated FBI {crimeCorr.year} crime rates with the real price histories and open-data context of{' '}
                  {seg.n.toLocaleString()} US markets. Short answer: <strong>barely</strong>. Crime describes a market's
                  character — its size, hazard exposure, how it's priced — but says almost nothing about where returns went.
                  That's why the Deal Score treats crime as context, not as a return signal.
                </p>

                <div className="grid-4" style={{ marginTop: '0.75rem' }}>
                  {typeof r5y === 'number' && (
                    <div className="card" style={{ background: 'var(--surface-2)' }}>
                      <div className="metric-label">Crime → recent returns <Info width={250}>r = {fmtR(r5y)} between violent-crime rate and 5-yr annualized return. Squaring r gives the share of return differences crime can account for.</Info></div>
                      <div className="metric-value">{(r5y * r5y * 100).toFixed(0)}%</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>of return differences explained — {strength(r5y)} {r5y < 0 ? 'negative' : 'positive'} link</div>
                    </div>
                  )}
                  <div className="card" style={{ background: 'var(--surface-2)' }}>
                    <div className="metric-label">…and within a state? <Info width={270}>Comparing markets only against others in the SAME state (state fixed effects + population control), the crime–growth rank correlation collapses from −0.14 to −0.03. The raw link mostly reflects which states boomed in 2020–25, not crime itself. Full analysis in the correlation deep-dive.</Info></div>
                    <div className="metric-value">−0.03</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>the link nearly disappears — it's mostly which <em>states</em> boomed, not crime</div>
                  </div>
                  {typeof rPop === 'number' && (
                    <div className="card" style={{ background: 'var(--surface-2)' }}>
                      <div className="metric-label">Strongest link: market size</div>
                      <div className="metric-value">{fmtR(rPop)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>bigger places report more crime per capita — density, not destiny</div>
                    </div>
                  )}
                  {typeof rYield === 'number' && (
                    <div className="card" style={{ background: 'var(--surface-2)' }}>
                      <div className="metric-label">Crime ↔ rent yield</div>
                      <div className="metric-value">{fmtR(rYield)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>higher-crime markets pay higher yields — the market already prices the risk</div>
                    </div>
                  )}
                </div>

                <h3 style={{ marginBottom: 4 }}>What moves with violent crime <Info width={260}>Correlation runs from <b>+1</b> (rises together) through <b>0</b> (unrelated) to <b>−1</b> (moves opposite). Bars left of center are negative. Hover the ⓘ on each row for what the metric means.</Info></h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 8 }}>across {seg.n.toLocaleString()} markets · sorted by strength · FBI {crimeCorr.year}</div>
                {bars.map(b => {
                  const r = b.r!
                  const w = Math.min(50, (Math.abs(r) / 0.4) * 50)
                  return (
                    <div className="cb-row" key={b.m}>
                      <span className="cb-name">{INFO[b.m][0]} <Info width={240} below>{INFO[b.m][1]} <i>(n={b.n.toLocaleString()} markets)</i></Info></span>
                      <span className="cb-track">
                        <span className="cb-zero" />
                        <span className="cb-fill" style={{
                          left: r < 0 ? `${50 - w}%` : '50%',
                          width: `${w}%`,
                          background: Math.abs(r) < 0.05 ? '#c2c8d2' : r > 0 ? '#3b5bdb' : '#c2384a',
                        }} />
                      </span>
                      <span className="cb-val" style={{ color: Math.abs(r) < 0.05 ? 'var(--muted)' : r > 0 ? 'var(--accent)' : 'var(--danger)' }}>{fmtR(r)}</span>
                      <span className="cb-strength">{strength(r)}</span>
                    </div>
                  )
                })}
                <p className="disclaimer">
                  Correlation ≠ causation: crime co-moves with density, income and reporting practices, and most of these raw correlations
                  shrink sharply once you compare within a state. The natural-hazard score row is especially confounded — FEMA's NRI score is
                  ~0.85 correlated with population, so its crime link is mostly market size. Rates winsorized at 1%/99%; property-crime
                  correlations track the violent-crime ones closely. Full controls and backtests: the correlation deep-dive in the repo.
                  Looking for how home prices co-move with rates, equities and the macro picture? That's the real 23×23 matrix on the <strong>US Market</strong> tab.
                </p>
              </div>

              {sc && (
                <div className="card" style={{ marginBottom: '1.5rem' }}>
                  <h2>Find your market on the map of all {pts.length.toLocaleString()}</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                    Every dot is a US market: its crime rate (across) vs its last-5-years return (up).
                    The nearly-flat trend line is the whole story — type a market to see where it sits.
                  </p>
                  <div style={{ position: 'relative', maxWidth: 420 }}>
                    <input
                      value={corrPickQuery}
                      onChange={e => { setCorrPickQuery(e.target.value); setCorrPick(null) }}
                      placeholder="e.g. Miami (city), FL — or any city/county"
                      style={{ width: '100%', padding: '0.5rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                    {suggestions.length > 0 && (
                      <div className="cb-suggest">
                        {suggestions.map(p => (
                          <div key={p.k} onClick={() => { setCorrPick(p.k); setCorrPickQuery(p.k) }}>{p.k}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  {sel && (
                    <div style={{ margin: '8px 0', fontSize: '0.85rem' }}>
                      <strong>{sel.k}</strong>: violent crime {sel.x.toLocaleString()}/100k (higher than {pctile(p => p.x, sel.x)}% of markets) ·
                      5-yr return {(sel.y * 100).toFixed(1)}%/yr (higher than {pctile(p => p.y, sel.y)}% of markets)
                    </div>
                  )}
                  <Plot
                    data={[
                      {
                        x: disp.map(p => p.x),
                        y: disp.map(p => p.y * 100),
                        text: disp.map(p => p.k),
                        type: 'scatter',
                        mode: 'markers',
                        marker: { color: '#3b5bdb', size: 4, opacity: 0.3 },
                        hovertemplate: '%{text}<br>violent: %{x:.0f}/100k<br>5-yr return: %{y:.1f}%/yr<extra></extra>',
                        showlegend: false,
                      },
                      ...(sc.trend ? [{
                        x: [sc.trend.xMin, sc.trend.xMax],
                        y: [(sc.trend.intercept + sc.trend.slope * sc.trend.xMin) * 100, (sc.trend.intercept + sc.trend.slope * sc.trend.xMax) * 100],
                        type: 'scatter' as const,
                        mode: 'lines' as const,
                        line: { color: '#b8860b', width: 2, dash: 'dash' as const },
                        hoverinfo: 'skip' as const,
                        showlegend: false,
                      }] : []),
                      ...(sel ? [{
                        x: [sel.x],
                        y: [sel.y * 100],
                        type: 'scatter' as const,
                        mode: 'markers+text' as const,
                        marker: { color: '#c2384a', size: 13, line: { color: '#fff', width: 2 } },
                        text: [sel.k],
                        textposition: 'top center' as const,
                        textfont: { size: 12, color: '#c2384a' },
                        hoverinfo: 'skip' as const,
                        showlegend: false,
                      }] : []),
                    ]}
                    layout={{
                      height: 380,
                      autosize: true,
                      margin: { t: 16, b: 45, l: 55, r: 10 },
                      xaxis: { title: { text: `Violent crime per 100k (FBI ${crimeCorr.year})` } },
                      yaxis: { title: { text: '5-yr annualized return %' } },
                      paper_bgcolor: 'rgba(0,0,0,0)',
                      plot_bgcolor: 'rgba(0,0,0,0)',
                      font: { color: '#11161f', family: 'Poppins, system-ui, sans-serif' },
                      annotations: sc.trend ? [{
                        x: sc.trend.xMax * 0.7, y: (sc.trend.intercept + sc.trend.slope * sc.trend.xMax * 0.7) * 100,
                        text: `trend: r² = ${(sc.trend.r2 * 100).toFixed(0)}% — crime explains ${(sc.trend.r2 * 100).toFixed(0)}% of return differences`,
                        showarrow: true, arrowhead: 0, ax: 0, ay: -40, font: { size: 11, color: '#b8860b' },
                      }] : [],
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    useResizeHandler
                    style={{ width: '100%' }}
                  />
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted)' }}>For the quants: full correlation matrix (violent + property × every metric)</summary>
                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginTop: 8 }}>
                      <table style={{ fontSize: '0.78rem' }}>
                        <thead><tr><th>Metric</th><th>Violent r</th><th>Property r</th><th>n</th></tr></thead>
                        <tbody>
                          {bars.map(b => (
                            <tr key={b.m}>
                              <td>{INFO[b.m][0]}</td>
                              <td>{fmtR(M?.v?.[b.m]?.pearson ?? 0)}</td>
                              <td>{typeof M?.p?.[b.m]?.pearson === 'number' ? fmtR(M.p[b.m].pearson) : '—'}</td>
                              <td>{b.n.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              )}
            </>
          )
        })()}

       </Suspense>
       </ErrorBoundary>
      </div>

      <div className="disclaimer" style={{ padding: '0 1.5rem 2rem' }}>
        De-biased MC (exact NCREIF-style PoC): client realized IRRs de-smoothed (true σ = reported / √(1-ρ)) → lognormal paths → P(IRR≥target), median, VaR/CVaR, fractional Kelly. All client-side. Your past deals + DDQ weights are the edge. Public data for context only.
      </div>
    </div>
  )
}
