// Back-testing — Patel's "ultimate goal": run his past deals through the
// current rulebook and see whether the gate's calls match what actually
// happened (on par / above / below). Deals come from the template spreadsheet;
// each row runs through the SAME /api/gate1/preview engine as live deals.
import { useRef, useState } from 'react'
import { Kicker } from './cc-ui'
import { Term } from './GlossaryTip'
import { downloadBacktestTemplate, parseBacktestWorkbook, type BacktestRow } from './excel'
import { ALL_FIELDS } from './deal-types'
import type { DealFields, GateVerdict, Posture } from './deal-types'

interface Props {
  /** "Par" — the house IRR benchmark deals are judged against (config-driven). */
  parIrr: number
}

interface RunRow extends BacktestRow {
  verdict: GateVerdict
  kills: string[]
  flagPoints: number
  missing: number
}

type Call = 'right_block' | 'right_pass' | 'missed_winner' | 'let_through' | 'indeterminate' | 'no_outcome'

const CALL_META: Record<Call, { label: string; cls: string }> = {
  right_block: { label: 'RIGHT CALL — blocked an underperformer', cls: 'bt-good' },
  right_pass: { label: 'RIGHT CALL — passed a performer', cls: 'bt-good' },
  missed_winner: { label: 'MISSED WINNER — gate blocked, deal performed', cls: 'bt-warn' },
  let_through: { label: 'LET THROUGH — passed, underperformed', cls: 'bt-bad' },
  indeterminate: { label: 'REVIEW — incomplete inputs, no call to grade', cls: 'bt-muted' },
  no_outcome: { label: 'no outcome data', cls: 'bt-muted' },
}

/** Fictional sample history so the screen demos without real client data. */
const SAMPLE_HISTORY: BacktestRow[] = [
  mk('Cypress Grove RV Resort', 'rv_specialty', { site_fully_entitled: true, hard_cost_contingency_pct: 0.07, sponsor_coinvest_pct: 0.09, stabilized_noi_untrended: 1300000, total_project_cost: 9800000, construction_loan: 5400000, exit_cap_rate: 0.075 }, 0.19, 2.4, 'Sold year 6 above plan'),
  mk('Lakeview Pads Phase I', 'rv_specialty', { site_fully_entitled: false, hard_cost_contingency_pct: 0.03, sponsor_coinvest_pct: 0.02, stabilized_noi_untrended: 900000, total_project_cost: 8400000, construction_loan: 5900000, exit_cap_rate: 0.065 }, 0.03, 1.05, 'Rezoning took 26 months; overruns ate the equity'),
  mk('Harbor Point Apartments', 'multifamily', { site_fully_entitled: true, hard_cost_contingency_pct: 0.06, sponsor_coinvest_pct: 0.1, stabilized_noi_untrended: 1500000, total_project_cost: 21000000, construction_loan: 13000000, exit_cap_rate: 0.055 }, 0.155, 1.9, 'On plan'),
  mk('Sunbelt Storage Conversion', 'industrial', { site_fully_entitled: true, hard_cost_contingency_pct: 0.04, sponsor_coinvest_pct: 0.04, stabilized_noi_untrended: 800000, total_project_cost: 8000000, construction_loan: 5600000, exit_cap_rate: 0.07 }, 0.07, 1.3, 'Lease-up ran 2 years behind'),
  mk('Palm Ridge Build-to-Rent', 'multifamily', { site_fully_entitled: true, hard_cost_contingency_pct: 0.05, sponsor_coinvest_pct: 0.06, stabilized_noi_untrended: 1250000, total_project_cost: 15500000, construction_loan: 9000000, exit_cap_rate: 0.06 }, 0.14, 1.8, 'Solid, unspectacular'),
  mk('Old Mill Office Reposition', 'office', { site_fully_entitled: true, hard_cost_contingency_pct: 0.05, sponsor_coinvest_pct: 0.07, stabilized_noi_untrended: 950000, total_project_cost: 14000000, construction_loan: 9800000, exit_cap_rate: 0.08 }, -0.02, 0.8, 'Office demand cratered; DSCR breach, sold at a loss'),
  mk('Riverbend RV Estates', 'rv_specialty', { site_fully_entitled: false, hard_cost_contingency_pct: 0.045, sponsor_coinvest_pct: 0.03, stabilized_noi_untrended: 1100000, total_project_cost: 8900000, construction_loan: 0, exit_cap_rate: 0.072 }, 0.22, 2.9, 'Entitlement came through fast; strong exit'),
  mk('Gateway Flex Industrial', 'industrial', { site_fully_entitled: true, hard_cost_contingency_pct: 0.08, sponsor_coinvest_pct: 0.12, stabilized_noi_untrended: 1350000, total_project_cost: 13000000, construction_loan: 7000000, exit_cap_rate: 0.068 }, 0.17, 2.0, 'Hit plan'),
]

function mk(name: string, ac: string, over: Partial<DealFields>, rIrr: number, rEm: number, notes: string): BacktestRow {
  return {
    fields: {
      deal_name: `${name} (fictional)`, asset_class: ac, location: 'Fictional, FL', sponsor_name: 'Fictional history',
      sponsor_integrity_clear: true, sponsor_completed_comparables: 3, exit_dependent_single_refi: false,
      has_gmp_or_bonded_gc: true, has_completion_guarantee: true, guarantor_net_worth: 3000000,
      hard_costs: Math.round(((over.total_project_cost as number) ?? 10000000) * 0.72),
      land_cost: Math.round(((over.total_project_cost as number) ?? 10000000) * 0.12),
      loan_interest_rate: 0.062, total_equity: null, market_cap_rate_today: 0.065,
      assumed_rent_monthly: 900, market_comp_rent_monthly: 880, interest_reserve_months: 18,
      construction_duration_months: 12, lease_up_months_assumed: 18, submarket_leaseup_months: 16,
      projected_irr: 0.16, projected_equity_multiple: 2.0,
      ...over,
    } as Record<string, string | number | boolean | null>,
    realized_irr: rIrr,
    verified_net_lp_return: null,
    realized_equity_multiple: rEm,
    outcome_notes: notes,
  }
}

function toDealFields(raw: BacktestRow['fields']): DealFields {
  const out: Record<string, unknown> = {}
  for (const f of ALL_FIELDS) out[f.key] = raw[f.key] ?? null
  return out as unknown as DealFields
}

/**
 * The outcome figure a deal is judged on: realized gross IRR is primary; the
 * verified net-to-LP return stands in ONLY when gross is missing. `usedNetLp`
 * lets the table flag that fallback — a net figure judged against the gross
 * par benchmark must never be silent.
 */
function outcome(r: BacktestRow): { irr: number | null; usedNetLp: boolean } {
  if (r.realized_irr !== null) return { irr: r.realized_irr, usedNetLp: false }
  return { irr: r.verified_net_lp_return, usedNetLp: r.verified_net_lp_return !== null }
}

function judgeCall(verdict: GateVerdict, outcomeIrr: number | null, par: number): Call {
  // REVIEW = required Gate 1 inputs missing — indeterminate, not a block, so it
  // can never be graded right or wrong against the outcome.
  if (verdict === 'REVIEW') return 'indeterminate'
  if (outcomeIrr === null) return 'no_outcome'
  const blocked = verdict === 'FAIL'
  const performed = outcomeIrr >= par
  if (blocked && !performed) return 'right_block'
  if (!blocked && performed) return 'right_pass'
  if (blocked && performed) return 'missed_winner'
  return 'let_through'
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)

export default function Backtest({ parIrr }: Props) {
  const [rows, setRows] = useState<BacktestRow[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [posture, setPosture] = useState<Posture>('green')
  const [run, setRun] = useState<RunRow[] | null>(null)
  const [postureCompare, setPostureCompare] = useState<Record<Posture, number> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  // Raw input text per row index, so a half-typed "14." isn't reformatted mid-keystroke.
  const [netEdit, setNetEdit] = useState<Record<number, string>>({})
  const fileInput = useRef<HTMLInputElement>(null)

  const takeFile = async (file: File) => {
    setErr(null); setRun(null); setPostureCompare(null); setNetEdit({})
    setBusy('Parsing workbook in your browser…')
    try {
      const { rows: parsed, warnings: w } = await parseBacktestWorkbook(await file.arrayBuffer())
      setRows(parsed); setWarnings(w); setSource(file.name)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally { setBusy(null) }
  }

  // The one editable results column. Typed as a percent (14.9 → 0.149); rows
  // and run share indices because evaluate() preserves order, so a re-run keeps edits.
  const editNetLp = (i: number, text: string) => {
    setNetEdit(prev => ({ ...prev, [i]: text }))
    const n = parseFloat(text)
    const frac = Number.isFinite(n) ? n / 100 : null
    const put = <T extends BacktestRow>(xs: T[]): T[] => xs.map((r, j) => (j === i ? { ...r, verified_net_lp_return: frac } : r))
    setRows(put)
    setRun(rr => (rr ? put(rr) : rr))
  }

  // Fallback for environments without /preview-batch — the vite dev bridge
  // serves single-row /api/gate1/* only. Small parallel chunks, same preview
  // endpoint the live intake uses.
  const evaluateRowByRow = async (deals: BacktestRow[], p: Posture): Promise<RunRow[]> => {
    const out: RunRow[] = []
    const CHUNK = 5
    for (let i = 0; i < deals.length; i += CHUNK) {
      const part = await Promise.all(deals.slice(i, i + CHUNK).map(async d => {
        const r = await fetch('/api/gate1/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: toDealFields(d.fields), posture: p }),
        })
        const data = await r.json()
        if (data.error) throw new Error(`${d.fields.deal_name}: ${data.error}`)
        return { ...d, verdict: data.result.verdict, kills: data.result.kills, flagPoints: data.result.flagPoints, missing: data.result.missing.length } as RunRow
      }))
      out.push(...part)
    }
    return out
  }

  // One batch request per posture — the gate1 function rate-limits per IP, so
  // a 60-deal book must never fan out into 60 preview calls. Each batch entry
  // is shaped like a single /preview response (or a per-row { error }).
  const evaluate = async (deals: BacktestRow[], p: Posture): Promise<RunRow[]> => {
    const out: RunRow[] = []
    const BATCH = 100 // server-side cap on /preview-batch rows
    for (let i = 0; i < deals.length; i += BATCH) {
      const part = deals.slice(i, i + BATCH)
      const r = await fetch('/api/gate1/preview-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: part.map(d => toDealFields(d.fields)), posture: p }),
      })
      const data = await r.json().catch(() => ({}))
      if (!Array.isArray(data.results)) {
        // 400/404/405 without per-row results = no batch endpoint here (the
        // vite dev bridge) — this client never sends an empty or oversized
        // batch, so a real one answers 200 or 5xx. Anything else is a real error.
        if (r.status === 400 || r.status === 404 || r.status === 405) return evaluateRowByRow(deals, p)
        throw new Error(data.error ?? `Batch preview failed (HTTP ${r.status})`)
      }
      part.forEach((d, j) => {
        const entry = data.results[j]
        if (!entry || entry.error) throw new Error(`${d.fields.deal_name}: ${entry?.error ?? 'no result returned'}`)
        out.push({ ...d, verdict: entry.result.verdict, kills: entry.result.kills, flagPoints: entry.result.flagPoints, missing: entry.result.missing.length } as RunRow)
      })
    }
    return out
  }

  const runBacktest = async () => {
    if (!rows.length) return
    setBusy(`Running ${rows.length} deals through Gate 1 (${posture} posture)…`)
    setErr(null)
    try {
      setRun(await evaluate(rows, posture))
      setPostureCompare(null)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally { setBusy(null) }
  }

  const comparePostures = async () => {
    if (!rows.length) return
    setBusy('Re-running the book under all three postures…')
    try {
      const passCount = (rs: RunRow[]) => rs.filter(x => x.verdict === 'PASS' || x.verdict === 'CONDITIONAL').length
      // Sequential on purpose: one batch request per posture keeps COMPARE at
      // three calls total instead of three fan-outs racing the rate limit.
      const counts = {} as Record<Posture, number>
      for (const p of ['green', 'yellow', 'red'] as Posture[]) {
        counts[p] = passCount(await evaluate(rows, p))
      }
      setPostureCompare(counts)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally { setBusy(null) }
  }

  const calls = (run ?? []).map(r => judgeCall(r.verdict, outcome(r).irr, parIrr))
  const rightCalls = calls.filter(c => c === 'right_block' || c === 'right_pass').length
  // "of Y" denominator: definite verdict AND known outcome — indeterminate
  // (REVIEW) rows can't be graded, so they never count for or against the gate.
  const outcomes = calls.filter(c => c !== 'no_outcome' && c !== 'indeterminate').length
  const passed = (run ?? []).filter(r => r.verdict === 'PASS' || r.verdict === 'CONDITIONAL')
  const failed = (run ?? []).filter(r => r.verdict === 'FAIL')
  const reviews = (run ?? []).filter(r => r.verdict === 'REVIEW').length
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const avgPassed = avg(passed.map(r => r.realized_irr))
  const avgFailed = avg(failed.map(r => r.realized_irr))
  const avgAll = avg((run ?? []).filter(r => r.verdict !== 'REVIEW').map(r => r.realized_irr))
  const anyNetLp = (run ?? []).some(r => r.verified_net_lp_return !== null)
  const avgNetPassed = avg(passed.map(r => r.verified_net_lp_return))
  const avgNetFailed = avg(failed.map(r => r.verified_net_lp_return))

  return (
    <div className="bt-root">
      <style>{CSS}</style>
      <div className="card bt-hero">
        <Kicker>CONNECTED CAPITAL — BACK-TESTING</Kicker>
        <h2>Run your history through the rulebook</h2>
        <p className="bt-lede">
          Load past deals with their realized outcomes and see how today's Gate 1 would have called
          each one — on par, above, or below. Par is the house <Term k="irr">IRR</Term> benchmark
          ({pct(parIrr)}), and every deal runs through the exact engine live intake uses.
        </p>
        <div className="bt-actions">
          <button className="secondary" onClick={() => downloadBacktestTemplate()}>DOWNLOAD TEMPLATE</button>
          <button className="secondary" onClick={() => fileInput.current?.click()}>UPLOAD PAST DEALS (XLSX)</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) takeFile(f); e.target.value = '' }} />
          <button className="bt-sample-link" onClick={() => { setRows(SAMPLE_HISTORY); setSource('fictional sample history'); setRun(null); setPostureCompare(null); setWarnings([]); setNetEdit({}) }}>
            Load fictional sample history
          </button>
        </div>
        {source && (
          <div className="bt-loaded">
            <b>{rows.length} deals loaded</b> from {source}
            {warnings.map((w, i) => <span key={i} className="bt-warn-note"> · {w}</span>)}
            <span className="bt-posture">
              Posture:
              {(['green', 'yellow', 'red'] as Posture[]).map(p => (
                <button key={p} className={`bt-chip${posture === p ? ' bt-chip-on' : ''}`} onClick={() => setPosture(p)}>{p.toUpperCase()}</button>
              ))}
            </span>
            <button onClick={runBacktest} disabled={!!busy}>RUN BACKTEST</button>
            <button className="secondary" onClick={comparePostures} disabled={!!busy}>COMPARE POSTURES</button>
          </div>
        )}
        {busy && <div className="bt-busy" role="status">{busy}</div>}
        {err && <div className="bt-err" role="alert">{err}</div>}
      </div>

      {postureCompare && (
        <div className="card bt-compare">
          <h3>Posture sensitivity <Term k="posture" /></h3>
          <p className="bt-muted">Deals that would clear the gate (PASS or CONDITIONAL) out of {rows.length}:</p>
          <div className="bt-compare-row">
            {(['green', 'yellow', 'red'] as Posture[]).map(p => (
              <div key={p} className={`bt-compare-cell bt-${p}`}>
                <div className="bt-compare-n">{postureCompare[p]}</div>
                <div className="bt-compare-l">{p.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {run && (
        <>
          <div className="card bt-summary">
            <h3>The verdict on your history</h3>
            <div className="bt-stats">
              <div>
                <b>{run.length}</b> deals · gate passes <b>{passed.length}</b>, blocks <b>{failed.length}</b>
                {reviews > 0 && <>, review (incomplete inputs) <b>{reviews}</b></>}
              </div>
              <div>Avg realized IRR — passed: <b>{pct(avgPassed)}</b> vs blocked: <b>{pct(avgFailed)}</b></div>
              {anyNetLp && <div>Avg verified net-to-LP — passed: <b>{pct(avgNetPassed)}</b> vs blocked: <b>{pct(avgNetFailed)}</b></div>}
              <div>Right calls: <b>{rightCalls} of {outcomes}</b> deals with a definite verdict and known outcome</div>
              <div>
                Your book overall: <b>{pct(avgAll)}</b> realized —{' '}
                <b>{avgAll === null ? '—' : avgAll >= parIrr ? 'ABOVE PAR' : 'BELOW PAR'}</b> vs the {pct(parIrr)} benchmark
              </div>
            </div>
          </div>
          <div className="card bt-table-card">
            <table className="bt-table">
              <thead>
                <tr>
                  <th>Deal</th><th>Verdict</th><th>Kills</th><th>Flags</th>
                  <th>Projected IRR</th><th>Realized IRR</th>
                  <th title="Net to the LP after fees/promote — fill only when verified; blank = unverified">Verified net LP</th>
                  <th>Realized EM</th><th>The gate's call</th>
                </tr>
              </thead>
              <tbody>
                {run.map((r, i) => {
                  const { irr: outcomeIrr, usedNetLp } = outcome(r)
                  const call = judgeCall(r.verdict, outcomeIrr, parIrr)
                  return (
                    <tr key={i}>
                      <td>
                        <div className="bt-deal">{String(r.fields.deal_name ?? '—')}</div>
                        {r.outcome_notes && <div className="bt-notes">{r.outcome_notes}</div>}
                      </td>
                      <td><span className={`bt-verdict bt-v-${r.verdict.toLowerCase()}`}>{r.verdict}</span></td>
                      <td title={r.kills.join(', ')}>{r.kills.length || '—'}</td>
                      <td>{r.flagPoints || '—'}</td>
                      <td>{pct((r.fields.projected_irr as number) ?? null)}</td>
                      <td>{pct(r.realized_irr)}</td>
                      <td className="bt-netlp-cell">
                        <input type="number" step="0.1" className="bt-netlp-input" placeholder="—"
                          aria-label={`Verified net-to-LP return (%) — ${String(r.fields.deal_name ?? `row ${i + 1}`)}`}
                          value={netEdit[i] ?? (r.verified_net_lp_return === null ? '' : String(Number((r.verified_net_lp_return * 100).toFixed(2))))}
                          onChange={e => editNetLp(i, e.target.value)} />
                        <span className="bt-netlp-unit">%</span>
                      </td>
                      <td>{r.realized_equity_multiple === null ? '—' : `${r.realized_equity_multiple.toFixed(2)}x`}</td>
                      <td>
                        <span className={`bt-call ${CALL_META[call].cls}`}>{CALL_META[call].label}</span>
                        {usedNetLp && <span className="bt-netlp-chip" title="No realized gross IRR — this call judges the verified net-to-LP figure against the gross par benchmark">net LP</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const CSS = `
.bt-root{display:flex;flex-direction:column;gap:2rem;max-width:1180px;margin:0 auto;width:100%}
.bt-hero{padding:2.5rem}
.bt-hero h2{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.9rem;margin:.5rem 0 .4rem;letter-spacing:-.01em}
.bt-lede{color:var(--muted,#5c6b67);font-size:.9rem;max-width:640px;line-height:1.6;margin:0 0 1.5rem}
.bt-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center}
.bt-actions button{letter-spacing:.08em;font-size:12px}
button.bt-sample-link{background:transparent;border:none;color:var(--muted,#5c6b67);text-transform:none;letter-spacing:0;font-size:.8rem;text-decoration:underline;padding:.2rem 0}
button.bt-sample-link:hover{background:transparent;color:var(--text,#090e11)}
.bt-loaded{margin-top:1.4rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;font-size:.85rem}
.bt-warn-note{color:#b8860b}
.bt-posture{display:inline-flex;align-items:center;gap:.4rem;color:var(--muted,#5c6b67)}
button.bt-chip{background:transparent;border:1px solid var(--border,#dcebe7);color:var(--muted,#5c6b67);font-size:10.5px;padding:.25rem .6rem;border-radius:999px;letter-spacing:.06em}
button.bt-chip.bt-chip-on{background:var(--accent-soft,#e4f5ee);border-color:var(--accent,#3f7d69);color:var(--accent,#3f7d69)}
.bt-busy{margin-top:1rem;color:var(--accent,#3f7d69);font-size:.82rem}
.bt-err{margin-top:1rem;background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:.8rem 1rem;font-size:.85rem}
.bt-compare h3,.bt-summary h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .8rem;font-weight:600}
.bt-muted{color:var(--muted,#5c6b67);font-size:.82rem}
.bt-compare-row{display:flex;gap:1rem}
.bt-compare-cell{flex:1;text-align:center;border-radius:10px;padding:1rem;border:1px solid var(--border,#dcebe7)}
.bt-compare-cell.bt-green{background:rgba(63,125,105,.08)}
.bt-compare-cell.bt-yellow{background:rgba(184,134,11,.08)}
.bt-compare-cell.bt-red{background:rgba(194,56,74,.08)}
.bt-compare-n{font-size:30px;font-weight:300}
.bt-compare-l{font-size:10.5px;letter-spacing:.1em;color:var(--muted,#5c6b67)}
.bt-summary{padding:1.5rem}
.bt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.8rem;font-size:.88rem;line-height:1.6}
.bt-table-card{padding:.5rem 1rem;overflow-x:auto}
.bt-table{width:100%;border-collapse:collapse;font-size:.83rem}
.bt-table th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);padding:.7rem .6rem;border-bottom:1px solid var(--border,#dcebe7)}
.bt-table td{padding:.65rem .6rem;border-bottom:1px solid var(--border,#dcebe7);vertical-align:top}
.bt-deal{font-weight:500}
.bt-notes{font-size:.75rem;color:var(--muted,#5c6b67);margin-top:.2rem;max-width:260px}
.bt-verdict{font-size:10.5px;letter-spacing:.08em;font-weight:700;padding:2px 8px;border-radius:6px;border:1.5px solid}
.bt-v-pass{color:#3f7d69;border-color:#3f7d69;background:rgba(63,125,105,.08)}
.bt-v-conditional{color:#b8860b;border-color:#b8860b;background:rgba(184,134,11,.08)}
.bt-v-fail{color:#c2384a;border-color:#c2384a;background:rgba(194,56,74,.08)}
.bt-v-review{color:#5c6b67;border-color:#9c9c9c;background:rgba(156,156,156,.12)}
.bt-netlp-cell{white-space:nowrap}
input.bt-netlp-input{width:4.6rem;font-size:.83rem;padding:.25rem .4rem}
/* keep the global 16px mobile input floor (stops iOS focus zoom) — this
   selector outranks index.css's bare input rule inside the same media query */
@media (max-width:700px){input.bt-netlp-input{font-size:16px}}
.bt-netlp-unit{margin-left:.25rem;color:var(--muted,#5c6b67);font-size:.75rem}
.bt-netlp-chip{display:inline-block;margin-left:.4rem;padding:1px 7px;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#b8860b;border:1px solid #b8860b;background:rgba(184,134,11,.08);border-radius:999px;vertical-align:middle}
.bt-call{font-size:.72rem;letter-spacing:.02em}
.bt-call.bt-good{color:#3f7d69}
.bt-call.bt-warn{color:#b8860b}
.bt-call.bt-bad{color:#c2384a}
.bt-call.bt-muted{color:var(--muted,#5c6b67)}
@media(max-width:900px){.bt-compare-row{flex-direction:column}}
`
