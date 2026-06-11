import { useMemo, useState } from 'react'
import { Info } from './Info'
import Provenance from './Provenance'
import US from './us-market.json'

// Deal underwriting gates — "liabilities first, then asset returns".
// Tier 1 gates survival (DSCR, exit-cap discipline, leverage, breakeven
// occupancy); Tier 2 measures return quality (unlevered yield, cash-on-cash,
// levered IRR / equity multiple); Tier 3 is debt-structure context with the
// LIVE rate overlay (SOFR, Fed Funds, 10Y, Mortgage 30Y) rather than static
// inputs. Thresholds per the Connected Capital pilot brief.

const num = (v: string, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
const usd = (x: number) => '$' + (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x / 1e3) + 'k')
const pct = (x: number, d = 2) => (x * 100).toFixed(d) + '%'

function liveRate(id: string): { v: number; asof: string } | null {
  const s = (US as any).series.find((s: any) => s.id === id)
  return s ? { v: s.latest / 100, asof: s.asof } : null
}

// annual debt service: interest-only or 30-year amortizing
function annualDebtService(loan: number, rate: number, io: boolean): number {
  if (loan <= 0 || rate <= 0) return 0
  if (io) return loan * rate
  const r = rate / 12, n = 360
  return (loan * r / (1 - Math.pow(1 + r, -n))) * 12
}

function loanBalanceAfter(loan: number, rate: number, io: boolean, years: number): number {
  if (io) return loan
  const r = rate / 12, n = 360, k = Math.min(n, Math.round(years * 12))
  const pmt = loan * r / (1 - Math.pow(1 + r, -n))
  return loan * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r
}

function irr(cashflows: number[]): number | null {
  // bisection on [-0.99, 5]
  const npv = (r: number) => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0)
  let lo = -0.99, hi = 5
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid
  }
  return (lo + hi) / 2
}

type GateStatus = 'pass' | 'flag' | 'fail' | 'na'
interface Gate { name: string; status: GateStatus; value: string; note: string; tip: string }

export default function Underwrite() {
  const [cost, setCost] = useState('5000000')
  const [gpi, setGpi] = useState('620000')
  const [occ, setOcc] = useState('93')
  const [opex, setOpex] = useState('210000')
  const [loan, setLoan] = useState('3250000')
  const [rate, setRate] = useState('6.25')
  const [floating, setFloating] = useState(false)
  const [hasCap, setHasCap] = useState(false)
  const [capStrike, setCapStrike] = useState('8.0')
  const [io, setIo] = useState(true)
  const [termY, setTermY] = useState('5')
  const [holdY, setHoldY] = useState('5')
  const [exitCap, setExitCap] = useState('7.5')
  const [noiG, setNoiG] = useState('2.5')

  const sofr = liveRate('SOFR'), ff = liveRate('FEDFUNDS'), t10 = liveRate('DGS10'), mtg = liveRate('MORTGAGE30US')

  const R = useMemo(() => {
    const C = num(cost), G = num(gpi), O = num(occ) / 100, X = num(opex)
    const L = num(loan), r = num(rate) / 100, eCap = num(exitCap) / 100, g = num(noiG) / 100
    const term = num(termY), hold = num(holdY)
    const noi = G * O - X
    if (C <= 0 || G <= 0 || noi <= 0) return null

    const goingIn = noi / C
    const ads = annualDebtService(L, r, io)
    const dscr = ads > 0 ? noi / ads : Infinity
    const ltc = L / C
    const debtYield = L > 0 ? noi / L : Infinity
    const breakevenOcc = G > 0 ? (X + ads) / G : 0
    const occMargin = O - breakevenOcc
    const spread10 = t10 ? goingIn - t10.v : null

    // floating stress: +200bps, bounded by the cap strike if one exists
    const stressRate = floating ? Math.min(r + 0.02, hasCap ? num(capStrike) / 100 : Infinity) : r
    const stressAds = annualDebtService(L, stressRate, io)
    const stressDscr = stressAds > 0 ? noi / stressAds : Infinity

    // Tier 2: hold-period cashflows
    const equity = C - L
    const coc = equity > 0 ? (noi - ads) / equity : null
    const cfs: number[] = [-equity]
    let noiT = noi
    for (let t = 1; t <= hold; t++) {
      noiT = noi * Math.pow(1 + g, t)
      let cf = noiT - ads
      if (t === hold) {
        const sale = (noi * Math.pow(1 + g, hold + 1)) / eCap
        cf += sale * 0.98 - loanBalanceAfter(L, r, io, hold) // 2% selling costs
      }
      cfs.push(cf)
    }
    const leveredIrr = equity > 0 ? irr(cfs) : null
    const inflows = cfs.slice(1).reduce((s, x) => s + Math.max(0, x), 0)
    const multiple = equity > 0 ? inflows / equity : null

    const gates: Gate[] = [
      {
        name: 'DSCR', tip: 'Net operating income ÷ annual debt service. Below ~1.20–1.25× the asset barely covers its debt — the first survival gate.',
        value: dscr === Infinity ? 'no debt' : dscr.toFixed(2) + '×',
        status: L <= 0 ? 'na' : dscr < 1.20 ? 'fail' : dscr < 1.25 ? 'flag' : 'pass',
        note: L <= 0 ? 'unlevered' : dscr < 1.20 ? 'below 1.20× — debt service not safely covered' : dscr < 1.25 ? 'thin coverage (1.20–1.25×)' : 'covers debt with margin',
      },
      {
        name: 'Exit-cap discipline', tip: 'The most abused assumption in RE underwriting. Demand exit cap ≥ going-in cap; deals that only work on cap compression are rejected.',
        value: `${pct(eCap, 2)} vs ${pct(goingIn, 2)} in`,
        status: eCap >= goingIn ? 'pass' : 'fail',
        note: eCap >= goingIn ? 'no cap compression assumed' : 'underwritten on cap compression — reject or re-underwrite',
      },
      {
        name: 'Leverage (LTC)', tip: 'Loan ÷ total cost. Above ~0.75 is aggressive for this cycle; above 0.85 leaves no margin for error.',
        value: pct(ltc, 0),
        status: L <= 0 ? 'na' : ltc > 0.85 ? 'fail' : ltc > 0.75 ? 'flag' : 'pass',
        note: ltc > 0.85 ? 'extreme leverage' : ltc > 0.75 ? 'aggressive leverage' : 'reasonable leverage',
      },
      {
        name: 'Breakeven occupancy', tip: 'Occupancy at which income exactly covers opex + debt service. The gap to current occupancy is how far income can fall.',
        value: pct(breakevenOcc, 0) + ` (now ${pct(O, 0)})`,
        status: L <= 0 ? 'na' : breakevenOcc >= O ? 'fail' : occMargin < 0.075 ? 'flag' : 'pass',
        note: breakevenOcc >= O ? 'already below breakeven' : occMargin < 0.075 ? `only ${(occMargin * 100).toFixed(1)}pp of cushion` : `${(occMargin * 100).toFixed(1)}pp occupancy cushion`,
      },
      {
        name: 'Loan maturity vs hold', tip: 'A loan that matures before the hold ends forces a refinance at unknown rates — in this cycle, RE risk is overwhelmingly a rates-and-refi story.',
        value: `${term}y loan / ${hold}y hold`,
        status: L <= 0 ? 'na' : term < hold ? (floating && !hasCap ? 'fail' : 'flag') : 'pass',
        note: term < hold ? 'refi dependence inside the hold' + (floating && !hasCap ? ' on unhedged floating debt' : '') : 'debt outlasts the hold',
      },
      {
        name: 'Debt yield', tip: "NOI ÷ loan — the lender's cross-check on leverage; most lenders want ≥ 10%.",
        value: debtYield === Infinity ? 'no debt' : pct(debtYield, 1),
        status: L <= 0 ? 'na' : debtYield < 0.08 ? 'fail' : debtYield < 0.10 ? 'flag' : 'pass',
        note: debtYield < 0.08 ? 'below lender floors' : debtYield < 0.10 ? 'thin for most lenders' : 'lender-comfortable',
      },
      ...(floating ? [{
        name: 'Rate stress (+200bps)', tip: hasCap ? 'Floating-rate DSCR with rates 200bps higher, bounded by your rate cap.' : 'Floating-rate DSCR with rates 200bps higher — unhedged.',
        value: stressDscr.toFixed(2) + '×',
        status: (stressDscr < 1.0 ? 'fail' : stressDscr < 1.2 ? 'flag' : 'pass') as GateStatus,
        note: stressDscr < 1.0 ? 'underwater if rates rise 200bps' : stressDscr < 1.2 ? 'thin under rate stress' : 'survives +200bps',
      }] : []),
    ]

    const anyFail = gates.some(gt => gt.status === 'fail')
    const anyFlag = gates.some(gt => gt.status === 'flag')
    return {
      noi, goingIn, ads, dscr, ltc, debtYield, breakevenOcc, spread10, equity, coc, leveredIrr, multiple, gates,
      verdict: anyFail ? 'fail' : anyFlag ? 'caution' : 'pass',
    }
  }, [cost, gpi, occ, opex, loan, rate, floating, hasCap, capStrike, io, termY, holdY, exitCap, noiG])

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

  return (
    <div className="uw-root">
      <style>{CSS}</style>
      <Provenance kind="sample">
        Pre-filled with a <b>fictional deal</b> — &ldquo;Palmetto Court Apartments&rdquo;, a $5M Sun Belt value-add
        (Beacon Harbor Real Estate Partners, the same fictional sponsor as the DDQ sample) — so the gates have
        something to evaluate. Every number is yours to change; try dropping the exit cap below the going-in cap
        to watch the discipline gate reject the deal.
      </Provenance>
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
