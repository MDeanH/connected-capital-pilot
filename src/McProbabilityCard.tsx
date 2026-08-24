// Monte Carlo return-probability card — the deal flow's consumer of the
// verified /api/score engine. Scores the deal's resolved market baseline
// (exact "City, ST" match server-side, or the national baseline clearly
// labeled — compute.ts resolveBaseline), with the engine's own questionnaire
// layer off (neutralDdq) because Gate 1 is this product's judgment layer.
// Index-based market distribution + generic idiosyncratic layer, honestly
// labeled — never a deal-specific underwrite, and never a blocker: an API
// failure degrades to a note under the Gate 1 results.
import { useEffect, useRef, useState } from 'react'
import { Term } from './GlossaryTip'

// No hold-period field is extracted from the documents yet — score over the
// engine's default 5-year hold and say so on the card.
const HOLDING_YEARS = 5

interface M3 { median: number; ci: [number, number] }
interface ScoreResponse {
  base: {
    label: string; nObs: number; muAnn: number
    sigmaIndexRaw: number; sigmaMarketDesmoothed: number
    idiosyncratic: number; sigmaDealTotal: number
  }
  resolvedLocation: { requested: string; key: string; exact: boolean } | null
  marketEdge: { grossYield: number; statePct: number; nState: number; muBias: number } | null
  marketPath: { asof: string; stale: boolean; gatePassed: boolean; muBias: number } | null
  honest: { pTarget: M3; pLoss: M3; expected: M3; median: M3 }
  naive: { pLoss: M3 }
}

interface Props {
  location: string | null
  /** The active rulebook's par IRR benchmark — the P(beats target) bar. */
  parIrr: number
  dealName?: string
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const pct0 = (x: number) => `${(x * 100).toFixed(0)}%`
const signedPct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%/yr`
const ciText = (m: M3) => `90% CI ${pct0(m.ci[0])}–${pct0(m.ci[1])}`

export default function McProbabilityCard({ location, parIrr, dealName }: Props) {
  const [data, setData] = useState<ScoreResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    setLoading(true)
    // Debounced like the Gate 1 preview — the Monte Carlo endpoint is heavy.
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // location (never a guessed baseline key) — the server resolves it;
          // an empty string resolves to the labeled national fallback.
          body: JSON.stringify({
            location: location ?? '',
            holding: HOLDING_YEARS,
            target: parIrr,
            neutralDdq: true,
            name: dealName,
          }),
        })
        if (seqRef.current !== seq) return
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('application/json')) throw new Error(`scoring endpoint returned ${r.status}`)
        const d = await r.json()
        if (seqRef.current !== seq) return
        if (d.error) throw new Error(d.error)
        setData(d as ScoreResponse)
        setErr(null)
      } catch (e: unknown) {
        if (seqRef.current !== seq) return
        setErr(String((e as Error)?.message || e))
      } finally {
        if (seqRef.current === seq) setLoading(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [location, parIrr, dealName])

  // Degrade, never block: Gate 1 results above stand on their own.
  if (err) {
    return (
      <div className="card mcp-root">
        <style>{CSS}</style>
        <h2 className="mcp-title">Market return distribution</h2>
        <div className="mcp-muted">
          Monte Carlo scoring unavailable ({err}) — the Gate 1 verdict above is unaffected.
        </div>
      </div>
    )
  }

  const exact = data?.resolvedLocation?.exact ?? false
  const baseLabel = data?.base.label

  return (
    <div className="card mcp-root">
      <style>{CSS}</style>
      <h2 className="mcp-title">
        Market return distribution{baseLabel ? <> — {baseLabel}</> : null}
        <span className="mcp-kicker">
          MONTE CARLO · <Term k="de_smoothing">DE-SMOOTHED</Term> · {HOLDING_YEARS}-YR HOLD
        </span>
      </h2>

      {loading && <div className="mcp-muted" role="status">simulating…</div>}

      {!loading && data && (
        <>
          {!exact && (
            <div className="mcp-fallback" role="note">
              No metro baseline matches “{location?.trim() || 'this deal’s location'}” — showing the
              national ({baseLabel}) distribution, not a guess. These are NOT the deal’s own market numbers.
            </div>
          )}

          <div className="mcp-stats">
            <div className="mcp-stat">
              <div className="mcp-stat-label">P(beats {pct1(parIrr)} par IRR)</div>
              <div className="mcp-stat-value">{pct0(data.honest.pTarget.median)}</div>
              <div className="mcp-stat-ci">{ciText(data.honest.pTarget)}</div>
            </div>
            <div className="mcp-stat">
              <div className="mcp-stat-label"><Term k="p_loss">P(loss)</Term></div>
              <div className="mcp-stat-value">{pct0(data.honest.pLoss.median)}</div>
              <div className="mcp-stat-ci">{ciText(data.honest.pLoss)}</div>
            </div>
            <div className="mcp-stat">
              <div className="mcp-stat-label">Expected return (ann.)</div>
              <div className="mcp-stat-value">{pct1(data.honest.expected.median)}</div>
              <div className="mcp-stat-ci">{ciText(data.honest.expected)}</div>
            </div>
          </div>

          <div className="mcp-basis">
            Baseline: <b>{baseLabel}</b> Zillow return history · n={data.base.nObs} quarterly observations ·
            de-smoothed market σ {pct1(data.base.sigmaMarketDesmoothed)} (smoothed index reads {pct1(data.base.sigmaIndexRaw)}) +
            {' '}{pct1(data.base.idiosyncratic)} idiosyncratic → {pct1(data.base.sigmaDealTotal)} total.
            On the smoothed index alone, P(loss) would read {pct0(data.naive.pLoss.median)}.
          </div>

          <div className="mcp-adjust">
            {data.marketEdge && data.marketEdge.muBias !== 0 && (
              <span>
                <b>Yield-edge tilt:</b> {signedPct(data.marketEdge.muBias)} (gross-yield percentile{' '}
                {Math.round(data.marketEdge.statePct)} of {data.marketEdge.nState} in-state markets)
              </span>
            )}
            {data.marketPath && !data.marketPath.stale && data.marketPath.gatePassed && data.marketPath.muBias !== 0 && (
              <span>
                <b>Market-path tilt:</b> {signedPct(data.marketPath.muBias)} (12-mo forecast as of {data.marketPath.asof}, amortized over the hold)
              </span>
            )}
            {!(data.marketEdge && data.marketEdge.muBias !== 0) &&
              !(data.marketPath && !data.marketPath.stale && data.marketPath.gatePassed && data.marketPath.muBias !== 0) && (
              <span className="mcp-muted">No yield-edge or market-path tilt applies to this baseline.</span>
            )}
          </div>

          <div className="mcp-caveat">
            An index-based market distribution plus a generic idiosyncratic layer — not a deal-specific
            underwrite. Par IRR benchmark from the active rulebook. The engine’s own questionnaire layer is
            off here; the Gate&nbsp;1 verdict above is this product’s judgment layer and does not use these numbers.
          </div>
        </>
      )}
    </div>
  )
}

const CSS = `
.mcp-root{max-width:1180px;margin:0 auto;padding:1.5rem}
.mcp-title{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;letter-spacing:-.01em;margin:0 0 1rem}
.mcp-kicker{font-size:0.68rem;color:var(--muted,#5c6b67);font-weight:500;margin-left:10px;letter-spacing:.06em}
.mcp-muted{color:var(--muted,#5c6b67);font-size:.85rem}
.mcp-fallback{background:#fbf3df;border:1px solid #f0e0b0;color:#5b4a16;border-radius:10px;padding:.7rem 1rem;font-size:.8rem;line-height:1.5;margin-bottom:1rem}
.mcp-stats{display:flex;gap:2.5rem;flex-wrap:wrap;margin:.25rem 0 1rem}
.mcp-stat-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600}
.mcp-stat-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:2rem;font-variant-numeric:tabular-nums;margin-top:2px}
.mcp-stat-ci{font-size:.72rem;color:var(--muted,#5c6b67);font-variant-numeric:tabular-nums}
.mcp-basis{font-size:.8rem;color:var(--muted,#5c6b67);line-height:1.55;border-top:1px solid var(--border,#eef4f2);padding-top:.7rem}
.mcp-adjust{display:flex;gap:1.5rem;flex-wrap:wrap;font-size:.8rem;margin-top:.5rem}
.mcp-caveat{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:.7rem;line-height:1.5}
@media(max-width:900px){.mcp-stats{gap:1.25rem}}
`
