import { EXTRACT_FIELDS } from './fields'
import type {
  CheckDef,
  CheckResult,
  CheckStatus,
  DealFields,
  Gate1Config,
  GateResult,
  GateVerdict,
  ResolvedThreshold,
} from './types'

/**
 * Undefined → null for every registry field: a workbook that OMITS a column
 * must evaluate as MISSING (→ REVIEW), not as a failing boolean or a NaN
 * seeping through derivations. Non-finite numbers normalize to null too.
 * String fields stay as-is — no check null-gates them.
 */
export function normalizeDealFields(fields: DealFields): DealFields {
  const out: DealFields = { ...fields }
  for (const def of EXTRACT_FIELDS) {
    if (def.kind === 'string') continue
    const v = out[def.key]
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) {
      ;(out as Record<keyof DealFields, unknown>)[def.key] = null
    }
  }
  return out
}

/**
 * Gate 1: 10 hard kills + 8 watch flags. Pure — no I/O, no Date, no literals:
 * every threshold comes from `resolved` (config × posture × judgment adjustments).
 *
 * Verdict roll-up: any kill = FAIL; otherwise any MISSING = REVIEW (missing never
 * passes); otherwise flag points ≤ passMax = PASS, ≤ conditionalMax = CONDITIONAL,
 * above = FAIL.
 */
export function evaluateGate1(
  rawFields: DealFields,
  resolved: Record<string, ResolvedThreshold>,
  config: Gate1Config,
): GateResult {
  const fields = normalizeDealFields(rawFields)
  const d = derive(fields)
  const fragilePct = resolved['fragile_margin_pct']?.effective ?? 0.1

  const checks: CheckResult[] = config.checks.map(def => {
    const r = runCheck(def, fields, d, resolved)
    if (r.status === 'pass' && r.margin !== null && r.threshold) {
      const scale = Math.abs(r.threshold.effective) || 1
      r.fragile = Math.abs(r.margin) / scale < fragilePct
    }
    return r
  })

  const kills = checks.filter(c => c.kind === 'kill' && c.status === 'fail').map(c => c.id)
  const missing = checks.filter(c => c.status === 'missing').map(c => c.id)
  const flagPoints = checks.reduce((s, c) => s + (c.status === 'flag' ? c.flagPoints : 0), 0)

  let verdict: GateVerdict
  if (kills.length > 0) verdict = 'FAIL'
  else if (missing.length > 0) verdict = 'REVIEW'
  else if (flagPoints <= config.verdictBands.passMaxFlagPts) verdict = 'PASS'
  else if (flagPoints <= config.verdictBands.conditionalMaxFlagPts) verdict = 'CONDITIONAL'
  else verdict = 'FAIL'

  const stressCheck = checks.find(c => c.id === 'mini_stress')
  return {
    verdict,
    kills,
    flagPoints,
    missing,
    checks,
    stress: stressCheck
      ? {
          stressedEquityMultiple: stressCheck.value,
          floor: resolved['stress_em_floor']?.effective ?? NaN,
          hardCostBumpPct: resolved['stress_hard_cost_bump']?.effective ?? NaN,
          exitCapBumpBps: resolved['stress_exit_cap_bump_bps']?.effective ?? NaN,
        }
      : undefined,
  }
}

/** Metrics derivable from the raw fields; null propagates as MISSING. */
export function derive(f: DealFields) {
  const equity =
    f.total_equity ??
    (f.total_project_cost !== null && f.construction_loan !== null
      ? f.total_project_cost - f.construction_loan
      : null)
  const ltc =
    f.construction_loan !== null && nz(f.total_project_cost)
      ? f.construction_loan / f.total_project_cost!
      : null
  const yoc =
    f.stabilized_noi_untrended !== null && nz(f.total_project_cost)
      ? f.stabilized_noi_untrended / f.total_project_cost!
      : null
  const devSpreadBps =
    yoc !== null && f.exit_cap_rate !== null ? (yoc - f.exit_cap_rate) * 10000 : null
  const landBasis =
    f.land_cost !== null && nz(f.total_project_cost) ? f.land_cost / f.total_project_cost! : null
  const exitValue =
    f.stabilized_noi_untrended !== null && nz(f.exit_cap_rate)
      ? f.stabilized_noi_untrended / f.exit_cap_rate!
      : null
  const profitMargin =
    exitValue !== null && nz(f.total_project_cost)
      ? (exitValue - f.total_project_cost!) / f.total_project_cost!
      : null
  const rentPremium =
    f.assumed_rent_monthly !== null && nz(f.market_comp_rent_monthly)
      ? f.assumed_rent_monthly / f.market_comp_rent_monthly! - 1
      : null
  return { equity, ltc, yoc, devSpreadBps, landBasis, exitValue, profitMargin, rentPremium }
}

/**
 * Mini-stress ("the only real math in Gate 1"): bump hard costs (equity-funded),
 * widen the exit cap, charge selling costs, untrended NOI; ignore interim cash
 * flows (conservative). Returns the stressed levered equity multiple.
 */
export function stressedEquityMultiple(
  f: DealFields,
  equity: number,
  hardCostBumpPct: number,
  exitCapBumpBps: number,
  sellingCosts: number,
): number | null {
  if (
    f.hard_costs === null ||
    f.stabilized_noi_untrended === null ||
    f.exit_cap_rate === null ||
    f.construction_loan === null
  )
    return null
  const overrun = f.hard_costs * hardCostBumpPct
  const stressedEquity = equity + overrun
  if (stressedEquity <= 0) return null
  const stressedCap = f.exit_cap_rate + exitCapBumpBps / 10000
  if (stressedCap <= 0) return null
  const exitValue = f.stabilized_noi_untrended / stressedCap
  const netProceeds = exitValue * (1 - sellingCosts) - f.construction_loan
  return netProceeds / stressedEquity
}

type Derived = ReturnType<typeof derive>

function runCheck(
  def: CheckDef,
  f: DealFields,
  d: Derived,
  resolved: Record<string, ResolvedThreshold>,
): CheckResult {
  const t = (key: string) => resolved[key] ?? null
  const base: Omit<CheckResult, 'status' | 'value' | 'valueDisplay' | 'margin'> = {
    id: def.id,
    kind: def.kind,
    label: def.label,
    threshold: def.thresholdKeys.length ? t(def.thresholdKeys[0]) : null,
    flagPoints: def.kind === 'flag' ? (def.flagPoints ?? 1) : 0,
  }
  const failStatus: CheckStatus = def.kind === 'kill' ? 'fail' : 'flag'

  const bool = (value: boolean | null, passWhen: boolean, note?: string): CheckResult => ({
    ...base,
    status: value === null ? 'missing' : value === passWhen ? 'pass' : failStatus,
    value: null,
    valueDisplay: value === null ? 'missing' : value ? 'yes' : 'no',
    margin: null,
    note,
  })

  const numeric = (
    value: number | null,
    threshold: ResolvedThreshold | null,
    comparator: '<=' | '>=',
    fmt: (n: number) => string,
  ): CheckResult => {
    // A non-finite value is a derivation over degenerate inputs (e.g. 0/0) —
    // report missing, never let a NaN comparison read as a silent failure.
    if (value !== null && !Number.isFinite(value)) value = null
    if (value === null || threshold === null)
      return { ...base, threshold, comparator, status: 'missing', value, valueDisplay: 'missing', margin: null }
    const margin = comparator === '<=' ? threshold.effective - value : value - threshold.effective
    return {
      ...base,
      threshold,
      comparator,
      status: margin >= 0 ? 'pass' : failStatus,
      value,
      valueDisplay: fmt(value),
      margin,
    }
  }

  switch (def.id) {
    case 'sponsor_integrity':
      return bool(f.sponsor_integrity_clear, true)
    case 'site_entitled':
      return bool(f.site_fully_entitled, true)
    case 'single_exit_refi':
      return bool(f.exit_dependent_single_refi, false)
    case 'ltc_max':
      return numeric(d.ltc, t('ltc_max'), '<=', pct)
    case 'dev_spread_min':
      return numeric(d.devSpreadBps, t('dev_spread_min_bps'), '>=', n => `${Math.round(n)} bps`)
    case 'contingency_min':
      return numeric(f.hard_cost_contingency_pct, t('contingency_min'), '>=', pct)
    case 'coinvest_min':
      return numeric(f.sponsor_coinvest_pct ?? null, t('coinvest_min'), '>=', pct)
    case 'track_record':
      return numeric(f.sponsor_completed_comparables, t('track_record_min'), '>=', n => `${n}`)
    case 'gmp_required': {
      const sizeT = t('gmp_cost_threshold_usd')
      if (f.total_project_cost === null || sizeT === null)
        return { ...base, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      if (f.total_project_cost <= sizeT.effective)
        return {
          ...base,
          status: 'na',
          value: null,
          valueDisplay: 'n/a',
          margin: null,
          note: `Project below ${usd(sizeT.effective)} size threshold`,
        }
      return bool(f.has_gmp_or_bonded_gc, true)
    }
    case 'mini_stress': {
      const floor = t('stress_em_floor')
      const bump = t('stress_hard_cost_bump')
      const cap = t('stress_exit_cap_bump_bps')
      const sell = t('stress_selling_costs')
      if (!floor || !bump || !cap || !sell || d.equity === null)
        return { ...base, threshold: floor, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      const em = stressedEquityMultiple(f, d.equity, bump.effective, cap.effective, sell.effective)
      return numeric(em, floor, '>=', n => `${n.toFixed(2)}x`)
    }
    case 'yoc_vs_benchmark':
      return numeric(d.yoc, t('yoc_min'), '>=', pct)
    case 'exit_cap_vs_market': {
      if (f.exit_cap_rate === null || f.market_cap_rate_today === null)
        return { ...base, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      const margin = f.exit_cap_rate - f.market_cap_rate_today
      return {
        ...base,
        comparator: '>=',
        status: margin >= 0 ? 'pass' : failStatus,
        value: f.exit_cap_rate,
        valueDisplay: `${pct(f.exit_cap_rate)} vs market ${pct(f.market_cap_rate_today)}`,
        margin: margin * 10000,
        note: 'Compared to today’s market cap rate',
      }
    }
    case 'interest_reserve': {
      const buffer = t('interest_reserve_buffer_months')
      if (
        f.interest_reserve_months === null ||
        f.construction_duration_months === null ||
        buffer === null
      )
        return { ...base, threshold: buffer, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      const required = f.construction_duration_months + buffer.effective
      const margin = f.interest_reserve_months - required
      return {
        ...base,
        threshold: buffer,
        comparator: '>=',
        status: margin >= 0 ? 'pass' : failStatus,
        value: f.interest_reserve_months,
        valueDisplay: `${f.interest_reserve_months} mo vs ${required} mo needed`,
        margin,
      }
    }
    case 'land_basis':
      return numeric(d.landBasis, t('land_basis_max'), '<=', pct)
    case 'rents_vs_comps': {
      const flagAt = t('rent_premium_flag')
      const severeAt = t('rent_premium_severe')
      if (d.rentPremium === null || flagAt === null || severeAt === null)
        return { ...base, threshold: flagAt, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      const severe = d.rentPremium > severeAt.effective
      const tripped = d.rentPremium > flagAt.effective
      return {
        ...base,
        threshold: flagAt,
        comparator: '<=',
        status: tripped ? failStatus : 'pass',
        value: d.rentPremium,
        valueDisplay: `${pct(d.rentPremium)} above comps`,
        margin: flagAt.effective - d.rentPremium,
        flagPoints: tripped && severe ? base.flagPoints * 2 : base.flagPoints,
        note: severe ? 'Severe premium — double flag points' : undefined,
      }
    }
    case 'absorption': {
      if (f.lease_up_months_assumed === null || f.submarket_leaseup_months === null)
        return { ...base, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      const margin = f.lease_up_months_assumed - f.submarket_leaseup_months
      return {
        ...base,
        comparator: '>=',
        status: margin >= 0 ? 'pass' : failStatus,
        value: f.lease_up_months_assumed,
        valueDisplay: `${f.lease_up_months_assumed} mo vs submarket ${f.submarket_leaseup_months} mo`,
        margin,
        note: 'Assumed lease-up should not beat the submarket record',
      }
    }
    case 'profit_margin':
      return numeric(d.profitMargin, t('profit_margin_min'), '>=', pct)
    case 'completion_guarantee': {
      const minPct = t('guarantor_net_worth_min_pct')
      if (f.has_completion_guarantee === null || minPct === null)
        return { ...base, threshold: minPct, status: 'missing', value: null, valueDisplay: 'missing', margin: null }
      if (!f.has_completion_guarantee)
        return { ...base, threshold: minPct, status: failStatus, value: null, valueDisplay: 'no guarantee', margin: null }
      if (f.guarantor_net_worth === null || f.total_project_cost === null)
        return { ...base, threshold: minPct, status: 'missing', value: null, valueDisplay: 'guarantor net worth missing', margin: null }
      const ratio = f.guarantor_net_worth / f.total_project_cost
      return numeric(ratio, minPct, '>=', pct)
    }
    default:
      return { ...base, status: 'missing', value: null, valueDisplay: 'unknown check', margin: null }
  }
}

const nz = (n: number | null): n is number => n !== null && n !== 0
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const usd = (n: number) => `$${(n / 1e6).toFixed(1)}M`
