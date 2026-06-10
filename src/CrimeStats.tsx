import { useEffect, useState } from 'react'
import { Info } from './Info'

// Crime context overlay for the selected market — data baked offline from the
// FBI Crime Data Explorer (UCR/NIBRS) by scripts/fetch_fbi_crime.py into
// public/crime-stats.json. Rates are annual offenses per 100k population.

interface Rates { v?: number; p?: number; pop?: number }
interface CrimeData {
  year: number
  source: string
  national: Rates
  states: Record<string, Rates>
  markets: Record<string, Required<Rates>>
}

let crimeCache: Promise<CrimeData | null> | null = null
function loadCrime(): Promise<CrimeData | null> {
  if (!crimeCache) {
    crimeCache = fetch('/crime-stats.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return crimeCache
}

interface Hit extends Rates {
  label: string
  level: 'market' | 'state'
}

function lookup(d: CrimeData, marketKey: string): Hit | null {
  const direct = d.markets[marketKey]
  if (direct) return { label: marketKey, level: 'market', ...direct }

  const idx = marketKey.lastIndexOf(', ')
  if (idx < 0) return null
  const st = marketKey.slice(idx + 2)
  const base = marketKey.slice(0, idx).replace(/ \(city[^)]*\)$/, '')

  for (const candidate of [`${base} (city), ${st}`, `${base}, ${st}`]) {
    const m = d.markets[candidate]
    if (m) return { label: candidate, level: 'market', ...m }
  }
  const s = d.states[st]
  if (s) return { label: `${st} statewide`, level: 'state', ...s }
  return null
}

function RateRow({ name, rate, national }: { name: string; rate?: number; national?: number }) {
  if (rate === undefined) return null
  const ratio = national ? rate / national : null
  const width = ratio ? Math.min(100, ratio * 50) : 0
  const color = ratio === null ? '#5b6573' : ratio > 1.15 ? '#c2384a' : ratio < 0.85 ? '#1a8f5a' : '#b8860b'
  return (
    <div className="cs-row">
      <span className="cs-name">{name}</span>
      <span className="cs-rate" style={{ color }}>{rate.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      <span className="cs-bar"><span style={{ width: `${width}%`, background: color }} /></span>
      <span className="cs-vs">{ratio !== null ? `${ratio.toFixed(1)}× US` : ''}</span>
    </div>
  )
}

export default function CrimeStats({ marketKey }: { marketKey: string }) {
  const [data, setData] = useState<CrimeData | null>(null)
  useEffect(() => { loadCrime().then(setData) }, [])

  if (!data) return null
  const hit = lookup(data, marketKey)
  if (!hit) return null

  return (
    <div className="cs-card">
      <style>{CSS}</style>
      <div className="cs-head">
        Crime context
        <Info width={260}>
          Annual offenses per 100k residents from the <b>{data.source}</b>, {data.year}.
          Rates reflect the matched law-enforcement jurisdiction
          {hit.level === 'state' ? ' (no agency-level match for this market — statewide shown)' : ''}.
          Agency participation in NIBRS varies; treat as context, not a precise ranking.
        </Info>
        <span className="cs-src">{hit.label} · FBI {data.year}</span>
      </div>
      <RateRow name="Violent" rate={hit.v} national={data.national.v} />
      <RateRow name="Property" rate={hit.p} national={data.national.p} />
      {hit.pop ? <div className="cs-pop">jurisdiction pop. {hit.pop.toLocaleString()}</div> : null}
    </div>
  )
}

const CSS = `
.cs-card{margin-top:10px;padding:10px 12px;background:var(--surface-2,#f7f8fa);border:1px solid var(--border,#e6e9ef);border-radius:10px}
.cs-head{font-size:.78rem;font-weight:700;color:var(--text,#11161f);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.cs-src{margin-left:auto;font-weight:500;font-size:.68rem;color:var(--muted,#5b6573)}
.cs-row{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:.78rem}
.cs-name{width:54px;color:var(--muted,#5b6573)}
.cs-rate{width:48px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.cs-bar{flex:1;height:6px;background:#e6e9ef;border-radius:3px;overflow:hidden}
.cs-bar span{display:block;height:100%;border-radius:3px}
.cs-vs{width:52px;font-size:.68rem;color:var(--muted,#5b6573);text-align:right}
.cs-pop{margin-top:7px;font-size:.68rem;color:var(--muted,#5b6573)}
`
