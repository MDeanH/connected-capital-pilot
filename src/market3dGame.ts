import type { Metro } from './market3dScene'

// ---------------------------------------------------------------------------
// Market Quest game logic: correlated portfolio Monte Carlo (national + state
// risk factors, same lognormal-compounding approach as the platform engine),
// score breakdown, missions, and the results histogram.
// ---------------------------------------------------------------------------
export const MAX_PICKS = 5
export const HOLD_YEARS = 4
export const N_SIMS = 3000

// Factor loadings (share of each pick's variance): same-state pairs correlate
// at ~0.60, cross-state at ~0.35 — housing is mostly a national asset class.
const B_NATIONAL = 0.35
const B_STATE = 0.25
const B_IDIO = 1 - B_NATIONAL - B_STATE

function randomNormal(mean = 0, stdev = 1): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return mean + stdev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

export function stateOf(m: Metro): string {
  return m.name.split(', ')[1] ?? '?'
}

// Equal-weight portfolio IRRs under the factor model. Returns sorted IRRs.
export function simulatePortfolio(picks: Metro[], sims: number): number[] {
  const sN = Math.sqrt(B_NATIONAL), sS = Math.sqrt(B_STATE), sI = Math.sqrt(B_IDIO)
  const states = picks.map(stateOf)
  const uniq = [...new Set(states)]
  const stateIdx = states.map(st => uniq.indexOf(st))
  const logMus = picks.map(p => Math.log(1 + p.mu) - 0.5 * p.sigma * p.sigma)

  const irrs: number[] = []
  const cumLog = new Array<number>(picks.length)
  const zState = new Array<number>(uniq.length)
  for (let s = 0; s < sims; s++) {
    cumLog.fill(0)
    for (let y = 0; y < HOLD_YEARS; y++) {
      const zNat = randomNormal()
      for (let k = 0; k < uniq.length; k++) zState[k] = randomNormal()
      for (let i = 0; i < picks.length; i++) {
        const shock = sN * zNat + sS * zState[stateIdx[i]] + sI * randomNormal()
        cumLog[i] += logMus[i] + picks[i].sigma * shock
      }
    }
    let terminal = 0
    for (let i = 0; i < picks.length; i++) terminal += Math.exp(cumLog[i])
    irrs.push(Math.pow(terminal / picks.length, 1 / HOLD_YEARS) - 1)
  }
  irrs.sort((a, b) => a - b)
  return irrs
}

export interface Preview { medianIRR: number; pBeat: number; pLoss: number }

export function quickPreview(picks: Metro[], baseline: number): Preview {
  const irrs = simulatePortfolio(picks, 600)
  return {
    medianIRR: irrs[irrs.length >> 1],
    pBeat: irrs.filter(r => r >= baseline).length / irrs.length,
    pLoss: irrs.filter(r => r < 0).length / irrs.length,
  }
}

export interface ScoreParts {
  base: number          // median IRR
  conviction: number    // P(beat baseline)
  risk: number          // -P(loss)
  diversification: number
  exploration: number
}

export interface RunResult {
  irrs: number[]
  medianIRR: number
  pBeat: number
  pLoss: number
  baseline: number
  uniqueStates: number
  orbs: number
  totalOrbs: number
  parts: ScoreParts
  score: number
  rank: string
  timeSec: number
  picks: Metro[]
}

export function runDiligence(
  picks: Metro[],
  baseline: number,
  orbs: number,
  totalOrbs: number,
  timeSec: number,
): RunResult {
  const irrs = simulatePortfolio(picks, N_SIMS)
  const medianIRR = irrs[irrs.length >> 1]
  const pBeat = irrs.filter(r => r >= baseline).length / irrs.length
  const pLoss = irrs.filter(r => r < 0).length / irrs.length
  const uniqueStates = new Set(picks.map(stateOf)).size
  const parts: ScoreParts = {
    base: Math.round(medianIRR * 5000),
    conviction: Math.round(pBeat * 300),
    risk: -Math.round(pLoss * 300),
    diversification: uniqueStates * 25,
    exploration: orbs * 40,
  }
  const score = Math.max(0, parts.base + parts.conviction + parts.risk + parts.diversification + parts.exploration)
  return {
    irrs, medianIRR, pBeat, pLoss, baseline, uniqueStates, orbs, totalOrbs,
    parts, score, rank: rankFor(score), timeSec, picks: [...picks],
  }
}

export function rankFor(score: number): string {
  if (score >= 800) return 'Market Oracle'
  if (score >= 650) return 'Managing Partner'
  if (score >= 480) return 'VP of Diligence'
  if (score >= 280) return 'Associate'
  return 'Intern Analyst'
}

export interface Mission {
  id: string
  name: string
  desc: string
  check(r: RunResult): boolean
}

export const MISSIONS: Mission[] = [
  {
    id: 'fullbook', name: 'The Full Book',
    desc: '5 metros across 4+ states with P(loss) under 8%',
    check: r => r.picks.length === 5 && r.uniqueStates >= 4 && r.pLoss < 0.08,
  },
  {
    id: 'boring', name: 'Boring Is Beautiful',
    desc: '5 metros, every σ ≤ 10%, P(loss) ≤ 2%',
    check: r => r.picks.length === 5 && r.picks.every(p => p.sigma <= 0.10) && r.pLoss <= 0.02,
  },
  {
    id: 'storm', name: 'Storm Rider',
    desc: '5 metros, every σ ≥ 25%, still ≥ 35% to beat the baseline',
    check: r => r.picks.length === 5 && r.picks.every(p => p.sigma >= 0.25) && r.pBeat >= 0.35,
  },
  {
    id: 'archivist', name: 'The Archivist',
    desc: 'Collect all 8 data orbs in a single run',
    check: r => r.totalOrbs > 0 && r.orbs >= r.totalOrbs,
  },
  {
    id: 'oracle', name: 'Market Oracle',
    desc: 'Score 800+ in a single run',
    check: r => r.score >= 800,
  },
]

// --- persistence (guarded: storage may be unavailable in sandboxes) ---------
const BEST_KEY = 'mq-best-score'
const MISSIONS_KEY = 'mq-missions-done'

export function loadBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 }
}
export function saveBest(score: number): void {
  try { localStorage.setItem(BEST_KEY, String(score)) } catch { /* ignore */ }
}
export function loadMissionsDone(): string[] {
  try { return JSON.parse(localStorage.getItem(MISSIONS_KEY) || '[]') } catch { return [] }
}
export function saveMissionsDone(ids: string[]): void {
  try { localStorage.setItem(MISSIONS_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

// --- results histogram -------------------------------------------------------
export function drawHistogram(cv: HTMLCanvasElement, r: RunResult): void {
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const W = cv.width, H = cv.height
  ctx.clearRect(0, 0, W, H)
  const lo = Math.min(r.irrs[Math.floor(r.irrs.length * 0.01)], -0.02)
  const hi = Math.max(r.irrs[Math.floor(r.irrs.length * 0.99)], r.baseline + 0.02)
  const BINS = 40
  const counts = new Array(BINS).fill(0)
  for (const v of r.irrs) {
    const b = Math.floor(((v - lo) / (hi - lo)) * BINS)
    if (b >= 0 && b < BINS) counts[b]++
  }
  const maxC = Math.max(...counts)
  const bw = W / BINS
  for (let b = 0; b < BINS; b++) {
    const x = b * bw
    const mid = lo + ((b + 0.5) / BINS) * (hi - lo)
    ctx.fillStyle = mid < 0 ? 'rgba(239,68,68,0.75)' : 'rgba(59,91,219,0.85)'
    const h = (counts[b] / maxC) * (H - 16)
    ctx.fillRect(x + 0.5, H - 14 - h, bw - 1, h)
  }
  const vline = (v: number, color: string, label: string) => {
    const x = ((v - lo) / (hi - lo)) * W
    if (x < 0 || x > W) return
    ctx.strokeStyle = color
    ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.font = '9px system-ui'
    ctx.fillText(label, Math.min(x + 2, W - 38), 9)
  }
  vline(0, '#f87171', '0%')
  vline(r.baseline, '#fbbf24', 'US')
  vline(r.medianIRR, '#4ade80', 'med')
  ctx.fillStyle = '#8fa8d8'
  ctx.font = '9px system-ui'
  ctx.fillText(`${(lo * 100).toFixed(0)}%`, 2, H - 4)
  ctx.fillText(`${(hi * 100).toFixed(0)}%`, W - 24, H - 4)
}

export const MISSION_TEXT =
  `Scout the data city and assemble a portfolio of up to ${MAX_PICKS} metros. ` +
  `Fly close to a tower to scan it, press E to acquire. Hunt the glowing data orbs ` +
  `hidden at historic landmarks, then press R to run diligence — a correlated ` +
  `${N_SIMS.toLocaleString()}-path Monte Carlo (${HOLD_YEARS}-yr hold) scores your book.`
