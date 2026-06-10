import { useEffect, useState } from 'react'

// Live dataset freshness panel — green dot = the site ships the latest
// published vintage; red = the source has newer data available to download;
// gray = the check couldn't reach the source. Powered by /api/data-status
// (server-side probes, CDN-cached ~6h).

interface Row { id: string; name: string; vintage: string | null; status: 'current' | 'update' | 'unknown'; latest?: string }
interface Status { checkedAt: string; datasets: Row[] }

const DOT: Record<Row['status'], { color: string; label: string }> = {
  current: { color: '#1a8f5a', label: 'current' },
  update: { color: '#c2384a', label: 'newer data available' },
  unknown: { color: '#9aa3b2', label: 'check unavailable' },
}

export default function DataStatus() {
  const [data, setData] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/data-status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return null
  if (!data) {
    return <div className="dst-loading">Checking dataset freshness…</div>
  }

  const updates = data.datasets.filter(d => d.status === 'update').length

  return (
    <div className="dst-wrap">
      <style>{CSS}</style>
      <div className="dst-head">
        Dataset status
        <span className="dst-sub">
          {updates === 0 ? 'all current' : `${updates} update${updates > 1 ? 's' : ''} available`} · checked {new Date(data.checkedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      <div className="dst-grid">
        {data.datasets.map(d => (
          <div className="dst-row" key={d.id} title={DOT[d.status].label}>
            <span className="dst-dot" style={{ background: DOT[d.status].color }} />
            <span className="dst-name">{d.name}</span>
            <span className="dst-vint">
              {d.vintage ?? '—'}
              {d.status === 'update' && d.latest ? <b> → {d.latest}</b> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="dst-legend">
        <span><span className="dst-dot" style={{ background: DOT.current.color }} /> current</span>
        <span><span className="dst-dot" style={{ background: DOT.update.color }} /> newer data available</span>
        <span><span className="dst-dot" style={{ background: DOT.unknown.color }} /> check unavailable</span>
      </div>
    </div>
  )
}

const CSS = `
.dst-wrap{margin-top:14px;padding:12px 14px;background:var(--surface-2,#f7f8fa);border:1px solid var(--border,#e6e9ef);border-radius:10px}
.dst-loading{margin-top:14px;font-size:.78rem;color:var(--muted,#5b6573)}
.dst-head{font-size:.82rem;font-weight:700;color:var(--text,#11161f);display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dst-sub{margin-left:auto;font-weight:500;font-size:.7rem;color:var(--muted,#5b6573)}
.dst-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:4px 18px;margin-top:8px}
.dst-row{display:flex;align-items:center;gap:7px;font-size:.76rem;padding:2px 0}
.dst-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dst-name{color:var(--text,#11161f)}
.dst-vint{margin-left:auto;color:var(--muted,#5b6573);font-variant-numeric:tabular-nums;white-space:nowrap}
.dst-vint b{color:#c2384a}
.dst-legend{display:flex;gap:14px;margin-top:9px;font-size:.68rem;color:var(--muted,#5b6573)}
.dst-legend span{display:flex;align-items:center;gap:5px}
`
