import type { Metro } from './market3dScene'

// ---------------------------------------------------------------------------
// Market Quest game logic: portfolio Monte Carlo (same lognormal-compounding
// approach as the platform's scoring engine) + run scoring.
// ---------------------------------------------------------------------------
export const MAX_PICKS = 5
export const HOLD_YEARS = 4
export const N_SIMS = 3000

function randomNormal(mean = 0, stdev = 1): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return mean + stdev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

export interface RunResult {
  medianIRR: number
  pBeat: number          // P(portfolio IRR >= national baseline)
  pLoss: number          // P(portfolio IRR < 0)
  baseline: number
  uniqueStates: number
  orbs: number
  totalOrbs: number
  score: number
  rank: string
  timeSec: number
  picks: Metro[]
}

// Equal-weight portfolio of lognormal compounding paths per pick.
export function runDiligence(
  picks: Metro[],
  baseline: number,
  orbs: number,
  totalOrbs: number,
  timeSec: number,
): RunResult {
  const irrs: number[] = []
  for (let s = 0; s < N_SIMS; s++) {
    let terminal = 0
    for (const p of picks) {
      const logMu = Math.log(1 + p.mu) - 0.5 * p.sigma * p.sigma
      let cumLog = 0
      for (let y = 0; y < HOLD_YEARS; y++) cumLog += randomNormal(logMu, p.sigma)
      terminal += Math.exp(cumLog)
    }
    terminal /= picks.length
    irrs.push(Math.pow(terminal, 1 / HOLD_YEARS) - 1)
  }
  irrs.sort((a, b) => a - b)
  const medianIRR = irrs[Math.floor(N_SIMS / 2)]
  const pBeat = irrs.filter(r => r >= baseline).length / N_SIMS
  const pLoss = irrs.filter(r => r < 0).length / N_SIMS

  const uniqueStates = new Set(picks.map(p => p.name.split(', ')[1] ?? '?')).size
  const score = Math.max(0, Math.round(
    medianIRR * 5000 + pBeat * 300 - pLoss * 300 + uniqueStates * 25 + orbs * 40,
  ))
  return {
    medianIRR, pBeat, pLoss, baseline, uniqueStates, orbs, totalOrbs, score,
    rank: rankFor(score), timeSec, picks: [...picks],
  }
}

export function rankFor(score: number): string {
  if (score >= 900) return 'Market Oracle'
  if (score >= 700) return 'Managing Partner'
  if (score >= 500) return 'VP of Diligence'
  if (score >= 300) return 'Associate'
  return 'Intern Analyst'
}

export const MISSION_TEXT =
  `Scout the data city and assemble a portfolio of up to ${MAX_PICKS} metros. ` +
  `Fly close to a tower to scan it, press E to acquire. Hunt the glowing data orbs ` +
  `hidden at historic landmarks. Press R to run diligence: a ${N_SIMS.toLocaleString()}-path ` +
  `Monte Carlo (${HOLD_YEARS}-yr hold) scores your picks against the national baseline.`
