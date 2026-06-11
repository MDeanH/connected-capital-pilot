import { useCallback, useEffect, useMemo, useState } from 'react'
import Provenance from './Provenance'
import US from './us-market.json'
import METROS from './metros-list.json'
import { computeUnderwrite, UNDERWRITE_STORAGE, DEAL_DEFAULTS } from './underwrite-lib'
import type { StoredDealInputs, UnderwriteResult } from './underwrite-lib'
import { RM_STORAGE, rmComposite, grade, loadRmWeights } from './RiskModel'
import type { Scores } from './RiskModel'
import { computeGrading, DDQ_STORAGE } from './ddq-schema'
import type { GradingResult } from './ddq-schema'

// Combined Verdict — the bridge tab. Left side of the platform: Connected
// Capital's own methodology (Underwrite gates, Risk Model v2 scorecard,
// Institutional DDQ grading). Right side: the market-evidence Monte Carlo.
// This tab reads all three methodology ingredients from their tabs
// (localStorage), maps them through DISCLOSED linear formulas to a bounded
// return tilt and risk multiplier, and asks the scoring engine to apply that
// tilt on top of its own de-smoothed market history. Every intermediate
// number is rendered; the combination weights are transparent assumptions
// awaiting calibration against the client's realized track record.

// ---- shared helpers ---------------------------------------------------------
const num = (v: string, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const usd = (x: number) => '$' + (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1e3) + 'k')
const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%'
const signedPct = (x: number, d = 2) => (x < 0 ? '−' : '+') + (Math.abs(x) * 100).toFixed(d) + '%'
const signedNum = (x: number, d = 2) => (x < 0 ? '−' : '+') + Math.abs(x).toFixed(d)

function liveRate(id: string): { v: number; asof: string } | null {
  const s = (US as any).series.find((s: any) => s.id === id)
  return s ? { v: s.latest / 100, asof: s.asof } : null
}

// ---- market picker (simplified from DealScore's normMetro resolver) ---------
type Metro = { key: string; label: string; n: number; rank: number }
const METRO_LIST = METROS as Metro[]
const normMetro = (s: string) => s.toLowerCase().replace(/[.,\-()]/g, ' ').replace(/\s+/g, ' ').trim()
const METRO_NORM = METRO_LIST.map(m => ({ ...m, norm: normMetro(m.key) }))
const METRO_KEYS = new Set(METRO_LIST.map(m => m.key))

function suggestMetros(query: string, limit = 8): Metro[] {
  const q = normMetro(query)
  const pool = q.length < 2
    ? METRO_NORM
    : METRO_NORM.filter(m => m.norm.startsWith(q) || m.norm.includes(' ' + q) || m.norm.includes(q))
  return pool.slice().sort((a, b) => a.rank - b.rank).slice(0, limit)
}

// ---- ingredient loading (same parsing as the source tabs) -------------------
const RM_SAMPLE_MARKER = 'SAMPLE (fictional)'
const DDQ_SAMPLE_MARKER = '(Fictional Sample)'

interface Ingredients {
  deal: StoredDealInputs
  uw: UnderwriteResult | null
  t10: { v: number; asof: string } | null
  rm: { scored: boolean; composite: number; sample: boolean }
  ddq: { result: GradingResult | null; sample: boolean }
}

function readIngredients(): Ingredients {
  let deal = DEAL_DEFAULTS
  try { deal = { ...DEAL_DEFAULTS, ...JSON.parse(localStorage.getItem(UNDERWRITE_STORAGE) || '{}') } } catch { /* defaults */ }
  const t10 = liveRate('DGS10')
  // percent fields ÷ 100, exactly like Underwrite.tsx
  const uw = computeUnderwrite({
    cost: num(deal.cost), gpi: num(deal.gpi), occ: num(deal.occ) / 100, opex: num(deal.opex),
    loan: num(deal.loan), rate: num(deal.rate) / 100, floating: deal.floating, hasCap: deal.hasCap,
    capStrike: num(deal.capStrike) / 100, io: deal.io, termY: num(deal.termY), holdY: num(deal.holdY),
    exitCap: num(deal.exitCap) / 100, noiG: num(deal.noiG) / 100,
  }, t10 ? t10.v : null)

  let rm: Ingredients['rm'] = { scored: false, composite: 0, sample: false }
  try {
    const raw = JSON.parse(localStorage.getItem(RM_STORAGE) || 'null')
    if (raw && typeof raw === 'object') {
      const scores: Scores = Object.fromEntries(Object.entries(raw as Record<string, any>).map(([k, s]) => [
        k, { hist: Number(s?.hist) || 0, ytd: Number(s?.ytd) || 0, fwd: Number(s?.fwd) || 0, notes: typeof s?.notes === 'string' ? s.notes : '' },
      ]))
      const vals = Object.values(scores)
      const scored = vals.some(s => s.hist !== 0 || s.ytd !== 0 || s.fwd !== 0)
      const sample = vals.some(s => s.notes.includes(RM_SAMPLE_MARKER))
      // user-edited weights (persisted by the Risk Model tab) so this card
      // always matches what that tab displays
      rm = { scored, composite: scored ? rmComposite(scores, loadRmWeights()) : 0, sample }
    }
  } catch { /* not scored */ }

  let ddq: Ingredients['ddq'] = { result: null, sample: false }
  try {
    const raw = JSON.parse(localStorage.getItem(DDQ_STORAGE) || 'null')
    if (raw && typeof raw === 'object') {
      const result = computeGrading(raw.answers || {}, raw.subjective || {}, raw.weights || {})
      const firmName = raw.answers?.a1_name
      const sample = typeof firmName === 'string' && firmName.includes(DDQ_SAMPLE_MARKER)
      ddq = { result, sample }
    }
  } catch { /* not graded */ }

  return { deal, uw, t10, rm, ddq }
}

// ---- the combination math (every number surfaced in the panel below) --------
interface Combo {
  rmScored: boolean; ddqScored: boolean; ddqHardFail: boolean
  rmTiltMu: number; rmSigma: number; ddqTiltMu: number; ddqSigma: number
  extBiasMu: number; extSigmaMult: number
}

function combine(rm: Ingredients['rm'], ddqComposite: number | null, ddqHardFail: boolean): Combo {
  const rmScored = rm.scored, ddqScored = ddqComposite != null
  const rmTiltMu = rmScored ? (rm.composite / 3) * 0.02 : 0
  const rmSigma = rmScored ? clamp(1 - 0.06 * rm.composite, 0.82, 1.18) : 1
  let ddqTiltMu = ddqScored ? ((ddqComposite - 3) / 2) * 0.015 * 0.5 : 0
  let ddqSigma = ddqScored ? clamp(1 - 0.04 * (ddqComposite - 3) * 0.5, 0.92, 1.08) : 1
  // A DDQ hard fail caps the grade band at LOW on the DDQ tab; mirror that
  // here — a hard-failed manager can never IMPROVE the deal, whatever the
  // uncapped composite says.
  if (ddqScored && ddqHardFail) {
    ddqTiltMu = Math.min(ddqTiltMu, 0)
    ddqSigma = Math.max(ddqSigma, 1)
  }
  return {
    rmScored, ddqScored, ddqHardFail, rmTiltMu, rmSigma, ddqTiltMu, ddqSigma,
    extBiasMu: clamp(rmTiltMu + ddqTiltMu, -0.025, 0.025),
    extSigmaMult: clamp(rmSigma * ddqSigma, 0.75, 1.4),
  }
}

// ---- /api/score response (the fields this tab uses) -------------------------
type CI = { median: number; ci: [number, number] }
interface ScoreResult {
  deal: { target: number; holding: number; rf: number }
  base: { label: string; muAnn: number; sigmaMarketDesmoothed: number; sigmaDealTotal: number; nObs: number }
  ddq: { biasMu: number; sigmaMult: number }
  external: { biasMu: number; sigmaMult: number } | null
  marketEdge: { grossYield: number; statePct: number; nState: number; muBias: number } | null
  honest: {
    pTarget: CI; expected: CI; median: CI; pLoss: CI; varLoss: CI; cvarLoss: CI
    position: number; verdict: string
    confidence: { score: number; band: string; nObs: number }
    hist: { edges: number[]; counts: number[] }
  }
}

// ---- histogram (style matches the How It Works step-5 chart) ----------------
function Hist({ hist, target }: { hist: { edges: number[]; counts: number[] }; target: number }) {
  const lo = hist.edges[0], hi = hist.edges[hist.edges.length - 1]
  const max = Math.max(...hist.counts, 1)
  const x = (v: number) => 10 + ((v - lo) / (hi - lo)) * 540
  const barW = 540 / hist.counts.length
  return (
    <svg viewBox="0 0 560 150" className="cv-hist" role="img"
      aria-label="Histogram of simulated annualized returns; losses in red, target-beating outcomes in green">
      {hist.counts.map((c, i) => {
        const bLo = hist.edges[i], bHi = hist.edges[i + 1]
        const color = bHi <= 0 ? '#c2384a' : bLo >= target ? '#157f3c' : '#b9c2d4'
        const bh = (c / max) * 112
        return <rect key={i} x={x(bLo) + 0.5} y={134 - bh} width={Math.max(barW - 1.2, 0.8)} height={bh} fill={color} rx="1.2" />
      })}
      <line x1={x(0)} x2={x(0)} y1="20" y2="136" stroke="#c2384a" strokeWidth="1" strokeDasharray="3 3" />
      <line x1={x(target)} x2={x(target)} y1="8" y2="136" stroke="#157f3c" strokeWidth="1" strokeDasharray="3 3" />
      <text x={x(0) + 4} y="30" className="cv-cap" fill="#c2384a">0%</text>
      <text x={x(target) + 4} y="16" className="cv-cap" fill="#157f3c">target {pct(target, 0)}</text>
      <text x="300" y="148" className="cv-cap" fill="#7d8694" textAnchor="middle">simulated annualized returns over the hold — 20,000 lifetimes</text>
    </svg>
  )
}

// ---- the tab ----------------------------------------------------------------
const UW_VERDICT = {
  pass: { label: 'PASSES', color: '#157f3c', bg: '#f0fdf6' },
  caution: { label: 'CAUTION', color: '#b8860b', bg: '#fdf8ec' },
  fail: { label: 'FAILS', color: '#c2384a', bg: '#fdf2f4' },
} as const
const DDQ_BAND_COLOR = { HIGH: '#157f3c', MID: '#b8860b', LOW: '#c2384a' } as const

export default function CombinedVerdict() {
  const [tick, setTick] = useState(0)
  const ing = useMemo(readIngredients, [tick])
  const ddqComposite = ing.ddq.result?.composite ?? null
  const ddqHardFail = (ing.ddq.result?.hardFails.length ?? 0) > 0
  const combo = useMemo(() => combine(ing.rm, ddqComposite, ddqHardFail), [ing, ddqComposite, ddqHardFail])

  // market + deal params
  const [metroQuery, setMetroQuery] = useState('Miami, FL')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [target, setTarget] = useState('15')
  const [rf, setRf] = useState('4')
  const suggestions = useMemo(() => suggestMetros(metroQuery), [metroQuery])
  const marketKey = useMemo(() => {
    if (METRO_KEYS.has(metroQuery)) return metroQuery
    return suggestions.length ? suggestions[0].key : null
  }, [metroQuery, suggestions])
  const holding = num(ing.deal.holdY, 5)

  const [res, setRes] = useState<ScoreResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!marketKey) { setErr('pick a market from the list'); return }
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline: marketKey, target: num(target, 15) / 100, rf: num(rf, 4) / 100, holding,
          extBiasMu: combo.extBiasMu, extSigmaMult: combo.extSigmaMult, neutralDdq: true, name: 'Combined verdict',
        }),
      })
      const ct = r.headers.get('content-type') || ''
      if (!r.ok || !ct.includes('application/json')) throw new Error('bad response')
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setRes(data as ScoreResult)
    } catch { setErr('engine unreachable — retry') }
    finally { setLoading(false) }
  }, [marketKey, target, rf, holding, combo])

  // score once on mount with whatever the tabs currently hold, and re-score
  // when "Refresh from tabs" changes the combined tilt — otherwise the result
  // panel would show a stale probability under a fresh math panel
  useEffect(() => { void run() }, [combo.extBiasMu, combo.extSigmaMult]) // eslint-disable-line react-hooks/exhaustive-deps

  const uw = ing.uw
  const failedGates = uw ? uw.gates.filter(g => g.status === 'fail').map(g => g.name) : []
  const flaggedGates = uw ? uw.gates.filter(g => g.status === 'flag').map(g => g.name) : []
  const tier1Fail = uw != null && uw.verdict === 'fail'
  const rmGrade = ing.rm.scored ? grade(ing.rm.composite) : null
  const ddqR = ing.ddq.result

  // combination panel rows: label / formula with live numbers / result
  const rmC = signedNum(ing.rm.composite)
  const dC = ddqComposite != null ? ddqComposite.toFixed(2) : '—'
  const mathRows: { label: string; formula: string; result: string; note?: string }[] = [
    {
      label: 'Risk Model return tilt',
      formula: combo.rmScored ? `rmTiltMu = (rmComposite ÷ 3) × 0.02 = (${rmC} ÷ 3) × 0.02` : 'neutral — not scored',
      result: signedPct(combo.rmTiltMu) + '/yr',
      note: 'max ±2%/yr at composite ±3',
    },
    {
      label: 'Risk Model risk multiplier',
      formula: combo.rmScored ? `rmSigma = clamp(1 − 0.06 × ${rmC}, 0.82, 1.18)` : 'neutral — not scored',
      result: combo.rmSigma.toFixed(3) + '×',
    },
    {
      label: 'DDQ return tilt',
      formula: combo.ddqScored
        ? `ddqTiltMu = ((ddqComposite − 3) ÷ 2) × 0.015 × 0.5 = ((${dC} − 3) ÷ 2) × 0.015 × 0.5${combo.ddqHardFail ? ' → capped at ≤ 0 (hard fail)' : ''}`
        : 'neutral — not graded',
      result: signedPct(combo.ddqTiltMu, 3) + '/yr',
      note: combo.ddqHardFail
        ? 'HARD FAIL on the DDQ — a hard-failed manager can never improve the deal: the DDQ contribution is capped at neutral-or-worse, mirroring the LOW-grade cap on the DDQ tab'
        : 'max ±0.75%/yr — the × 0.5 is the explicit DOWN-WEIGHT: DDQ contribution down-weighted 50% until genuinely distinct mid/low calibration exemplars are provided',
    },
    {
      label: 'DDQ risk multiplier',
      formula: combo.ddqScored
        ? `ddqSigma = clamp(1 − 0.04 × (${dC} − 3) × 0.5, 0.92, 1.08)${combo.ddqHardFail ? ' → floored at ≥ 1× (hard fail)' : ''}`
        : 'neutral — not graded',
      result: combo.ddqSigma.toFixed(3) + '×',
    },
    {
      label: 'Combined return tilt',
      formula: `extBiasMu = clamp(${signedPct(combo.rmTiltMu)} ${combo.ddqTiltMu < 0 ? '−' : '+'} ${(Math.abs(combo.ddqTiltMu) * 100).toFixed(3)}%, −2.5%, +2.5%)`,
      result: signedPct(combo.extBiasMu) + '/yr',
    },
    {
      label: 'Combined risk multiplier',
      formula: `extSigmaMult = clamp(${combo.rmSigma.toFixed(3)} × ${combo.ddqSigma.toFixed(3)}, 0.75, 1.40)`,
      result: combo.extSigmaMult.toFixed(3) + '×',
    },
  ]

  const H = res?.honest

  return (
    <div className="cv-root">
      <style>{CSS}</style>

      {/* 1 — header */}
      <header className="cv-head">
        <h1>Combined Verdict</h1>
        <p>Left side of the platform: your methodology. Right side: market evidence. This tab is what they say together.</p>
      </header>
      <Provenance kind="client">
        The gates, scorecard and DDQ grading below are <b>Connected Capital&rsquo;s methodology</b>; the probability
        model is the platform&rsquo;s market evidence. The combination weights are transparent assumptions — shown in
        full — awaiting calibration against your realized track record.
      </Provenance>

      {/* 2 — ingredient cards */}
      <div className="cv-cardbar">
        <h2>The three ingredients</h2>
        <button className="cv-refresh" onClick={() => setTick(t => t + 1)}>↻ Refresh from tabs</button>
      </div>
      <div className="cv-cards">
        <div className="cv-card">
          <h3>Underwrite gates</h3>
          {uw ? (
            <>
              <span className="cv-pill" style={{ color: UW_VERDICT[uw.verdict].color, borderColor: UW_VERDICT[uw.verdict].color, background: UW_VERDICT[uw.verdict].bg }}>
                {UW_VERDICT[uw.verdict].label}
              </span>
              <div className="cv-kv">NOI <b>{usd(uw.noi)}</b> · going-in cap <b>{pct(uw.goingIn, 2)}</b></div>
              {failedGates.length > 0 && <div className="cv-gates"><b className="cv-red">failing:</b> {failedGates.join(', ')}</div>}
              {flaggedGates.length > 0 && <div className="cv-gates"><b className="cv-amber">flagged:</b> {flaggedGates.join(', ')}</div>}
              {failedGates.length === 0 && flaggedGates.length === 0 && <div className="cv-gates"><b className="cv-green">all gates clear</b></div>}
            </>
          ) : (
            <div className="cv-kv">deal incomplete — needs a positive cost, income and NOI</div>
          )}
          <div className="cv-note">deal from the Underwrite tab — edit it there.</div>
        </div>

        <div className="cv-card">
          <h3>Risk Model v2 {ing.rm.sample && <span className="cv-fic">fictional sample</span>}</h3>
          {ing.rm.scored && rmGrade ? (
            <>
              <div className="cv-big">{signedNum(ing.rm.composite)} <small>/ ±3</small></div>
              <span className="cv-pill" style={{ color: rmGrade.color, borderColor: rmGrade.color }}>{rmGrade.band}</span>
            </>
          ) : (
            <>
              <div className="cv-big cv-mut">not scored</div>
              <div className="cv-kv">contributes a neutral 0 tilt / 1× risk until scored.</div>
            </>
          )}
          <div className="cv-note">sponsor/deal scorecard from the Risk Model tab.</div>
        </div>

        <div className="cv-card">
          <h3>Institutional DDQ {ing.ddq.sample && <span className="cv-fic">fictional sample</span>}</h3>
          {ddqR && ddqR.composite != null ? (
            <>
              <div className="cv-big">{ddqR.composite.toFixed(2)} <small>/ 5</small></div>
              {ddqR.band && <span className="cv-pill" style={{ color: DDQ_BAND_COLOR[ddqR.band], borderColor: DDQ_BAND_COLOR[ddqR.band] }}>{ddqR.band} GRADE</span>}
              <div className="cv-kv">hard fails: <b style={{ color: ddqR.hardFails.length ? '#c2384a' : 'inherit' }}>{ddqR.hardFails.length}</b></div>
            </>
          ) : (
            <>
              <div className="cv-big cv-mut">not graded yet</div>
              <div className="cv-kv">contributes a neutral 0 tilt / 1× risk until graded.</div>
            </>
          )}
          <div className="cv-note">grading from the Institutional DDQ tab.</div>
        </div>
      </div>

      {/* 3 — the combination math, in full */}
      <section className="cv-math">
        <h3>How the methodology becomes a tilt — every number shown</h3>
        {mathRows.map(r => (
          <div className="cv-mrow" key={r.label}>
            <span className="cv-mlabel">{r.label}</span>
            <span className="cv-mformula">{r.formula}{r.note && <em className="cv-mnote">{r.note}</em>}</span>
            <span className="cv-mres">{r.result}</span>
          </div>
        ))}
        <p className="cv-mathfoot">
          The engine clamps once more on arrival (tilt ±3%/yr, multiplier 0.7–1.6×) and applies the tilt on top of its
          own de-smoothed market history — your methodology can lean on the evidence, never replace it.
        </p>
      </section>

      {/* 4 — market + deal params */}
      <div className="cv-params">
        <label className="cv-pf cv-market">Market history
          <span className="cv-in">
            <input value={metroQuery} placeholder="e.g. Miami, FL"
              onChange={e => { setMetroQuery(e.target.value); setPickerOpen(true) }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)} />
          </span>
          {pickerOpen && suggestions.length > 0 && (
            <div className="cv-dd">
              {suggestions.map(m => (
                <button key={m.key} onMouseDown={() => { setMetroQuery(m.key); setPickerOpen(false) }}>
                  {m.label} <i>#{m.rank}</i>
                </button>
              ))}
            </div>
          )}
          {marketKey && marketKey !== metroQuery && <span className="cv-resolve">↳ using {marketKey}</span>}
          {!marketKey && <span className="cv-resolve cv-red">↳ pick a market from the list</span>}
        </label>
        <label className="cv-pf">Target return
          <span className="cv-in cv-narrow"><input value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" /><i>%</i></span>
        </label>
        <label className="cv-pf">Risk-free
          <span className="cv-in cv-narrow"><input value={rf} onChange={e => setRf(e.target.value)} inputMode="decimal" /><i>%</i></span>
        </label>
        <span className="cv-pf">Holding
          <span className="cv-hold">{holding}y <i>from the Underwrite deal</i></span>
        </span>
        <button className="cv-run" onClick={() => void run()} disabled={loading || !marketKey}>
          {loading ? 'scoring…' : 'Run combined score'}
        </button>
      </div>

      {err && (
        <div className="cv-err">
          {err} <button className="cv-retry" onClick={() => void run()}>retry</button>
        </div>
      )}

      {/* 5 — result */}
      {tier1Fail && (
        <div className="cv-banner">
          <span>REJECTED BY TIER-1 GATES</span>
          <small>failing: {failedGates.join(', ')}</small>
        </div>
      )}

      {H && res && (
        <section className={tier1Fail ? 'cv-result cv-dim' : 'cv-result'}>
          {tier1Fail && (
            <p className="cv-moot">probability is moot until the deal survives the gates — fix the deal on the Underwrite tab.</p>
          )}
          <div className="cv-ptarget">
            <div>
              <span className="cv-plabel">P(annualized return ≥ {pct(res.deal.target, 0)} over {res.deal.holding}y)</span>
              <span className="cv-pval">{pct(H.pTarget.median)}</span>
              <span className="cv-pci">90% CI {pct(H.pTarget.ci[0])} – {pct(H.pTarget.ci[1])}</span>
            </div>
            <Hist hist={H.hist} target={res.deal.target} />
          </div>

          <div className="cv-chips">
            <div><span className="cv-clabel">Median annualized return</span><b>{pct(H.median.median)}</b></div>
            <div><span className="cv-clabel">Probability of loss</span><b style={{ color: H.pLoss.median > 0.15 ? '#c2384a' : '#b8860b' }}>{pct(H.pLoss.median)}</b></div>
            <div><span className="cv-clabel">5% tail loss (VaR / CVaR)</span><b>{(H.varLoss.median > 0 ? '−' : '') + pct(Math.abs(H.varLoss.median))} / {(H.cvarLoss.median > 0 ? '−' : '') + pct(Math.abs(H.cvarLoss.median))}</b></div>
            <div><span className="cv-clabel">Suggested allocation</span><b>{H.position.toFixed(0)}%</b><span className="cv-cnote">{H.verdict}</span></div>
            <div><span className="cv-clabel">Confidence</span><b>{H.confidence.score}/100</b><span className="cv-cnote">{H.confidence.band}</span></div>
          </div>

          <h3 className="cv-movedh">What moved the number</h3>
          <ul className="cv-moved">
            <li>
              <b>Market evidence</b> — {res.base.label}: μ {signedPct(res.base.muAnn)}/yr on {res.base.nObs} quarterly
              observations; σ {pct(res.base.sigmaMarketDesmoothed)} de-smoothed market, {pct(res.base.sigmaDealTotal)} with
              single-asset risk added.
            </li>
            {res.marketEdge && (
              <li>
                <b>Yield edge</b> — gross yield {pct(res.marketEdge.grossYield)} sits at the {res.marketEdge.statePct}th
                percentile of {res.marketEdge.nState} in-state markets → μ {signedPct(res.marketEdge.muBias)}/yr (capped ±0.30%).
              </li>
            )}
            <li>
              <b>Your methodology tilt</b> — return tilt {signedPct(res.external ? res.external.biasMu : combo.extBiasMu)}/yr,
              risk multiplier {(res.external ? res.external.sigmaMult : combo.extSigmaMult).toFixed(3)}× — from the
              combination panel above (Risk Model {combo.rmScored ? signedNum(ing.rm.composite) : 'neutral'}, DDQ {combo.ddqScored ? dC + '/5 down-weighted 50%' : 'neutral'}).
            </li>
            <li>
              <b>Engine&rsquo;s own questionnaire layer</b> — switched off for this tab
              (μ {signedPct(res.ddq.biasMu)}/yr, σ ×{res.ddq.sigmaMult.toFixed(3)}): your methodology tilt is the
              only judgment layer applied, and no portfolio-overlap haircut is taken on the suggested allocation.
            </li>
          </ul>
        </section>
      )}

      {!H && !err && loading && <div className="cv-loading">running 20,000 simulated lifetimes…</div>}

      {/* 6 — footer */}
      <p className="cv-foot">
        The combination weights on this tab are assumptions, not fitted statistics — they are deliberately small,
        hard-capped, and shown in full so they can be challenged and later calibrated against realized outcomes.
        Decision-support only; nothing here is investment advice.
      </p>
    </div>
  )
}

const CSS = `
.cv-root{max-width:1100px}
.cv-head h1{margin:0 0 4px;font-size:1.35rem}
.cv-head p{margin:0 0 12px;color:var(--muted);font-size:.86rem}
.cv-cardbar{display:flex;align-items:baseline;gap:12px;margin:2px 0 8px}
.cv-cardbar h2{margin:0;font-size:.95rem}
.cv-refresh{margin-left:auto;font-size:.72rem;padding:4px 10px}
.cv-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
.cv-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;min-width:0}
.cv-card h3{margin:0 0 8px;font-size:.84rem}
.cv-pill{display:inline-block;font-weight:800;font-size:.78rem;padding:2px 11px;border-radius:999px;border:1.5px solid;letter-spacing:.03em}
.cv-big{font-size:1.3rem;font-weight:800;margin:2px 0 6px}
.cv-big small{font-size:.72rem;color:var(--muted);font-weight:600}
.cv-mut{color:var(--muted);font-weight:600;font-size:1.05rem}
.cv-kv{font-size:.76rem;color:var(--text);margin:7px 0 0}
.cv-kv b{font-weight:800}
.cv-gates{font-size:.74rem;margin-top:5px;color:var(--muted)}
.cv-red{color:#c2384a}
.cv-amber{color:#b8860b}
.cv-green{color:#157f3c}
.cv-fic{display:inline-block;font-size:.6rem;font-weight:700;letter-spacing:.05em;color:#9a6700;background:#fff8e6;border:1px solid #eddfae;border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:middle;text-transform:uppercase}
.cv-note{font-size:.68rem;color:var(--muted);margin-top:9px;font-style:italic}
.cv-math{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:16px}
.cv-math h3{margin:0 0 8px;font-size:.88rem}
.cv-mrow{display:grid;grid-template-columns:185px 1fr 105px;gap:12px;align-items:baseline;padding:6px 0;border-top:1px dashed var(--border);font-size:.78rem}
.cv-mrow:first-of-type{border-top:none}
.cv-mlabel{font-weight:700}
.cv-mformula{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.72rem;color:var(--muted);overflow-wrap:anywhere}
.cv-mnote{display:block;font-family:Poppins,system-ui,sans-serif;font-style:italic;font-size:.66rem;color:#9a6700;margin-top:2px}
.cv-mres{font-weight:800;text-align:right;white-space:nowrap}
.cv-mathfoot{font-size:.7rem;color:var(--muted);margin:8px 0 0;line-height:1.45}
.cv-params{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px}
.cv-pf{display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600;color:var(--muted);position:relative}
.cv-in{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:6px;padding:0 8px;background:var(--surface)}
.cv-in input{border:none;outline:none;padding:.42rem 0;background:transparent;font-size:.85rem;min-width:0;width:200px;color:var(--text)}
.cv-narrow input{width:64px}
.cv-in i{font-style:normal;color:var(--muted);font-size:.72rem}
.cv-hold{font-size:.95rem;font-weight:800;color:var(--text);padding:.32rem 0}
.cv-hold i{font-style:normal;font-weight:400;font-size:.68rem;color:var(--muted);margin-left:6px}
.cv-dd{position:absolute;top:100%;left:0;min-width:240px;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 10px 24px rgba(15,23,42,.14);max-height:264px;overflow:auto}
.cv-dd button{display:block;width:100%;text-align:left;border:none;background:none;padding:7px 10px;font-size:.78rem;cursor:pointer;color:var(--text)}
.cv-dd button:hover{background:var(--accent-soft)}
.cv-dd button i{font-style:normal;color:var(--muted);font-size:.66rem}
.cv-resolve{font-weight:400;font-size:.68rem;color:var(--muted)}
.cv-run{margin-left:auto;font-size:.82rem;font-weight:700;padding:8px 16px}
.cv-err{border:1px solid #c2384a;background:#fdf2f4;color:#c2384a;border-radius:10px;padding:9px 14px;font-size:.8rem;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.cv-retry{font-size:.72rem;padding:3px 12px}
.cv-banner{border:1.5px solid #c2384a;background:#fdf2f4;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.cv-banner span{color:#c2384a;font-weight:800;font-size:.95rem;letter-spacing:.03em}
.cv-banner small{color:#c2384a;font-size:.74rem}
.cv-result{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:6px}
.cv-dim{opacity:.5}
.cv-moot{margin:0 0 10px;font-size:.74rem;font-style:italic;color:#c2384a}
.cv-ptarget{display:grid;grid-template-columns:230px 1fr;gap:16px;align-items:center;margin-bottom:12px}
.cv-plabel{display:block;font-size:.7rem;color:var(--muted);font-weight:600}
.cv-pval{display:block;font-size:2.3rem;font-weight:800;line-height:1.15;font-family:Manrope,Poppins,system-ui,sans-serif}
.cv-pci{display:block;font-size:.72rem;color:var(--muted)}
.cv-hist{width:100%;height:auto;background:var(--surface-2);border:1px solid var(--border);border-radius:10px}
.cv-cap{font-size:10px;font-family:Poppins,system-ui,sans-serif}
.cv-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px 16px;border-top:1px dashed var(--border);padding-top:12px}
.cv-chips>div{display:flex;flex-direction:column;min-width:0}
.cv-clabel{font-size:.68rem;color:var(--muted)}
.cv-chips b{font-size:1.05rem;font-weight:800}
.cv-cnote{font-size:.62rem;color:var(--muted);line-height:1.35}
.cv-movedh{margin:16px 0 6px;font-size:.84rem}
.cv-moved{margin:0;padding-left:18px;font-size:.76rem;line-height:1.55;color:var(--text)}
.cv-moved li{margin:4px 0}
.cv-loading{padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--muted);font-size:.8rem}
.cv-foot{font-size:.7rem;color:var(--muted);margin-top:14px;line-height:1.55}
@media(max-width:900px){
  .cv-cards{grid-template-columns:1fr}
  .cv-mrow{grid-template-columns:1fr;gap:2px}
  .cv-mres{text-align:left}
  .cv-ptarget{grid-template-columns:1fr}
  .cv-run{margin-left:0;width:100%}
}
`
