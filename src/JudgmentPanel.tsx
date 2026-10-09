// Judgment adjustments — per-deal threshold overrides. Reason is REQUIRED
// (the engine enforces it too); the rulebook's baseline verdict is always
// kept alongside the adjusted one, so manual control is never silent.
import { useEffect, useState } from 'react'
import { Term } from './GlossaryTip'
import { fmtThreshold } from './format'
import type { JudgmentAdjustment } from './deal-types'

export interface AvailableKey {
  key: string
  label: string
  /** Pre-judgment (base) threshold value, in the threshold's own units. */
  effective: number
}

interface Props {
  adjustments: JudgmentAdjustment[]
  onChange: (next: JudgmentAdjustment[]) => void
  availableKeys: AvailableKey[]
  prefill?: { key: string; value: number } | null
}

export default function JudgmentPanel({ adjustments, onChange, availableKeys, prefill }: Props) {
  const [selKey, setSelKey] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (prefill) {
      setSelKey(prefill.key)
      setValue(String(prefill.value))
    }
  }, [prefill])

  const byKey = new Map(availableKeys.map(k => [k.key, k]))
  const numeric = Number(value)
  const valid = selKey !== '' && value.trim() !== '' && Number.isFinite(numeric) && reason.trim() !== ''

  const apply = () => {
    if (!valid) return
    const next = adjustments.filter(a => a.key !== selKey)
    next.push({ key: selKey, value: numeric, reason: reason.trim(), adjustedAt: new Date().toISOString() })
    onChange(next)
    setSelKey('')
    setValue('')
    setReason('')
  }

  const revert = (key: string) => onChange(adjustments.filter(a => a.key !== key))

  return (
    <div className="card jp-root">
      <style>{CSS}</style>
      <h3><Term k="judgment_adjustment">Judgment adjustments</Term></h3>

      {adjustments.length === 0 && (
        <div className="jp-empty">No adjustments — the rulebook's thresholds apply as-is.</div>
      )}
      {adjustments.map(a => {
        const meta = byKey.get(a.key)
        return (
          <div className="jp-item" key={a.key}>
            <div className="jp-item-main">
              <span className="jp-key">{meta?.label ?? a.key}</span>
              <span className="jp-delta">
                {meta ? <>{fmtThreshold(a.key, meta.effective)} → </> : '→ '}<b>{fmtThreshold(a.key, a.value)}</b>
              </span>
              <div className="jp-reason">“{a.reason}”</div>
            </div>
            <button className="secondary jp-revert" onClick={() => revert(a.key)}>REVERT</button>
          </div>
        )
      })}

      <div className="jp-form">
        <label>
          Threshold
          <select value={selKey} onChange={e => setSelKey(e.target.value)}>
            <option value="">Select a threshold…</option>
            {availableKeys.map(k => (
              <option key={k.key} value={k.key}>
                {k.label} ({k.key}) — base {fmtThreshold(k.key, k.effective)}
              </option>
            ))}
          </select>
        </label>
        <label>
          New value
          {/* Raw engine units (pct = fraction: 0.06 means 6%) — the placeholder
              shows the raw base, and the live hint below shows what a typed
              value means, so a 100x unit mistake is visible before APPLY. */}
          <input
            type="number"
            step="any"
            value={value}
            placeholder={selKey && byKey.get(selKey) ? String(byKey.get(selKey)!.effective) : ''}
            onChange={e => setValue(e.target.value)}
          />
          {selKey && value.trim() !== '' && Number.isFinite(Number(value)) && (
            <span className="jp-value-hint">= {fmtThreshold(selKey, Number(value))}</span>
          )}
        </label>
        <label className="jp-reason-input">
          Reason (required)
          <input
            type="text"
            value={reason}
            placeholder="Why this deal deserves a different line"
            onChange={e => setReason(e.target.value)}
          />
        </label>
        <button onClick={apply} disabled={!valid}>APPLY</button>
      </div>

      <p className="jp-help">
        Adjustments preview this deal only; the baseline verdict stays visible.
        Use Record Decision and check for a recorded confirmation to save them.
      </p>
    </div>
  )
}

const CSS = `
.jp-root{padding:1.5rem;max-width:1180px;margin:0 auto}
.jp-root h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin:0 0 1rem}
.jp-empty{font-size:.82rem;color:#5c6b67;margin-bottom:1rem}
.jp-item{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.7rem .75rem;border:1px solid #dcebe7;border-radius:10px;margin-bottom:.6rem;background:rgba(99,205,169,.06)}
.jp-item-main{min-width:0}
.jp-key{font-size:.85rem;font-weight:600;margin-right:.6rem}
.jp-delta{font-size:.85rem;font-variant-numeric:tabular-nums;color:#3f7d69}
.jp-reason{font-size:.78rem;font-style:italic;color:#5c6b67;margin-top:2px}
button.jp-revert{font-size:10.5px;letter-spacing:.06em;padding:.3rem .7rem;flex:0 0 auto}
.jp-form{display:grid;grid-template-columns:2fr 1fr 2fr auto;gap:1rem;align-items:end;margin-top:1.25rem}
.jp-form label{display:block;font-size:.75rem;font-weight:600;color:#5c6b67}
.jp-value-hint{display:block;margin-top:.25rem;font-size:.75rem;font-weight:400;color:#7a8a85;font-variant-numeric:tabular-nums}
.jp-form select,.jp-form input{display:block;width:100%;margin-top:4px;font-size:.85rem;padding:.45rem .55rem}
.jp-help{font-size:.75rem;color:#5c6b67;margin:1rem 0 0;line-height:1.6}
@media(max-width:900px){.jp-form{grid-template-columns:1fr 1fr}.jp-reason-input{grid-column:1/-1}}
`
