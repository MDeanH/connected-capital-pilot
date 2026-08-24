// Location intelligence — what the platform independently knows about the
// deal's market, on the Review step (data-integration Item 3). Everything
// here is market data with named provenance: the Zillow return history the
// Monte Carlo scores against, the gross-yield edge, and the gate-passed
// 12-month market path. It also says out loud what the platform does NOT
// have an independent source for (metro rents, metro cap rates) — the
// cross-check annotations in the grid above cite the same boundaries.
// Degrades to a one-line note on API failure; the Review step never blocks.
import { Term } from './GlossaryTip'
import type { MarketContextState } from './useMarketContext'

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const signedPct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%/yr`

interface Props {
  /** The deal's location as typed/extracted — only used for the fallback wording. */
  location: string | null
  context: MarketContextState
}

export default function LocationIntelCard({ location, context }: Props) {
  const { data, err, loading } = context

  if (err) {
    return (
      <div className="card lic-root">
        <style>{CSS}</style>
        <h2 className="lic-title">Location intelligence</h2>
        <div className="lic-muted">
          Market data unavailable ({err}) — review and scoring are unaffected.
        </div>
      </div>
    )
  }

  const exact = data?.resolvedLocation?.exact ?? false
  const label = data?.base.label
  const mp = data?.marketPath
  const mpUsable = !!mp && !mp.stale && mp.gatePassed

  return (
    <div className="card lic-root">
      <style>{CSS}</style>
      <h2 className="lic-title">
        Location intelligence{label ? <> — {label}</> : null}
        <span className="lic-kicker">INDEPENDENT MARKET DATA · ZILLOW HISTORY · YIELD EDGE · 12-MO PATH</span>
      </h2>

      {loading && <div className="lic-muted" role="status">loading market data…</div>}

      {!loading && data && (
        <>
          {!exact && (
            <div className="lic-fallback" role="note">
              No metro baseline matches “{location?.trim() || 'this deal’s location'}” — the figures
              below describe the national ({label}) market, NOT the deal’s own. Correcting the
              Location field to an exact “City, ST” may find its metro among the ~20,000 baked baselines.
            </div>
          )}

          <div className="lic-stats">
            <div className="lic-stat">
              <div className="lic-stat-label">Market total return (ann.)</div>
              <div className="lic-stat-value">{pct1(data.base.muAnn)}</div>
              <div className="lic-stat-sub">Zillow prices + rental carry · n={data.base.nObs} qtrs</div>
            </div>
            <div className="lic-stat">
              <div className="lic-stat-label"><Term k="de_smoothing">Volatility (de-smoothed)</Term></div>
              <div className="lic-stat-value">{pct1(data.base.sigmaMarketDesmoothed)}</div>
              <div className="lic-stat-sub">smoothed index reads {pct1(data.base.sigmaIndexRaw)}</div>
            </div>
            {data.marketEdge && (
              <div className="lic-stat">
                <div className="lic-stat-label">Gross rental yield</div>
                <div className="lic-stat-value">{pct1(data.marketEdge.grossYield)}</div>
                <div className="lic-stat-sub">
                  pctile {Math.round(data.marketEdge.statePct)} of {data.marketEdge.nState} in-state markets
                  {data.marketEdge.muBias !== 0 && <> · MC tilt {signedPct(data.marketEdge.muBias)}</>}
                </div>
              </div>
            )}
            {mpUsable && (
              <div className="lic-stat">
                <div className="lic-stat-label">12-mo market path</div>
                <div className="lic-stat-value">{pct1(mp.annualMedian)}</div>
                <div className="lic-stat-sub">
                  q10 {pct1(mp.annualQ10)} · q90 {pct1(mp.annualQ90)} · as of {mp.asof}
                </div>
              </div>
            )}
          </div>

          {mp && !mpUsable && (
            <div className="lic-note">
              A 12-month market-path forecast exists for this baseline but is{' '}
              {mp.stale ? `stale (as of ${mp.asof})` : 'not acceptance-gated'} — it is never applied
              to any score (the Results-step path chart may still display it).
            </div>
          )}

          <div className="lic-blindspots">
            <b>Not independently known:</b> metro rents (the rent-comp fields are the sponsor’s own
            numbers) and metro cap rates (gross yield above is before opex — not a cap rate). Where
            the platform has no independent source, it says so rather than substituting one.
          </div>

          <div className="lic-caveat">
            Index-based market history — context for reviewing the sponsor’s claims, not a
            deal-specific underwrite. The same baseline drives the Monte Carlo distribution on the
            Results step; the Gate&nbsp;1 verdict does not use these numbers.
          </div>
        </>
      )}
    </div>
  )
}

const CSS = `
.lic-root{max-width:1180px;margin:1rem auto 0;padding:1.5rem}
.lic-title{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;letter-spacing:-.01em;margin:0 0 1rem}
.lic-kicker{font-size:0.68rem;color:var(--muted,#5c6b67);font-weight:500;margin-left:10px;letter-spacing:.06em}
.lic-muted{color:var(--muted,#5c6b67);font-size:.85rem}
.lic-fallback{background:#fbf3df;border:1px solid #f0e0b0;color:#5b4a16;border-radius:10px;padding:.7rem 1rem;font-size:.8rem;line-height:1.5;margin-bottom:1rem}
.lic-stats{display:flex;gap:2.5rem;flex-wrap:wrap;margin:.25rem 0 1rem}
.lic-stat-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600}
.lic-stat-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:2rem;font-variant-numeric:tabular-nums;margin-top:2px}
.lic-stat-sub{font-size:.72rem;color:var(--muted,#5c6b67);font-variant-numeric:tabular-nums}
.lic-note{font-size:.78rem;color:var(--muted,#5c6b67);margin-bottom:.6rem}
.lic-blindspots{font-size:.78rem;line-height:1.55;border-top:1px solid var(--border,#eef4f2);padding-top:.7rem;color:#5b4a16}
.lic-caveat{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:.6rem;line-height:1.5}
@media(max-width:900px){.lic-stats{gap:1.25rem}}
`
