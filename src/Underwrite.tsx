import { useEffect, useMemo, useState } from 'react'
import { Info } from './Info'
import Provenance from './Provenance'
import US from './us-market.json'
import { computeUnderwrite, UNDERWRITE_STORAGE, DEAL_DEFAULTS, isSampleDeal } from './underwrite-lib'
import type { StoredDealInputs } from './underwrite-lib'

// Deal underwriting gates — "liabilities first, then asset returns".
// Tier 1 gates survival (DSCR, exit-cap discipline, leverage, breakeven
// occupancy); Tier 2 measures return quality (unlevered yield, cash-on-cash,
// levered IRR / equity multiple); Tier 3 is debt-structure context with the
// LIVE rate overlay (SOFR, Fed Funds, 10Y, Mortgage 30Y) rather than static
// inputs. Thresholds per the Connected Capital pilot brief — the math lives
// in underwrite-lib.ts, shared with the Combined Verdict tab.

const num = (v: string, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
const usd = (x: number) => '$' + (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1e3) + 'k')
const pct = (x: number, d = 2) => (x * 100).toFixed(d) + '%'

function liveRate(id: string): { v: number; asof: string } | null {
  const s = (US as any).series.find((s: any) => s.id === id)
  return s ? { v: s.latest / 100, asof: s.asof } : null
}

function loadStored(): StoredDealInputs {
  try { return { ...DEAL_DEFAULTS, ...JSON.parse(localStorage.getItem(UNDERWRITE_STORAGE) || '{}') } } catch { return DEAL_DEFAULTS }
}

export default function Underwrite() {
  const stored = useMemo(loadStored, [])
  const [cost, setCost] = useState(stored.cost)
  const [gpi, setGpi] = useState(stored.gpi)
  const [occ, setOcc] = useState(stored.occ)
  const [opex, setOpex] = useState(stored.opex)
  const [loan, setLoan] = useState(stored.loan)
  const [rate, setRate] = useState(stored.rate)
  const [floating, setFloating] = useState(stored.floating)
  const [hasCap, setHasCap] = useState(stored.hasCap)
  const [capStrike, setCapStrike] = useState(stored.capStrike)
  const [io, setIo] = useState(stored.io)
  const [termY, setTermY] = useState(stored.termY)
  const [holdY, setHoldY] = useState(stored.holdY)
  const [exitCap, setExitCap] = useState(stored.exitCap)
  const [noiG, setNoiG] = useState(stored.noiG)

  // persist so the Combined Verdict tab can underwrite the same deal
  useEffect(() => {
    const snap: StoredDealInputs = { cost, gpi, occ, opex, loan, rate, floating, hasCap, capStrike, io, termY, holdY, exitCap, noiG }
    try { localStorage.setItem(UNDERWRITE_STORAGE, JSON.stringify(snap)) } catch { /* private mode */ }
  }, [cost, gpi, occ, opex, loan, rate, floating, hasCap, capStrike, io, termY, holdY, exitCap, noiG])

  const sofr = liveRate('SOFR'), ff = liveRate('FEDFUNDS'), t10 = liveRate('DGS10'), mtg = liveRate('MORTGAGE30US')

  const R = useMemo(() => computeUnderwrite({
    cost: num(cost), gpi: num(gpi), occ: num(occ) / 100, opex: num(opex),
    loan: num(loan), rate: num(rate) / 100, floating, hasCap, capStrike: num(capStrike) / 100, io,
    termY: num(termY), holdY: num(holdY), exitCap: num(exitCap) / 100, noiG: num(noiG) / 100,
  }, t10 ? t10.v : null), [cost, gpi, occ, opex, loan, rate, floating, hasCap, capStrike, io, termY, holdY, exitCap, noiG, t10])

  const VERDICT = {
    pass: { label: 'PASSES TIER-1 GATES', color: '#157f3c', bg: '#f0fdf6' },
    caution: { label: 'PROCEED WITH CAUTION', color: '#b8860b', bg: '#fdf8ec' },
    fail: { label: 'FAILS SURVIVAL GATES', color: '#c2384a', bg: '#fdf2f4' },
  } as const

  const F = ({ label, v, set, suffix, tip }: { label: string; v: string; set: (s: string) => void; suffix?: string; tip?: string }) => (
    <label className="uw-f">{label}{tip && <Info width={240}>{tip}</Info>}
      <span className="uw-in"><input value={v} onChange={e => set(e.target.value)} inputMode="decimal" />{suffix && <i>{suffix}</i>}</span>
    </label>
  )

  const snapshot: StoredDealInputs = { cost, gpi, occ, opex, loan, rate, floating, hasCap, capStrike, io, termY, holdY, exitCap, noiG }
  const sampleDeal = isSampleDeal(snapshot)
  const restoreSample = () => {
    setCost(DEAL_DEFAULTS.cost); setGpi(DEAL_DEFAULTS.gpi); setOcc(DEAL_DEFAULTS.occ); setOpex(DEAL_DEFAULTS.opex)
    setLoan(DEAL_DEFAULTS.loan); setRate(DEAL_DEFAULTS.rate); setFloating(DEAL_DEFAULTS.floating); setHasCap(DEAL_DEFAULTS.hasCap)
    setCapStrike(DEAL_DEFAULTS.capStrike); setIo(DEAL_DEFAULTS.io); setTermY(DEAL_DEFAULTS.termY); setHoldY(DEAL_DEFAULTS.holdY)
    setExitCap(DEAL_DEFAULTS.exitCap); setNoiG(DEAL_DEFAULTS.noiG)
  }

  return (
    <div className="uw-root">
      <style>{CSS}</style>
      {sampleDeal ? (
        <Provenance kind="sample">
          Pre-filled with a <b>fictional deal</b> — &ldquo;Palmetto Court Apartments&rdquo;, a $5M Sun Belt value-add
          (Beacon Harbor Real Estate Partners, the same fictional sponsor as the DDQ sample) — so the gates have
          something to evaluate. Every number is yours to change; try dropping the exit cap below the going-in cap
          to watch the discipline gate reject the deal.
        </Provenance>
      ) : (
        <div className="uw-yourdeal">
          Underwriting <b>your deal</b> (saved in this browser, never uploaded).{' '}
          <button className="uw-prefill" onClick={restoreSample}>restore the fictional sample deal</button>
        </div>
      )}
      <div className="uw-rates">
        <span className="uw-rlabel">Live rate overlay <Info width={250}>Pulled from the platform's FRED refresh — the macro context every deal is gated against, not a static input. As-of dates shown per series.</Info></span>
        {sofr && <span className="uw-chip">SOFR <b>{(sofr.v * 100).toFixed(2)}%</b></span>}
        {ff && <span className="uw-chip">Fed Funds <b>{(ff.v * 100).toFixed(2)}%</b></span>}
        {t10 && <span className="uw-chip">10Y UST <b>{(t10.v * 100).toFixed(2)}%</b></span>}
        {mtg && <span className="uw-chip">Mtg 30Y <b>{(mtg.v * 100).toFixed(2)}%</b></span>}
        {floating && sofr && <button className="uw-prefill" onClick={() => setRate(((sofr.v + 0.0275) * 100).toFixed(2))}>set rate = SOFR + 275bps</button>}
      </div>

      <div className="uw-grid">
        <aside className="uw-form">
          <h3>The asset</h3>
          <F label="Total acquisition cost" v={cost} set={setCost} suffix="$" />
          <F label="Gross potential income (Y1)" v={gpi} set={setGpi} suffix="$" tip="All-units-occupied annual income before vacancy and expenses." />
          <F label="Occupancy" v={occ} set={setOcc} suffix="%" />
          <F label="Operating expenses (Y1)" v={opex} set={setOpex} suffix="$" />
          <div className="uw-derived">NOI (derived): <b>{R ? usd(R.noi) : '—'}</b> · going-in cap <b>{R ? pct(R.goingIn) : '—'}</b></div>

          <h3>The liabilities</h3>
          <F label="Loan amount" v={loan} set={setLoan} suffix="$" />
          <F label="Interest rate" v={rate} set={setRate} suffix="%" />
          <div className="uw-row">
            <label><input type="checkbox" checked={floating} onChange={e => setFloating(e.target.checked)} /> floating rate</label>
            {floating && <label><input type="checkbox" checked={hasCap} onChange={e => setHasCap(e.target.checked)} /> rate cap</label>}
            {floating && hasCap && <span className="uw-in" style={{ width: 90 }}><input value={capStrike} onChange={e => setCapStrike(e.target.value)} /><i>% strike</i></span>}
          </div>
          <div className="uw-row">
            <label><input type="checkbox" checked={io} onChange={e => setIo(e.target.checked)} /> interest-only</label>
            {!io && <span className="uw-mut">30-yr amortization assumed</span>}
          </div>
          <F label="Loan term" v={termY} set={setTermY} suffix="yrs" />

          <h3>The plan</h3>
          <F label="Hold period" v={holdY} set={setHoldY} suffix="yrs" />
          <F label="Exit cap rate" v={exitCap} set={setExitCap} suffix="%" tip="What the buyer of your stabilized asset will pay. Demanding exit ≥ going-in is the discipline gate below." />
          <F label="NOI growth" v={noiG} set={setNoiG} suffix="%/yr" />
        </aside>

        <main className="uw-results">
          {!R && <div className="uw-err">Enter a positive cost, income and NOI to underwrite.</div>}
          {R && (
            <>
              <div className="uw-verdict" style={{ background: VERDICT[R.verdict as keyof typeof VERDICT].bg, borderColor: VERDICT[R.verdict as keyof typeof VERDICT].color }}>
                <span style={{ color: VERDICT[R.verdict as keyof typeof VERDICT].color }}>{VERDICT[R.verdict as keyof typeof VERDICT].label}</span>
                <span className="uw-vnote">Liabilities first: no single metric decides, but a Tier-1 failure means the deal can die before the upside matters.</span>
              </div>

              <h3>Tier 1 — survival gates</h3>
              <div className="uw-gates">
                {R.gates.map(g => (
                  <div className={`uw-gate ${g.status}`} key={g.name}>
                    <div className="uw-gname">{g.name} <Info width={250} below>{g.tip}</Info></div>
                    <div className="uw-gval">{g.value}</div>
                    <div className="uw-gnote">{g.note}</div>
                  </div>
                ))}
              </div>

              <h3>Tier 2 — return quality</h3>
              <div className="uw-t2">
                <div><span className="uw-mlabel">Going-in unlevered yield <Info width={230}>Year-1 NOI ÷ total acquisition cost — the margin-of-safety number.</Info></span><b>{pct(R.goingIn)}</b></div>
                <div><span className="uw-mlabel">Cash-on-cash (Y1)</span><b>{R.coc != null ? pct(R.coc, 1) : '—'}</b></div>
                <div><span className="uw-mlabel">Levered IRR ({holdY}y)</span><b>{R.leveredIrr != null ? pct(R.leveredIrr, 1) : '—'}</b></div>
                <div><span className="uw-mlabel">Equity multiple</span><b>{R.multiple != null ? R.multiple.toFixed(2) + '×' : '—'}</b></div>
                <div><span className="uw-mlabel">Cap spread vs 10Y UST <Info width={240}>Going-in cap minus the 10-year Treasury (live). A thin spread means you're barely paid over the risk-free rate for taking real-estate risk.</Info></span>
                  <b style={{ color: R.spread10 != null && R.spread10 < 0.015 ? '#c2384a' : 'inherit' }}>{R.spread10 != null ? (R.spread10 * 100).toFixed(0) + 'bps' : '—'}</b></div>
                <div><span className="uw-mlabel">Debt service (annual)</span><b>{usd(R.ads)}</b></div>
              </div>

              <p className="uw-foot">
                Sale assumes year-{holdY} exit at the stated exit cap on year-{num(holdY) + 1} NOI, 2% selling costs, loan balance repaid.
                Cap rate and cash-on-cash describe the deal at a moment; DSCR and exit-cap discipline tell you whether it survives.
                Combine with the market's Deal Score (price-history risk) and the Risk Model scorecard (sponsor risk) — deal, asset, market, manager.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

const CSS = `
.uw-root{max-width:1100px}
.uw-rates{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:14px;font-size:.8rem}
.uw-rlabel{font-weight:700}
.uw-chip{background:var(--accent-soft);border:1px solid #dbe2fb;border-radius:999px;padding:2px 10px;color:var(--text)}
.uw-chip b{color:var(--accent)}
.uw-prefill{margin-left:auto;font-size:.72rem;padding:4px 10px}
.uw-yourdeal{font-size:.78rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.uw-yourdeal .uw-prefill{margin-left:0}
.uw-grid{display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start}
@media(max-width:900px){.uw-grid{grid-template-columns:1fr}}
.uw-form{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.uw-form h3{margin:14px 0 6px;font-size:.85rem}
.uw-form h3:first-child{margin-top:0}
.uw-f{display:block;font-size:.78rem;margin:7px 0;color:var(--text)}
.uw-in{display:flex;align-items:center;gap:6px;margin-top:3px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0 8px}
.uw-in input{flex:1;border:none;outline:none;padding:.4rem 0;background:transparent;font-size:.85rem;min-width:0}
.uw-in i{font-style:normal;color:var(--muted);font-size:.72rem}
.uw-derived{font-size:.76rem;color:var(--muted);margin:8px 0;padding:6px 8px;background:var(--surface-2);border-radius:6px}
.uw-row{display:flex;gap:14px;align-items:center;font-size:.78rem;margin:6px 0;flex-wrap:wrap}
.uw-mut{color:var(--muted);font-size:.72rem}
.uw-results{min-width:0}
.uw-err{padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--muted)}
.uw-verdict{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border:1.5px solid;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-weight:800;font-size:1rem}
.uw-vnote{font-weight:400;font-size:.74rem;color:var(--muted)}
.uw-results h3{margin:14px 0 8px;font-size:.9rem}
.uw-gates{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
.uw-gate{border:1px solid var(--border);border-left-width:4px;border-radius:9px;padding:9px 11px;background:var(--surface)}
.uw-gate.pass{border-left-color:#157f3c}
.uw-gate.flag{border-left-color:#b8860b}
.uw-gate.fail{border-left-color:#c2384a;background:#fdf2f4}
.uw-gate.na{border-left-color:#c2c8d2;opacity:.7}
.uw-gname{font-size:.74rem;font-weight:700;color:var(--muted)}
.uw-gval{font-size:1.15rem;font-weight:800;margin:2px 0}
.uw-gate.fail .uw-gval{color:#c2384a}
.uw-gate.flag .uw-gval{color:#b8860b}
.uw-gnote{font-size:.7rem;color:var(--muted)}
.uw-t2{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.uw-t2>div{display:flex;flex-direction:column;font-size:.95rem}
.uw-t2 b{font-size:1.05rem}
.uw-mlabel{font-size:.7rem;color:var(--muted)}
.uw-foot{font-size:.72rem;color:var(--muted);margin-top:12px;line-height:1.5}
`
