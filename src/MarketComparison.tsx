// Market comparison — the deal's projected returns against the public-market
// alternative (S&P 500) and configured benchmarks, plus a financing sanity
// check of the modeled loan rate against prevailing SOFR + typical spread.
// All comparator values come from the weekly market snapshot and config —
// nothing here is hardcoded except two display-judgment bands (below).
import type { ReactNode } from 'react'
import { Term } from './GlossaryTip'
import type { DealFields } from './deal-types'
import type { MarketContext } from '../netlify/functions/lib/gate1/types'
import { dealCashOnCash } from './finance'

// Display-judgment bands for the financing status line (how far the modeled
// rate may sit from prevailing before we comment on it). These shape wording
// only — they are NOT gate thresholds and gate math never reads them.
const FINANCING_INLINE_BAND_PP = 0.5 // within ±0.5pp → "in line"
const FINANCING_ABOVE_NOTE_PP = 1.0 // more than +1pp above → "above market" note

export interface MarketBenchmarks {
  coc: number
  irr: number
  equityMultiple: number
  financingSpreadTypicalBps: number
}

interface Props {
  fields: DealFields
  market: MarketContext | null
  benchmarks: MarketBenchmarks | null
}

const NA = 'n/a — not in the documents'

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`

/** MarketContext returns are ALREADY annualized by the server (fred.ts annualizedReturn). */
function annualized(ret: number | null | undefined, _years: number): number | null {
  return ret ?? null
}

type Tone = 'good' | 'warn' | ''

/** Color + word when the deal value sits clearly above/below its comparators. */
function tone(value: number | null, comparators: Array<number | null>): { tone: Tone; word: string } {
  const cs = comparators.filter((c): c is number => c != null)
  if (value == null || cs.length === 0) return { tone: '', word: '' }
  if (cs.every(c => value > c)) return { tone: 'good', word: 'above' }
  if (cs.every(c => value < c)) return { tone: 'warn', word: 'below' }
  return { tone: '', word: 'mixed' }
}

function StatRow({ label, glossaryKey, value, valueTone, toneWord, comparators }: {
  label: string
  glossaryKey: string
  value: string
  valueTone: Tone
  toneWord: string
  comparators: Array<{ label: string; value: string }>
}) {
  return (
    <div className="mx-row">
      <div className="mx-row-label"><Term k={glossaryKey}>{label}</Term></div>
      <div className="mx-row-value">
        <span className={`mx-val ${valueTone ? `mx-val-${valueTone}` : ''}`}>{value}</span>
        {toneWord && <span className={`mx-tone-word ${valueTone ? `mx-tone-${valueTone}` : ''}`}>{toneWord}</span>}
      </div>
      <div className="mx-row-cmp">
        {comparators.map(c => (
          <span className="mx-cmp" key={c.label}>
            <span className="mx-cmp-label">{c.label}</span> {c.value}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function MarketComparison({ fields, market, benchmarks }: Props) {
  const sp = market?.sp500 ?? null
  const sp1y = sp ? annualized(sp.ret1y, 1) : null
  const sp3y = sp ? annualized(sp.ret3y, 3) : null
  const sp5y = sp ? annualized(sp.ret5y, 5) : null

  const irr = fields.projected_irr ?? null
  const coc = dealCashOnCash(fields)
  const em = fields.projected_equity_multiple ?? null

  // "Clearly above/below" = above/below both the S&P 5y annualized and the
  // configured benchmark (where each is available).
  const irrTone = tone(irr, [sp5y, benchmarks?.irr ?? null])
  const cocTone = tone(coc, [benchmarks?.coc ?? null])
  const emTone = tone(em, [benchmarks?.equityMultiple ?? null])

  // ---- Financing check ----
  const modeled = fields.loan_interest_rate ?? null
  const loan = fields.construction_loan
  // FRED rate series arrive as percent-point levels (3.53 = 3.53%, 0.5 = 0.5%) —
  // always divide by 100 so the comparison against the deal's decimal loan rate
  // is sane. No magnitude guessing: a ZIRP-era 0.5 must not read as 50%.
  const sofrRaw = market?.sofr ?? null
  const sofr = sofrRaw === null ? null : sofrRaw / 100
  const spreadBps = benchmarks?.financingSpreadTypicalBps ?? null
  const prevailing = sofr !== null && spreadBps !== null ? sofr + spreadBps / 10000 : null

  let finBody: ReactNode
  if (loan === 0) {
    finBody = <div className="mx-fin-line mx-muted">All-equity — no financing exposure</div>
  } else if (modeled === null) {
    finBody = <div className="mx-fin-line mx-muted">Modeled loan rate: {NA}</div>
  } else if (prevailing === null) {
    finBody = (
      <div className="mx-fin-line mx-muted">
        Modeled {pct1(modeled)} — prevailing rates unavailable, no comparison possible
      </div>
    )
  } else {
    const diffPp = (modeled - prevailing) * 100
    let dot: string, word: string, note: string
    if (diffPp < -FINANCING_INLINE_BAND_PP) {
      dot = 'warn'
      word = 'FINANCING LOOKS OPTIMISTIC'
      note = "— the model assumes debt cheaper than today's market"
    } else if (diffPp <= FINANCING_INLINE_BAND_PP) {
      dot = 'good'
      word = 'IN LINE'
      note = 'with prevailing rates'
    } else if (diffPp > FINANCING_ABOVE_NOTE_PP) {
      dot = 'na'
      word = 'ABOVE'
      note = 'market — conservative or pricing in weak credit'
    } else {
      dot = 'na'
      word = 'SLIGHTLY ABOVE'
      note = 'prevailing rates'
    }
    finBody = (
      <>
        <div className="mx-fin-line">
          Modeled {pct1(modeled)} vs prevailing ≈ {pct1(prevailing)} (SOFR {pct1(sofr!)} + {spreadBps}bps)
        </div>
        <div className="mx-fin-status">
          <span className={`mx-dot mx-dot-${dot}`} aria-hidden="true" />
          <span className={`mx-fin-word mx-fin-${dot}`}>{word}</span>
          <span className="mx-fin-note">{note}</span>
        </div>
      </>
    )
  }

  const spCmp = [
    { label: 'S&P 1y', value: sp1y !== null ? pct1(sp1y) : 'n/a' },
    { label: '3y ann.', value: sp3y !== null ? pct1(sp3y) : 'n/a' },
    { label: '5y ann.', value: sp5y !== null ? pct1(sp5y) : 'n/a' },
    ...(benchmarks ? [{ label: 'benchmark', value: pct1(benchmarks.irr) }] : []),
  ]

  return (
    <div className="card mx-root">
      <style>{CSS}</style>
      <h2 className="mx-title">Market comparison</h2>

      <div className="mx-section-label">Returns vs the index</div>
      <div className="mx-rows">
        <StatRow
          label="Projected IRR" glossaryKey="sp500_comparison"
          value={irr !== null ? pct1(irr) : NA}
          valueTone={irr !== null ? irrTone.tone : ''} toneWord={irr !== null ? irrTone.word : ''}
          comparators={market ? spCmp : [{ label: 'S&P', value: 'unavailable' }, ...(benchmarks ? [{ label: 'benchmark', value: pct1(benchmarks.irr) }] : [])]}
        />
        <StatRow
          label="Cash-on-cash" glossaryKey="cash_on_cash"
          value={coc !== null ? pct1(coc) : NA}
          valueTone={coc !== null ? cocTone.tone : ''} toneWord={coc !== null ? cocTone.word : ''}
          comparators={benchmarks ? [{ label: 'benchmark', value: pct1(benchmarks.coc) }] : [{ label: 'benchmark', value: 'unavailable' }]}
        />
        <StatRow
          label="Equity multiple" glossaryKey="equity_multiple"
          value={em !== null ? `${em.toFixed(2)}x` : NA}
          valueTone={em !== null ? emTone.tone : ''} toneWord={em !== null ? emTone.word : ''}
          comparators={benchmarks ? [{ label: 'benchmark', value: `${benchmarks.equityMultiple.toFixed(2)}x` }] : [{ label: 'benchmark', value: 'unavailable' }]}
        />
      </div>

      <div className="mx-section-label"><Term k="financing">Financing check</Term></div>
      <div className="mx-fin">{finBody}</div>

      {market?.asof && <div className="mx-asof">market data as of {market.asof}</div>}
    </div>
  )
}

const CSS = `
.mx-root{max-width:1180px;margin:0 auto;padding:1.5rem}
.mx-title{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;letter-spacing:-.01em;margin:0 0 1rem}
.mx-section-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin:1.1rem 0 .5rem}
.mx-rows{display:flex;flex-direction:column}
.mx-row{display:flex;align-items:baseline;gap:1.25rem;padding:.55rem 0}
.mx-row + .mx-row{border-top:1px solid var(--border,#eef4f2)}
.mx-row-label{flex:0 0 32%;font-size:.85rem;font-weight:500;min-width:0}
.mx-row-value{flex:0 0 auto;display:flex;align-items:baseline;gap:.5rem}
.mx-val{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;font-variant-numeric:tabular-nums}
.mx-val-good{color:var(--success,#157f3c)}
.mx-val-warn{color:var(--warning,#b8860b)}
.mx-tone-word{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5c6b67)}
.mx-tone-good{color:var(--success,#157f3c)}
.mx-tone-warn{color:var(--warning,#b8860b)}
.mx-row-cmp{flex:1 1 auto;display:flex;flex-wrap:wrap;gap:.4rem .9rem;justify-content:flex-end;font-size:.8rem;color:var(--muted,#5c6b67);font-variant-numeric:tabular-nums}
.mx-cmp-label{font-size:10px;letter-spacing:.05em;text-transform:uppercase;opacity:.85;margin-right:2px}
.mx-fin{font-size:.85rem}
.mx-fin-line{font-variant-numeric:tabular-nums}
.mx-muted{color:var(--muted,#5c6b67)}
.mx-fin-status{display:flex;align-items:center;gap:.5rem;margin-top:.45rem}
.mx-dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex-shrink:0}
.mx-dot-good{background:var(--posture-green,#3f7d69)}
.mx-dot-warn{background:var(--posture-yellow,#b8860b)}
.mx-dot-na{background:var(--cc-gray,#9c9c9c)}
.mx-fin-word{font-size:11px;font-weight:700;letter-spacing:.08em}
.mx-fin-good{color:var(--success,#157f3c)}
.mx-fin-warn{color:var(--warning,#b8860b)}
.mx-fin-na{color:var(--muted,#5c6b67)}
.mx-fin-note{font-size:.8rem;color:var(--muted,#5c6b67)}
.mx-asof{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:1rem}
@media(max-width:900px){
  .mx-row{flex-wrap:wrap;gap:.3rem .75rem}
  .mx-row-label{flex:1 1 100%}
  .mx-row-cmp{justify-content:flex-start}
}
`
