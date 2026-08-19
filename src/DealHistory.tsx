// Deal history — the durable, browsable record of past decisions. Reads the
// gate_decisions ledger via GET /api/gate1/decisions (newest first, deal
// name joined, cursor-paged — LOAD OLDER appends pages via ?before=, and
// REFRESH or a delete resets to the first page). Decisions are never
// EDITED — but a deal can be deleted
// outright (removing its decisions with it), and an unlinked decision row
// can be deleted individually; both double-confirm. When persistence isn't
// configured the panel says so honestly instead of showing fake rows.
import { useCallback, useEffect, useState } from 'react'
import { Kicker, PostureChip } from './cc-ui'
import { fmtNumber } from './format'
import type { GateVerdict, Posture } from './deal-types'

interface DecisionRow {
  id: string
  decided_at: string
  deal_id: string | null
  deal_name: string | null
  verdict: GateVerdict
  baseline_verdict: GateVerdict
  posture: Posture | null
  threshold_config_version: number
  kills: string[]
  flag_pts: number | null
  overrides_count: number
}

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

export default function DealHistory() {
  const [rows, setRows] = useState<DecisionRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Success notes are transient — they clear themselves after a few seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setDegraded(false)
    setHasMore(false)
    try {
      const r = await fetch('/api/gate1/decisions')
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        throw new Error('Decision history needs the deployed API — run `netlify dev` (plain vite has no persistence).')
      const data = await r.json()
      if (r.status === 503) {
        setDegraded(true)
        setRows(null)
        return
      }
      if (data.error) throw new Error(data.error)
      setRows(Array.isArray(data.decisions) ? (data.decisions as DecisionRow[]) : [])
      setHasMore(data.hasMore === true)
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    const oldest = rows?.[rows.length - 1]
    if (!oldest) return
    setLoadingMore(true)
    setErr(null)
    try {
      const r = await fetch(`/api/gate1/decisions?before=${encodeURIComponent(oldest.decided_at)}`)
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        throw new Error('Decision history needs the deployed API — run `netlify dev` (plain vite has no persistence).')
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      const older = Array.isArray(data.decisions) ? (data.decisions as DecisionRow[]) : []
      setRows(prev => {
        const seen = new Set((prev ?? []).map(x => x.id))
        return [...(prev ?? []), ...older.filter(d => !seen.has(d.id))]
      })
      setHasMore(data.hasMore === true)
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }, [rows])

  useEffect(() => { load() }, [load])

  const deleteRow = useCallback(async (r: DecisionRow) => {
    const name = r.deal_name ?? 'this deal'
    // The loaded pages only show SOME of a deal's decisions when older pages
    // exist — never present that count as the delete's exact scope.
    const siblings = (rows ?? []).filter(x => r.deal_id && x.deal_id === r.deal_id).length
    const scope = hasMore
      ? `ALL of its recorded decisions? (${siblings} shown here; older pages may hold more.)`
      : 'ALL of its recorded decisions?'
    const msg = r.deal_id
      ? `Delete the deal “${name}” and ${scope}\n\nThis permanently removes them from the history. It cannot be undone.`
      : `Delete this recorded decision for “${name}”?\n\nThis permanently removes it from the history. It cannot be undone.`
    if (!window.confirm(msg)) return
    setDeletingId(r.id)
    setErr(null)
    setNotice(null)
    try {
      const url = r.deal_id ? `/api/deals/${r.deal_id}` : `/api/gate1/decisions/${r.id}`
      const resp = await fetch(url, { method: 'DELETE' })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `Delete failed (HTTP ${resp.status})`)
      await load()
      if (r.deal_id && typeof data.decisionsDeleted === 'number') {
        setNotice(`Deleted “${name}” — ${data.decisionsDeleted} recorded decision${data.decisionsDeleted === 1 ? '' : 's'} removed.`)
      }
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setDeletingId(null)
    }
  }, [rows, hasMore, load])

  return (
    <div className="dh-root">
      <style>{CSS}</style>
      <div className="card dh-hero">
        <Kicker>CONNECTED CAPITAL — DEAL HISTORY</Kicker>
        <h2>Every decision, on the record</h2>
        <p className="dh-lede">
          The ledger of recorded Gate 1 decisions — newest first, each stamped with the rulebook
          version, macro posture and any judgment adjustments it was made under. Decisions are never
          edited; a deal can be deleted outright, which removes its recorded decisions with it.
        </p>
        <div className="dh-actions">
          <button className="secondary" onClick={load} disabled={loading}>
            {loading ? 'LOADING…' : 'REFRESH'}
          </button>
        </div>
      </div>

      {loading && !rows && <div className="dh-busy" role="status">Loading decision history…</div>}
      {err && <div className="dh-err" role="alert">{err}</div>}
      {notice && <div className="dh-notice" role="status">{notice}</div>}

      {degraded && (
        <div className="card dh-degraded" role="note">
          <h3>Decisions are not being recorded</h3>
          <p>
            Persistence isn't configured on this deployment (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY),
            so RECORD DECISION computes a verdict but stores nothing — the same "NOT recorded" warning
            you see on the results step.
          </p>
          <p>
            With persistence on, every recorded decision lands here as a row that is never edited — deal,
            verdict, rulebook version, macro posture and judgment adjustments — replayable exactly and
            browsable as the fund's history of old deals. Deals (and their decisions) can be deleted,
            but a decision is never silently altered.
          </p>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="card dh-empty">
          No decisions recorded yet — score a deal and hit RECORD DECISION on the results step.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card dh-table-card">
          <table className="dh-table">
            <thead>
              <tr>
                <th>Deal</th><th>Verdict</th><th>Posture</th><th>Kills</th><th>Flags</th>
                <th>Rulebook</th><th>Adjustments</th><th>Decided</th><th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="dh-deal">{r.deal_name ?? '—'}</div>
                    {!r.deal_id && <div className="dh-unlinked">not linked to a saved deal</div>}
                  </td>
                  <td>
                    <span className={`dh-verdict dh-v-${r.verdict.toLowerCase()}`}>{r.verdict}</span>
                    {r.baseline_verdict !== r.verdict && (
                      <div className="dh-baseline">rulebook said {r.baseline_verdict}</div>
                    )}
                  </td>
                  <td>{r.posture ? <PostureChip posture={r.posture} /> : '—'}</td>
                  <td title={r.kills.join(', ')}>{r.kills.length || '—'}</td>
                  <td>{r.flag_pts ? fmtNumber(r.flag_pts) : '—'}</td>
                  <td>v{r.threshold_config_version}</td>
                  <td>{r.overrides_count || '—'}</td>
                  <td title={r.decided_at}>{fmtDate(r.decided_at)}</td>
                  <td>
                    <button
                      className="dh-delete"
                      onClick={() => deleteRow(r)}
                      disabled={deletingId !== null}
                      title={r.deal_id ? 'Delete this deal and all its recorded decisions' : 'Delete this recorded decision'}
                      aria-label={r.deal_id ? `Delete deal ${r.deal_name ?? ''}` : 'Delete decision'}
                    >
                      {deletingId === r.id ? '…' : 'DELETE'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="dh-more">
              <button className="secondary" onClick={loadMore} disabled={loadingMore || loading}>
                {loadingMore ? 'LOADING…' : 'LOAD OLDER'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const CSS = `
.dh-root{display:flex;flex-direction:column;gap:2rem;max-width:1180px;margin:0 auto;width:100%}
.dh-hero{padding:2.5rem}
.dh-hero h2{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.9rem;margin:.5rem 0 .4rem;letter-spacing:-.01em}
.dh-lede{color:var(--muted,#5c6b67);font-size:.9rem;max-width:640px;line-height:1.6;margin:0 0 1.5rem}
.dh-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center}
.dh-actions button{letter-spacing:.08em;font-size:12px}
.dh-busy{color:var(--accent,#3f7d69);font-size:.82rem}
.dh-err{background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:.8rem 1rem;font-size:.85rem}
.dh-notice{background:#e4f5ee;color:#2c574a;border:1px solid #bcded3;border-radius:10px;padding:.8rem 1rem;font-size:.85rem}
.dh-degraded{padding:1.5rem;border:1px solid #f0e0b0;background:#fbf3df}
.dh-degraded h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .8rem;font-weight:600;color:#5b4a16}
.dh-degraded p{color:#5b4a16;font-size:.85rem;line-height:1.6;margin:0 0 .8rem}
.dh-degraded p:last-child{margin-bottom:0}
.dh-empty{padding:1.5rem;color:var(--muted,#5c6b67);font-size:.88rem}
.dh-table-card{padding:.5rem 1rem;overflow-x:auto}
.dh-table{width:100%;border-collapse:collapse;font-size:.83rem}
.dh-table th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);padding:.7rem .6rem;border-bottom:1px solid var(--border,#dcebe7)}
.dh-table td{padding:.65rem .6rem;border-bottom:1px solid var(--border,#dcebe7);vertical-align:top}
.dh-deal{font-weight:500}
.dh-unlinked{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:.2rem}
.dh-verdict{font-size:10.5px;letter-spacing:.08em;font-weight:700;padding:2px 8px;border-radius:6px;border:1.5px solid;display:inline-block}
.dh-v-pass{color:#3f7d69;border-color:#3f7d69;background:rgba(63,125,105,.08)}
.dh-v-conditional{color:#b8860b;border-color:#b8860b;background:rgba(184,134,11,.08)}
.dh-v-fail{color:#c2384a;border-color:#c2384a;background:rgba(194,56,74,.08)}
.dh-v-review{color:#5c6b67;border-color:#9c9c9c;background:rgba(156,156,156,.12)}
.dh-baseline{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:.25rem}
.dh-delete{font-size:9.5px;letter-spacing:.08em;font-weight:700;color:#c2384a;background:transparent;border:1px solid #f0c8d0;border-radius:6px;padding:3px 9px;cursor:pointer}
.dh-delete:hover:not(:disabled){background:#fbecef}
.dh-delete:disabled{opacity:.45;cursor:default}
.dh-more{display:flex;justify-content:center;padding:.9rem 0 .6rem}
.dh-more button{letter-spacing:.08em;font-size:12px}
@media (max-width:700px){.dh-delete{font-size:12px}}
`
