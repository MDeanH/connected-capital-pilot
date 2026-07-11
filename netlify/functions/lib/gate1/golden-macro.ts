// Macro snapshot golden suite — build-gating like golden.ts. Run: tsx golden-macro.ts
// Synthetic series only (no network): the pure layer is exercised against the
// shipped DEFAULT_CONFIG so config edits that change regime behavior fail loudly.
import type { FredPoint } from './fred.ts'
import { buildMarketContext, computeMacroSnapshot, computeVote } from './macro.ts'
import { DEFAULT_CONFIG } from './preview.ts'
import type { MacroSnapshot } from './types.ts'

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name} ${detail}`)
}

const WEEK = '2026-07-06'

/** Series ending 2026-06-01, one value per `stepMonths` months, oldest first. */
const makeSeries = (values: number[], stepMonths = 1): FredPoint[] =>
  values.map((value, i) => {
    const offset = (values.length - 1 - i) * stepMonths
    const d = new Date(Date.UTC(2026, 5 - offset, 1))
    return { date: d.toISOString().slice(0, 10), value }
  })
const flat = (v: number, n = 18) => Array.from({ length: n }, () => v)
/** Index level compounding at `annualRate`, spanning `months` months. */
const growthSeries = (annualRate: number, months = 18, stepMonths = 1): FredPoint[] =>
  makeSeries(
    Array.from({ length: Math.floor(months / stepMonths) + 1 }, (_, i) => 100 * Math.pow(1 + annualRate, (i * stepMonths) / 12)),
    stepMonths,
  )

/** All 7 auto signals voting green (ISM supplied via manualValues). */
const greenSeries = (): Record<string, FredPoint[]> => ({
  sahm: makeSeries(flat(0.1)),
  core_pce: growthSeries(0.02),
  gdp: growthSeries(0.025, 18, 3),
  hy_spread: makeSeries(flat(3.5)),
  unemployment: makeSeries(flat(4.0)),
  yield_curve: makeSeries(flat(0.8)),
  jobless_claims: makeSeries(flat(240_000)),
})
/** All 8 signals voting red WITHOUT tripping the sahm/GDP hard overrides. */
const redSeriesNoOverride = (): Record<string, FredPoint[]> => ({
  sahm: makeSeries(flat(0.48)), // red band, below the 0.5 Sahm trigger
  core_pce: growthSeries(0.05),
  gdp: makeSeries([100, 99, 98.5, 98.6, 98.7], 3), // yoy negative, but last two q/q changes are RISES
  hy_spread: makeSeries(flat(6.5)),
  unemployment: makeSeries(flat(6.0)),
  yield_curve: makeSeries(flat(-0.5)),
  jobless_claims: makeSeries(flat(400_000)),
})
const GREEN_ISM = { ism: 55 }
const snap = (
  series: Record<string, FredPoint[]>,
  opts: { manualValues?: Record<string, number>; previous?: MacroSnapshot | null } = {},
) => computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: WEEK, series, manualValues: GREEN_ISM, ...opts })

console.log('HARD OVERRIDES:')
{
  const r = snap({ ...greenSeries(), sahm: makeSeries(flat(0.6)) })
  check('(a) sahm 0.6 forces recession over all-green votes', r.regime === 'recession', `(${r.regime})`)
  check('(a) …with no hysteresis pending', r.pending_regime === null && r.degraded === false)

  const gdpTwoDown = makeSeries([100, 100.5, 100.2, 99.8], 3) // last two q/q changes decline
  const g = snap({ ...greenSeries(), gdp: gdpTwoDown })
  check('(g) two consecutive GDP q/q declines force recession', g.regime === 'recession', `(${g.regime})`)
}

console.log('\nHYSTERESIS (regime flips need consecutive wins):')
{
  const prevSoft: MacroSnapshot = {
    week_of: '2026-06-29',
    source: 'auto',
    signals: [],
    regime: 'soft_landing',
    pending_regime: null,
    degraded: false,
    postures: { '*': 'green' },
  }
  const manualValues = { ism: 40 } // red ISM to make all 8 votes red
  const week1 = computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: WEEK, series: redSeriesNoOverride(), manualValues, previous: prevSoft })
  check('(b) week 1 holds soft_landing', week1.regime === 'soft_landing', `(${week1.regime})`)
  check('(b) week 1 pending_regime = recession', week1.pending_regime === 'recession', `(${week1.pending_regime})`)
  const week2 = computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: '2026-07-13', series: redSeriesNoOverride(), manualValues, previous: week1 })
  check('(b) week 2 flips to recession', week2.regime === 'recession' && week2.pending_regime === null, `(${week2.regime})`)
}

console.log('\nDEGRADED (too few live votes):')
{
  const prevStag: MacroSnapshot = {
    week_of: '2026-06-29',
    source: 'auto',
    signals: [],
    regime: 'stagflation',
    pending_regime: null,
    degraded: false,
    postures: { '*': 'yellow' },
  }
  const g = greenSeries()
  const only3 = { sahm: g.sahm, hy_spread: g.hy_spread, unemployment: g.unemployment } // 3 < minVotes 4
  const r = computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: WEEK, series: only3, previous: prevStag })
  check('(c) 3 non-null votes → degraded', r.degraded === true)
  check('(c) regime preserved from previous', r.regime === 'stagflation', `(${r.regime})`)
}

console.log('\nQUADRANT (all four corners):')
{
  const gdpUp = growthSeries(0.025, 18, 3)
  const gdpDown = makeSeries([100, 99, 98, 97.5, 97], 3)
  const hot = growthSeries(0.03)
  const cool = growthSeries(0.015)
  const q = (core_pce: FredPoint[], gdp: FredPoint[]) => snap({ ...greenSeries(), core_pce, gdp }).quadrant!.label
  check('(d) hot inflation + growth → inflationary_expansion', q(hot, gdpUp) === 'inflationary_expansion', `(${q(hot, gdpUp)})`)
  check('(d) cool inflation + growth → disinflationary_expansion', q(cool, gdpUp) === 'disinflationary_expansion', `(${q(cool, gdpUp)})`)
  check('(d) hot inflation + contraction → stagflation', q(hot, gdpDown) === 'stagflation', `(${q(hot, gdpDown)})`)
  check('(d) cool inflation + contraction → deflationary_contraction', q(cool, gdpDown) === 'deflationary_contraction', `(${q(cool, gdpDown)})`)
}

console.log('\nVOTE BAND EDGES (inclusive on the better side):')
{
  const defs = DEFAULT_CONFIG.macro.signals!
  const sahm = defs.find((d) => d.id === 'sahm')! // high_is_bad, green 0.2
  const ism = defs.find((d) => d.id === 'ism')! // high_is_good, yellow 48
  check('(e) high_is_bad value == green bound → green', computeVote(sahm, sahm.green) === 'green')
  check('(e) high_is_good value == yellow bound → yellow', computeVote(ism, ism.yellow) === 'yellow')
  check('(e) null value → null vote', computeVote(sahm, null) === null)
}

console.log('\nPOSTURE MATRIX + HURDLE:')
{
  const r = snap({ ...greenSeries(), sahm: makeSeries(flat(0.6)) }) // forced recession
  check("(f) recession: '*' → red", r.postures['*'] === 'red')
  check('(f) recession: private_credit stays yellow', r.postures['private_credit'] === 'yellow')
  // hurdle from config: 8% anchor + 250bps (5y lockup) + 250bps (development) + 200bps (recession) = 15%
  check('hurdle stack totals 15% in recession', Math.abs(r.hurdle!.totalPct - 0.15) < 1e-9, `(${r.hurdle!.totalPct})`)
  const g = snap(greenSeries())
  check('hurdle stack totals 13% in soft_landing', Math.abs(g.hurdle!.totalPct - 0.13) < 1e-9, `(${g.hurdle!.totalPct})`)
}

console.log('\nMARKET CONTEXT (synthetic):')
{
  const empty: FredPoint[] = []
  const m = buildMarketContext({
    sofr: makeSeries(flat(4.3)),
    mortgage30y: makeSeries(flat(6.7)),
    treasury10y: makeSeries(flat(4.4)),
    sp500: growthSeries(0.08, 72),
  })
  check('sofr latest = 4.3', m.sofr === 4.3)
  check('sp500 5y annualized ≈ 8%', m.sp500.ret5y !== null && Math.abs(m.sp500.ret5y - 0.08) < 0.002, `(${m.sp500.ret5y})`)
  const degraded = buildMarketContext({ sofr: empty, mortgage30y: empty, treasury10y: empty, sp500: empty })
  check('empty series → nulls, never faked', degraded.sofr === null && degraded.sp500.ret1y === null)
}

console.log('\nREPLAY (same inputs → identical snapshot):')
{
  const prev: MacroSnapshot = {
    week_of: '2026-06-29',
    source: 'auto',
    signals: [],
    regime: 'soft_landing',
    pending_regime: null,
    degraded: false,
    postures: { '*': 'green' },
  }
  const a = JSON.stringify(computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: WEEK, series: redSeriesNoOverride(), manualValues: GREEN_ISM, previous: prev }))
  const b = JSON.stringify(computeMacroSnapshot({ config: DEFAULT_CONFIG, weekOf: WEEK, series: redSeriesNoOverride(), manualValues: GREEN_ISM, previous: prev }))
  check('(h) recompute is byte-identical', a === b)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
