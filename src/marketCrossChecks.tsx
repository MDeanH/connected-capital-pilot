// Independent market cross-checks for the Review grid (data-integration
// Item 2). Gate 1's market checks compare the sponsor's claimed market
// numbers against the sponsor's own assumptions; these annotations put the
// platform's INDEPENDENT reference — with its provenance and its limits —
// directly under the fields making the claim. Two disciplines, both
// deliberate:
//
//  - Context, never verdicts: nothing here passes or kills. The references
//    are labeled for exactly what they are (price history is not an
//    underwrite; gross yield is not a cap rate), and the judgment stays with
//    the analyst and Gate 1.
//  - Blind spots are stated, not papered over: where no independent source is
//    baked (metro rents), the annotation says so instead of substituting a
//    lookalike number.
//
// Returns only rows whose backing data actually exists; an empty object when
// the market context has not loaded. Keys are DealFields keys — IntakeReview
// renders each under the matching field.
import type { ReactNode } from 'react'
import type { DealFields } from './deal-types'
import type { MarketContext } from './useMarketContext'

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`

export function buildCrossChecks(
  ctx: MarketContext | null,
  coerced: Partial<DealFields>,
): Partial<Record<keyof DealFields, ReactNode>> {
  if (!ctx) return {}
  const out: Partial<Record<keyof DealFields, ReactNode>> = {}
  const exact = ctx.resolvedLocation?.exact ?? false
  const label = ctx.base.label
  const scopeNote = exact ? null : ' — national distribution, no exact metro match'

  out.location = exact ? (
    <>Matched metro baseline <b>{label}</b> — {ctx.base.nObs} quarters of independent Zillow market history.</>
  ) : (
    <>No exact “City, ST” match among the ~20,000 baked metro baselines — independent references
    below fall back to the <b>national</b> distribution, not this market’s.</>
  )

  if (typeof coerced.projected_irr === 'number') {
    out.projected_irr = (
      <>
        Independent context: the {label} market itself returned <b>{pct1(ctx.base.muAnn)}/yr</b>{' '}
        (de-smoothed σ {pct1(ctx.base.sigmaMarketDesmoothed)}, n={ctx.base.nObs} qtrs){scopeNote}.
        The gap to the sponsor’s {pct1(coerced.projected_irr)} is claimed execution alpha plus
        leverage — Gate&nbsp;1’s job to judge, never assumed.
      </>
    )
  }

  if (ctx.marketEdge && typeof coerced.market_cap_rate_today === 'number') {
    out.market_cap_rate_today = (
      <>
        Independent context: {label} gross rental yield <b>{pct1(ctx.marketEdge.grossYield)}</b>{' '}
        (percentile {Math.round(ctx.marketEdge.statePct)} of {ctx.marketEdge.nState} in-state
        markets){scopeNote}. Gross yield is before opex — direction and context, not a cap-rate
        benchmark.
      </>
    )
  }

  const mp = ctx.marketPath
  if (mp && !mp.stale && mp.gatePassed && typeof coerced.exit_cap_rate === 'number') {
    out.exit_cap_rate = (
      <>
        Independent context: gate-passed 12-mo price path for {label} — median{' '}
        <b>{pct1(mp.annualMedian)}</b> (q10 {pct1(mp.annualQ10)}, q90 {pct1(mp.annualQ90)}), as of{' '}
        {mp.asof}. A 12-month statement only — it says nothing about pricing at exit (mean
        reversion removes its signal by years 3–5), and it is not a cap-rate forecast.
      </>
    )
  }

  if (typeof coerced.market_comp_rent_monthly === 'number') {
    out.market_comp_rent_monthly = (
      <>
        No independent rent series is baked{exact ? ` for ${label}` : ''} — this comp is the
        sponsor’s own number, and Gate&nbsp;1’s rent-premium check compares sponsor vs sponsor.
        Treat it as unverified.
      </>
    )
  }

  return out
}
