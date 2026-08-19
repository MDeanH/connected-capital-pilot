// Shared display formatting for engine numbers, keyed off FieldKind.
// The engine and extraction pipeline store dollars as plain numbers and
// percentages as fractions (0.065 = 6.5%); this is the one place that turns
// them into reader-friendly strings ($2,000,000 · 6.5% · 24 mo). Formatting
// is display-only — stored values are never mutated, and a missing/non-finite
// value returns null so callers can simply skip the echo.
import type { FieldKind } from './deal-types'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function fmtUSD(n: number): string {
  return usd0.format(n)
}

/** Fraction in, percent out: 0.065 → "6.5%". Up to 2 dp, trailing zeros trimmed. */
export function fmtPct(n: number): string {
  return `${num2.format(n * 100)}%`
}

export function fmtMonths(n: number): string {
  return `${num2.format(n)} mo`
}

export function fmtNumber(n: number): string {
  return num2.format(n)
}

/**
 * Format a value for display by its field kind. Returns null when there is
 * nothing sensible to show (text/bool kinds, or a non-numeric value) so the
 * caller can render no echo at all rather than a fake one.
 */
export function fmtByKind(kind: FieldKind, value: unknown): string | null {
  if (!finite(value)) return null
  switch (kind) {
    case 'usd': return fmtUSD(value)
    case 'pct': return fmtPct(value)
    case 'months': return fmtMonths(value)
    case 'number': return fmtNumber(value)
    default: return null
  }
}

/**
 * Display unit for every threshold key in the Gate 1 config. bps and x are
 * engine-native units (the stored number IS bps / a multiple), unlike 'pct'
 * where the stored number is a fraction. Keys absent here (new config rows)
 * fall back to plain number formatting — never a wrong unit.
 */
export const THRESHOLD_UNITS: Record<string, 'usd' | 'pct' | 'bps' | 'x' | 'months' | 'number'> = {
  coc_benchmark: 'pct',
  coinvest_min: 'pct',
  contingency_min: 'pct',
  dev_spread_min_bps: 'bps',
  equity_multiple_benchmark: 'x',
  financing_spread_typical_bps: 'bps',
  fragile_margin_pct: 'pct',
  gmp_cost_threshold_usd: 'usd',
  guarantor_net_worth_min_pct: 'pct',
  interest_reserve_buffer_months: 'months',
  irr_benchmark: 'pct',
  land_basis_max: 'pct',
  ltc_max: 'pct',
  profit_margin_min: 'pct',
  rent_premium_flag: 'pct',
  rent_premium_severe: 'pct',
  stress_em_floor: 'x',
  stress_exit_cap_bump_bps: 'bps',
  stress_hard_cost_bump: 'pct',
  stress_selling_costs: 'pct',
  track_record_min: 'number',
  yoc_min: 'pct',
}

/** Format a Gate 1 threshold value by its key's unit: 0.75 → "75%", 10000000 → "$10,000,000". */
export function fmtThreshold(key: string, value: number): string {
  if (!finite(value)) return String(value)
  switch (THRESHOLD_UNITS[key] ?? 'number') {
    case 'usd': return fmtUSD(value)
    case 'pct': return fmtPct(value)
    case 'bps': return `${num2.format(value)} bps`
    case 'x': return `${num2.format(value)}x`
    case 'months': return fmtMonths(value)
    default: return fmtNumber(value)
  }
}
