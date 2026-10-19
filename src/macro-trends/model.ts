import config from './config.json'
export type EconomicPosture = 'soft_landing' | 'stagflation' | 'recession'
export type Group = 'slowdown' | 'inflation'
export type SignalId = 'sahm' | 'gdp' | 'hy' | 'unemployment' | 'claims' | 'ism' | 'pce'
export interface SignalDefinition { id: SignalId; label: string; group: Group; weight: number; yellow: number; red: number; unit: string }
export const SIGNALS = config.signals as SignalDefinition[]
export const LOOKBACK_WEEKS = config.lookbackWeeks
export interface Release { date: string; value: number | null }
export type Releases = Record<SignalId, Release[]>
export interface WeeklySnapshot { date: string; readings: Record<SignalId, number | null>; published: Record<SignalId, string | null> }
export interface GroupTrend {
  score: number | null; prior: number | null; speed: number | null
  direction: 'worsening' | 'improving' | 'holding' | 'unavailable'
  next: number | null; room: number | null; weeks: number | null; status: string
}
export const POSTURE_LABEL: Record<EconomicPosture, string> = { soft_landing: 'Soft Landing', stagflation: 'Stagflation', recession: 'Recession' }
export function normalize(reading: number | null, yellow: number, red: number): number | null {
  if (reading === null || !Number.isFinite(reading) || !Number.isFinite(yellow) || !Number.isFinite(red) || red === yellow) return null
  return Math.max(-1, Math.min(2, (reading - yellow) / (red - yellow)))
}
export function scoreBand(score: number | null) {
  return score === null ? 'Unavailable' : score < 0 ? 'Green' : score < 1 ? 'Yellow' : 'Red'
}
/** Last published observation at the weekly cutoff; never interpolate unpublished releases. */
export function snapshotAt(releases: Releases, date: string): WeeklySnapshot {
  const readings = {} as WeeklySnapshot['readings'], published = {} as WeeklySnapshot['published']
  for (const def of SIGNALS) {
    const available = releases[def.id].filter(r => r.date <= date).sort((a,b) => b.date.localeCompare(a.date))
    readings[def.id] = available[0]?.value ?? null
    published[def.id] = available[0]?.date ?? null
  }
  return { date, readings, published }
}
export function groupScore(snapshot: WeeklySnapshot, group: Group): number | null {
  let total = 0, weights = 0
  for (const def of SIGNALS.filter(s => s.group === group)) {
    const score = normalize(snapshot.readings[def.id], def.yellow, def.red)
    // Missing observations invalidate the group; do not silently reweight it.
    if (score === null) return null
    total += score * def.weight
    weights += def.weight
  }
  return total / weights
}
export function groupTrend(score: number | null, prior: number | null): GroupTrend {
  const base: GroupTrend = { score, prior, speed: null, direction: 'unavailable', next: null, room: null, weeks: null, status: '13-week comparison unavailable' }
  if (score === null) return { ...base, status: 'Current observations unavailable' }
  if (prior === null) return base
  const speed = (score - prior) / LOOKBACK_WEEKS
  if (speed === 0) return { ...base, speed, direction: 'holding', status: 'Holding' }
  const direction = speed > 0 ? 'worsening' : 'improving'
  const next = speed > 0 ? (score < 0 ? 0 : score < 1 ? 1 : null) : (score > 1 ? 1 : score > 0 ? 0 : null)
  if (next === null) return { ...base, speed, direction, status: speed > 0 ? 'Red, worsening' : 'Green, improving' }
  const room = Math.abs(next - score)
  return { ...base, speed, direction, next, room, weeks: room / Math.abs(speed), status: `${direction === 'worsening' ? 'Toward' : 'Below'} ${next === 0 ? 'Yellow' : 'Red'}` }
}
export function priorDate(date: string) {
  const time = Date.parse(`${date}T00:00:00Z`)
  return new Date(time - LOOKBACK_WEEKS * 7 * 86400000).toISOString().slice(0,10)
}
export function easingConfirmed(releases: Release[], asOf: string): boolean {
  // Three consecutive releases easing needs four monthly values (three declines).
  const latest = releases.filter(r => r.date <= asOf).sort((a,b) => b.date.localeCompare(a.date))
  const monthly: Release[] = []
  for (const r of latest) if (!monthly.some(m => m.date.slice(0,7) === r.date.slice(0,7))) monthly.push(r)
  if (monthly.length < 4) return false
  const monthIndex = (date: string) => Number(date.slice(0,4)) * 12 + Number(date.slice(5,7))
  if (!monthly.slice(0,3).every((r,i) => monthIndex(r.date) - monthIndex(monthly[i+1].date) === 1)) return false
  return monthly.slice(0,4).every(r => r.value !== null && Number.isFinite(r.value)) &&
    monthly.slice(0,3).every((r,i) => r.value! < monthly[i+1].value!)
}
export interface Projection { target: EconomicPosture | null; weeks: number | null; leader: Group | 'both' | null; text: string }
export function projectPosture(current: EconomicPosture, slowdown: GroupTrend, inflation: GroupTrend, recovery: boolean): Projection {
  const none: Projection = { target: null, weeks: null, leader: null, text: `Holding at ${POSTURE_LABEL[current]}` }
  const candidate = (target: EconomicPosture, weeks: number, leader: Projection['leader']): Projection => ({ target, weeks, leader, text: `Heading toward ${POSTURE_LABEL[target]}` })
  if (slowdown.next === null && inflation.next === null) return none
  if (current === 'soft_landing') {
    const options = ([['slowdown', slowdown], ['inflation', inflation]] as const)
      .filter(([,g]) => g.direction === 'worsening' && g.score !== null)
      .flatMap(([id,g]) => g.next === 0 && g.weeks !== null ? [candidate('stagflation', g.weeks, id)] : [])
    return options.sort((a,b) => a.weeks! - b.weeks!)[0] ?? none
  }
  if (current === 'stagflation' && slowdown.direction === 'worsening' && slowdown.score !== null) {
    if (slowdown.next === 1 && slowdown.weeks !== null) return candidate('recession', slowdown.weeks, 'slowdown')
  }
  const improving = slowdown.direction === 'improving' || inflation.direction === 'improving'
  if (improving && !recovery) return { ...none, text: 'Early signs of improvement, not confirmed' }
  if (!recovery) return none
  if (current === 'recession' && slowdown.direction === 'improving' && slowdown.score !== null) {
    if (slowdown.score <= 1) return candidate('stagflation', 0, 'slowdown')
    if (slowdown.next === 1 && slowdown.weeks !== null) return candidate('stagflation', slowdown.weeks, 'slowdown')
  }
  if (current === 'stagflation' && improving) {
    const untilBelowYellow = (g: GroupTrend) => g.score !== null && g.score < 0 ? 0
      : g.score !== null && g.score === 0 && g.direction === 'improving' ? 0
      : g.direction === 'improving' && g.next === 0 ? g.weeks : null
    const slowWeeks = untilBelowYellow(slowdown), inflationWeeks = untilBelowYellow(inflation)
    // Both conditions must be met: the later crossing determines this transition.
    if (slowWeeks !== null && inflationWeeks !== null) return candidate('soft_landing', Math.max(slowWeeks, inflationWeeks), 'both')
  }
  return none
}
export function analyzeTrend(currentPosture: EconomicPosture, snapshots: WeeklySnapshot[], asOf: string, pceReleases: Release[]) {
  const current = snapshots.find(s => s.date === asOf)
  const prior = snapshots.find(s => s.date === priorDate(asOf))
  const slowdown = groupTrend(current ? groupScore(current, 'slowdown') : null, prior ? groupScore(prior, 'slowdown') : null)
  const inflation = groupTrend(current ? groupScore(current, 'inflation') : null, prior ? groupScore(prior, 'inflation') : null)
  let improving = 0, worsening = 0, unchanged = 0, unavailable = 0
  for (const d of SIGNALS.filter(s => s.group === 'slowdown')) {
    const now = current?.readings[d.id] ?? null
    const then = prior?.readings[d.id] ?? null
    if (now === null || then === null || !Number.isFinite(now) || !Number.isFinite(then)) unavailable++
    else {
      // Direction is observable even when both normalized scores are clamped.
      const movement = (now - then) / (d.red - d.yellow)
      if (movement < 0) improving++
      else if (movement > 0) worsening++
      else unchanged++
    }
  }
  const pceEasing = easingConfirmed(pceReleases, asOf)
  const recoveryConfirmed = improving >= 5 && pceEasing
  const projection = projectPosture(currentPosture, slowdown, inflation, recoveryConfirmed)
  if (slowdown.score === null || inflation.score === null || slowdown.prior === null || inflation.prior === null) {
    return { current, prior, slowdown, inflation, improving, worsening, unchanged, unavailable, pceEasing, recoveryConfirmed,
      projection: { target: null, weeks: null, leader: null, text: 'Trend unavailable — complete current and 13-week history required' } as Projection }
  }
  return { current, prior, slowdown, inflation, improving, worsening, unchanged, unavailable, pceEasing, recoveryConfirmed, projection }
}
export function estimateLabel(weeks: number | null) {
  if (weeks === null) return 'No relevant crossing estimate'
  if (weeks === 0) return 'Boundary reached; weekly evaluation pending'
  if (!Number.isFinite(weeks) || weeks > 1000) return 'More than 1,000 weeks at this pace'
  if (weeks < 1) return 'Less than 1 week'
  return Number.isInteger(weeks) ? `About ${weeks} weeks` : `About ${Math.floor(weeks)}–${Math.ceil(weeks)} weeks`
}
