// Step 2 — verification of what the AI extracted from the deal documents.
// Every field is editable (the analyst corrects the machine), carries a
// confidence tag, and cites the document/page/quote it came from.
// Pure controlled form: state lives in DealIntake, raw values in, raw values out.
import { Term } from './GlossaryTip'
import { ConfidenceTag, SourceCite } from './cc-ui'
import { fmtByKind } from './format'
import { FIELD_GROUPS } from './deal-types'
import type { DealFields, FieldDef, IntakeFormValues } from './deal-types'
import type { ExtractedField } from '../netlify/functions/lib/gate1/fields'

interface Props {
  fields: IntakeFormValues
  onChange: (key: keyof DealFields, rawValue: string) => void
  missingKeys: string[]
  /** Per-field extraction metadata (confidence + source citation), when an extraction ran. */
  meta?: Record<string, ExtractedField>
}

function confidenceLevel(ex: ExtractedField | undefined): 'high' | 'med' | 'low' | null {
  if (!ex || ex.value === null || ex.confidence <= 0) return null
  return ex.confidence >= 0.8 ? 'high' : ex.confidence >= 0.5 ? 'med' : 'low'
}

/** What to show in the input for a stored value (typed sample values or raw strings). */
function displayValue(f: FieldDef, v: string | number | boolean | null | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') {
    if (f.kind === 'pct') return String(Number((v * 100).toFixed(4))) // 0.018 → "1.8"
    return String(v)
  }
  return v
}

/**
 * Formatted echo of the current form value ("$2,000,000") for kinds a native
 * number input can't punctuate. Null (unparseable/empty/other kinds) = no echo.
 */
function echoValue(f: FieldDef, v: string | number | boolean | null | undefined): string | null {
  if (f.kind !== 'usd' && f.kind !== 'number' && f.kind !== 'months') return null
  const raw = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v)
  if (raw === '') return null
  const pretty = fmtByKind(f.kind, typeof v === 'string' ? Number(v) : v)
  // No echo when formatting adds nothing over the input's own digits ("3" → "3").
  return pretty === null || pretty === raw ? null : pretty
}

function prettyOption(o: string): string {
  return o === 'rv_specialty' ? 'RV / specialty' : o.replace(/_/g, ' ')
}

function FieldInput({ f, value, onChange }: {
  f: FieldDef
  value: string
  onChange: (key: keyof DealFields, rawValue: string) => void
}) {
  const id = `ir-${f.key}`
  if (f.kind === 'bool') {
    return (
      <select id={id} value={value} onChange={e => onChange(f.key, e.target.value)}>
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    )
  }
  if (f.options) {
    return (
      <select id={id} value={value} onChange={e => onChange(f.key, e.target.value)}>
        <option value="">Select…</option>
        {f.options.map(o => <option key={o} value={o}>{prettyOption(o)}</option>)}
      </select>
    )
  }
  if (f.kind === 'text') {
    return <input id={id} type="text" value={value} onChange={e => onChange(f.key, e.target.value)} />
  }
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step="any"
      value={value}
      onChange={e => onChange(f.key, e.target.value)}
    />
  )
}

export default function IntakeReview({ fields, onChange, missingKeys, meta }: Props) {
  const missing = new Set(missingKeys)
  const missingLabels = FIELD_GROUPS
    .flatMap(g => g.fields)
    .filter(f => missing.has(f.key))
    .map(f => f.label)

  return (
    <div className="ir-root">
      <style>{CSS}</style>
      <div className="ir-head">
        <h2>Review what was extracted</h2>
        <p className="ir-sub">
          Confirm or correct each value — the citations show where it came from. Fields the
          documents don't answer are flagged for you. Nothing is scored until you confirm.
        </p>
      </div>
      {missingLabels.length > 0 && (
        <div role="status" className="card ir-attention">
          <b>The documents didn't answer ({missingLabels.length}):</b> {missingLabels.join(', ')}
        </div>
      )}
      <div className="ir-grid">
        {FIELD_GROUPS.map(g => (
          <div className="card ir-group" key={g.title}>
            <h3>{g.title}</h3>
            {g.fields.map(f => {
              const isMissing = missing.has(f.key)
              const ex = meta?.[f.key]
              const level = confidenceLevel(ex)
              const echo = echoValue(f, fields[f.key])
              return (
                <div className={`ir-row${isMissing ? ' ir-missing' : ''}`} key={f.key}>
                  <label htmlFor={`ir-${f.key}`} className="ir-label">
                    {f.glossaryKey ? <Term k={f.glossaryKey}>{f.label}</Term> : f.label}
                    {isMissing && <span className="ir-tag"><ConfidenceTag level="missing" /></span>}
                    {!isMissing && level && <span className="ir-tag"><ConfidenceTag level={level} /></span>}
                    {ex?.source?.doc && (
                      <span className="ir-cite">
                        <SourceCite
                          doc={ex.source.doc === 'om' ? 'OM' : 'Pro forma'}
                          page={ex.source.page}
                          quote={ex.source.quote ?? undefined}
                        />
                      </span>
                    )}
                  </label>
                  <div className="ir-input">
                    <FieldInput f={f} value={displayValue(f, fields[f.key])} onChange={onChange} />
                    {f.kind === 'pct' && <span className="ir-suffix">%</span>}
                    {echo !== null && <span className="ir-suffix">{echo}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
.ir-root{max-width:1180px;margin:0 auto}
.ir-head{margin-bottom:1.25rem}
.ir-head h2{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.7rem;margin:0 0 .3rem;letter-spacing:-.01em}
.ir-sub{color:#5c6b67;font-size:.88rem;line-height:1.6;max-width:640px;margin:0}
.ir-cite{margin-left:.5rem;display:inline-block;vertical-align:middle}
.ir-attention{background:#fbf3df;border-color:#f0e0b0;color:#5b4a16;font-size:.85rem;padding:1rem 1.25rem;margin-bottom:1.25rem;line-height:1.6}
.ir-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem;align-items:start}
.ir-group{padding:1.5rem}
.ir-group h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .75rem;font-weight:600}
.ir-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.5rem .5rem;border-radius:8px}
.ir-row + .ir-row{margin-top:2px}
.ir-row.ir-missing{background:rgba(194,56,74,.07)}
.ir-label{flex:1 1 55%;font-size:.85rem;font-weight:500;min-width:0}
.ir-tag{margin-left:.5rem;display:inline-block;vertical-align:middle}
.ir-input{flex:1 1 45%;display:flex;align-items:center;gap:.4rem;min-width:0}
.ir-input input,.ir-input select{width:100%;min-width:0;font-size:.85rem;padding:.4rem .55rem}
.ir-suffix{font-size:.8rem;color:#5c6b67;flex:0 0 auto;white-space:nowrap;font-variant-numeric:tabular-nums}
@media(max-width:900px){.ir-grid{grid-template-columns:1fr}}
`
