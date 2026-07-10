// Thresholds & weights control panel — every tunable in the Gate 1 rulebook,
// editable. Edits build a local draft (copy-on-write; props are never mutated)
// that previews use until cleared; SAVE AS NEW VERSION persists it with a
// required note. The engine itself has no hardcoded thresholds — this panel is
// the proof.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Term } from './GlossaryTip'
import type { Gate1Config, ThresholdRow } from '../netlify/functions/lib/gate1/types'

interface Props {
  active: { version: number; config: Gate1Config } | null
  draft: Gate1Config | null
  onDraftChange: (cfg: Gate1Config | null) => void
  onSave: (cfg: Gate1Config, note: string) => Promise<{ persisted: boolean; warning?: string; version?: number }>
}

/**
 * Threshold keys that must tighten monotonically as posture worsens
 * (green ≤ yellow ≤ red). Violations warn softly — never block.
 */
const POSTURE_ORDERED_KEYS = [
  'dev_spread_min_bps',
  'stress_hard_cost_bump',
  'stress_exit_cap_bump_bps',
  'stress_em_floor',
]

const POSTURE_ORDER: Record<string, number> = { green: 0, yellow: 1, red: 2 }

type SaveMsg =
  | { kind: 'saved'; version?: number }
  | { kind: 'not-persisted'; warning: string }
  | { kind: 'error'; message: string }

/** Deep clone (config is pure JSON data, so a JSON round-trip is exact). */
function clone(cfg: Gate1Config): Gate1Config {
  return JSON.parse(JSON.stringify(cfg)) as Gate1Config
}

function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'green' }) {
  return <span className={`tc-chip tc-chip-${tone}`}>{children}</span>
}

/**
 * Uncontrolled numeric input (defaultValue) so intermediate keystrokes like
 * "0." never fight a controlled re-render; parents remount via key when the
 * underlying config identity resets (clear draft / new active version).
 */
function NumInput({ value, onCommit, ariaLabel }: {
  value: number
  onCommit: (v: number) => void
  ariaLabel: string
}) {
  return (
    <input
      className="tc-num"
      type="number"
      step="any"
      defaultValue={value}
      aria-label={ariaLabel}
      onChange={e => {
        const v = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onCommit(v)
      }}
    />
  )
}

export default function ThresholdConfig({ active, draft, onDraftChange, onSave }: Props) {
  const working = draft ?? active?.config ?? null

  // Remount inputs when the draft is discarded so they snap back to active values.
  const [resetKey, setResetKey] = useState(0)
  const prevDraft = useRef(draft)
  useEffect(() => {
    if (prevDraft.current !== null && draft === null) setResetKey(k => k + 1)
    prevDraft.current = draft
  }, [draft])

  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null)

  if (!working) {
    return (
      <div className="card tc-root">
        <style>{CSS}</style>
        <h2 className="tc-title">Thresholds &amp; weights</h2>
        <p className="tc-muted">Config unavailable — the active rulebook has not loaded yet.</p>
      </div>
    )
  }

  /** Copy-on-write edit: clone the working config, mutate, hand up as draft. */
  const edit = (mutator: (cfg: Gate1Config) => void) => {
    const next = clone(working)
    mutator(next)
    onDraftChange(next)
  }

  // ---- Gate thresholds grouped by key, stable first-appearance order ----
  const groups = new Map<string, Array<{ row: ThresholdRow; idx: number }>>()
  working.thresholds.forEach((row, idx) => {
    const list = groups.get(row.key) ?? []
    list.push({ row, idx })
    groups.set(row.key, list)
  })

  const prettyName = (key: string): string => {
    const check = working.checks.find(c => c.thresholdKeys.includes(key))
    return check ? check.label : key
  }

  /** Soft posture-ordering warning for a key's rows (per asset class). */
  const postureWarning = (key: string, rows: Array<{ row: ThresholdRow }>): string | null => {
    if (!POSTURE_ORDERED_KEYS.includes(key)) return null
    const byClass = new Map<string, Partial<Record<string, number>>>()
    for (const { row } of rows) {
      if (!(row.posture in POSTURE_ORDER)) continue
      const m = byClass.get(row.asset_class) ?? {}
      m[row.posture] = row.value
      byClass.set(row.asset_class, m)
    }
    for (const [, m] of byClass) {
      const g = m.green, y = m.yellow, r = m.red
      if ((y != null && r != null && r < y) || (g != null && y != null && y < g)) {
        return 'Check the ordering: this threshold should tighten as posture worsens (green ≤ yellow ≤ red).'
      }
    }
    return null
  }

  const bandsWarn = working.verdictBands.conditionalMaxFlagPts < working.verdictBands.passMaxFlagPts

  // ---- Save flow ----
  const doSave = async () => {
    if (!note.trim()) {
      setNoteError(true)
      return
    }
    setNoteError(false)
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await onSave(working, note.trim())
      if (res.persisted) {
        setSaveMsg({ kind: 'saved', version: res.version })
        setNoteOpen(false)
        setNote('')
      } else {
        setSaveMsg({ kind: 'not-persisted', warning: res.warning ?? 'Not persisted.' })
      }
    } catch (err) {
      setSaveMsg({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(working, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gate1-config-draft.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const inputKey = `${active?.version ?? 'none'}-${resetKey}`

  return (
    <div className="tc-root">
      <style>{CSS}</style>

      <div className="tc-header">
        <h2 className="tc-title">Thresholds &amp; weights</h2>
        <div className="tc-header-chips">
          {active
            ? <Chip tone="green">v{active.version} active</Chip>
            : <Chip>no saved version — spec default</Chip>}
          {draft && <Chip tone="amber">DRAFT — previews use your draft until cleared</Chip>}
        </div>
        <div className="tc-header-actions">
          <button className="tc-btn" onClick={() => { setNoteOpen(o => !o); setSaveMsg(null) }}>
            SAVE AS NEW VERSION
          </button>
          <button className="tc-btn tc-btn-secondary" disabled={!draft} onClick={() => { setSaveMsg(null); onDraftChange(null) }}>
            CLEAR DRAFT
          </button>
        </div>
      </div>

      {noteOpen && (
        <div className="card tc-savebar">
          <label className="tc-savebar-label" htmlFor="tc-note">Version note (required)</label>
          <div className="tc-savebar-row">
            <input
              id="tc-note"
              className="tc-note-input"
              type="text"
              placeholder="What changed and why — e.g. 'tightened dev spread per IC memo'"
              value={note}
              onChange={e => { setNote(e.target.value); setNoteError(false) }}
            />
            <button className="tc-btn" onClick={doSave} disabled={saving}>
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
          {noteError && <div className="tc-warn-text">A note is required — every saved version needs a why.</div>}
        </div>
      )}

      {saveMsg?.kind === 'saved' && (
        <div className="tc-save-ok" role="status">
          Saved{saveMsg.version != null ? ` as v${saveMsg.version}` : ''}.
        </div>
      )}
      {saveMsg?.kind === 'not-persisted' && (
        <div className="card tc-save-warn" role="alert">
          <div className="tc-warn-text">{saveMsg.warning}</div>
          <button className="tc-btn tc-btn-secondary" onClick={exportJson}>EXPORT JSON</button>
        </div>
      )}
      {saveMsg?.kind === 'error' && (
        <div className="card tc-save-warn" role="alert">
          <div className="tc-warn-text">Save failed: {saveMsg.message}</div>
          <button className="tc-btn tc-btn-secondary" onClick={exportJson}>EXPORT JSON</button>
        </div>
      )}

      <div className="card tc-notice">
        Green/Yellow/Red <Term k="posture">posture</Term> shifts these values automatically — you are
        editing the underlying bands.
      </div>

      <h3 className="tc-section">Gate thresholds</h3>
      <div className="card tc-card">
        {[...groups.entries()].map(([key, rows]) => {
          const warn = postureWarning(key, rows)
          const pretty = prettyName(key)
          return (
            <div className="tc-group" key={key}>
              <div className="tc-group-name">
                {pretty}
                {pretty !== key && <span className="tc-group-key">{key}</span>}
              </div>
              {rows.map(({ row, idx }) => (
                <div className="tc-row" key={`${row.asset_class}-${row.posture}`}>
                  <Chip>{row.asset_class === '*' ? 'all classes' : row.asset_class}</Chip>
                  <Chip tone={row.posture === '*' ? 'neutral' : row.posture === 'green' ? 'green' : 'amber'}>
                    {row.posture === '*' ? 'all postures' : `${row.posture} posture`}
                  </Chip>
                  <NumInput
                    key={`${inputKey}-th-${idx}`}
                    value={row.value}
                    ariaLabel={`${key} for ${row.asset_class} / ${row.posture}`}
                    onCommit={v => edit(cfg => { cfg.thresholds[idx].value = v })}
                  />
                </div>
              ))}
              {warn && <div className="tc-warn-text">{warn}</div>}
            </div>
          )
        })}
      </div>

      <h3 className="tc-section">Verdict bands</h3>
      <div className="card tc-card">
        <div className="tc-row">
          <span className="tc-row-label">PASS allowed up to (flag points)</span>
          <NumInput
            key={`${inputKey}-vb-pass`}
            value={working.verdictBands.passMaxFlagPts}
            ariaLabel="pass max flag points"
            onCommit={v => edit(cfg => { cfg.verdictBands.passMaxFlagPts = v })}
          />
        </div>
        <div className="tc-row">
          <span className="tc-row-label">CONDITIONAL allowed up to (flag points)</span>
          <NumInput
            key={`${inputKey}-vb-cond`}
            value={working.verdictBands.conditionalMaxFlagPts}
            ariaLabel="conditional max flag points"
            onCommit={v => edit(cfg => { cfg.verdictBands.conditionalMaxFlagPts = v })}
          />
        </div>
        {bandsWarn && (
          <div className="tc-warn-text">
            Check the ordering: the CONDITIONAL band should be at least the PASS band.
          </div>
        )}
      </div>

      <h3 className="tc-section">Macro signal weights &amp; bands</h3>
      <div className="card tc-card">
        {(working.macro.signals ?? []).length === 0 && (
          <p className="tc-muted">This config version carries no per-signal definitions to edit.</p>
        )}
        {(working.macro.signals ?? []).map((sig, i) => (
          <div className="tc-sig-row" key={sig.id}>
            <div className="tc-sig-name">
              {sig.label}
              <span className="tc-sig-dir">{sig.direction === 'high_is_bad' ? 'high is bad' : 'high is good'}</span>
            </div>
            <label className="tc-sig-field">
              <span>weight</span>
              <NumInput
                key={`${inputKey}-sw-${sig.id}`}
                value={sig.weight}
                ariaLabel={`${sig.label} weight`}
                onCommit={v => edit(cfg => {
                  const s = cfg.macro.signals?.[i]
                  if (s) s.weight = v
                  cfg.macro.signalWeights[sig.id] = v // keep the legacy weight map in lockstep
                })}
              />
            </label>
            <label className="tc-sig-field">
              <span>green ≤</span>
              <NumInput
                key={`${inputKey}-sg-${sig.id}`}
                value={sig.green}
                ariaLabel={`${sig.label} green band`}
                onCommit={v => edit(cfg => { const s = cfg.macro.signals?.[i]; if (s) s.green = v })}
              />
            </label>
            <label className="tc-sig-field">
              <span>yellow ≤</span>
              <NumInput
                key={`${inputKey}-sy-${sig.id}`}
                value={sig.yellow}
                ariaLabel={`${sig.label} yellow band`}
                onCommit={v => edit(cfg => { const s = cfg.macro.signals?.[i]; if (s) s.yellow = v })}
              />
            </label>
          </div>
        ))}
      </div>

      <p className="tc-footnote">
        Every value here is config data — the engine has no hardcoded thresholds. Saving requires
        the database; drafts apply to previews in this browser only.
      </p>
    </div>
  )
}

const CSS = `
.tc-root{max-width:1180px;margin:0 auto}
.tc-title{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.5rem;letter-spacing:-.01em;margin:0}
.tc-header{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.tc-header-chips{display:flex;gap:.5rem;flex-wrap:wrap}
.tc-header-actions{margin-left:auto;display:flex;gap:.5rem;flex-wrap:wrap}
.tc-chip{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  padding:2px 9px;border-radius:999px;border:1px solid var(--border,#dcebe7);color:var(--muted,#5c6b67);background:var(--surface-2,#f5fbfa);white-space:nowrap}
.tc-chip-amber{color:#8a6508;background:#fbf3df;border-color:#f0e0b0}
.tc-chip-green{color:var(--cc-deep,#3f7d69);background:var(--accent-soft,#e4f5ee);border-color:#cfe8dd}
button.tc-btn{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
  padding:.5rem 1.1rem;border-radius:6px;border:1px solid var(--cc-deep,#3f7d69);
  background:var(--cc-deep,#3f7d69);color:#fff;cursor:pointer}
button.tc-btn:hover{opacity:.92}
button.tc-btn:disabled{opacity:.45;cursor:default}
button.tc-btn.tc-btn-secondary{background:transparent;color:var(--cc-deep,#3f7d69)}
.tc-savebar{padding:1rem 1.25rem;margin-bottom:1rem}
.tc-savebar-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--muted,#5c6b67)}
.tc-savebar-row{display:flex;gap:.6rem;margin-top:.45rem;flex-wrap:wrap}
.tc-note-input{flex:1 1 320px;padding:.5rem .7rem;border:1px solid var(--border,#dcebe7);border-radius:6px;font-size:.85rem}
.tc-save-ok{display:inline-block;font-size:.8rem;color:var(--success,#157f3c);background:var(--accent-soft,#e4f5ee);
  border:1px solid #cfe8dd;border-radius:6px;padding:.35rem .8rem;margin-bottom:1rem}
.tc-save-warn{padding:.9rem 1.25rem;margin-bottom:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.tc-warn-text{font-size:.78rem;color:var(--warning,#b8860b)}
.tc-notice{padding:.9rem 1.25rem;font-size:.83rem;color:var(--muted,#5c6b67);margin-bottom:.5rem}
.tc-section{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin:1.5rem 0 .6rem}
.tc-card{padding:1rem 1.5rem}
.tc-group{padding:.7rem 0}
.tc-group + .tc-group{border-top:1px solid var(--border,#eef4f2)}
.tc-group-name{font-size:.86rem;font-weight:500;margin-bottom:.4rem}
.tc-group-key{font-size:.72rem;color:var(--muted,#5c6b67);font-family:ui-monospace,monospace;margin-left:.6rem}
.tc-row{display:flex;align-items:center;gap:.6rem;padding:.3rem 0;flex-wrap:wrap}
.tc-row-label{font-size:.84rem;flex:1 1 260px}
.tc-num{width:120px;padding:.38rem .55rem;border:1px solid var(--border,#dcebe7);border-radius:6px;
  font-size:.85rem;font-variant-numeric:tabular-nums;text-align:right}
.tc-sig-row{display:flex;align-items:center;gap:1rem;padding:.55rem 0;flex-wrap:wrap}
.tc-sig-row + .tc-sig-row{border-top:1px solid var(--border,#eef4f2)}
.tc-sig-name{flex:1 1 240px;font-size:.85rem;font-weight:500;min-width:0}
.tc-sig-dir{display:block;font-size:.7rem;font-weight:400;color:var(--muted,#5c6b67);margin-top:2px}
.tc-sig-field{display:flex;align-items:center;gap:.4rem;font-size:.72rem;color:var(--muted,#5c6b67)}
.tc-sig-field .tc-num{width:96px}
.tc-muted{font-size:.83rem;color:var(--muted,#5c6b67)}
.tc-footnote{font-size:.74rem;color:var(--muted,#5c6b67);margin-top:1rem}
@media(max-width:900px){
  .tc-header-actions{margin-left:0}
}
`
