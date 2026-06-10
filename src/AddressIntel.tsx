import { useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { Info } from './Info'

// Address lookup for Deal Score: paste a US street address, we geocode it
// (US Census), auto-select the matching market, and — for Miami-Dade County —
// show true address-level intel (parcel assessment, FEMA flood zone, crime
// within 800m). Backed by /api/address-intel.

interface Parcel {
  folio: string; siteAddress: string | null; assessedYear: number | null
  totalValue: number | null; landValue: number | null; buildingValue: number | null
  valueYoY: number | null; yearBuilt: string | number | null; floors: number | null
  beds: number | null; baths: number | null; livingArea: number | null
  lotSize: number | null; zoning: string | null; landUse: string | null
}
interface Flood { zone: string | null; subtype: string | null; baseFloodElevFt: number | null }
interface Crime { radiusM: number; days: number; total: number; top: { type: string; n: number }[] }
interface IntelResponse {
  matched: string; lat: number; lng: number
  countyName?: string; countyGeoid?: string; placeName?: string; stateAbbr?: string
  miamiDade: { parcel: Parcel | null; flood: Flood | null; crime: Crime | null } | null
  error?: string
}

const usd = (x: number) => '$' + (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1e3) + 'k')

// flood zones starting with A/V are inside the 1%-annual-chance floodplain
const floodColor = (zone: string | null) =>
  !zone ? 'var(--muted)' : /^[AV]/.test(zone) ? '#c2384a' : '#1a8f5a'

export default function AddressIntel({ onResolved }: { onResolved: (candidates: string[]) => string | null }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<IntelResponse | null>(null)
  const [marketUsed, setMarketUsed] = useState<string | null>(null)

  const lookup = async () => {
    const query = q.trim()
    if (query.length < 8) { setErr('Enter a full street address (street, city, state)'); return }
    setBusy(true); setErr(null); setRes(null); setMarketUsed(null)
    try {
      const r = await fetch(`/api/address-intel?q=${encodeURIComponent(query)}`)
      const d: IntelResponse = await r.json()
      if (!r.ok) { setErr(d?.error || 'Lookup failed'); return }
      setRes(d)
      // build market candidates: city first (an address is in a city), then county
      const st = d.stateAbbr
      const place = (d.placeName || '').replace(/ (city|town|village|CDP|municipality)$/i, '').trim()
      const cands: string[] = []
      if (place && st) cands.push(`${place} (city), ${st}`, `${place}, ${st}`)
      if (d.countyName && st) cands.push(`${d.countyName}, ${st}`)
      setMarketUsed(onResolved(cands))
    } catch {
      setErr('Lookup failed — try again')
    } finally {
      setBusy(false)
    }
  }

  const md = res?.miamiDade
  const p = md?.parcel

  return (
    <div className="ai-card">
      <style>{CSS}</style>
      <label className="ai-label">
        Property address
        <Info width={250}>Paste the address of a property you're evaluating. We geocode it (US Census) and auto-select its market below. For <b>Miami-Dade County</b> addresses you also get parcel assessment, FEMA flood zone, and nearby-crime detail.</Info>
      </label>
      <div className="ai-row">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !busy && lookup()}
          placeholder="e.g. 1000 Brickell Ave, Miami, FL"
        />
        <button onClick={lookup} disabled={busy} title="Look up address">
          {busy ? '…' : <Search size={14} />}
        </button>
      </div>
      {err && <div className="ai-err">{err}</div>}

      {res && (
        <div className="ai-result">
          <div className="ai-matched"><MapPin size={12} /> {res.matched}</div>
          {marketUsed
            ? <div className="ai-market">Scoring market set to <b>{marketUsed}</b></div>
            : <div className="ai-market">Couldn't match a market for this address — pick one below.</div>}

          {p && (
            <div className="ai-line">
              <span className="ai-k">Parcel</span>
              <span>
                {p.totalValue != null && <><b>{usd(p.totalValue)}</b> assessed{p.assessedYear ? ` (${p.assessedYear}` : ''}{p.valueYoY != null ? `, ${p.valueYoY >= 0 ? '+' : ''}${(p.valueYoY * 100).toFixed(1)}% YoY)` : p.assessedYear ? ')' : ''}</>}
                {p.zoning && <> · {p.zoning.toLowerCase()}</>}
                {p.yearBuilt && String(p.yearBuilt).length <= 12 && <> · built {p.yearBuilt}</>}
                {p.beds ? <> · {p.beds}bd/{p.baths ?? '?'}ba</> : null}
              </span>
            </div>
          )}
          {md?.flood && (
            <div className="ai-line">
              <span className="ai-k">Flood</span>
              <span>
                zone <b style={{ color: floodColor(md.flood.zone) }}>{md.flood.zone ?? '—'}</b>
                {md.flood.baseFloodElevFt != null && <> · base flood elev {md.flood.baseFloodElevFt} ft</>}
                {/^[AV]/.test(md.flood.zone ?? '') && <> · flood insurance typically required</>}
              </span>
            </div>
          )}
          {md?.crime && (
            <div className="ai-line">
              <span className="ai-k">Crime</span>
              <span><b>{md.crime.total.toLocaleString()}</b> incidents ≤{md.crime.radiusM}m, {md.crime.days}d · top: {md.crime.top[0].type} ({md.crime.top[0].n})</span>
            </div>
          )}
          {res.countyGeoid === '12086' && !p && !md?.flood && (
            <div className="ai-line"><span className="ai-k">Note</span><span>No parcel matched at this point — score uses the market level.</span></div>
          )}
          {res.countyGeoid !== '12086' && (
            <div className="ai-note">Address-level parcel/flood/crime detail is currently available for Miami-Dade County; other markets use market-level data.</div>
          )}
        </div>
      )}
    </div>
  )
}

const CSS = `
.ai-card{margin-bottom:12px;padding:10px 12px;background:var(--accent-soft,#eef2ff);border:1px solid var(--border,#e6e9ef);border-radius:10px}
.ai-label{font-size:.78rem;font-weight:700;color:var(--text,#11161f)}
.ai-row{display:flex;gap:6px;margin-top:6px}
.ai-row input{flex:1;min-width:0;background:var(--surface,#fff);border:1px solid var(--border,#e6e9ef);color:var(--text,#11161f);padding:.45rem .6rem;border-radius:6px;font-size:.85rem}
.ai-row button{padding:.45rem .7rem}
.ai-err{margin-top:6px;font-size:.75rem;color:#c2384a}
.ai-result{margin-top:8px}
.ai-matched{display:flex;align-items:center;gap:4px;font-size:.75rem;font-weight:600;color:var(--text,#11161f)}
.ai-market{font-size:.72rem;color:var(--accent,#3b5bdb);margin-top:3px}
.ai-line{display:flex;gap:8px;font-size:.74rem;margin-top:5px;line-height:1.4}
.ai-k{width:44px;flex-shrink:0;color:var(--muted,#5b6573)}
.ai-note{margin-top:6px;font-size:.68rem;color:var(--muted,#5b6573)}
`
