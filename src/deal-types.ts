// Deal Intake — client-side types, field registry, and the sample deal for the
// Gate 1 intake flow. Server types are re-exported so client code has a single
// import point and can never drift from the engine's contract.

export type {
  DealFields,
  GateResult,
  CheckResult,
  JudgmentAdjustment,
  GateVerdict,
  Posture,
  CheckDef,
  ResolvedThreshold,
  PostureScenario,
} from '../netlify/functions/lib/gate1/types'

import type {
  CheckDef,
  DealFields,
  GateResult,
  GateVerdict,
  JudgmentAdjustment,
  Posture,
  PostureScenario,
} from '../netlify/functions/lib/gate1/types'

/**
 * Response shape of POST /api/gate1/preview (computeGate1's return) plus the
 * persistence extras that /api/gate1/decide adds.
 */
export interface Gate1Response {
  result: GateResult
  baseline: { verdict: GateVerdict; kills: string[]; flagPoints: number }
  baselineFull: GateResult
  adjustments: JudgmentAdjustment[]
  posture: Posture
  postureSource: string
  configVersion: number
  macroSnapshotId: string | null
  checksMeta: CheckDef[]
  /** Same deal scored under each posture (display only; absent on older function builds). */
  scenarios?: Record<Posture, PostureScenario>
  persisted?: boolean
  warning?: string
  decisionId?: string
}

export type FieldKind = 'text' | 'usd' | 'pct' | 'number' | 'bool' | 'months'

export interface FieldDef {
  key: keyof DealFields
  label: string
  glossaryKey?: string
  kind: FieldKind
  /** For text fields rendered as a select (asset_class). */
  options?: string[]
}

export const ASSET_CLASSES = ['rv_specialty', 'multifamily', 'industrial', 'retail', 'office']

/** Every DealFields input, grouped for the review form. */
export const FIELD_GROUPS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: 'Deal & Sponsor',
    fields: [
      { key: 'deal_name', label: 'Deal name', kind: 'text' },
      { key: 'asset_class', label: 'Asset class', kind: 'text', options: ASSET_CLASSES },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'sponsor_name', label: 'Sponsor', kind: 'text' },
      { key: 'sponsor_integrity_clear', label: 'Sponsor integrity clear', kind: 'bool', glossaryKey: 'hard_kill' },
      { key: 'site_fully_entitled', label: 'Site fully entitled', kind: 'bool', glossaryKey: 'hard_kill' },
      { key: 'sponsor_completed_comparables', label: 'Completed comparable projects', kind: 'number', glossaryKey: 'track_record' },
      { key: 'sponsor_coinvest_pct', label: 'Sponsor co-invest', kind: 'pct', glossaryKey: 'coinvest' },
    ],
  },
  {
    title: 'Capital Stack',
    fields: [
      { key: 'total_project_cost', label: 'Total project cost', kind: 'usd' },
      { key: 'hard_costs', label: 'Hard costs', kind: 'usd' },
      { key: 'land_cost', label: 'Land cost', kind: 'usd', glossaryKey: 'land_basis' },
      { key: 'hard_cost_contingency_pct', label: 'Hard-cost contingency', kind: 'pct', glossaryKey: 'contingency' },
      { key: 'construction_loan', label: 'Construction loan', kind: 'usd', glossaryKey: 'ltc' },
      { key: 'loan_interest_rate', label: 'Modeled loan rate', kind: 'pct', glossaryKey: 'financing' },
      { key: 'total_equity', label: 'Total equity', kind: 'usd' },
    ],
  },
  {
    title: 'Operations',
    fields: [
      { key: 'stabilized_noi_untrended', label: 'Stabilized NOI (untrended)', kind: 'usd', glossaryKey: 'yoc' },
      { key: 'exit_cap_rate', label: 'Exit cap rate', kind: 'pct', glossaryKey: 'exit_cap' },
      { key: 'market_cap_rate_today', label: 'Market cap rate today', kind: 'pct' },
      { key: 'assumed_rent_monthly', label: 'Assumed rent (monthly)', kind: 'usd', glossaryKey: 'rents_vs_comps' },
      { key: 'market_comp_rent_monthly', label: 'Market comp rent (monthly)', kind: 'usd' },
      { key: 'interest_reserve_months', label: 'Interest reserve', kind: 'months', glossaryKey: 'interest_reserve' },
      { key: 'construction_duration_months', label: 'Construction duration', kind: 'months' },
      { key: 'lease_up_months_assumed', label: 'Assumed lease-up', kind: 'months', glossaryKey: 'absorption' },
      { key: 'submarket_leaseup_months', label: 'Submarket lease-up record', kind: 'months' },
    ],
  },
  {
    title: 'Structure & Exit',
    fields: [
      { key: 'exit_dependent_single_refi', label: 'Exit depends on a single refi', kind: 'bool', glossaryKey: 'single_exit_refi' },
      { key: 'has_gmp_or_bonded_gc', label: 'GMP contract / bonded GC', kind: 'bool', glossaryKey: 'gmp' },
      { key: 'has_completion_guarantee', label: 'Completion guarantee', kind: 'bool', glossaryKey: 'completion_guarantee' },
      { key: 'guarantor_net_worth', label: 'Guarantor net worth', kind: 'usd' },
      { key: 'projected_irr', label: 'Projected IRR', kind: 'pct', glossaryKey: 'irr' },
      { key: 'projected_equity_multiple', label: 'Projected equity multiple', kind: 'number', glossaryKey: 'equity_multiple' },
    ],
  },
]

/** Flat list of every registered field, in display order. */
export const ALL_FIELDS: FieldDef[] = FIELD_GROUPS.flatMap(g => g.fields)

/**
 * Fields the 18 checks actually consume — missing any of these means the
 * engine returns MISSING statuses / a REVIEW verdict. Display-only fields
 * (location, sponsor name, sponsor-reported KPIs) and derivable/conditional
 * ones (total_equity, guarantor_net_worth) are excluded.
 */
export const REQUIRED_FIELD_KEYS: Array<keyof DealFields> = [
  'deal_name',
  'asset_class',
  'sponsor_integrity_clear',
  'site_fully_entitled',
  'sponsor_completed_comparables',
  'sponsor_coinvest_pct',
  'total_project_cost',
  'hard_costs',
  'land_cost',
  'hard_cost_contingency_pct',
  'construction_loan',
  'stabilized_noi_untrended',
  'exit_cap_rate',
  'market_cap_rate_today',
  'assumed_rent_monthly',
  'market_comp_rent_monthly',
  'interest_reserve_months',
  'construction_duration_months',
  'lease_up_months_assumed',
  'submarket_leaseup_months',
  'exit_dependent_single_refi',
  'has_gmp_or_bonded_gc',
  'has_completion_guarantee',
]

/**
 * Raw intake form state. Values may be:
 *  - typed DealFields values (loaded from the sample deal: numbers as decimals,
 *    booleans as booleans), or
 *  - raw input strings the user typed (pct entered as "5" meaning 5%),
 *    'yes'/'no'/'' for booleans.
 * Coercion to a clean DealFields payload happens at POST time (DealIntake).
 */
export type IntakeFormValues = Partial<Record<keyof DealFields, string | number | boolean | null>>

/**
 * The client's sample deal — the faithful_trails golden fixture (Okeechobee RV
 * pro forma v18 + OM v2). Strong headline returns, but it fails Gate 1 on three
 * hard kills (unentitled site, 3% contingency, 1.8% co-invest) with the
 * GMP/completion-guarantee answers missing. Keep in sync with
 * netlify/functions/lib/gate1/golden.json.
 */
export const SAMPLE_DEAL: DealFields = {
  deal_name: 'Faithful Trails RV Estates',
  asset_class: 'rv_specialty',
  location: 'Okeechobee, FL',
  sponsor_name: 'DB Fortune Investments, LLC',
  sponsor_integrity_clear: true,
  site_fully_entitled: false,
  sponsor_completed_comparables: 2,
  sponsor_coinvest_pct: 0.018,
  exit_dependent_single_refi: false,
  has_gmp_or_bonded_gc: null,
  has_completion_guarantee: null,
  guarantor_net_worth: null,
  total_project_cost: 10921964,
  hard_costs: 8500000,
  land_cost: 785000,
  hard_cost_contingency_pct: 0.03,
  construction_loan: 6290000,
  loan_interest_rate: 0.065,
  total_equity: 4630000,
  stabilized_noi_untrended: 1472158,
  exit_cap_rate: 0.07,
  market_cap_rate_today: 0.065,
  assumed_rent_monthly: 1175,
  market_comp_rent_monthly: 950,
  interest_reserve_months: 18,
  construction_duration_months: 10,
  lease_up_months_assumed: 13,
  submarket_leaseup_months: 24,
  projected_irr: 0.177,
  projected_equity_multiple: 3.07,
}
