// Pure underwriting math shared by the Underwrite tab and the Combined Verdict
// tab. Extracted from Underwrite.tsx unchanged — thresholds per the Connected
// Capital pilot brief (DSCR 1.20/1.25, exit-cap discipline, LTC 0.75/0.85,
// breakeven cushion 7.5pp, maturity-vs-hold, debt yield 8/10%, +200bps stress).

export type GateStatus = 'pass' | 'flag' | 'fail' | 'na'
export interface Gate { name: string; status: GateStatus; value: string; note: string; tip: string }

export interface UnderwriteInputs {
  cost: number
  gpi: number
  occ: number // fraction 0-1
  opex: number
  loan: number
  rate: number // fraction, e.g. 0.0625
  floating: boolean
  hasCap: boolean
  capStrike: number // fraction
  io: boolean
  termY: number
  holdY: number
  exitCap: number // fraction
  noiG: number // fraction per year
}

export interface UnderwriteResult {
  noi: number
  goingIn: number
  ads: number
  dscr: number
  ltc: number
  debtYield: number
  breakevenOcc: number
  spread10: number | null
  equity: number
  coc: number | null
  leveredIrr: number | null
  multiple: number | null
  gates: Gate[]
  verdict: 'pass' | 'caution' | 'fail'
}

const pct = (x: number, d = 2) => (x * 100).toFixed(d) + '%'

// annual debt service: interest-only or 30-year amortizing
export function annualDebtService(loan: number, rate: number, io: boolean): number {
  if (loan <= 0 || rate <= 0) return 0
  if (io) return loan * rate
  const r = rate / 12, n = 360
  return (loan * r / (1 - Math.pow(1 + r, -n))) * 12
}

export function loanBalanceAfter(loan: number, rate: number, io: boolean, years: number): number {
  if (io) return loan
  const r = rate / 12, n = 360, k = Math.min(n, Math.round(years * 12))
  const pmt = loan * r / (1 - Math.pow(1 + r, -n))
  return loan * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r
}

export function irr(cashflows: number[]): number | null {
  // bisection on [-0.99, 5]
  const npv = (r: number) => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0)
  let lo = -0.99, hi = 5
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid
  }
  return (lo + hi) / 2
}

export function computeUnderwrite(inp: UnderwriteInputs, t10: number | null): UnderwriteResult | null {
  const { cost: C, gpi: G, occ: O, opex: X, loan: L, rate: r, floating, hasCap, capStrike, io } = inp
  const eCap = inp.exitCap, g = inp.noiG, term = inp.termY, hold = inp.holdY
  const noi = G * O - X
  if (C <= 0 || G <= 0 || noi <= 0) return null

  const goingIn = noi / C
  const ads = annualDebtService(L, r, io)
  const dscr = ads > 0 ? noi / ads : Infinity
  const ltc = L / C
  const debtYield = L > 0 ? noi / L : Infinity
  const breakevenOcc = G > 0 ? (X + ads) / G : 0
  const occMargin = O - breakevenOcc
  const spread10 = t10 != null ? goingIn - t10 : null

  // floating stress: +200bps, bounded by the cap strike if one exists
  const stressRate = floating ? Math.min(r + 0.02, hasCap ? capStrike : Infinity) : r
  const stressAds = annualDebtService(L, stressRate, io)
  const stressDscr = stressAds > 0 ? noi / stressAds : Infinity

  // Tier 2: hold-period cashflows
  const equity = C - L
  const coc = equity > 0 ? (noi - ads) / equity : null
  const cfs: number[] = [-equity]
  for (let t = 1; t <= hold; t++) {
    let cf = noi * Math.pow(1 + g, t) - ads
    if (t === hold) {
      const sale = (noi * Math.pow(1 + g, hold + 1)) / eCap
      cf += sale * 0.98 - loanBalanceAfter(L, r, io, hold) // 2% selling costs
    }
    cfs.push(cf)
  }
  const leveredIrr = equity > 0 ? irr(cfs) : null
  const inflows = cfs.slice(1).reduce((s, x) => s + Math.max(0, x), 0)
  const multiple = equity > 0 ? inflows / equity : null

  const gates: Gate[] = [
    {
      name: 'DSCR', tip: 'Net operating income ÷ annual debt service. Below ~1.20–1.25× the asset barely covers its debt — the first survival gate.',
      value: dscr === Infinity ? 'no debt' : dscr.toFixed(2) + '×',
      status: L <= 0 ? 'na' : dscr < 1.20 ? 'fail' : dscr < 1.25 ? 'flag' : 'pass',
      note: L <= 0 ? 'unlevered' : dscr < 1.20 ? 'below 1.20× — debt service not safely covered' : dscr < 1.25 ? 'thin coverage (1.20–1.25×)' : 'covers debt with margin',
    },
    {
      name: 'Exit-cap discipline', tip: 'The most abused assumption in RE underwriting. Demand exit cap ≥ going-in cap; deals that only work on cap compression are rejected.',
      value: `${pct(eCap, 2)} vs ${pct(goingIn, 2)} in`,
      status: eCap >= goingIn ? 'pass' : 'fail',
      note: eCap >= goingIn ? 'no cap compression assumed' : 'underwritten on cap compression — reject or re-underwrite',
    },
    {
      name: 'Leverage (LTC)', tip: 'Loan ÷ total cost. Above ~0.75 is aggressive for this cycle; above 0.85 leaves no margin for error.',
      value: pct(ltc, 0),
      status: L <= 0 ? 'na' : ltc > 0.85 ? 'fail' : ltc > 0.75 ? 'flag' : 'pass',
      note: ltc > 0.85 ? 'extreme leverage' : ltc > 0.75 ? 'aggressive leverage' : 'reasonable leverage',
    },
    {
      name: 'Breakeven occupancy', tip: 'Occupancy at which income exactly covers opex + debt service. The gap to current occupancy is how far income can fall.',
      value: pct(breakevenOcc, 0) + ` (now ${pct(O, 0)})`,
      status: L <= 0 ? 'na' : breakevenOcc >= O ? 'fail' : occMargin < 0.075 ? 'flag' : 'pass',
      note: breakevenOcc >= O ? 'already below breakeven' : occMargin < 0.075 ? `only ${(occMargin * 100).toFixed(1)}pp of cushion` : `${(occMargin * 100).toFixed(1)}pp occupancy cushion`,
    },
    {
      name: 'Loan maturity vs hold', tip: 'A loan that matures before the hold ends forces a refinance at unknown rates — in this cycle, RE risk is overwhelmingly a rates-and-refi story.',
      value: `${term}y loan / ${hold}y hold`,
      status: L <= 0 ? 'na' : term < hold ? (floating && !hasCap ? 'fail' : 'flag') : 'pass',
      note: term < hold ? 'refi dependence inside the hold' + (floating && !hasCap ? ' on unhedged floating debt' : '') : 'debt outlasts the hold',
    },
    {
      name: 'Debt yield', tip: "NOI ÷ loan — the lender's cross-check on leverage; most lenders want ≥ 10%.",
      value: debtYield === Infinity ? 'no debt' : pct(debtYield, 1),
      status: L <= 0 ? 'na' : debtYield < 0.08 ? 'fail' : debtYield < 0.10 ? 'flag' : 'pass',
      note: debtYield < 0.08 ? 'below lender floors' : debtYield < 0.10 ? 'thin for most lenders' : 'lender-comfortable',
    },
    ...(floating ? [{
      name: 'Rate stress (+200bps)', tip: hasCap ? 'Floating-rate DSCR with rates 200bps higher, bounded by your rate cap.' : 'Floating-rate DSCR with rates 200bps higher — unhedged.',
      value: stressDscr.toFixed(2) + '×',
      status: (stressDscr < 1.0 ? 'fail' : stressDscr < 1.2 ? 'flag' : 'pass') as GateStatus,
      note: stressDscr < 1.0 ? 'underwater if rates rise 200bps' : stressDscr < 1.2 ? 'thin under rate stress' : 'survives +200bps',
    }] : []),
  ]

  const anyFail = gates.some(gt => gt.status === 'fail')
  const anyFlag = gates.some(gt => gt.status === 'flag')
  return {
    noi, goingIn, ads, dscr, ltc, debtYield, breakevenOcc, spread10, equity, coc, leveredIrr, multiple, gates,
    verdict: anyFail ? 'fail' : anyFlag ? 'caution' : 'pass',
  }
}

// The Underwrite tab persists its raw input strings here so the Combined
// Verdict tab can underwrite "the deal currently on the Underwrite tab".
export const UNDERWRITE_STORAGE = 'underwrite-deal-v1'
export interface StoredDealInputs {
  cost: string; gpi: string; occ: string; opex: string; loan: string; rate: string
  floating: boolean; hasCap: boolean; capStrike: string; io: boolean
  termY: string; holdY: string; exitCap: string; noiG: string
}

// The fictional "Palmetto Court Apartments" sample deal — single source of
// truth for both tabs (and for detecting whether the user has replaced it).
export const DEAL_DEFAULTS: StoredDealInputs = {
  cost: '5000000', gpi: '620000', occ: '93', opex: '210000', loan: '3250000', rate: '6.25',
  floating: false, hasCap: false, capStrike: '8.0', io: true,
  termY: '5', holdY: '5', exitCap: '7.5', noiG: '2.5',
}

export function isSampleDeal(d: StoredDealInputs): boolean {
  return (Object.keys(DEAL_DEFAULTS) as (keyof StoredDealInputs)[]).every(k => d[k] === DEAL_DEFAULTS[k])
}
