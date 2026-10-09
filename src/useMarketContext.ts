// Shared market-context fetch for the Review step — one debounced, NEUTRAL
// /api/score call per deal location, consumed by LocationIntelCard and the
// independent cross-check annotations in IntakeReview (data-integration
// Items 2–3; Item 1's McProbabilityCard on Results keeps its own fetch, which
// additionally depends on the rulebook's par IRR).
//
// Neutral means: the engine's questionnaire layer is off (neutralDdq) and no
// deal-specific tilts are sent, so everything in the response's base /
// marketEdge / marketPath / resolvedLocation blocks is a statement about the
// MARKET, not about this deal. The honest-score block is ignored here for the
// same reason.
//
// `location === null` means "don't fetch" (no deal location context wanted);
// an empty string fetches and resolves to the labeled national fallback,
// exactly like the Results-step card.
import { useEffect, useRef, useState } from 'react'

export interface MarketContext {
  base: {
    label: string
    nObs: number
    muAnn: number
    sigmaIndexRaw: number
    sigmaMarketDesmoothed: number
    idiosyncratic: number
    sigmaDealTotal: number
    lag1: number
    smoothing: string
  }
  resolvedLocation: { requested: string; key: string; exact: boolean } | null
  marketEdge: { grossYield: number; statePct: number; nState: number; muBias: number } | null
  marketPath: {
    asof: string
    stale: boolean
    gatePassed: boolean
    geltnerTested: boolean
    tiltAnnualCapped: number
    muBias: number
    annualMedian: number
    annualQ10: number
    annualQ90: number
    backtest: { hitRate: number | null; nWindows: number; dmPvsDrift: number | null }
  } | null
}

export interface MarketContextState {
  data: MarketContext | null
  err: string | null
  loading: boolean
}

export function useMarketContext(location: string | null): MarketContextState {
  const [data, setData] = useState<MarketContext | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    if (location === null) return
    const seq = ++seqRef.current
    // A new location cycle invalidates the previous one's result AND failure:
    // stale data must never render as the new location's "independent context"
    // (the consumers' documented contract), and a stale error must not mask
    // the loading state of a corrected location.
    setData(null)
    setErr(null)
    setLoading(true)
    // Debounced like the Gate 1 preview — the Monte Carlo endpoint is heavy
    // and the location field is analyst-editable.
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location, neutralDdq: true }),
        })
        if (seqRef.current !== seq) return
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('application/json')) throw new Error(`scoring endpoint returned ${r.status}`)
        const d = await r.json()
        if (seqRef.current !== seq) return
        if (d.error) throw new Error(d.error)
        setData(d as MarketContext)
        setErr(null)
      } catch (e: unknown) {
        if (seqRef.current !== seq) return
        setErr(String((e as Error)?.message || e))
      } finally {
        if (seqRef.current === seq) setLoading(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [location])

  return { data, err, loading }
}
