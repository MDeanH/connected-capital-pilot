import { useEffect, useMemo, useRef, useState } from 'react'
import { Info } from './Info'
import {
  DDQ_SECTIONS, RISK_CATEGORIES, RUBRICS, GRADED_QUESTIONS,
  autoScore, hardFailOf, isAnswered, computeGrading,
  type AnswerValue, type CategoryId, type DDQQuestion,
} from './ddq-schema'

// Institutional DDQ — ILPA DDQ 2.0-aligned digital intake with grading.
// Sections A (Firm) and B (Fund Terms) in full + RE Development and RE
// Acquisition modules. Objective fields auto-score 1–5 against the three
// completed exemplars (Evercrest high / Marston Bridge mid / Halcyon Peak
// low); the analyst adds a subjective 1–5 per risk category; weights come
// from the Risk Model v2 workbook. Everything stays in this browser —
// autosaved to localStorage, exportable as JSON. Nothing uploads anywhere.

const STORAGE = 'ddqx-intake-v1'

interface Persisted {
  answers: Record<string, AnswerValue>
  subjective: Partial<Record<CategoryId, number>>
  weights: Partial<Record<CategoryId, number>>
}

const defaultWeights = (): Record<CategoryId, number> =>
  Object.fromEntries(RISK_CATEGORIES.map(c => [c.id, c.weight])) as Record<CategoryId, number>

function load(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return {
      answers: raw.answers || {},
      subjective: raw.subjective || {},
      weights: { ...defaultWeights(), ...(raw.weights || {}) },
    }
  } catch {
    return { answers: {}, subjective: {}, weights: defaultWeights() }
  }
}

const BAND_COLOR = { HIGH: '#157f3c', MID: '#b8860b', LOW: '#c2384a' } as const
const BAND_DESC = {
  HIGH: 'Top-tier profile — calibrates to the Evercrest exemplar (composite ≥ 4.0).',
  MID: 'Credible but carries real risk — deeper diligence required (Marston Bridge exemplar; composite ≥ 2.75).',
  LOW: 'Distressed profile — in most institutional programs this fails diligence (Halcyon Peak exemplar).',
} as const

export default function DDQ() {
  const [state, setState] = useState<Persisted>(load)
  const [activeSection, setActiveSection] = useState<string>(DDQ_SECTIONS[0].id)
  const [showGrading, setShowGrading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)) } catch { /* private mode */ }
  }, [state])

  const setAnswer = (id: string, v: AnswerValue) =>
    setState(s => ({ ...s, answers: { ...s.answers, [id]: v } }))
  const setSubjective = (id: CategoryId, v: number) =>
    setState(s => ({ ...s, subjective: { ...s.subjective, [id]: s.subjective[id] === v ? undefined : v } }))
  const setWeight = (id: CategoryId, v: number) =>
    setState(s => ({ ...s, weights: { ...s.weights, [id]: Math.max(0, Math.min(100, v)) } }))

  const grading = useMemo(
    () => computeGrading(state.answers, state.subjective, state.weights),
    [state.answers, state.subjective, state.weights],
  )

  const progress = useMemo(() => {
    const per = DDQ_SECTIONS.map(sec => {
      const qs = sec.subsections.flatMap(ss => ss.questions)
      const done = qs.filter(q => isAnswered(q, state.answers[q.id])).length
      return { id: sec.id, done, total: qs.length }
    })
    const done = per.reduce((s, p) => s + p.done, 0)
    const total = per.reduce((s, p) => s + p.total, 0)
    return { per, done, total }
  }, [state.answers])

  const gradedAnswered = GRADED_QUESTIONS.filter(q => autoScore(q, state.answers[q.id]) !== null).length

  const exportJson = () => {
    const payload = {
      schema: 'institutional-ddq-v1',
      exported: new Date().toISOString(),
      answers: state.answers,
      subjective: state.subjective,
      weights: state.weights,
      grading: {
        composite: grading.composite,
        band: grading.band,
        uncappedBand: grading.uncappedBand,
        hardFails: grading.hardFails,
        redFlags: grading.redFlags.map(f => ({ qid: f.qid, prompt: f.prompt })),
        perCategory: grading.perCategory.map(c => ({ id: c.id, weight: c.weight, autoAvg: c.autoAvg, subjective: c.subjective, score: c.score })),
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'institutional-ddq.json'
    a.click()
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result))
        setState({
          answers: raw.answers || {},
          subjective: raw.subjective || {},
          weights: { ...defaultWeights(), ...(raw.weights || {}) },
        })
      } catch {
        alert('Could not parse that file as a DDQ JSON export.')
      }
    }
    reader.readAsText(file)
  }

  const reset = () => {
    if (confirm('Clear all DDQ answers, subjective scores, and weights?')) {
      setState({ answers: {}, subjective: {}, weights: defaultWeights() })
    }
  }

  const section = DDQ_SECTIONS.find(s => s.id === activeSection) || DDQ_SECTIONS[0]
  const compositeStr = grading.composite !== null ? grading.composite.toFixed(2) : '—'
  const wTotal = RISK_CATEGORIES.reduce((s, c) => s + (state.weights[c.id] ?? c.weight), 0)

  return (
    <div className="ddq-root">
      <style>{CSS}</style>

      {/* ===== Verdict / grading summary ===== */}
      <div className="ddq-verdict" style={{ borderColor: grading.band ? BAND_COLOR[grading.band] : 'var(--border)' }}>
        <div className="ddq-verdict-head">
          <div>
            <div className="ddq-band" style={{ color: grading.band ? BAND_COLOR[grading.band] : 'var(--muted)' }}>
              {grading.band ? `${grading.band} GRADE` : 'NOT YET GRADED'}
            </div>
            <div className="ddq-comp">
              Weighted composite: <b>{compositeStr}</b> / 5.00
              <Info width={290}>Each risk category scores 1–5: the mean of its auto-graded objective fields, blended 50/50 with the analyst's subjective score when both exist. The composite is the weight-averaged category score (weights from the Risk Model v2 workbook, editable below). Bands: HIGH ≥ 4.0, MID ≥ 2.75, LOW below — hard-fail answers cap the grade at LOW regardless of score.</Info>
            </div>
            {grading.band && <div className="ddq-banddesc">{BAND_DESC[grading.band]}</div>}
          </div>
          <div className="ddq-progress">
            <div><b>{progress.done}</b> / {progress.total} questions answered</div>
            <div className="ddq-progressbar"><span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
            <div className="ddq-progress-sub">{gradedAnswered} / {GRADED_QUESTIONS.length} auto-graded fields scored</div>
          </div>
        </div>

        {grading.hardFails.length > 0 && (
          <div className="ddq-hardfail">
            ⛔ <b>Hard-fail override — grade capped at LOW</b>
            {grading.uncappedBand && grading.uncappedBand !== 'LOW' && <> (score alone would be {grading.uncappedBand})</>}:
            <ul>{grading.hardFails.map(h => <li key={h.qid}><b>{h.note}</b> — “{h.prompt}”</li>)}</ul>
          </div>
        )}

        {grading.redFlags.length > 0 && (
          <details className="ddq-redflags">
            <summary>🚩 Red flags — {grading.redFlags.length} field{grading.redFlags.length > 1 ? 's' : ''} auto-graded 1/5</summary>
            <ul>{grading.redFlags.map(f => <li key={f.qid}>{f.prompt} <span className="ddq-rule">({f.ruleText})</span></li>)}</ul>
          </details>
        )}

        <div className="ddq-actions">
          <button onClick={exportJson}>Export JSON</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
          <button className="secondary" onClick={() => setShowGrading(v => !v)}>{showGrading ? 'Hide' : 'Show'} grading panel</button>
          <button className="secondary" onClick={reset}>Reset</button>
        </div>
      </div>

      {/* ===== Grading panel: per-category auto + subjective + weights ===== */}
      {showGrading && (
        <div className="ddq-gradepanel">
          <div className="ddq-gradehead">
            <b>Grading panel</b> — auto scores from the intake fields below; set your subjective 1–5 per category.
            Weights from the Risk Model v2 workbook (editable, currently sum to {wTotal.toFixed(0)}).
          </div>
          {grading.perCategory.map(cat => {
            const rub = RUBRICS[cat.id]
            return (
              <div className="ddq-cat" key={cat.id}>
                <div className="ddq-catrow">
                  <div className="ddq-catname">
                    <b>{cat.name}</b>
                    <span className="ddq-catauto">
                      {cat.autoAvg !== null
                        ? <>auto {cat.autoAvg.toFixed(1)} <Info width={300} below>
                            <b>{cat.auto.length} auto-graded field{cat.auto.length > 1 ? 's' : ''}:</b>
                            {cat.auto.map(f => <div key={f.qid} style={{ marginTop: 4 }}>• {f.score}/5 — {f.prompt}</div>)}
                          </Info></>
                        : <span className="ddq-muted">no auto fields answered yet</span>}
                    </span>
                  </div>
                  <div className="ddq-catscore">
                    <span className="ddq-w">w=
                      <input value={String(state.weights[cat.id] ?? cat.weight)}
                        onChange={e => setWeight(cat.id, parseFloat(e.target.value) || 0)} />%
                    </span>
                    <div className="ddq-subj" role="radiogroup" aria-label={`${cat.name} subjective score`}>
                      {[1, 2, 3, 4, 5].map(v => (
                        <button key={v} className={`ddq-dot ${cat.subjective === v ? 'on' : ''}`}
                          onClick={() => setSubjective(cat.id, v)} aria-pressed={cat.subjective === v}>{v}</button>
                      ))}
                    </div>
                    <span className="ddq-catmean" style={{ color: cat.score === null ? 'var(--muted)' : cat.score >= 4 ? BAND_COLOR.HIGH : cat.score >= 2.75 ? BAND_COLOR.MID : BAND_COLOR.LOW }}>
                      {cat.score !== null ? cat.score.toFixed(1) : '—'}
                    </span>
                  </div>
                </div>
                <div className="ddq-rubric">
                  <span><b className="ddq-r5">5</b> {rub.five}</span>
                  <span><b className="ddq-r3">3</b> {rub.three}</span>
                  <span><b className="ddq-r1">1</b> {rub.one}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== Section navigation ===== */}
      <div className="ddq-nav">
        {DDQ_SECTIONS.map(sec => {
          const p = progress.per.find(x => x.id === sec.id)!
          return (
            <button key={sec.id} className={`ddq-navbtn ${activeSection === sec.id ? 'on' : ''}`} onClick={() => setActiveSection(sec.id)}>
              <span className="ddq-navtitle">{sec.title.split('—')[0].trim()}</span>
              <span className="ddq-navsub">{sec.title.split('—')[1]?.trim()}{sec.module ? ' · module' : ''}</span>
              <span className="ddq-navprog">{p.done}/{p.total}</span>
            </button>
          )
        })}
      </div>

      {/* ===== Active section form ===== */}
      <div className="ddq-section">
        <h3>{section.title}</h3>
        {section.intro && <p className="ddq-intro">{section.intro}</p>}
        {section.subsections.map(ss => (
          <div className="ddq-subsection" key={ss.id}>
            <h4>{ss.title}</h4>
            {ss.questions.map(q => (
              <Question key={q.id} q={q} value={state.answers[q.id]} onChange={v => setAnswer(q.id, v)} />
            ))}
          </div>
        ))}
      </div>

      <p className="ddq-foot">
        ILPA DDQ 2.0-aligned intake (sections A–B core + RE Development and RE Acquisition modules; PE/VC/credit
        modules plug into the same schema later). Auto-grading is calibrated to the three completed sample DDQs.
        Everything stays in this browser — autosaved locally, nothing uploads. Export JSON to share with the desk.
      </p>
    </div>
  )
}

// ===== Single question renderer =====
function Question({ q, value, onChange }: { q: DDQQuestion; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  const score = autoScore(q, value)
  const hf = hardFailOf(q, value)
  return (
    <div className={`ddq-q ${hf ? 'hardfail' : ''}`}>
      <div className="ddq-qhead">
        <span className="ddq-prompt">
          {q.prompt}
          {q.ilpa && <span className="ddq-ilpa" title="ILPA DDQ 2.0 reference">ILPA {q.ilpa}</span>}
          {q.grading && (
            <Info width={300} below>
              <b>Auto-graded.</b> {q.grading.ruleText}
              <div style={{ marginTop: 6 }}><b>High</b> — {q.grading.calibration.high}</div>
              <div><b>Mid</b> — {q.grading.calibration.mid}</div>
              <div><b>Low</b> — {q.grading.calibration.low}</div>
              {q.grading.hardFail && <div style={{ marginTop: 6 }}>⛔ “{typeof q.grading.hardFail.on === 'boolean' ? (q.grading.hardFail.on ? 'Yes' : 'No') : q.grading.hardFail.on}” caps the whole DDQ at LOW.</div>}
            </Info>
          )}
        </span>
        {score !== null && (
          <span className={`ddq-score s${score}`} title={q.grading!.ruleText}>
            {hf ? '⛔ ' : ''}{score}/5
          </span>
        )}
      </div>
      <AnswerInput q={q} value={value} onChange={onChange} />
      {score !== null && <div className="ddq-rule">rule: {q.grading!.ruleText}</div>}
      {hf && <div className="ddq-hfnote">Hard fail: {hf} — grade capped at LOW regardless of composite.</div>}
    </div>
  )
}

function AnswerInput({ q, value, onChange }: { q: DDQQuestion; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  switch (q.answerType) {
    case 'text':
      return <input className="ddq-in" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder}
        onChange={e => onChange(e.target.value)} />
    case 'longtext':
      return <textarea className="ddq-in" rows={3} value={typeof value === 'string' ? value : ''} placeholder={q.placeholder}
        onChange={e => onChange(e.target.value)} />
    case 'number':
    case 'percent':
      return (
        <span className="ddq-numwrap">
          <input className="ddq-in ddq-num" type="number" step="any"
            value={typeof value === 'number' ? value : ''}
            onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))} />
          <span className="ddq-unit">{q.answerType === 'percent' ? '%' : q.unit || ''}</span>
        </span>
      )
    case 'boolean':
      return (
        <div className="ddq-bool">
          {[true, false].map(b => (
            <button key={String(b)} className={`ddq-boolbtn ${value === b ? 'on' : ''}`}
              onClick={() => onChange(value === b ? null : b)}>{b ? 'Yes' : 'No'}</button>
          ))}
        </div>
      )
    case 'select':
      return (
        <select className="ddq-in" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)}>
          <option value="">— select —</option>
          {(q.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'table': {
      const cols = q.columns || []
      const rows: string[][] = Array.isArray(value) ? (value as string[][]) : []
      const setCell = (ri: number, ci: number, v: string) => {
        const next = rows.map(r => [...r])
        next[ri][ci] = v
        onChange(next)
      }
      return (
        <div className="ddq-tablewrap">
          {q.placeholder && rows.length === 0 && <div className="ddq-tablehint">{q.placeholder}</div>}
          {rows.length > 0 && (
            <table className="ddq-table">
              <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {cols.map((c, ci) => (
                      <td key={c.key}><input value={row[ci] || ''} onChange={e => setCell(ri, ci, e.target.value)} /></td>
                    ))}
                    <td><button className="ddq-rowdel" title="Remove row"
                      onClick={() => onChange(rows.filter((_, i) => i !== ri))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="ddq-addrow" onClick={() => onChange([...rows, cols.map(() => '')])}>+ Add row</button>
        </div>
      )
    }
  }
}

const CSS = `
.ddq-root{max-width:980px}
.ddq-verdict{background:var(--surface);border:1.5px solid;border-radius:12px;padding:14px 16px;margin-bottom:10px}
.ddq-verdict-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ddq-band{font-size:1.3rem;font-weight:800;font-family:Manrope,Poppins,sans-serif}
.ddq-comp{font-size:.85rem}
.ddq-banddesc{font-size:.76rem;color:var(--muted);margin-top:4px;max-width:560px}
.ddq-progress{font-size:.78rem;color:var(--muted);text-align:right;min-width:200px}
.ddq-progressbar{height:7px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;margin:5px 0;overflow:hidden}
.ddq-progressbar span{display:block;height:100%;background:var(--accent);border-radius:5px;transition:width .2s}
.ddq-progress-sub{font-size:.7rem}
.ddq-hardfail{margin-top:10px;font-size:.8rem;color:#c2384a;background:#fdf2f4;border:1px solid #f5c2c7;border-radius:8px;padding:8px 12px}
.ddq-hardfail ul{margin:6px 0 0;padding-left:18px}
.ddq-redflags{margin-top:8px;font-size:.78rem;color:#c2384a}
.ddq-redflags summary{cursor:pointer}
.ddq-redflags ul{margin:6px 0 0;padding-left:18px}
.ddq-actions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
.ddq-actions button{font-size:.78rem;padding:6px 14px}
.ddq-gradepanel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.ddq-gradehead{font-size:.78rem;color:var(--muted);margin-bottom:8px}
.ddq-cat{border-top:1px solid var(--border);padding:8px 0}
.ddq-catrow{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.ddq-catname{font-size:.85rem}
.ddq-catauto{font-size:.72rem;color:var(--muted);margin-left:8px}
.ddq-muted{color:var(--muted)}
.ddq-catscore{display:flex;align-items:center;gap:12px}
.ddq-w{font-size:.7rem;color:var(--muted)}
.ddq-w input{width:42px;border:1px solid var(--border);border-radius:5px;padding:2px 4px;font-size:.75rem;text-align:right}
.ddq-subj{display:flex;gap:4px}
.ddq-dot{width:30px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:.72rem;font-weight:600;color:var(--muted);cursor:pointer;padding:0}
.ddq-dot.on{background:#3b5bdb;border-color:#3b5bdb;color:#fff}
.ddq-catmean{font-weight:800;font-size:1rem;font-variant-numeric:tabular-nums;min-width:30px;text-align:right}
.ddq-rubric{display:grid;gap:2px;margin-top:6px;font-size:.7rem;color:var(--muted);line-height:1.45}
.ddq-rubric b{display:inline-block;width:14px;text-align:center;border-radius:4px;color:#fff;font-size:.66rem;margin-right:4px}
.ddq-r5{background:#157f3c}.ddq-r3{background:#b8860b}.ddq-r1{background:#c2384a}
.ddq-nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.ddq-navbtn{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:8px 12px;cursor:pointer;text-align:left}
.ddq-navbtn.on{border-color:#3b5bdb;box-shadow:0 0 0 1px #3b5bdb inset}
.ddq-navtitle{font-weight:700;font-size:.8rem}
.ddq-navsub{font-size:.66rem;color:var(--muted)}
.ddq-navprog{font-size:.66rem;color:var(--accent);font-variant-numeric:tabular-nums}
.ddq-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.ddq-section h3{margin:0 0 4px}
.ddq-intro{font-size:.78rem;color:var(--muted);margin:0 0 10px}
.ddq-subsection{margin-bottom:14px}
.ddq-subsection h4{margin:14px 0 6px;font-size:.92rem;border-bottom:1px solid var(--border);padding-bottom:4px}
.ddq-q{padding:8px 10px;border-radius:8px;margin-bottom:6px;background:var(--surface-2)}
.ddq-q.hardfail{background:#fdf2f4;border:1px solid #f5c2c7}
.ddq-qhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.ddq-prompt{font-size:.8rem;line-height:1.45}
.ddq-ilpa{font-size:.62rem;color:var(--accent);border:1px solid var(--border);border-radius:5px;padding:1px 5px;margin-left:6px;white-space:nowrap;vertical-align:middle}
.ddq-score{font-size:.72rem;font-weight:800;border-radius:6px;padding:2px 8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ddq-score.s5{background:#e5f4ea;color:#157f3c}.ddq-score.s4{background:#e5f4ea;color:#157f3c}
.ddq-score.s3{background:#fbf3df;color:#b8860b}.ddq-score.s2{background:#fdf2f4;color:#c2384a}.ddq-score.s1{background:#c2384a;color:#fff}
.ddq-in{width:100%;border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;font-size:.8rem;background:var(--surface);margin-top:5px;box-sizing:border-box}
textarea.ddq-in{resize:vertical;font-family:inherit}
.ddq-numwrap{display:inline-flex;align-items:center;gap:6px}
.ddq-num{width:140px}
.ddq-unit{font-size:.74rem;color:var(--muted);margin-top:5px}
.ddq-bool{display:flex;gap:6px;margin-top:5px}
.ddq-boolbtn{border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:.76rem;font-weight:600;padding:4px 16px;cursor:pointer;color:var(--muted)}
.ddq-boolbtn.on{background:#3b5bdb;border-color:#3b5bdb;color:#fff}
.ddq-rule{font-size:.66rem;color:var(--muted);margin-top:4px}
.ddq-hfnote{font-size:.72rem;color:#c2384a;font-weight:600;margin-top:4px}
.ddq-tablewrap{margin-top:5px}
.ddq-tablehint{font-size:.7rem;color:var(--muted);margin-bottom:4px}
.ddq-table{font-size:.72rem;width:100%}
.ddq-table th{font-size:.66rem;padding:.25rem .35rem}
.ddq-table td{padding:.15rem .25rem}
.ddq-table input{width:100%;border:1px solid var(--border);border-radius:5px;padding:2px 5px;font-size:.72rem;box-sizing:border-box;background:var(--surface)}
.ddq-rowdel{border:none;background:none;color:#c2384a;font-size:.9rem;cursor:pointer;padding:0 4px}
.ddq-addrow{font-size:.7rem;padding:3px 10px;margin-top:4px}
.ddq-foot{font-size:.72rem;color:var(--muted);margin-top:10px}
@media(max-width:640px){.ddq-progress{text-align:left}.ddq-catrow{align-items:flex-start}}
`
