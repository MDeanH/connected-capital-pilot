// Gate 1 golden suite — build-gating like lib/parity.ts. Run: tsx golden.ts
import { readFileSync } from 'node:fs'
import { evaluateGate1 } from './engine.ts'
import { resolveThresholds } from './thresholds.ts'
import type { DealFields, Gate1Config, Posture } from './types.ts'

const config: Gate1Config = JSON.parse(
  readFileSync(new URL('./default-config.json', import.meta.url), 'utf8'),
)
const fixtures = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'))
const faithful: DealFields = fixtures.faithful_trails
const palm: DealFields = fixtures.palm_grove

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name} ${detail}`)
}
const evalDeal = (f: DealFields, posture: Posture, adjustments: any[] = []) =>
  evaluateGate1(f, resolveThresholds(config, f.asset_class, posture, adjustments), config)
const sortedEq = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')

console.log('FAITHFUL TRAILS (canonical FAIL):')
{
  const r = evalDeal(faithful, 'green')
  check('verdict FAIL', r.verdict === 'FAIL', `(${r.verdict})`)
  check(
    'kills exactly {site_entitled, contingency_min, coinvest_min}',
    sortedEq(r.kills, ['site_entitled', 'contingency_min', 'coinvest_min']),
    `(${r.kills.join(', ')})`,
  )
  check(
    'GMP + completion guarantee are MISSING (not kills)',
    r.missing.includes('gmp_required') && r.missing.includes('completion_guarantee'),
    `(missing: ${r.missing.join(', ')})`,
  )
  const rents = r.checks.find(c => c.id === 'rents_vs_comps')!
  check('rents ~24% above comps → severe double flag', rents.status === 'flag' && rents.flagPoints === 2)
  const spread = r.checks.find(c => c.id === 'dev_spread_min')!
  check('dev spread passes (~648bps)', spread.status === 'pass' && Math.abs(spread.value! - 648) < 5, `(${spread.valueDisplay})`)
}

console.log('\nCLEAN PASS + POSTURE SHIFT (macro moves the bar):')
{
  const green = evalDeal(palm, 'green')
  check('palm_grove PASS under Green', green.verdict === 'PASS', `(${green.verdict}, ${green.flagPoints} pts)`)
  check('no kills, no missing', green.kills.length === 0 && green.missing.length === 0)
  const red = evalDeal(palm, 'red')
  check('palm_grove FAILS under Red', red.verdict === 'FAIL', `(${red.verdict})`)
  check(
    'Red kills = mini_stress + dev_spread (bar moved, deal unchanged)',
    sortedEq(red.kills, ['mini_stress', 'dev_spread_min']),
    `(${red.kills.join(', ')})`,
  )
  const em = green.stress!.stressedEquityMultiple!
  check('Green stressed EM ≈ 1.50x', Math.abs(em - 1.5) < 0.02, `(${em.toFixed(3)})`)
}

console.log('\nBOUNDARIES:')
{
  // Kill line is inclusive: spread exactly at the Green 125bps line passes, and is fragile.
  const at = { ...palm, stabilized_noi_untrended: (0.055 + 0.0125) * 20000000 }
  const r = evalDeal(at, 'green')
  const spread = r.checks.find(c => c.id === 'dev_spread_min')!
  check('spread exactly 125bps → pass (inclusive)', spread.status === 'pass', `(${spread.valueDisplay})`)
  check('…and marked fragile', spread.fragile === true)

  // Flag bands: 2 pts → CONDITIONAL, 4 pts → FAIL (no kills involved).
  const twoPts = { ...palm, assumed_rent_monthly: 1700 } // ~17% premium → severe, 2 pts
  const r2 = evalDeal(twoPts, 'green')
  check('2 flag pts → CONDITIONAL', r2.verdict === 'CONDITIONAL', `(${r2.flagPoints} pts, ${r2.verdict})`)
  const fourPts = { ...twoPts, interest_reserve_months: 10, lease_up_months_assumed: 9 }
  const r4 = evalDeal(fourPts, 'green')
  check('4 flag pts → FAIL', r4.verdict === 'FAIL' && r4.kills.length === 0, `(${r4.flagPoints} pts, ${r4.verdict})`)

  // MISSING never passes: clean deal minus one required field → REVIEW.
  const missing = { ...palm, hard_cost_contingency_pct: null }
  const rm = evalDeal(missing, 'green')
  check('missing contingency → REVIEW (never PASS)', rm.verdict === 'REVIEW', `(${rm.verdict})`)
}

console.log('\nTHRESHOLD RESOLUTION:')
{
  // Same land share, different class caps: 25% passes multifamily (30%), flags RV (20%).
  const land25mf = { ...palm, land_cost: 5000000 }
  const rmf = evalDeal(land25mf, 'green')
  check('25% land basis passes multifamily (cap 30%)', rmf.checks.find(c => c.id === 'land_basis')!.status === 'pass')
  const land25rv = { ...land25mf, asset_class: 'rv_specialty' }
  const rrv = evalDeal(land25rv, 'green')
  check('25% land basis flags rv_specialty (cap 20%)', rrv.checks.find(c => c.id === 'land_basis')!.status === 'flag')
  const t = resolveThresholds(config, 'rv_specialty', 'yellow')
  check('wildcard fallback: rv yellow dev spread = 175bps', t['dev_spread_min_bps'].effective === 175)
  check('class-specific row wins: rv yoc_min = 9.5%', t['yoc_min'].effective === 0.095)
}

console.log('\nJUDGMENT ADJUSTMENTS (manual control, always logged):')
{
  const adj = [{ key: 'contingency_min', value: 0.03, reason: 'Sponsor documented GMP buyout covering overruns' }]
  const r = evalDeal(faithful, 'green', adj)
  check(
    'adjusted contingency floor removes that kill (2 remain)',
    sortedEq(r.kills, ['site_entitled', 'coinvest_min']),
    `(${r.kills.join(', ')})`,
  )
  const th = r.checks.find(c => c.id === 'contingency_min')!.threshold!
  check('provenance carries base + adjustment + reason', th.base === 0.05 && th.effective === 0.03 && !!th.adjustment?.reason)
  let threw = false
  try {
    resolveThresholds(config, 'multifamily', 'green', [{ key: 'contingency_min', value: 0.03, reason: '  ' }])
  } catch {
    threw = true
  }
  check('adjustment without a reason is rejected', threw)
}

console.log('\nREPLAY (same inputs → identical result):')
{
  const a = JSON.stringify(evalDeal(faithful, 'yellow'))
  const b = JSON.stringify(evalDeal(faithful, 'yellow'))
  check('recompute is byte-identical', a === b)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
