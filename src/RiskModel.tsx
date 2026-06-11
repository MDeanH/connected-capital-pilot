import { useEffect, useMemo, useState } from 'react'
import { Info } from './Info'
import Provenance from './Provenance'

// Risk Model v2 — the pilot's 9-category sponsor/deal risk scorecard.
// Each category is scored −3…+3 across three timeframes (Historical, YTD,
// Forward prediction), weighted, and rolled up into a Capital Risk composite
// and a High / Mid / Low grade band calibrated to the three DDQ exemplars.
// Variable checklists (with realistic ranges and edge cases from the intake
// schema) guide each category's score.

interface Variable { name: string; type: 'quant' | 'qual'; range?: string; edge?: string }
interface Category { id: string; name: string; question: string; weight: number; vars: Variable[] }

// Weights default to the Risk Model v2 priority ranking (1 = most important):
// Operational 1, Credit 2, Funding 3, Cash Flow 4, Liquidity 5, Regulatory 6,
// Market 7, Competition 8 — converted to normalized weights.
const CATEGORIES: Category[] = [
  {
    id: 'operational', name: 'Operational', question: 'How is the operation run?', weight: 0.20,
    vars: [
      { name: 'AUM', type: 'quant', range: '$0–2B', edge: 'zero pre-launch; step-jump after close; decline after redemptions' },
      { name: 'Avg. returns', type: 'quant', range: '−10% to 35%', edge: 'negative vintage; >20% exceptional' },
      { name: 'Repeat investors', type: 'quant', range: '0–500', edge: 'zero for first-time sponsor' },
      { name: 'K-1 timing', type: 'quant', range: '30–150 days after FYE', edge: '>100 days late; <45 exceptional' },
      { name: 'Years of experience (strategy / running a company)', type: 'quant' },
      { name: 'Underwriting vs actuals on prior deals', type: 'qual', edge: 'a sponsor who beats their own pro forma is worth more than a higher headline IRR' },
      { name: 'LP-service orientation', type: 'qual', range: 'score 1–5', edge: '<3 weak alignment' },
      { name: 'Outside team (accounting, legal, audit) independence', type: 'qual' },
    ],
  },
  {
    id: 'credit', name: 'Credit', question: 'Can the sponsor pay?', weight: 0.16,
    vars: [
      { name: 'Payables aging', type: 'quant', range: '0–180 days', edge: '90+ days = stress state' },
      { name: 'Missed payments', type: 'quant', range: '0–12', edge: 'any nonzero is an exception; 3+ severe' },
      { name: 'D&B / PAYDEX', type: 'qual', range: '0–100 or n/a', edge: 'PAYDEX < 50' },
      { name: 'GP bankruptcy / felony / SEC-FINRA history', type: 'qual', edge: 'any enforcement action is a gate' },
      { name: 'Existing or pending lawsuits', type: 'qual', range: '0–10 + severity', edge: 'class action / fraud severity' },
    ],
  },
  {
    id: 'funding', name: 'Funding', question: "What is the sponsor's buy box?", weight: 0.14,
    vars: [
      { name: 'Existing revenue', type: 'quant', range: '$0–250M', edge: 'zero for pre-revenue vehicle' },
      { name: 'Buy-box projected free cash flow', type: 'quant', range: '−$10M to $100M', edge: 'underwriting bias >20%' },
      { name: 'Buy-box loan term', type: 'quant', range: '6–120 months', edge: '12-month bridge vs 60+ permanent' },
      { name: 'Buy-box discipline & conviction', type: 'qual', edge: 'raising to raise vs conviction on the box' },
    ],
  },
  {
    id: 'cashflow', name: 'Cash Flow', question: 'Can they pay on time and in full?', weight: 0.13,
    vars: [
      { name: 'DSCR', type: 'quant', range: '0.5–3.0×', edge: '<1.0 = debt service not covered' },
      { name: 'D/E ratio', type: 'quant', range: '0–4×', edge: '>2.5 aggressive; negative equity case' },
      { name: 'D/A ratio', type: 'quant', range: '0–0.95', edge: '>0.80 aggressive leverage' },
      { name: 'Capex requirement', type: 'quant', range: '$0–30M', edge: 'major rehab spike' },
      { name: 'Cash-out-refi dependence', type: 'qual', edge: 'success depends on a refi happening' },
      { name: 'Cash needed for additional acquisitions', type: 'quant', range: '$0–50M gap' },
    ],
  },
  {
    id: 'liquidity', name: 'Liquidity', question: 'How do we redeem?', weight: 0.11,
    vars: [
      { name: 'Holding period', type: 'quant', range: '6–120 months', edge: 'evergreen/null; long-dated development' },
      { name: 'Historical returns', type: 'quant', range: '−10% to 35% IRR', edge: 'negative impaired vintage' },
      { name: 'Assets sold / exits to date', type: 'quant' },
      { name: 'Exit plan & sell-box requirements', type: 'qual' },
      { name: 'Early-redemption terms', type: 'qual' },
    ],
  },
  {
    id: 'regulatory', name: 'Regulatory', question: 'Outside regulation impact', weight: 0.10,
    vars: [
      { name: 'Tax changes', type: 'quant', range: '0–5/yr', edge: '2+ material changes → tax memo refresh' },
      { name: 'State of registration', type: 'qual', edge: 'foreign domicile; null before formation' },
      { name: 'Entity layering', type: 'quant', range: '1–8 layers', edge: '5+ layers increase opacity' },
      { name: 'Asset regulations / SEC-FINRA changes', type: 'qual' },
      { name: 'Flow of the investment (structure clarity)', type: 'qual' },
    ],
  },
  {
    id: 'market', name: 'Market', question: 'Macro considerations', weight: 0.09,
    vars: [
      { name: 'S&P rate of return', type: 'quant', range: '−35% to 35%', edge: 'bear < −20%; melt-up > 25%' },
      { name: 'Federal interest rate', type: 'quant', range: '0–8%', edge: 'zero-lower-bound regime' },
      { name: 'SOFR + spread', type: 'quant', range: '0–10% + bps', edge: 'distressed spread > 600bps' },
      { name: 'Competitive beta', type: 'quant', range: '0–2.5×', edge: 'β > 2 aggressive' },
      { name: 'Geopolitical / climate / supply chain', type: 'qual', range: 'enum 1–5', edge: 'Very High for wildfire/coastal concentration' },
    ],
  },
  {
    id: 'competition', name: 'Competition', question: 'How unique or compelling?', weight: 0.07,
    vars: [
      { name: 'Similar groups / companies', type: 'quant', range: '0–100', edge: 'sudden crowding after capital inflows' },
      { name: 'Secret sauce — what they do best', type: 'qual' },
      { name: 'Why this and not someone else (or the S&P)?', type: 'qual', edge: 'cash flow + depreciation are the honest answers' },
    ],
  },
]

const TF = ['hist', 'ytd', 'fwd'] as const
const TF_LABEL = { hist: 'Historical', ytd: 'YTD', fwd: 'Forward' } as const
type Scores = Record<string, { hist: number; ytd: number; fwd: number; notes: string }>

const STORAGE = 'riskmodel-v2'
const emptyScores = (): Scores => Object.fromEntries(CATEGORIES.map(c => [c.id, { hist: 0, ytd: 0, fwd: 0, notes: '' }]))

// Fictional demo scorecard — same invented sponsor as the DDQ sample, so the
// story is consistent across tabs. Lands a MID composite (~+0.48).
const SAMPLE_MARKER = 'SAMPLE (fictional)'
const SAMPLE_SCORES: Scores = {
  operational: { hist: 1, ytd: 1, fwd: 1, notes: `${SAMPLE_MARKER} — Beacon Harbor Real Estate Partners: 12-person ops team, documented SOPs, third-party fund admin; two key-person dependencies.` },
  credit: { hist: 1, ytd: 1, fwd: 0, notes: `${SAMPLE_MARKER} — modest corporate leverage; one covenant waiver in 2020 (Houston asset), resolved without loss.` },
  funding: { hist: 0, ytd: 1, fwd: 1, notes: `${SAMPLE_MARKER} — consistent buy box: Sun Belt value-add multifamily, $20–60M total cost.` },
  cashflow: { hist: 1, ytd: 0, fwd: 0, notes: `${SAMPLE_MARKER} — distributions on schedule since inception; one quarter delayed in 2020.` },
  liquidity: { hist: 0, ytd: 0, fwd: -1, notes: `${SAMPLE_MARKER} — quarterly redemptions with 90-day notice; untested at scale.` },
  regulatory: { hist: 1, ytd: 1, fwd: 1, notes: `${SAMPLE_MARKER} — clean SEC exam history, no enforcement actions.` },
  market: { hist: 0, ytd: 0, fwd: -1, notes: `${SAMPLE_MARKER} — concentrated in FL/TX; exit assumptions sensitive to rates.` },
  competition: { hist: 0, ytd: 1, fwd: 0, notes: `${SAMPLE_MARKER} — differentiated sourcing through local operator JVs.` },
}

// grade bands calibrated to the three DDQ exemplars
function grade(composite: number) {
  if (composite >= 1.0) return { band: 'HIGH GRADE', color: '#157f3c', desc: 'Top-tier profile: clean record, conservative leverage, stable team, strong alignment — calibrates to the Evercrest exemplar.' }
  if (composite >= -0.5) return { band: 'MID GRADE', color: '#b8860b', desc: 'Credible but carries real risk: second-quartile record, market-standard alignment, resolved issues — deeper diligence required (Marston Bridge exemplar).' }
  return { band: 'LOW GRADE', color: '#c2384a', desc: 'Distressed profile: in most institutional programs this fails diligence outright (Halcyon Peak exemplar). Multiple items here are individually disqualifying.' }
}

export default function RiskModel({ dealName }: { dealName?: string }) {
  const [scores, setScores] = useState<Scores>(() => {
    try { return { ...emptyScores(), ...JSON.parse(localStorage.getItem(STORAGE) || '{}') } } catch { return emptyScores() }
  })
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(CATEGORIES.map(c => [c.id, c.weight])))

  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(scores)) } catch { /* private mode */ } }, [scores])

  const set = (id: string, tf: typeof TF[number], v: number) =>
    setScores(s => ({ ...s, [id]: { ...s[id], [tf]: v } }))

  const R = useMemo(() => {
    const wSum = CATEGORIES.reduce((s, c) => s + (weights[c.id] || 0), 0) || 1
    let composite = 0
    const perCat = CATEGORIES.map(c => {
      const sc = scores[c.id]
      // forward-weighted mean: the model is a prediction, not a record
      const mean = (sc.hist * 0.25 + sc.ytd * 0.25 + sc.fwd * 0.5)
      composite += mean * (weights[c.id] || 0) / wSum
      return { id: c.id, mean }
    })
    const flags = CATEGORIES.filter(c => {
      const sc = scores[c.id]
      return Math.min(sc.hist, sc.ytd, sc.fwd) <= -2
    }).map(c => c.name)
    return { composite, perCat, flags, grade: grade(composite) }
  }, [scores, weights])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ deal: dealName || null, exported: new Date().toISOString(), weights, scores, composite: R.composite, grade: R.grade.band }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'risk-model-scorecard.json'
    a.click()
  }

  const sampleLoaded = Object.values(scores).some(s => s.notes.startsWith(SAMPLE_MARKER))

  return (
    <div className="rm-root">
      <style>{CSS}</style>

      {sampleLoaded && (
        <Provenance kind="sample">
          These scores describe a <b>fictional manager</b> — Beacon Harbor Real Estate Partners, the same invented
          sponsor as the DDQ sample — loaded so the composite and grade bands are visible. Score a real sponsor by
          editing any cell, or hit Reset to start clean.
        </Provenance>
      )}

      <div className="rm-verdict" style={{ borderColor: R.grade.color }}>
        <div>
          <div className="rm-band" style={{ color: R.grade.color }}>{R.grade.band}</div>
          <div className="rm-comp">Capital-risk composite: <b>{R.composite >= 0 ? '+' : ''}{R.composite.toFixed(2)}</b> on −3…+3 <Info width={260}>Weighted mean of the nine category scores; each category mixes Historical 25%, YTD 25%, Forward 50% — the model is a prediction, not a record. Bands calibrated to the three completed DDQ exemplars.</Info></div>
        </div>
        <div className="rm-desc">{R.grade.desc}</div>
        {R.flags.length > 0 && (
          <div className="rm-flags">⚠ Deep-caution categories (any timeframe ≤ −2): <b>{R.flags.join(', ')}</b></div>
        )}
        <div className="rm-actions">
          <button onClick={exportJson}>Export JSON</button>
          <button className="secondary" onClick={() => setScores(SAMPLE_SCORES)}>Load fictional sample</button>
          <button className="secondary" onClick={() => setScores(emptyScores())}>Reset</button>
        </div>
      </div>

      <p className="rm-help">
        Score each category from <b>−3</b> (severe risk) to <b>+3</b> (exceptional strength) for each timeframe.
        Open a category's checklist for its intake variables, realistic ranges and the edge cases that should pull a score down.
        Weights are editable — defaults follow the Risk Model v2 priority ranking.
      </p>

      {CATEGORIES.map(c => {
        const sc = scores[c.id]
        const mean = sc.hist * 0.25 + sc.ytd * 0.25 + sc.fwd * 0.5
        return (
          <div className="rm-cat" key={c.id}>
            <div className="rm-cathead">
              <div>
                <b>{c.name}</b> <span className="rm-q">{c.question}</span>
              </div>
              <div className="rm-meanwrap">
                <span className="rm-w">w=
                  <input value={(weights[c.id] ?? 0).toFixed(2)} onChange={e => setWeights(w => ({ ...w, [c.id]: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) }))} />
                </span>
                <span className="rm-mean" style={{ color: mean <= -1 ? '#c2384a' : mean >= 1 ? '#157f3c' : '#b8860b' }}>{mean >= 0 ? '+' : ''}{mean.toFixed(1)}</span>
              </div>
            </div>
            <div className="rm-tfs">
              {TF.map(tf => (
                <div className="rm-tf" key={tf}>
                  <span className="rm-tflabel">{TF_LABEL[tf]}</span>
                  <div className="rm-scale" role="radiogroup" aria-label={`${c.name} ${TF_LABEL[tf]}`}>
                    {[-3, -2, -1, 0, 1, 2, 3].map(v => (
                      <button key={v}
                        className={`rm-dot ${sc[tf] === v ? 'on' : ''} ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}`}
                        onClick={() => set(c.id, tf, v)} aria-pressed={sc[tf] === v}>{v > 0 ? `+${v}` : v}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <details className="rm-vars">
              <summary>Checklist — {c.vars.length} intake variables</summary>
              <table>
                <thead><tr><th>Variable</th><th>Type</th><th>Realistic range</th><th>Edge cases / what pulls the score down</th></tr></thead>
                <tbody>
                  {c.vars.map(v => (
                    <tr key={v.name}><td>{v.name}</td><td>{v.type}</td><td>{v.range || '—'}</td><td>{v.edge || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
            <input className="rm-notes" placeholder="notes / evidence for this category…" value={sc.notes}
              onChange={e => setScores(s => ({ ...s, [c.id]: { ...s[c.id], notes: e.target.value } }))} />
          </div>
        )
      })}

      <p className="rm-foot">
        Scores persist in this browser only (nothing is uploaded). Pair with the Underwrite tab (deal gates), Deal Score
        (market risk from real price history) and the DDQ — deal, asset, market, manager.
      </p>
    </div>
  )
}

const CSS = `
.rm-root{max-width:880px}
.rm-verdict{background:var(--surface);border:1.5px solid;border-radius:12px;padding:14px 16px;margin-bottom:10px}
.rm-band{font-size:1.3rem;font-weight:800;font-family:Manrope,Poppins,sans-serif}
.rm-comp{font-size:.85rem;color:var(--text)}
.rm-desc{font-size:.78rem;color:var(--muted);margin-top:6px;max-width:640px}
.rm-flags{margin-top:8px;font-size:.8rem;color:#c2384a}
.rm-actions{margin-top:10px;display:flex;gap:8px}
.rm-actions button{font-size:.78rem;padding:6px 14px}
.rm-help{font-size:.78rem;color:var(--muted);margin:10px 0 14px;max-width:720px}
.rm-cat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.rm-cathead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.rm-q{font-size:.75rem;color:var(--muted);margin-left:6px}
.rm-meanwrap{display:flex;align-items:baseline;gap:12px}
.rm-w{font-size:.7rem;color:var(--muted)}
.rm-w input{width:48px;border:1px solid var(--border);border-radius:5px;padding:2px 4px;font-size:.75rem;text-align:right}
.rm-mean{font-weight:800;font-size:1.05rem;font-variant-numeric:tabular-nums}
.rm-tfs{display:grid;gap:6px;margin-top:8px}
.rm-tf{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rm-tflabel{width:74px;font-size:.72rem;color:var(--muted);flex-shrink:0}
.rm-scale{display:flex;gap:4px}
.rm-dot{width:38px;height:26px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:.72rem;font-weight:600;color:var(--muted);cursor:pointer;padding:0}
.rm-dot.on.neg{background:#c2384a;border-color:#c2384a;color:#fff}
.rm-dot.on.pos{background:#157f3c;border-color:#157f3c;color:#fff}
.rm-dot.on:not(.neg):not(.pos){background:#5b6573;border-color:#5b6573;color:#fff}
.rm-vars{margin-top:8px;font-size:.76rem}
.rm-vars summary{cursor:pointer;color:var(--accent);font-size:.74rem}
.rm-vars table{margin-top:6px;font-size:.72rem}
.rm-vars th,.rm-vars td{padding:.35rem .5rem}
.rm-notes{width:100%;margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;font-size:.78rem;background:var(--surface)}
.rm-foot{font-size:.72rem;color:var(--muted);margin-top:6px}
@media(max-width:640px){.rm-dot{width:32px}}
`
