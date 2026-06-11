import { useMemo, useState } from 'react'

// "How It Works" — a step-by-step walkthrough of the scoring engine for anyone
// who wants to understand (not just trust) the numbers. Every claim mirrors the
// real engine in netlify/functions/lib/engine.ts; the interactive panel runs a
// miniature version of the same algorithm live in the browser, so turning the
// step-3 dials visibly changes the step-4 paths, step-5 histogram and step-6
// sizing. Production differences are stated where they matter (20,000 paths
// there, 2,000 here).

// ---- a small, fixed pool of quarterly total returns (price + rent carry) ----
// Illustrative but realistic: mostly modest positive quarters with a 2008-style
// drawdown stretch — the kind of pool step 2 produces after de-smoothing.
// Recentred/rescaled to a deal-level profile (~13%/yr drift, ~8.5%/yr vol) so
// the default histogram shows a genuine hit-or-miss split around a 15% target.
const RAW = [
  0.021, 0.018, 0.025, 0.012, 0.030, 0.022, 0.015, 0.028,
  0.035, 0.027, 0.019, 0.024, 0.016, 0.029, 0.033, 0.020,
  0.011, 0.026, 0.031, 0.014, -0.004, 0.018, 0.022, 0.027,
  0.038, 0.024, 0.013, 0.021, -0.012, -0.028, -0.052, -0.078,
  -0.061, -0.043, -0.019, -0.006, 0.008, 0.017, 0.026, 0.034,
  0.041, 0.029, 0.018, 0.012, 0.023, 0.027, 0.020, 0.015,
  0.031, 0.036, 0.022, 0.009, -0.008, 0.014, 0.025, 0.030,
  0.019, 0.023, 0.028, 0.017, 0.012, 0.026, 0.021, 0.024,
]
const RAW_MEAN = RAW.reduce((s, x) => s + x, 0) / RAW.length
const POOL = RAW.map(x => 0.0315 + 1.8 * (x - RAW_MEAN))

// Same seeded RNG family as the real engine — same inputs, same outputs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length)
}

// Shape-preserving tilt — the same recenter/rescale the engine applies (step 3).
function tiltPool(pool: number[], biasMuAnnual: number, sigmaMult: number): number[] {
  const muP = mean(pool)
  const muAnnCur = Math.pow(1 + muP, 4) - 1
  const base = 1 + muAnnCur + biasMuAnnual
  const targetMuP = base > 0 ? Math.pow(base, 1 / 4) - 1 : muP + biasMuAnnual / 4
  const shift = targetMuP - muP
  return pool.map(x => Math.max(muP + sigmaMult * (x - muP) + shift, -0.999))
}

const HOLD_YEARS = 5
const QUARTERS = HOLD_YEARS * 4
const N_SIMS = 2000
const TARGET = 0.15
const RF = 0.04

interface SimResult {
  irrs: number[]
  paths: number[][] // a handful of cumulative-value trajectories for the chart
  pTarget: number
  median: number
  pLoss: number
  q5: number // 5th-percentile IRR — 1 in 20 lifetimes ends below this
  expected: number
  sigmaAnn: number
}

function runSim(biasMu: number, sigmaMult: number): SimResult {
  const pool = tiltPool(POOL, biasMu, sigmaMult)
  const rng = mulberry32(20260611)
  const irrs: number[] = new Array(N_SIMS)
  const paths: number[][] = []
  for (let s = 0; s < N_SIMS; s++) {
    let cum = 0
    const keep = s < 14
    const traj: number[] = keep ? [1] : []
    for (let q = 0; q < QUARTERS; q++) {
      cum += Math.log1p(pool[(rng() * pool.length) | 0])
      if (keep) traj.push(Math.exp(cum))
    }
    if (keep) paths.push(traj)
    irrs[s] = Math.pow(Math.exp(cum), 1 / HOLD_YEARS) - 1
  }
  const sorted = [...irrs].sort((a, b) => a - b)
  const q5 = sorted[Math.floor(0.05 * sorted.length)]
  return {
    irrs,
    paths,
    pTarget: irrs.filter(x => x >= TARGET).length / N_SIMS,
    median: sorted[Math.floor(sorted.length / 2)],
    pLoss: irrs.filter(x => x < 0).length / N_SIMS,
    q5,
    expected: mean(irrs),
    sigmaAnn: std(pool) * 2, // quarterly sigma × √4
  }
}

// ---- step-2 demo data: what smoothing hides --------------------------------
// "Reported" = the pool re-smoothed the way appraisal/index data arrives
// (each print echoes the last). The red line is the ENGINE'S OWN correction
// applied to that reported series — measured echo, capped at 0.6, reversed —
// exactly geltnerUnsmooth() from netlify/functions/lib/engine.ts.
const SMOOTH_A = 0.6
const GELTNER_A_CAP = 0.6
const REPORTED: number[] = (() => {
  const out: number[] = [POOL[0]]
  for (let i = 1; i < POOL.length; i++) out.push(SMOOTH_A * out[i - 1] + (1 - SMOOTH_A) * POOL[i])
  return out
})()
function lag1(r: number[]): number {
  const r0 = r.slice(0, -1), r1 = r.slice(1)
  const m0 = mean(r0), m1 = mean(r1)
  const denom = std(r0) * std(r1)
  if (denom === 0) return 0
  let cov = 0
  for (let i = 0; i < r0.length; i++) cov += (r0[i] - m0) * (r1[i] - m1)
  return cov / r0.length / denom
}
const MEASURED_ECHO = lag1(REPORTED)
const DESMOOTHED: number[] = (() => {
  const a = Math.min(MEASURED_ECHO, GELTNER_A_CAP)
  const out: number[] = []
  for (let i = 1; i < REPORTED.length; i++) out.push((REPORTED[i] - a * REPORTED[i - 1]) / (1 - a))
  return out
})()
const SIGMA_TRUE_ANN = std(POOL) * 2
const SIGMA_REPORTED_ANN = std(REPORTED) * 2
const SIGMA_DESMOOTHED_ANN = std(DESMOOTHED) * 2

// cumulative price path for the step-1 chart
const PRICE_PATH: number[] = (() => {
  const out = [1]
  for (const r of POOL) out.push(out[out.length - 1] * (1 + r))
  return out
})()

// ---- tiny SVG helpers -------------------------------------------------------
function linePath(values: number[], w: number, h: number, yMin: number, yMax: number): string {
  const n = values.length
  return values
    .map((v, i) => {
      const x = (i / (n - 1)) * w
      const clamped = Math.min(Math.max(v, yMin), yMax)
      const y = h - ((clamped - yMin) / (yMax - yMin)) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`

// ---- the page ---------------------------------------------------------------
export default function EngineExplainer() {
  const [biasMu, setBiasMu] = useState(0)
  const [sigmaMult, setSigmaMult] = useState(1)
  const sim = useMemo(() => runSim(biasMu, sigmaMult), [biasMu, sigmaMult])

  // histogram of simulated IRRs
  const hist = useMemo(() => {
    const lo = -0.25, hi = 0.45, nb = 28
    const bw = (hi - lo) / nb
    const counts = new Array(nb).fill(0)
    for (const x of sim.irrs) {
      const idx = Math.min(nb - 1, Math.max(0, Math.floor((x - lo) / bw)))
      counts[idx]++
    }
    const max = Math.max(...counts)
    return { lo, hi, nb, bw, counts, max }
  }, [sim])

  // half-Kelly sizing from the live sim (mirrors kellyPosition in the engine,
  // including production's deal-specific risk floor — without it the demo
  // allocation would be pinned at the cap for every dial setting)
  const kelly = useMemo(() => {
    const IDIO = 0.18 // deal-specific volatility production adds on top of market risk
    const sigmaK = Math.sqrt(sim.sigmaAnn * sim.sigmaAnn + IDIO * IDIO)
    const edge = sim.expected - RF
    if (edge <= 0) return { position: 0, verdict: 'PASS — no advantage over the risk-free rate' }
    const raw = edge / (sigmaK * sigmaK)
    const position = Math.min(0.5 * raw, 0.25)
    return { position, verdict: position >= 0.25 ? 'INVEST (capped at 25%)' : 'INVEST' }
  }, [sim])

  return (
    <div className="eg-root">
      <style>{CSS}</style>

      <header className="eg-head">
        <h1>How the scoring engine works</h1>
        <p>
          Six steps from raw market history to &ldquo;probability this deal hits its target.&rdquo; Each step says
          what happens and <em>why it&rsquo;s done that way</em>. The dials in step&nbsp;3 are live — turn them and
          watch steps 4, 5 and 6 change. This page runs a miniature of the production engine (2,000 simulated
          outcomes here vs 20,000 there; same algorithm, same kind of randomness, fully reproducible).
        </p>
      </header>

      {/* STEP 1 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">1</span><h2>Start from real history, not assumptions</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              When a deal is scored in a market — say Miami — the engine pulls that market&rsquo;s actual quarterly
              price history (one of 20,216 U.S. metros, counties and cities) and adds a rent-income carry, so each
              quarter reflects the <b>total</b> return of holding property there: price change plus net rent.
            </p>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              Every forecast has to start somewhere. Starting from observed history — including the bad years —
              means the model&rsquo;s idea of &ldquo;what can happen&rdquo; was learned from things that <b>did</b> happen,
              not from someone&rsquo;s optimistic spreadsheet assumption.
            </p>
          </div>
        </div>
        <svg viewBox="0 0 560 120" className="eg-chart" role="img" aria-label="A market total-return history (price plus rent) over time, including a visible 2008-style drawdown">
          <path d={linePath(PRICE_PATH, 540, 100, Math.min(...PRICE_PATH) * 0.97, Math.max(...PRICE_PATH) * 1.02)} fill="none" stroke="#3b5bdb" strokeWidth="2" transform="translate(10,8)" />
          <text x="300" y="116" className="eg-cap" textAnchor="middle">16 years of quarterly total returns shown here (production histories run ~26 years per market) — the crash quarters stay in</text>
        </svg>
      </section>

      {/* STEP 2 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">2</span><h2>Un-smooth it — recover the risk the data hides</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              Index and appraisal-based data arrive artificially calm — an index print blends many sales and
              appraisals, so each quarter carries old information and partly echoes the one before it. The engine
              measures that echo (the correlation between one quarter and the next) and reverses it:
              <code>true&nbsp;=&nbsp;(this&nbsp;quarter&nbsp;−&nbsp;echo&nbsp;×&nbsp;last&nbsp;quarter)&nbsp;/&nbsp;(1&nbsp;−&nbsp;echo)</code>.
              The echo factor is capped at 0.6: on heavily smoothed series the engine deliberately
              under-corrects rather than risk inventing volatility that was never there.
            </p>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              Underwriting against smoothed data is how investors end up surprised: the swings were real, the data
              just averaged them away. De-smoothing roughly <b>doubles</b> measured volatility for heavily smoothed
              series — that&rsquo;s the honest number to size risk against. (This is the Geltner correction, standard
              in institutional real-estate research.)
            </p>
          </div>
        </div>
        <svg viewBox="0 0 560 130" className="eg-chart" role="img" aria-label="Two return series: the reported one is visibly damped; the engine's de-smoothing correction recovers wider swings">
          <path d={linePath(REPORTED, 540, 90, -0.16, 0.09)} fill="none" stroke="#9aa4b5" strokeWidth="1.8" transform="translate(10,10)" />
          <path d={linePath(DESMOOTHED, 540, 90, -0.16, 0.09)} fill="none" stroke="#c2384a" strokeWidth="1.6" opacity="0.85" transform="translate(10,10)" />
          <text x="14" y="14" className="eg-cap" fill="#7d8694">reported (smoothed) — looks like σ ≈ {fmtPct(SIGMA_REPORTED_ANN)}/yr</text>
          <text x="14" y="28" className="eg-cap" fill="#c2384a">after the engine&rsquo;s capped correction — σ ≈ {fmtPct(SIGMA_DESMOOTHED_ANN)}/yr</text>
          <text x="300" y="126" className="eg-cap" textAnchor="middle">the red line is the engine&rsquo;s own formula applied to the gray one (measured echo ≈ {MEASURED_ECHO.toFixed(2)}, capped at 0.6) — true σ of this series: {fmtPct(SIGMA_TRUE_ANN)}/yr, recovered without overshooting</text>
        </svg>
      </section>

      {/* STEP 3 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">3</span><h2>Tilt for deal quality — judgment with guardrails</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              Due-diligence answers — sponsor track record, leverage, business-plan risk, alignment — convert into
              three dials: a <b>return tilt</b> (shifts the whole distribution up or down, capped at ±10%/yr),
              a <b>risk multiplier</b> (stretches or compresses it, bounded 0.6×–2.5×), and a <b>portfolio-overlap</b>
              dial (0–0.95, used at the sizing step — step 6). A first-time sponsor at 80% leverage gets the same
              market history, shifted down and stretched wider. Before sizing, production also adds a small
              market &ldquo;yield edge&rdquo; (at most ±0.30%/yr) and a deal-specific volatility floor.
            </p>
            <div className="eg-dials">
              <label>
                Return tilt <b>{biasMu >= 0 ? '+' : ''}{fmtPct(biasMu)}/yr</b>
                <input type="range" min={-0.1} max={0.1} step={0.005} value={biasMu}
                  onChange={e => setBiasMu(parseFloat(e.target.value))} />
              </label>
              <label>
                Risk multiplier <b>{sigmaMult.toFixed(2)}×</b>
                <input type="range" min={0.6} max={2.5} step={0.1} value={sigmaMult}
                  onChange={e => setSigmaMult(parseFloat(e.target.value))} />
              </label>
              <div className="eg-dialnote">
                Live — steps 4, 5 and 6 below recompute as you move these. The ranges are the production caps
                (tilt ±10%/yr, risk 0.6×–2.5×). Drag the return tilt deep negative and watch step 6 say no.
              </div>
            </div>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              Qualitative judgment matters, but it shouldn&rsquo;t be able to <b>manufacture</b> a good score. Bounded
              dials mean judgment can tilt the evidence, never replace it — and every adjustment is auditable: you
              can point at each answer and say exactly how much it moved the forecast. The shape of the history —
              including its extreme quarters — is preserved; only its center and width move.
            </p>
          </div>
        </div>
      </section>

      {/* STEP 4 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">4</span><h2>Live through thousands of alternate futures</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              The engine simulates the deal&rsquo;s life {N_SIMS.toLocaleString()} times here
              (20,000 in production). Each run draws random <b>real quarters</b> from the tilted history — with
              replacement, so a crash can land early, late, twice, or not at all — compounds them across the
              {' '}{HOLD_YEARS}-year hold, and records the resulting annualized return (IRR).
            </p>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              No bell-curve assumption. A bell curve says extreme outcomes die off at a fixed, rapid rate — a
              quarter like late 2008 is so many widths from average that the curve treats it as
              once-in-thousands-of-years, yet markets produce one most decades. Because the simulation resamples
              quarters that actually occurred, those crash quarters appear in simulated futures at their real
              historical frequency — the model can&rsquo;t talk itself out of the bad years.
            </p>
          </div>
        </div>
        <svg viewBox="0 0 560 150" className="eg-chart" role="img" aria-label="Fourteen simulated value paths fanning out over the hold period, with a dashed target-pace line">
          {sim.paths.map((traj, i) => (
            <path key={i} d={linePath(traj, 540, 120, 0.4, 3.2)} fill="none"
              stroke={i === 0 ? '#3b5bdb' : '#8fa3e8'} strokeWidth={i === 0 ? 2 : 1} opacity={i === 0 ? 1 : 0.45}
              transform="translate(10,8)" />
          ))}
          <line x1="10" x2="550" y1={8 + 120 - ((Math.pow(1 + TARGET, HOLD_YEARS) - 0.4) / (3.2 - 0.4)) * 120}
            y2={8 + 120 - ((Math.pow(1 + TARGET, HOLD_YEARS) - 0.4) / (3.2 - 0.4)) * 120}
            stroke="#157f3c" strokeDasharray="5 4" strokeWidth="1.4" />
          <text x="546" y={4 + 120 - ((Math.pow(1 + TARGET, HOLD_YEARS) - 0.4) / (3.2 - 0.4)) * 120}
            className="eg-cap" fill="#157f3c" textAnchor="end">target pace ({fmtPct(TARGET, 0)}/yr)</text>
          <text x="300" y="146" className="eg-cap" textAnchor="middle">14 of the {N_SIMS.toLocaleString()} simulated lifetimes — each one a different shuffle of real quarters</text>
        </svg>
      </section>

      {/* STEP 5 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">5</span><h2>Count the outcomes — that&rsquo;s the score</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              Line up all the simulated IRRs and just count. The probability of hitting the target is literally the
              fraction of simulated lifetimes that did. The same pile of outcomes gives the median return, the chance
              of losing money, and two worst-case yardsticks: the level the bottom 5% of lifetimes falls below
              (<b>Value at Risk</b>, VaR) and the average within that worst slice (CVaR) — the &ldquo;how bad is
              bad&rdquo; numbers.
            </p>
            <p>
              Production adds one more honesty layer: it rebuilds the pool of quarters ~200 times by resampling —
              as if history had dealt a slightly different hand — and re-runs the whole simulation each time. The
              spread of those 200 answers becomes the <b>confidence interval</b>. Thin or noisy history → wide
              intervals → the app&rsquo;s confidence score drops and tells you to lean on the range, not the point
              estimate.
            </p>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              A single projected IRR hides everything that matters. A distribution shows the trade at a glance:
              two deals with the same &ldquo;expected 18%&rdquo; can have wildly different chances of disaster. Counting
              simulated outcomes also keeps the math explainable — there is no black box between the histogram and
              the headline probability.
            </p>
          </div>
        </div>
        <svg viewBox="0 0 560 170" className="eg-chart" role="img" aria-label="Histogram of simulated returns with loss region, sub-target region and above-target region shaded differently">
          {hist.counts.map((c, i) => {
            const x = 10 + (i / hist.nb) * 540
            const bh = hist.max ? (c / hist.max) * 120 : 0
            const binLo = hist.lo + i * hist.bw
            const color = binLo + hist.bw <= 0 ? '#c2384a' : binLo >= TARGET ? '#157f3c' : '#b9c2d4'
            return <rect key={i} x={x} y={132 - bh} width={540 / hist.nb - 2} height={bh} fill={color} rx="1.5" />
          })}
          <line x1={10 + ((TARGET - hist.lo) / (hist.hi - hist.lo)) * 540} x2={10 + ((TARGET - hist.lo) / (hist.hi - hist.lo)) * 540}
            y1="6" y2="134" stroke="#157f3c" strokeDasharray="5 4" strokeWidth="1.4" />
          <line x1={10 + ((0 - hist.lo) / (hist.hi - hist.lo)) * 540} x2={10 + ((0 - hist.lo) / (hist.hi - hist.lo)) * 540}
            y1="6" y2="134" stroke="#c2384a" strokeDasharray="3 4" strokeWidth="1" />
          <text x={14 + ((TARGET - hist.lo) / (hist.hi - hist.lo)) * 540} y="16" className="eg-cap" fill="#157f3c">target {fmtPct(TARGET, 0)}</text>
          <text x={14 + ((0 - hist.lo) / (hist.hi - hist.lo)) * 540} y="30" className="eg-cap" fill="#c2384a">0%</text>
          <text x="300" y="150" className="eg-cap" textAnchor="middle">all {N_SIMS.toLocaleString()} simulated IRRs — green hit the target, red lost money</text>
        </svg>
        <div className="eg-stats" aria-live="polite">
          <span className="eg-chip"><b>{fmtPct(sim.pTarget)}</b> chance of ≥ {fmtPct(TARGET, 0)}</span>
          <span className="eg-chip"><b>{fmtPct(sim.median)}</b> median IRR</span>
          <span className="eg-chip"><b>{fmtPct(sim.pLoss)}</b> chance of loss</span>
          <span className="eg-chip">1 in 20 lifetimes ends below <b>{fmtPct(sim.q5)}</b>/yr (Value at Risk, 5%)</span>
        </div>
      </section>

      {/* STEP 6 */}
      <section className="eg-step">
        <div className="eg-stephead"><span className="eg-num">6</span><h2>Size the position — or pass</h2></div>
        <div className="eg-cols">
          <div>
            <h4>What happens</h4>
            <p>
              The expected return&rsquo;s advantage over the risk-free rate, divided by risk squared, gives the
              classic Kelly allocation. The engine takes <b>half</b> of it (half-Kelly), caps it at 25% of the
              portfolio, and trims it further using the portfolio-overlap dial from step 3. The risk in the
              denominator is the market volatility from step 2 <b>plus a deal-specific floor</b> (~18%/yr) — a
              single property is always riskier than its market index. No advantage over risk-free → the verdict
              is PASS, however good the story sounds.
            </p>
          </div>
          <div className="eg-why">
            <h4>Why</h4>
            <p>
              Full Kelly is what a gambler with perfect estimates would bet — and estimates are never perfect.
              Half-Kelly keeps most of the growth with far less risk of ruin, and the cap acknowledges that any
              model of an illiquid asset deserves humility. Discipline lives here: the sizing rule is allowed to
              say no.
            </p>
          </div>
        </div>
        <div className="eg-kelly">
          <div className="eg-kellybar">
            <div className="eg-kellyfill" style={{ width: `${Math.min(kelly.position / 0.25, 1) * 100}%` }} />
          </div>
          <div className="eg-kellytext" aria-live="polite">
            Suggested allocation: <b>{fmtPct(kelly.position)}</b> of the portfolio &nbsp;·&nbsp; verdict: <b>{kelly.verdict}</b>
            <span className="eg-dialnote"> (live — drag the step-3 return tilt below about −7%/yr and watch the
            allocation shrink, then flip to PASS; risk-free {fmtPct(RF, 0)}, cap 25%)</span>
          </div>
        </div>
      </section>

      <footer className="eg-foot">
        Reproducibility: the production engine uses seeded randomness — the same inputs always produce the same
        score — and a 16-test parity suite validates it against the original reference implementation. Everything
        on this page is an illustrative miniature built for understanding: the outputs are decision-support
        analytics, not investment advice or a recommendation to buy or sell anything — verify independently before
        acting on any number this platform produces.
      </footer>
    </div>
  )
}

const CSS = `
.eg-root{max-width:940px;margin:0 auto;font-family:'Poppins',-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif;color:#11161f}
.eg-root h1{font-family:'Manrope',sans-serif;font-size:1.5rem;margin:0 0 0.4rem}
.eg-root h2{font-family:'Manrope',sans-serif;font-size:1.05rem;margin:0}
.eg-root h4{margin:0 0 0.35rem;font-size:0.78rem;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280}
.eg-head{margin-bottom:1.1rem}
.eg-head p{color:#4d5663;font-size:0.9rem;line-height:1.55;margin:0;max-width:72ch}
.eg-step{background:#fff;border:1px solid var(--border,#e2e7f0);border-radius:12px;padding:1.1rem 1.2rem;margin-bottom:1rem}
.eg-stephead{display:flex;align-items:center;gap:10px;margin-bottom:0.7rem}
.eg-num{width:26px;height:26px;border-radius:50%;background:#3b5bdb;color:#fff;font-weight:700;font-size:0.85rem;display:flex;align-items:center;justify-content:center;flex:none}
.eg-cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:0.6rem}
@media (max-width:760px){.eg-cols{grid-template-columns:1fr}}
.eg-cols p{font-size:0.86rem;line-height:1.55;color:#2a3240;margin:0 0 0.5rem}
.eg-why{background:#f6f8fc;border:1px solid #e8edf6;border-radius:10px;padding:0.7rem 0.85rem}
.eg-chart{width:100%;height:auto;display:block;margin-top:0.3rem}
.eg-cap{font-size:11px;fill:#566070}
.eg-root code{background:#f1f4f9;border-radius:5px;padding:1px 5px;font-size:0.8em}
.eg-dials{background:#fbfcfe;border:1px dashed #c9d4f6;border-radius:10px;padding:0.7rem 0.85rem;margin-top:0.4rem}
.eg-dials label{display:block;font-size:0.82rem;color:#2a3240;margin-bottom:0.5rem}
.eg-dials input[type=range]{width:100%;display:block;margin-top:2px}
.eg-dialnote{font-size:0.74rem;color:#7a8494}
.eg-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:0.6rem}
.eg-chip{background:#f1f4f9;border:1px solid #e2e7f0;border-radius:999px;padding:4px 12px;font-size:0.78rem;color:#2a3240}
.eg-kelly{margin-top:0.4rem}
.eg-kellybar{height:14px;background:#eef1f7;border-radius:999px;overflow:hidden;border:1px solid #e2e7f0}
.eg-kellyfill{height:100%;background:linear-gradient(90deg,#3b5bdb,#157f3c);transition:width 0.25s}
.eg-kellytext{font-size:0.84rem;color:#2a3240;margin-top:6px}
.eg-foot{font-size:0.78rem;color:#7a8494;line-height:1.5;margin:1.2rem 0 0.5rem;max-width:78ch}
`
