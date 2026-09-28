// Gate 1 — shared types. Client code imports these with `import type` only.

export type Posture = 'green' | 'yellow' | 'red'
export type Regime = 'soft_landing' | 'stagflation' | 'recession'
export type GateVerdict = 'PASS' | 'CONDITIONAL' | 'FAIL' | 'REVIEW'
export type CheckStatus = 'pass' | 'flag' | 'fail' | 'missing' | 'na'

/**
 * The ~30 intake fields. Everything the 18 checks consume.
 * All monetary values in USD; all rates/shares as decimals (0.05 = 5%).
 * `null` means MISSING — a missing required field can never pass its check.
 */
export interface DealFields {
  deal_name: string
  asset_class: string // threshold rows may specialize per class, e.g. 'rv_specialty'
  location?: string
  sponsor_name?: string

  sponsor_integrity_clear: boolean | null
  site_fully_entitled: boolean | null
  sponsor_completed_comparables: number | null
  sponsor_coinvest_pct: number | null
  exit_dependent_single_refi: boolean | null
  has_gmp_or_bonded_gc: boolean | null
  has_completion_guarantee: boolean | null
  guarantor_net_worth: number | null

  total_project_cost: number | null
  hard_costs: number | null
  land_cost: number | null
  hard_cost_contingency_pct: number | null
  construction_loan: number | null // 0 = all-equity deal
  loan_interest_rate: number | null // modeled rate on the loan (decimal), for the SOFR comparison
  total_equity: number | null // if null, derived as cost - loan

  stabilized_noi_untrended: number | null
  exit_cap_rate: number | null
  market_cap_rate_today: number | null
  assumed_rent_monthly: number | null
  market_comp_rent_monthly: number | null

  interest_reserve_months: number | null
  construction_duration_months: number | null
  lease_up_months_assumed: number | null
  submarket_leaseup_months: number | null

  // Display-only KPIs (sponsor-reported; not used by checks)
  projected_irr?: number | null
  projected_equity_multiple?: number | null
}

export interface CheckDef {
  id: string
  kind: 'kill' | 'flag'
  label: string
  /** Flag points contributed when a 'flag' check trips (kills contribute none). */
  flagPoints?: number
  /** Threshold key(s) this check reads, for provenance display. */
  thresholdKeys: string[]
  /** Plain-English tooltip copy: what it is / why it matters. */
  tip: string
}

export interface ThresholdRow {
  /** '*' = any asset class */
  asset_class: string
  /** '*' = any posture */
  posture: Posture | '*'
  key: string
  value: number
}

/** A per-deal manual judgment adjustment. Reason is required — never silent. */
export interface JudgmentAdjustment {
  key: string
  value: number
  reason: string
  adjustedAt?: string
}

export interface Gate1Config {
  checks: CheckDef[]
  thresholds: ThresholdRow[]
  verdictBands: { passMaxFlagPts: number; conditionalMaxFlagPts: number }
  macro: MacroConfig
}

export interface MacroConfig {
  signalWeights: Record<string, number>
  /** Per-signal definitions (FRED series, weights, vote bands) — all data, no code. */
  signals?: MacroSignalDef[]
  /** regime → asset_class → posture ('*' asset class supported) */
  postureMatrix: Record<Regime, Record<string, Posture>>
  hysteresisWins: number
  minVotes: number
  /** Four-quadrant bands: inflation hot above this yoy; growth recessionary below this yoy. */
  quadrantBands?: { inflationHotYoy: number; growthRecessionYoy: number }
  hurdleStack: {
    anchorPct: number
    illiquidityBpsByLockupYears: Array<{ maxYears: number; bps: number }>
    complexityBpsByStrategy: Record<string, number>
    regimeBps: Record<Regime, number>
  }
}

/** Threshold value with full provenance, for UI display and audit. */
export interface ResolvedThreshold {
  key: string
  /** Value from config resolution (asset class + posture fallback chain). */
  base: number
  /** Which (asset_class, posture) row supplied the base. */
  source: { asset_class: string; posture: string }
  /** Per-deal judgment adjustment, if any. */
  adjustment?: JudgmentAdjustment
  /** The value the engine actually used. */
  effective: number
}

export interface CheckResult {
  id: string
  kind: 'kill' | 'flag'
  label: string
  status: CheckStatus
  /** The deal's computed value for this check, if numeric. */
  value: number | null
  /** Human-readable value, e.g. "57.6%" or "yes". */
  valueDisplay: string
  /** The effective threshold with provenance. */
  threshold: ResolvedThreshold | null
  /** Comparator for display, e.g. '<=', '>='. */
  comparator?: string
  /** Signed margin to the threshold in the check's own units (+ = safe side). */
  margin: number | null
  /** True when the pass margin is thin (within config's fragile band). */
  fragile?: boolean
  flagPoints: number
  note?: string
}

export interface GateResult {
  verdict: GateVerdict
  kills: string[]
  flagPoints: number
  missing: string[]
  checks: CheckResult[]
  stress?: {
    stressedEquityMultiple: number | null
    floor: number
    hardCostBumpPct: number
    exitCapBumpBps: number
  }
}

/** One posture's outcome in the side-by-side scenario view (computeGate1.scenarios). */
export interface PostureScenario {
  posture: Posture
  verdict: GateVerdict
  kills: string[]
  flagPoints: number
  checks: Array<{
    id: string
    status: CheckStatus
    /** Signed margin in the check's own units (+ = safe side), as in CheckResult. */
    margin: number | null
    fragile?: boolean
    /** Effective threshold under this posture (null for thresholdless checks). */
    threshold: number | null
  }>
}

export interface MacroSignalReading {
  id: string
  label: string
  value: number | null
  asof?: string
  vote: Posture | null // null = signal unavailable this week
  weight: number
  /** ~5 years of history for the dashboard sparklines (monthly-ish points). */
  history?: Array<{ date: string; value: number }>
}

/** Patel's four-quadrant read: inflation/deflation × expansion/recession. */
export interface MacroQuadrant {
  inflationYoy: number | null
  growthYoy: number | null
  /** The quadrantBands the engine classified with (absent on old rows → display defaults). */
  bands?: { inflationHotYoy: number; growthRecessionYoy: number }
  label:
    | 'inflationary_expansion'
    | 'disinflationary_expansion'
    | 'stagflation'
    | 'deflationary_contraction'
    | 'unknown'
}

/** Prevailing-market context for the comparison panel (S&P + financing rates). */
export interface MarketContext {
  /**
   * OLDEST observation date among the series present ('' when none). Invariant:
   * no displayed value is older than asof — freshness is never overstated.
   */
  asof: string
  /** Per-series observation dates (absent on rows persisted before this field). */
  asofBySeries?: { sofr?: string; mortgage30y?: string; treasury10y?: string; sp500?: string }
  sofr: number | null
  mortgage30y: number | null
  treasury10y: number | null
  sp500: { level: number | null; ret1y: number | null; ret3y: number | null; ret5y: number | null }
}

export interface MacroSnapshot {
  id?: string
  week_of: string
  source: 'auto' | 'manual'
  signals: MacroSignalReading[]
  regime: Regime
  pending_regime?: Regime | null
  /** Consecutive snapshots pending_regime has won (absent on old rows → 1). */
  pending_wins?: number | null
  degraded: boolean
  postures: Record<string, Posture>
  quadrant?: MacroQuadrant
  market?: MarketContext
  hurdle?: Record<string, number>
  note?: string
}

/** Per-signal config: FRED series + weight + posture vote bands (all data, no code). */
export interface MacroSignalDef {
  id: string
  label: string
  fred: string | null // null = manual-entry signal (e.g. ISM)
  weight: number
  /** transform applied to the raw series: 'level' | 'yoy' (12-mo % change) */
  transform: 'level' | 'yoy'
  /** vote bands: value <= green → green; <= yellow → yellow; else red (or reversed when direction='high_is_good') */
  direction: 'high_is_bad' | 'high_is_good'
  green: number
  yellow: number
}
