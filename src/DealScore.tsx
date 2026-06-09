import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import METROS from './metros-list.json'
import { Info } from './Info'

// Compact DDQ field list for the dropdowns (math lives server-side in lib/ddq.ts).
const DDQ_FIELDS: { key: string; q: string; opts: [string, string][] }[] = [
  { key: 'sponsor_track_record', q: 'Sponsor track record', opts: [['first_time', 'First-time / no exits'], ['emerging', 'Some exits, short history'], ['established', 'Multiple realized exits'], ['institutional', 'Long institutional record']] },
  { key: 'business_plan', q: 'Business-plan risk', opts: [['core', 'Core / stabilized'], ['core_plus', 'Core-plus / light VA'], ['value_add', 'Heavy value-add'], ['opportunistic', 'Ground-up / opportunistic']] },
  { key: 'leverage_ltv', q: 'Leverage (LTV)', opts: [['low', 'Low (<50%)'], ['moderate', 'Moderate (50-65%)'], ['high', 'High (65-75%)'], ['very_high', 'Very high (>75%)']] },
  { key: 'asset_status', q: 'Asset status at entry', opts: [['stabilized', 'Stabilized'], ['transitional', 'Lease-up / transitional'], ['predev', 'Pre-development']] },
  { key: 'market_quality', q: 'Market tier', opts: [['gateway', 'Gateway / primary'], ['secondary', 'Strong secondary'], ['tertiary', 'Tertiary / thin']] },
  { key: 'downside_protection', q: 'Downside protection', opts: [['none', 'Common equity, none'], ['pref', 'Preferred return'], ['secured', 'Secured / guaranteed']] },
  { key: 'alignment', q: 'Sponsor alignment', opts: [['none', 'No co-invest'], ['modest', 'Standard (~5-10%)'], ['strong', 'Large (>10%)']] },
  { key: 'correlation_to_book', q: 'Correlation to book', opts: [['diversifying', 'Diversifying'], ['moderate', 'Moderately correlated'], ['concentrated', 'Highly correlated']] },
  { key: 'comp_quality', q: 'Comp / data quality', opts: [['strong', 'Strong'], ['fair', 'Fair / partial'], ['weak', 'Weak / sparse']] },
]
const METRO_LIST = METROS as { key: string; label: string; n: number; rank: number }[]

// Forgiving metro lookup: "Miami Florida", "miami, fl" and plain "miami" all
// resolve to "Miami, FL" (ties go to the larger metro by rank).
const STATE_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

function normMetro(s: string): string {
  let q = s.toLowerCase().replace(/[.,\-()]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [name, abbr] of Object.entries(STATE_ABBR)) {
    if (q.endsWith(' ' + name)) { q = q.slice(0, q.length - name.length).trim() + ' ' + abbr.toLowerCase(); break }
  }
  return q
}

const METRO_NORM = METRO_LIST.map(m => ({ ...m, norm: normMetro(m.key) }))

function resolveMetro(query: string): string | null {
  const q = normMetro(query)
  if (q.length < 3) return null
  const exact = METRO_NORM.find(m => m.norm === q)
  if (exact) return exact.key
  const candidates = METRO_NORM.filter(m => m.norm.startsWith(q))
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => a.rank - b.rank)[0].key
}

// Top datalist suggestions for the current query — with 20k+ markets we only
// render a handful of <option>s, not the whole list.
function suggestMetros(query: string, limit = 40): string[] {
  const q = normMetro(query)
  const pool = q.length < 2
    ? METRO_NORM
    : METRO_NORM.filter(m => m.norm.startsWith(q) || m.norm.includes(' ' + q) || m.key.toLowerCase().includes(query.toLowerCase()))
  return pool.slice().sort((a, b) => a.rank - b.rank).slice(0, limit).map(m => m.key)
}
const DEFAULTS: Record<string, string> = {
  sponsor_track_record: 'established', business_plan: 'value_add', leverage_ltv: 'moderate',
  asset_status: 'transitional', market_quality: 'secondary', downside_protection: 'pref',
  alignment: 'modest', correlation_to_book: 'moderate', comp_quality: 'fair',
}

type CI = { median: number; ci: [number, number] }
interface Result {
  deal: { name: string; strategy: string; ticket: number; book: number; holding: number; target: number; rf: number }
  base: { label: string; nObs: number; muAnn: number; sigmaIndexRaw: number; sigmaMarketDesmoothed: number; idiosyncratic: number; sigmaDealTotal: number; lag1: number; smoothing: boolean }
  ddq: { biasMu: number; sigmaMult: number; bookCorr: number; drivers: { field: string; answer: string; muDelta: number; sigmaMult: number }[] }
  honest: { pTarget: CI; expected: CI; median: CI; pLoss: CI; varLoss: CI; cvarLoss: CI; position: number; verdict: string; confidence: { score: number; band: string; nObs: number }; drivers: { factor: string; delta: number }[]; hist: { edges: number[]; counts: number[] } }
  naive: { pLoss: CI; varLoss: CI }
  macro: { mortgage30y: number; caseShillerYoy: number; asof: string }
}

const pct = (x: number) => (x * 100).toFixed(1) + '%'
const pct0 = (x: number) => (x * 100).toFixed(0) + '%'
const usd = (x: number) => '$' + (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1e3) + 'k')

export default function DealScore() {
  const [baseline, setBaseline] = useState('Miami, FL')
  const [metroQuery, setMetroQuery] = useState('Miami, FL')
  const metroKeys = useMemo(() => new Set(METRO_LIST.map(m => m.key)), [])
  const [target, setTarget] = useState(0.2)
  const [rf, setRf] = useState(0.04)
  const [holding, setHolding] = useState(5)
  const [book, setBook] = useState(5_000_000)
  const [ticket, setTicket] = useState(250_000)
  const [idio, setIdio] = useState(0.18)
  const [answers, setAnswers] = useState<Record<string, string>>(DEFAULTS)
  const [res, setRes] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const fetchScore = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseline, target, rf, holding, book, ticket, idiosyncratic: idio, answers }),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error('Scoring engine offline — run `vite` (dev middleware) or `netlify dev`.')
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setRes(data as Result)
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setLoading(false) }
  }, [baseline, target, rf, holding, book, ticket, idio, answers])

  useEffect(() => { const t = setTimeout(fetchScore, 250); return () => clearTimeout(t) }, [fetchScore])

  const H = res?.honest
  const cards = res && H ? [
    { label: `P(hit target ${pct0(res.deal.target)})`, val: pct(H.pTarget.median), ci: `90% CI ${pct(H.pTarget.ci[0])} – ${pct(H.pTarget.ci[1])}`, cls: '',
      tip: <>Probability the deal's annualized IRR <b>meets or beats your target</b> over the hold, across 20,000 simulations drawn from the metro's real history. The 90% CI shows how much the limited history actually pins this down.</> },
    { label: 'Expected annualized return', val: pct(H.expected.median), ci: `90% CI ${pct(H.expected.ci[0])} – ${pct(H.expected.ci[1])}`, cls: 'good',
      tip: <>Median annualized return across simulations (an IRR / CAGR proxy). It sits below the simple average because volatility drags compound returns down.</> },
    { label: 'Probability of loss', val: pct(H.pLoss.median), ci: `90% CI ${pct(H.pLoss.ci[0])} – ${pct(H.pLoss.ci[1])}`, cls: H.pLoss.median > 0.15 ? 'bad' : 'warn',
      tip: <>Share of scenarios ending <b>below breakeven</b> over the hold. This is the number a smoothed index hides — see the volatility build-up below.</> },
    { label: '5% tail loss (VaR)', val: (H.varLoss.median > 0 ? '−' : '') + pct(Math.abs(H.varLoss.median)), ci: `worst-5% avg ${pct(Math.abs(H.cvarLoss.median))}`, cls: H.varLoss.median > 0 ? 'bad' : 'good',
      tip: <>Value-at-Risk: the loss at the 5th-percentile outcome; "worst-5% avg" (CVaR) is the average across that whole tail. A <b>−</b> value means even the 5%-worst case still gains.</> },
    { label: 'Suggested allocation', val: H.position.toFixed(0) + '%', ci: usd(res.deal.book * H.position / 100) + ' of book', cls: '',
      tip: <>Risk-budgeted position size — <b>fractional Kelly</b>, capped at 25%, shrunk for correlation with your existing book. Advisory only; the tool never commits capital.</> },
  ] : []

  return (
    <div className="ds-root">
      <style>{CSS}</style>
      <div className="ds-grid">
        {/* CONTROLS */}
        <aside className="ds-controls">
          <h3>Deal inputs</h3>
          <label>Market / metro history <Info>Type any of {METRO_LIST.length.toLocaleString()} U.S. markets — metros ("Miami, FL"), counties ("Miami-Dade County, FL") or cities ("Coral Gables, FL"). The engine scores the deal on <b>that market's real price history</b> — de-smoothed to recover its true volatility.</Info> <span className="ds-rv">{METRO_LIST.length.toLocaleString()} markets</span>
            <input list="ds-metros" value={metroQuery} placeholder="Metro, county or city, e.g. Miami, FL"
              onChange={e => {
                const v = e.target.value
                setMetroQuery(v)
                const match = metroKeys.has(v) ? v : resolveMetro(v)
                if (match) setBaseline(match)
              }} />
            <datalist id="ds-metros">{suggestMetros(metroQuery).map(k => <option key={k} value={k} />)}</datalist>
            {!metroKeys.has(metroQuery) && (
              resolveMetro(metroQuery)
                ? <span className="ds-rv">↳ using {resolveMetro(metroQuery)}</span>
                : <span className="ds-warn">↳ pick a metro from the list</span>
            )}
          </label>
          <Range label={<>Target annual return <Info>The IRR hurdle you want this deal to clear (e.g. 20%). Every probability above is computed against this.</Info></>} v={target} min={0.05} max={0.5} step={0.01} fmt={pct0} set={setTarget} />
          <Range label="Risk-free rate" v={rf} min={0} max={0.1} step={0.005} fmt={pct} set={setRf} />
          <Range label="Holding period (yrs)" v={holding} min={1} max={10} step={1} fmt={v => String(v)} set={setHolding} />
          <Range label={<>Idiosyncratic single-asset σ <Info>Asset-specific volatility <b>beyond</b> the metro market — how far one property can deviate from the index. Added in quadrature on top of the de-smoothed market vol. A single deal carries far more of this than a diversified index.</Info></>} v={idio} min={0} max={0.4} step={0.01} fmt={pct0} set={setIdio} />
          <label>Book size
            <input type="number" value={book} step={500000} onChange={e => setBook(Number(e.target.value))} /></label>
          <label>Proposed ticket
            <input type="number" value={ticket} step={50000} onChange={e => setTicket(Number(e.target.value))} /></label>
          <h3 style={{ marginTop: 18 }}>Due-diligence questionnaire <Info>Each answer nudges the base distribution by a small, <b>documented and capped</b> amount (μ shift and σ multiplier) — see the "DDQ drivers" table on the right. This is how qualitative judgment enters the score, transparently.</Info></h3>
          {DDQ_FIELDS.map(f => (
            <label key={f.key}>{f.q}
              <select value={answers[f.key]} onChange={e => setAnswers(a => ({ ...a, [f.key]: e.target.value }))}>
                {f.opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          ))}
          <p className="ds-note">Every score traces to these inputs. Decision support, not investment advice.</p>
        </aside>

        {/* RESULTS */}
        <main className="ds-results">
          {err && <div className="ds-err">{err}</div>}
          {!res && !err && <div className="ds-loading">Scoring…</div>}
          {res && H && (<>
            <header className="ds-top">
              <div>
                <div className="ds-brand">AI INVESTMENT DILIGENCE {loading && <span className="ds-live">· updating…</span>}</div>
                <h1>{res.deal.name}</h1>
                <div className="ds-sub"><span className="ds-chip">{res.deal.strategy}</span> &nbsp;
                  {usd(res.deal.ticket)} ticket · {res.deal.holding}-yr hold · target {pct0(res.deal.target)} IRR · book {usd(res.deal.book)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="ds-verdict">{H.verdict.split('(')[0].trim()}</div>
                <div className="ds-sub" style={{ marginTop: 8 }}>size <b>{H.position.toFixed(1)}%</b> · {usd(res.deal.book * H.position / 100)} (advisory, capped)</div>
              </div>
            </header>

            <div className="ds-metrics">
              {cards.map((c, i) => (
                <div className="ds-metric" key={i}>
                  <div className="ds-mlabel">{c.label}<Info>{c.tip}</Info></div>
                  <div className={`ds-mval ${c.cls}`}>{c.val}</div>
                  <div className="ds-mci">{c.ci}</div>
                </div>
              ))}
            </div>

            <div className="ds-two">
              <div className="ds-panel">
                <h2>Why the downside is real <span className="ds-tag">honest-risk</span> <Info width={280}>Public RE indices are <b>smoothed</b>, which hides volatility and makes deals look near-riskless. We de-smooth the market vol (Geltner) and add idiosyncratic single-asset vol. The "naïve vs honest" boxes below show how much risk the raw index conceals.</Info></h2>
                <div className="ds-callout">The base history is a <b>diversified, smoothed national index</b>. A single
                  levered value-add asset carries far more risk than that implies. We de-smooth the index and add an
                  explicit <b>idiosyncratic single-asset</b> volatility, in the open.</div>
                <div className="ds-h2sub">Volatility build-up (annualized σ)</div>
                <Sigbar base={res.base} />
                <div className="ds-cmp">
                  <div className="ds-naive"><div className="ds-cmph">Raw index (naïve)</div>
                    <div className="ds-big" style={{ color: '#5b6573' }}>{pct(res.naive.pLoss.median)}</div>
                    <div className="ds-cmpn">probability of loss — looks riskless</div></div>
                  <div className="ds-honest"><div className="ds-cmph">Honest model (this score)</div>
                    <div className="ds-big" style={{ color: '#c2384a' }}>{pct(H.pLoss.median)}</div>
                    <div className="ds-cmpn">with a real 5% tail loss of {pct(Math.abs(H.varLoss.median))}</div></div>
                </div>
              </div>
              <div className="ds-panel">
                <h2>Simulated {res.deal.holding}-yr annualized return</h2>
                <Histogram hist={H.hist} target={res.deal.target} />
                <div className="ds-legend"><span><i style={{ background: '#c2384a' }} />loss region</span>
                  <span><i style={{ background: '#3b5bdb' }} />≥ target</span>
                  <span style={{ borderLeft: '2px dashed #333', paddingLeft: 8 }}>target</span></div>
              </div>
            </div>

            <div className="ds-two">
              <div className="ds-panel">
                <h2>What moved the score — DDQ drivers (auditable)</h2>
                <table className="ds-table"><thead><tr><th>Qualitative factor</th><th style={{ textAlign: 'right' }}>Δμ</th><th style={{ textAlign: 'right' }}>×σ</th></tr></thead>
                  <tbody>{res.ddq.drivers.map((d, i) => (
                    <tr key={i}><td>{d.field.replace(/_/g, ' ')} — <span style={{ color: '#5b6573' }}>{d.answer}</span></td>
                      <td className="ds-num" style={{ color: d.muDelta >= 0 ? '#157f3c' : '#c2384a' }}>{d.muDelta >= 0 ? '+' : ''}{(d.muDelta * 100).toFixed(1)}pp</td>
                      <td className="ds-num" style={{ color: d.sigmaMult > 1 ? '#c2384a' : '#157f3c' }}>×{d.sigmaMult.toFixed(2)}</td></tr>
                  ))}</tbody></table>
                <div className="ds-foot">Net DDQ: <b>μ {res.ddq.biasMu >= 0 ? '+' : ''}{(res.ddq.biasMu * 100).toFixed(1)}pp</b>, <b>σ ×{res.ddq.sigmaMult.toFixed(2)}</b>, book-corr <b>{res.ddq.bookCorr.toFixed(2)}</b>.</div>
              </div>
              <div className="ds-panel">
                <h2>Sensitivity &amp; confidence</h2>
                <Sensitivity drivers={H.drivers} />
                <div className="ds-kv"><span>Confidence (history depth)</span><b>{H.confidence.score.toFixed(0)} / 100 — {H.confidence.band.split('(')[0].trim()}</b></div>
                <div className="ds-kv"><span>Comparable observations</span><b>{H.confidence.nObs}</b></div>
                <div className="ds-kv"><span>Base distribution</span><b style={{ fontWeight: 500, textAlign: 'right' }}>{res.base.label} · n={res.base.nObs} · μ={pct(res.base.muAnn)}</b></div>
                <div className="ds-foot">Lag-1 autocorrelation of the raw index is <b>{res.base.lag1}</b> (smoothing {res.base.smoothing ? 'flagged' : 'not flagged'}) — why de-smoothing is applied before sizing.</div>
              </div>
            </div>

            <div className="ds-panel ds-macro">
              <h2>Macro context (live FRED)</h2>
              <div><div className="ds-mk">30-yr mortgage</div><div className="ds-mv">{res.macro.mortgage30y}%</div></div>
              <div><div className="ds-mk">Case-Shiller YoY</div><div className="ds-mv">{res.macro.caseShillerYoy}%</div></div>
              <div><div className="ds-mk">as of</div><div className="ds-mv">{res.macro.asof}</div></div>
            </div>
            <div className="ds-foot" style={{ marginTop: 14 }}>Numbers are live from the verified Monte Carlo engine (TS port, parity-checked vs the Python reference). Probabilities are conditional on the comparable history + DDQ inputs.</div>
          </>)}
        </main>
      </div>
    </div>
  )
}

function Range({ label, v, min, max, step, fmt, set }: { label: ReactNode; v: number; min: number; max: number; step: number; fmt: (n: number) => string; set: (n: number) => void }) {
  return <label>{label} <span className="ds-rv">{fmt(v)}</span>
    <input type="range" min={min} max={max} step={step} value={v} onChange={e => set(Number(e.target.value))} /></label>
}

function Sigbar({ base }: { base: Result['base'] }) {
  const mktW = base.sigmaMarketDesmoothed / base.sigmaDealTotal * 100
  return (<>
    <div className="ds-sigbar">
      <div className="ds-smkt" style={{ width: `${mktW}%` }}>market {pct(base.sigmaMarketDesmoothed)}</div>
      <div className="ds-sidio" style={{ width: `${100 - mktW}%` }}>idiosyncratic {pct(base.idiosyncratic)}</div>
    </div>
    <div className="ds-legend">
      <span><i style={{ background: '#cfd4dd' }} />raw index <b>{pct(base.sigmaIndexRaw)}</b></span>
      <span><i style={{ background: '#7c8aa5' }} />de-smoothed market <b>{pct(base.sigmaMarketDesmoothed)}</b></span>
      <span><i style={{ background: '#c2384a' }} />+ idiosyncratic <b>{pct(base.idiosyncratic)}</b></span>
      <span>= deal <b>{pct(base.sigmaDealTotal)}</b></span>
    </div>
  </>)
}

function Histogram({ hist, target }: { hist: { edges: number[]; counts: number[] }; target: number }) {
  const W = 520, Hh = 240, padB = 28, padL = 4, padR = 4, padT = 10
  const { edges, counts } = hist, n = counts.length
  const maxc = Math.max(...counts, 1), bw = (W - padL - padR) / n
  const x0 = edges[0], x1 = edges[edges.length - 1]
  const xpix = (val: number) => padL + (val - x0) / (x1 - x0) * (W - padL - padR)
  const bars = counts.map((c, i) => {
    const h = (c / maxc) * (Hh - padT - padB), lo = edges[i]
    const col = lo < 0 ? '#c2384a' : (lo >= target ? '#3b5bdb' : '#c7cede')
    return <rect key={i} x={padL + i * bw + 0.5} y={Hh - padB - h} width={bw - 1} height={h} fill={col} opacity={0.9} />
  })
  const xt = xpix(target)
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" height={240} preserveAspectRatio="xMidYMid meet">
      {bars}
      <line x1={xt} y1={padT} x2={xt} y2={Hh - padB} stroke="#11161f" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={xt} y={padT + 10} fontSize={10} textAnchor="middle" fill="#11161f">target {pct0(target)}</text>
      {[-0.5, -0.25, 0, 0.25, 0.5, 0.75].filter(t => t >= x0 && t <= x1).map(t => (
        <text key={t} x={xpix(t)} y={Hh - 8} fontSize={10} textAnchor="middle" fill="#5b6573">{pct0(t)}</text>
      ))}
    </svg>
  )
}

function Sensitivity({ drivers }: { drivers: { factor: string; delta: number }[] }) {
  const mx = Math.max(...drivers.map(d => Math.abs(d.delta)), 0.0001)
  return <div style={{ marginBottom: 14 }}>{drivers.map((d, i) => (
    <div key={i} style={{ margin: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
        <span>{d.factor}</span><span style={{ color: '#5b6573' }}>{d.delta >= 0 ? '+' : ''}{(d.delta * 100).toFixed(1)}pp</span></div>
      <div className="ds-track"><div className="ds-bar" style={{ width: `${Math.abs(d.delta) / mx * 100}%`, background: d.delta < 0 ? '#c9ccd4' : '#3b5bdb' }} /></div>
    </div>
  ))}</div>
}

const CSS = `
.ds-root{font-family:'Poppins',-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif;color:#11161f}
/* neutralize the app's global dark-theme table styles inside this light panel */
.ds-root table{background:transparent;border-radius:0;overflow:visible}
.ds-root th,.ds-root td{background:transparent;color:#11161f}
.ds-grid{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start}
.ds-controls{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:16px 18px;position:sticky;top:12px}
.ds-controls h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6573;margin:0 0 10px}
.ds-controls label{display:block;font-size:12.5px;color:#2a3340;font-weight:600;margin:10px 0}
.ds-controls select,.ds-controls input[type=number],.ds-controls input[list]{width:100%;margin-top:4px;padding:6px 8px;border:1px solid #d7dbe3;border-radius:8px;font-size:13px;background:#fff}
.ds-controls input[type=range]{width:100%;margin-top:6px;accent-color:#3b5bdb}
.ds-rv{float:right;color:#3b5bdb;font-weight:700}
.ds-warn{display:block;color:#c2384a;font-size:11px;font-weight:600;margin-top:3px}
.ds-note{font-size:11.5px;color:#5b6573;margin-top:14px;line-height:1.5}
.ds-results{min-width:0}
.ds-err{background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:14px 16px;font-size:13.5px}
.ds-loading{color:#5b6573;padding:40px;text-align:center}
.ds-top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}
.ds-brand{font-size:12px;letter-spacing:.14em;color:#5b6573;font-weight:600}
.ds-live{color:#3b5bdb;letter-spacing:0}
.ds-top h1{font-size:24px;margin:4px 0 2px;letter-spacing:-.02em}
.ds-sub{color:#5b6573;font-size:13.5px}
.ds-chip{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:#eef2ff;color:#3b5bdb;border:1px solid #dbe2fb}
.ds-verdict{font-size:13px;font-weight:700;padding:7px 14px;border-radius:10px;background:#e7f6ee;color:#157f3c;border:1px solid #bfe6cf;display:inline-block}
.ds-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px}
.ds-metric{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:14px 16px}
.ds-mlabel{font-size:11.5px;color:#5b6573;font-weight:600;margin-bottom:8px;min-height:30px}
.ds-mval{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1}
.ds-mval.good{color:#157f3c}.ds-mval.bad{color:#c2384a}.ds-mval.warn{color:#b8860b}
.ds-mci{font-size:11.5px;color:#5b6573;margin-top:8px;font-variant-numeric:tabular-nums}
.ds-two{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;margin-bottom:16px}
.ds-panel{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:16px 18px;min-width:0}
.ds-panel h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6573;margin:0 0 12px;font-weight:700}
.ds-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:#fbf3df;color:#b8860b;border:1px solid #f0e0b0}
.ds-callout{border-left:4px solid #b8860b;background:#fbf3df;border-radius:0 10px 10px 0;padding:12px 14px;font-size:13px;color:#5b4a16}
.ds-h2sub{margin:14px 0 6px;font-size:11.5px;color:#5b6573;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.ds-sigbar{display:flex;height:30px;border-radius:8px;overflow:hidden;border:1px solid #e6e9ef}
.ds-sigbar>div{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;white-space:nowrap}
.ds-smkt{background:#7c8aa5}.ds-sidio{background:#c2384a}
.ds-legend{font-size:11.5px;color:#5b6573;margin-top:8px;display:flex;gap:14px;flex-wrap:wrap}
.ds-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}
.ds-cmp{display:flex;border:1px solid #e6e9ef;border-radius:12px;overflow:hidden;margin-top:14px}
.ds-cmp>div{flex:1;padding:12px 14px}.ds-naive{background:#fafbfc;border-right:1px solid #e6e9ef}
.ds-cmph{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5b6573;font-weight:700;margin-bottom:6px}
.ds-big{font-size:22px;font-weight:700}.ds-cmpn{font-size:11.5px;color:#5b6573;margin-top:4px}
.ds-table{width:100%;border-collapse:collapse;font-size:13px}
.ds-table td,.ds-table th{text-align:left;padding:7px 6px;border-bottom:1px solid #e6e9ef}
.ds-table th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#5b6573}
.ds-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.ds-foot{color:#5b6573;font-size:11.5px;margin-top:10px;line-height:1.6}
.ds-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #e6e9ef;font-size:13px}
.ds-kv b{font-variant-numeric:tabular-nums}
.ds-track{height:8px;background:#eef0f4;border-radius:6px;margin-top:3px}.ds-bar{height:8px;border-radius:6px}
.ds-macro{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end}
.ds-macro h2{width:100%}.ds-mk{font-size:11.5px;color:#5b6573}.ds-mv{font-size:18px;font-weight:700}
@media(max-width:980px){.ds-grid{grid-template-columns:1fr}.ds-metrics{grid-template-columns:repeat(2,1fr)}.ds-two{grid-template-columns:1fr}}
`
