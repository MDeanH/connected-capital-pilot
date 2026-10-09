// Gate 1 check-by-check results: 10 hard kills + 8 watch flags, each row with
// value vs threshold, provenance (base × posture × judgment), pass margin and
// fragility. ADJUST prefills the JudgmentPanel with the check's threshold key.
import { Term } from './GlossaryTip'
import { StatusDot } from './cc-ui'
import type { CheckDef, CheckResult, Gate1Response } from './deal-types'

interface Props {
  response: Gate1Response
  onAdjust?: (thresholdKey: string, currentEffective: number) => void
}

// check id → glossary key (sponsor_integrity / site_entitled are pure kills).
const GLOSSARY_BY_CHECK: Record<string, string> = {
  ltc_max: 'ltc',
  dev_spread_min: 'dev_spread',
  contingency_min: 'contingency',
  coinvest_min: 'coinvest',
  track_record: 'track_record',
  single_exit_refi: 'single_exit_refi',
  gmp_required: 'gmp',
  mini_stress: 'mini_stress',
  yoc_vs_benchmark: 'yoc',
  exit_cap_vs_market: 'exit_cap',
  interest_reserve: 'interest_reserve',
  land_basis: 'land_basis',
  rents_vs_comps: 'rents_vs_comps',
  absorption: 'absorption',
  profit_margin: 'profit_margin',
  completion_guarantee: 'completion_guarantee',
  sponsor_integrity: 'hard_kill',
  site_entitled: 'hard_kill',
}

/** Format a threshold/adjustment value in the check's own units. */
export function fmtVal(id: string, n: number): string {
  switch (id) {
    case 'dev_spread_min':
    case 'exit_cap_vs_market':
      return `${Math.round(n)} bps`
    case 'mini_stress':
      return `${n.toFixed(2)}x`
    case 'interest_reserve':
    case 'absorption':
      return `${Math.round(n)} mo`
    case 'track_record':
      return `${n}`
    case 'gmp_required':
      return `$${(n / 1e6).toFixed(1)}M`
    default:
      return `${(n * 100).toFixed(1)}%`
  }
}

/** Format a signed-margin magnitude in the check's own units. */
export function fmtMargin(id: string, m: number): string {
  const a = Math.abs(m)
  switch (id) {
    case 'dev_spread_min':
    case 'exit_cap_vs_market':
      return `${Math.round(a)} bps`
    case 'mini_stress':
      return `${a.toFixed(2)}x`
    case 'interest_reserve':
    case 'absorption':
      return `${Math.round(a)} mo`
    case 'track_record':
      return `${a}`
    default:
      return `${(a * 100).toFixed(1)} pp` // pct-style values → percentage points
  }
}

/** Threshold as it should read next to the comparator. */
function fmtThreshold(c: CheckResult): string {
  if (!c.threshold) return ''
  if (c.id === 'interest_reserve') return `duration + ${fmtVal(c.id, c.threshold.effective)}`
  return fmtVal(c.id, c.threshold.effective)
}

const CMP: Record<string, string> = { '<=': '≤', '>=': '≥' }

function Row({ c, meta, onAdjust }: {
  c: CheckResult
  meta: CheckDef | undefined
  onAdjust?: (thresholdKey: string, currentEffective: number) => void
}) {
  const gk = GLOSSARY_BY_CHECK[c.id]
  const t = c.threshold
  const extra = (
    <>
      {meta?.tip && <div style={{ marginTop: 6 }}>{meta.tip}</div>}
      {t && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          {fmtVal(c.id, t.base)} base ({t.source.posture === '*' ? 'all postures' : `${t.source.posture} posture`})
          {t.adjustment && <> · judgment: {fmtVal(c.id, t.adjustment.value)} — “{t.adjustment.reason}”</>}
        </div>
      )}
    </>
  )
  return (
    <div className={`gr-row gr-b-${c.status}`}>
      <div className="gr-name">
        <StatusDot status={c.status} />
        <span className="gr-label">
          {gk ? <Term k={gk} extra={extra}>{c.label}</Term> : c.label}
        </span>
      </div>
      <div className="gr-mid">
        <span className="gr-val">{c.valueDisplay}</span>
        {t && c.comparator && (
          <span className="gr-thresh"> {CMP[c.comparator] ?? c.comparator} {fmtThreshold(c)}</span>
        )}
        {c.note && <div className="gr-note">{c.note}</div>}
      </div>
      <div className="gr-status">
        <span className={`gr-word gr-w-${c.status}`}>
          {c.status === 'na' ? 'N/A' : c.status.toUpperCase()}
        </span>
        {c.margin !== null && c.status === 'pass' && (
          <span className="gr-margin">passes by {fmtMargin(c.id, c.margin)}</span>
        )}
        {c.fragile && (
          <span className="gr-fragile"><Term k="fragile_pass">FRAGILE</Term></span>
        )}
        {c.margin !== null && (c.status === 'fail' || c.status === 'flag') && (
          <span className="gr-margin gr-miss">misses by {fmtMargin(c.id, c.margin)}</span>
        )}
        {onAdjust && t && (
          <button
            className="gr-adjust"
            onClick={() => onAdjust(t.key, t.effective)}
            title={`Adjust the ${t.key} threshold for this deal (reason required)`}
          >
            ADJUST
          </button>
        )}
      </div>
    </div>
  )
}

export default function GateResults({ response, onAdjust }: Props) {
  const metaById = new Map(response.checksMeta.map(m => [m.id, m]))
  const checks = response.result.checks
  const kills = checks.filter(c => c.kind === 'kill')
  const flags = checks.filter(c => c.kind === 'flag')
  const killCount = response.checksMeta.filter(m => m.kind === 'kill').length
  const flagCount = response.checksMeta.filter(m => m.kind === 'flag').length

  const n = (s: string) => checks.filter(c => c.status === s).length
  const summary = `${n('fail')} failed · ${n('flag')} flagged · ${n('pass')} passed · ${n('missing')} missing`

  return (
    <div className="gr-root">
      <style>{CSS}</style>
      <div className="gr-summary" role="status">{summary}</div>

      <h3><Term k="hard_kill">Hard kills</Term> — {killCount}</h3>
      <div className="card gr-section">
        {kills.map(c => <Row key={c.id} c={c} meta={metaById.get(c.id)} onAdjust={onAdjust} />)}
      </div>

      <h3><Term k="watch_flag">Watch flags</Term> — {flagCount}</h3>
      <div className="card gr-section">
        {flags.map(c => <Row key={c.id} c={c} meta={metaById.get(c.id)} onAdjust={onAdjust} />)}
      </div>
    </div>
  )
}

const CSS = `
.gr-root{max-width:1180px;margin:0 auto}
.gr-root h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin:1.5rem 0 .6rem}
.gr-summary{display:inline-block;font-size:.8rem;color:#5c6b67;background:#fff;border:1px solid #dcebe7;border-radius:999px;padding:.3rem .85rem;font-variant-numeric:tabular-nums}
.gr-section{padding:.25rem 1.5rem}
.gr-row{display:flex;align-items:center;gap:1.25rem;padding:.8rem .75rem;border-left:4px solid transparent;margin-left:-.75rem}
.gr-row + .gr-row{border-top:1px solid #eef4f2}
.gr-b-pass{border-left-color:#157f3c}
.gr-b-flag{border-left-color:#b8860b}
.gr-b-fail,.gr-b-missing{border-left-color:#c2384a}
.gr-b-na{border-left-color:#c2c8d2}
.gr-name{flex:1 1 32%;display:flex;align-items:center;gap:.55rem;font-size:.88rem;font-weight:500;min-width:0}
.gr-mid{flex:1 1 40%;font-size:.85rem;font-variant-numeric:tabular-nums;min-width:0}
.gr-val{font-weight:600}
.gr-thresh{color:#5c6b67}
.gr-note{font-size:.72rem;color:#5c6b67;margin-top:2px}
.gr-status{flex:0 0 auto;display:flex;align-items:center;gap:.6rem;justify-content:flex-end;flex-wrap:wrap}
.gr-word{font-size:11px;font-weight:700;letter-spacing:.08em}
.gr-w-pass{color:#157f3c}
.gr-w-flag{color:#b8860b}
.gr-w-fail,.gr-w-missing{color:#c2384a}
.gr-w-na{color:#5c6b67}
.gr-margin{font-size:.72rem;color:#5c6b67}
.gr-margin.gr-miss{color:#c2384a}
.gr-fragile{font-size:10px;font-weight:700;letter-spacing:.06em;color:#b8860b;background:#fbf3df;border:1px solid #f0e0b0;border-radius:5px;padding:1px 6px}
button.gr-adjust{font-size:10.5px;letter-spacing:.06em;padding:.2rem .6rem;background:transparent;color:#3f7d69;border:none;text-decoration:underline;box-shadow:none}
button.gr-adjust:hover{background:rgba(99,205,169,.12)}
@media(max-width:900px){
  .gr-row{flex-wrap:wrap;gap:.4rem}
  .gr-name{flex:1 1 100%}
  .gr-mid{flex:1 1 55%}
  .gr-status{flex:1 1 40%}
}
`
