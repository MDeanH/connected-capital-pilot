// FRED data access — the ONLY module in the macro pipeline that touches the
// network. Uses the keyless fredgraph CSV endpoint (no API key to provision
// or leak). Every helper below fetchFredSeries is pure and shared with the
// pure logic in macro.ts.
//
// Failure contract: a fetch/parse failure returns [] — never throws. The pure
// layer treats an empty series as "signal unavailable" (null value, null vote),
// so missing data degrades honestly instead of faking values.

export interface FredPoint {
  date: string // ISO yyyy-mm-dd
  value: number
}

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
const DAY_MS = 86_400_000
const YEAR_MS = 365.25 * DAY_MS

/**
 * Fetch a FRED series as [{date, value}] ascending by date.
 * Skips '.' (missing) observations; filters to the trailing `yearsBack` years.
 * Returns [] on any network/parse failure.
 */
export async function fetchFredSeries(seriesId: string, yearsBack = 6): Promise<FredPoint[]> {
  try {
    const res = await fetch(`${FRED_CSV_BASE}?id=${encodeURIComponent(seriesId)}`)
    if (!res.ok) return []
    const text = await res.text()
    const cutoff = Date.now() - yearsBack * YEAR_MS
    const out: FredPoint[] = []
    for (const line of text.split('\n').slice(1)) {
      const comma = line.indexOf(',')
      if (comma < 0) continue
      const date = line.slice(0, comma).trim()
      const rawValue = line.slice(comma + 1).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || rawValue === '.' || rawValue === '') continue
      const value = Number(rawValue)
      if (!Number.isFinite(value)) continue
      if (new Date(`${date}T00:00:00Z`).getTime() < cutoff) continue
      out.push({ date, value })
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    return out
  } catch {
    return []
  }
}

/** Fetch several series concurrently, keyed by the caller's key. Each entry obeys the []-on-failure contract. */
export async function fetchSeriesMap(ids: Record<string, string>, yearsBack = 6): Promise<Record<string, FredPoint[]>> {
  const entries = await Promise.all(
    Object.entries(ids).map(async ([key, id]) => [key, await fetchFredSeries(id, yearsBack)] as const),
  )
  return Object.fromEntries(entries)
}

/** Last observation, or null for an empty series. */
export function latest(series: FredPoint[]): FredPoint | null {
  return series.length ? series[series.length - 1] : null
}

const time = (p: FredPoint) => new Date(`${p.date}T00:00:00Z`).getTime()

/** Nearest point to `targetMs`, or null if none lands within `toleranceMs`. */
function nearest(series: FredPoint[], targetMs: number, toleranceMs: number): FredPoint | null {
  let best: FredPoint | null = null
  let bestDist = Infinity
  for (const p of series) {
    const d = Math.abs(time(p) - targetMs)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best && bestDist <= toleranceMs ? best : null
}

/**
 * Year-over-year change: latest value vs the observation nearest to 12 months
 * earlier (pure date math, so it works for monthly AND quarterly series).
 * null when the series is too short or the base value is unusable.
 */
export function yoyChange(series: FredPoint[]): number | null {
  const last = latest(series)
  if (!last) return null
  // 60-day tolerance: accepts the exact -12mo point for monthly data and the
  // matching quarter for quarterly data, but rejects a series that simply
  // doesn't reach back a year.
  const base = nearest(series, time(last) - YEAR_MS, 60 * DAY_MS)
  if (!base || base.date === last.date || base.value === 0) return null
  return last.value / base.value - 1
}

/** Last observation per calendar month — compact history for sparklines. */
export function downsampleMonthly(series: FredPoint[]): FredPoint[] {
  const byMonth = new Map<string, FredPoint>()
  for (const p of series) byMonth.set(p.date.slice(0, 7), p) // ascending input → last wins
  return [...byMonth.values()]
}

/**
 * Annualized return over `years`: (last/base)^(1/years) - 1, base taken from
 * the observation nearest to `years` back. null when the series doesn't reach
 * far enough (never extrapolated).
 */
export function annualizedReturn(series: FredPoint[], years: number): number | null {
  const last = latest(series)
  if (!last || years <= 0) return null
  const base = nearest(series, time(last) - years * YEAR_MS, 45 * DAY_MS)
  if (!base || base.value <= 0 || last.value <= 0 || base.date === last.date) return null
  return Math.pow(last.value / base.value, 1 / years) - 1
}
