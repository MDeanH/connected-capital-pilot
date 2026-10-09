// Pure finance helpers — no I/O, no config, no side effects. Used by the
// market-comparison panel, the KPI scorecard and the financial summary for
// derived (not sponsor-reported) figures.
import type { DealFields } from './deal-types'

/**
 * Annual debt service on a standard monthly-amortizing loan (annuity formula).
 *   r = annualRate / 12, n = amortYears * 12
 *   payment = loan * r / (1 - (1 + r)^-n), annual = 12 * payment
 * A zero rate degenerates to straight-line principal: loan / n * 12.
 */
export function annualDebtService(loan: number, annualRate: number, amortYears = 25): number {
  const n = amortYears * 12
  if (annualRate === 0) return (loan / n) * 12
  const r = annualRate / 12
  return (12 * loan * r) / (1 - Math.pow(1 + r, -n))
}

/**
 * Debt service coverage ratio: stabilized untrended NOI ÷ annual debt service
 * on the construction loan. All-equity deals (loan 0 or unknown) have no debt
 * service to cover — null, as for any other missing input.
 */
export function dealDSCR(fields: DealFields): number | null {
  const noi = fields.stabilized_noi_untrended
  const loan = fields.construction_loan
  const rate = fields.loan_interest_rate
  if (noi === null || noi === undefined) return null
  if (loan === null || loan === undefined || loan === 0) return null
  if (rate === null || rate === undefined) return null
  return noi / annualDebtService(loan, rate)
}

/**
 * Debt yield: stabilized untrended NOI ÷ construction loan — the lender's
 * amortization-free coverage view. Null when an input is missing or the deal
 * is all-equity (loan 0).
 */
export function dealDebtYield(fields: DealFields): number | null {
  const noi = fields.stabilized_noi_untrended
  const loan = fields.construction_loan
  if (noi === null || noi === undefined) return null
  if (loan === null || loan === undefined || loan === 0) return null
  return noi / loan
}

/**
 * Implied stabilized exit value: stabilized untrended NOI ÷ exit cap rate.
 * Null when an input is missing or the exit cap is 0.
 */
export function impliedExitValue(fields: DealFields): number | null {
  const noi = fields.stabilized_noi_untrended
  const cap = fields.exit_cap_rate
  if (noi === null || noi === undefined) return null
  if (cap === null || cap === undefined || cap === 0) return null
  return noi / cap
}

/**
 * Stabilized cash-on-cash return derived from the intake fields:
 *   (stabilized untrended NOI − annual debt service) / equity
 * where equity = total_equity ?? (total cost − loan).
 *
 * All-equity deals (an EXPLICIT loan of 0) return the unlevered NOI yield on
 * equity (equity = total_equity ?? total cost). A missing loan means the
 * capital stack is unknown — null, as for any other missing input; we never
 * fake a number.
 */
export function dealCashOnCash(fields: DealFields): number | null {
  const noi = fields.stabilized_noi_untrended
  const cost = fields.total_project_cost
  const loan = fields.construction_loan

  if (noi === null || noi === undefined) return null
  if (loan === null || loan === undefined) return null

  // Unlevered: explicitly no debt in the stack.
  if (loan === 0) {
    const equity = fields.total_equity ?? cost
    if (equity === null || equity === undefined || equity <= 0) return null
    return noi / equity
  }

  const rate = fields.loan_interest_rate
  if (rate === null || rate === undefined) return null

  const equity = fields.total_equity ?? (cost !== null && cost !== undefined ? cost - loan : null)
  if (equity === null || equity <= 0) return null

  return (noi - annualDebtService(loan, rate)) / equity
}
