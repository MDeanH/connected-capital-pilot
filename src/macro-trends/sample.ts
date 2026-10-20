import { SIGNALS, snapshotAt, type EconomicPosture, type Releases, type SignalId } from './model'
// FICTIONAL release calendar and values. No external API, Date.now or randomness.
// Units follow the client config (percent values are not decimal fractions).
export const SAMPLE_AS_OF = '2026-04-13'
export const SAMPLE_WEEK_DATES = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 0, 12 + 7 * i)).toISOString().slice(0, 10))
export type SampleScenarioId = 'inflation' | 'slowdown' | 'recovery' | 'early' | 'holding' | 'missing'
export const SAMPLE_SCENARIOS: Record<SampleScenarioId, { label: string; posture: EconomicPosture; slow: [number,number]; pce: [number,number] }> = {
  inflation: { label: 'Inflation pressure building', posture: 'soft_landing', slow: [-.5,-.25], pce: [1.9,2.4] },
  slowdown: { label: 'Slowdown approaching Red', posture: 'stagflation', slow: [.25,.82], pce: [2.9,3.05] },
  recovery: { label: 'Confirmed recovery signals', posture: 'recession', slow: [1.8,1.2], pce: [3.8,3.2] },
  early: { label: 'Early recovery, not confirmed', posture: 'recession', slow: [1.8,1.2], pce: [3.8,3.2] },
  holding: { label: 'Holding steady', posture: 'soft_landing', slow: [-.25,-.25], pce: [2.3,2.3] },
  missing: { label: 'Missing 13-week history', posture: 'soft_landing', slow: [-.5,-.25], pce: [1.9,2.4] },
}
const monthlyDates = ['2026-01-09','2026-02-09','2026-03-09','2026-04-10']
export function macroSample(id: SampleScenarioId) {
  const s = SAMPLE_SCENARIOS[id]
  const releases = {} as Releases
  for (const def of SIGNALS) {
    if (def.id === 'pce') {
      const values = monthlyDates.map((_,i) => s.pce[0] + (s.pce[1] - s.pce[0]) * i / 3)
      if (id === 'early') values[1] = 3.9 // only two consecutive eased releases
      releases.pce = monthlyDates.map((date,i) => ({ date, value: values[i] }))
      continue
    }
    const dates = def.id === 'gdp' ? ['2026-01-09','2026-04-09']
      : ['sahm','ism','unemployment'].includes(def.id) ? monthlyDates : SAMPLE_WEEK_DATES
    releases[def.id] = dates.map((date,i) => ({ date,
      value: Number((def.yellow + (s.slow[0] + (s.slow[1] - s.slow[0]) * i / (dates.length - 1)) * (def.red - def.yellow)).toFixed(6)),
    }))
  }
  const snapshots = SAMPLE_WEEK_DATES.map(date => snapshotAt(releases, date))
  return { ...s, releases, asOf: SAMPLE_AS_OF, snapshots: id === 'missing' ? snapshots.slice(1) : snapshots }
}
export function readingLabel(id: SignalId, value: number | null) {
  if (value === null) return 'Unavailable'
  const def = SIGNALS.find(s => s.id === id)!
  const digits = id === 'gdp' ? 6 : 4
  return `${Number(value.toFixed(digits))}${def.unit === '%' ? '%' : ` ${def.unit}`}`
}
