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
  /** regime → asset_class → posture ('*' asset class supported) */
  postureMatrix: Record<Regime, Record<string, Posture>>
  hysteresisWins: number
  minVotes: number
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

export interface MacroSignalReading {
  id: string
  label: string
  value: number | null
  asof?: string
  vote: Posture | null // null = signal unavailable this week
  weight: number
}

export interface MacroSnapshot {
  id?: string
  week_of: string
  source: 'auto' | 'manual'
  signals: MacroSignalReading[]
  regime: Regime
  pending_regime?: Regime | null
  degraded: boolean
  postures: Record<string, Posture>
  hurdle?: Record<string, number>
  note?: string
}
