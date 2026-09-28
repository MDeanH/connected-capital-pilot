// CapitalCharts — the Financials and Market charts of the Underwriting view,
// rebuilt on ChartKit: uses & sources of capital, the deal's modeled loan rate
// against today's market rates, and the development timeline. Every mark is a
// number from the documents or the macro snapshot; a missing input is said in
// words, never drawn as a zero. Series colors are identity (CK.cat) or
// emphasis (CK.accent / CK.context) — status colors appear only on the
// financing verdict word, where they mean in-line / check.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { CK, ChartCard, Plot, niceTicks, scaleLinear, useTooltip, type LegendItem, type TableSpec, type TipLine } from './ChartKit'
import type { DealFields } from '../deal-types'
import type { CheckResult, MarketContext } from '../../netlify/functions/lib/gate1/types'

const MISSING = 'not in the documents'
const GAP = 2 // surface gap between touching fills
const NARROW = 480 // below this plot width, row labels move above their bars

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
/** Unsigned percentage points from whole basis points: 50 → "0.5", 58 → "0.58", 125 → "1.25". */
const ptsAbs = (bps: number) => (Math.abs(bps) / 100).toFixed(2).replace(/0$/, '')
const mo = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1))

/** % tick labels with the fewest decimals that show every tick exactly (2.5% stays 2.5%, not 3%). */
function pctTickFormat(ticks: number[]): (t: number) => string {
  const dec = [0, 1, 2].find(d => ticks.every(t => {
    const v = t * 100 * 10 ** d
    return Math.abs(v - Math.round(v)) < 1e-6
  })) ?? 2
  return t => `${(t * 100).toFixed(dec)}%`
}

/**
 * Vertical extents for gridlines. On phones row labels sit above their bars,
 * so each row's gridline starts below its label strip instead of striking it.
 */
function gridBands(narrow: boolean, n: number, top: number, rowH: number): Array<[number, number]> {
  if (!narrow) return [[top, top + n * rowH]]
  return Array.from({ length: n }, (_, i): [number, number] => [top + i * rowH + 18, top + (i + 1) * rowH])
}

function money(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/**
 * Measured plot width, so the SVG's viewBox matches its rendered width and
 * text stays at its true size on phones instead of shrinking with the chart.
 */
function useWidth(initial: number): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(initial)
  const obs = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect()
    obs.current = null
    if (!el) return
    const read = () => {
      const cw = Math.round(el.getBoundingClientRect().width)
      if (cw > 0) setW(cw)
    }
    read()
    if (typeof ResizeObserver !== 'undefined') {
      obs.current = new ResizeObserver(read)
      obs.current.observe(el)
    }
  }, [])
  return [ref, w]
}

/** Bar from `base` to `end`: square at the baseline, 4px rounded data end. */
function barPath(base: number, end: number, y: number, h: number, r = 4): string {
  const w = Math.abs(end - base)
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  const s = end >= base ? 1 : -1
  const sweep = s > 0 ? 1 : 0
  return `M${base},${y}H${end - s * rr}A${rr},${rr} 0 0 ${sweep} ${end},${y + rr}V${y + h - rr}`
    + `A${rr},${rr} 0 0 ${sweep} ${end - s * rr},${y + h}H${base}Z`
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="capc-empty">{children}</div>
}

// ============================================================ USES & SOURCES

interface Part { key: string; label: string; value: number | null; color: string; absent?: string }

// Form: one horizontal 100% stacked bar per card, not a donut — length reads
// more exactly than angle, the method deprioritises donuts, and the value
// legend underneath carries each part's $ and %. Shares are only printed when
// the whole is known; otherwise the card says what is missing and the table
// lists the amounts the documents do give.
function PartToWhole({ title, subtitle, head, whole, parts, empty, notes, totalLabel, knownTotal }: {
  title: string
  subtitle: string
  head: string
  whole: string
  parts: Part[]
  empty: string | null
  notes: string[]
  totalLabel: string
  knownTotal: number | null
}) {
  const tip = useTooltip()
  const [measure, width] = useWidth(360)
  const W = Math.max(200, width)
  const shown = parts.filter((p): p is Part & { value: number } => has(p.value) && p.value > 0)
  const total = shown.reduce((s, p) => s + p.value, 0)
  const drawable = !empty && total > 0
  const absent = (p: Part) => p.absent ?? MISSING

  const table: TableSpec = drawable
    ? {
      columns: [head, 'Amount', 'Share'],
      rows: [
        ...parts.map(p => [p.label, has(p.value) ? money(p.value) : absent(p), has(p.value) ? pct1(p.value / total) : '—']),
        [totalLabel, money(total), '100%'],
      ],
    }
    : {
      columns: [head, 'Amount'],
      rows: [
        ...parts.map(p => [p.label, has(p.value) ? money(p.value) : absent(p)]),
        ...(has(knownTotal) ? [[totalLabel, money(knownTotal)]] : []),
      ],
    }

  const BAR = 22
  const PAD = 5
  const H = BAR + PAD * 2
  // Proportional widths after the gaps; a sliver keeps ≥3px so it stays visible.
  const avail = Math.max(0, W - GAP * (shown.length - 1))
  const raw = shown.map(p => (p.value / total) * avail)
  const MIN = 3
  const deficit = raw.reduce((s, w) => s + Math.max(0, MIN - w), 0)
  const big = raw.reduce((s, w) => s + (w >= MIN ? w : 0), 0)
  const widths = raw.map(w => (w < MIN ? MIN : big > 0 ? w - (deficit * w) / big : w))
  let cursor = 0
  const segs = shown.map((p, i) => {
    const seg = { ...p, x: cursor, w: widths[i], share: p.value / total, last: i === shown.length - 1 }
    cursor += widths[i] + GAP
    return seg
  })
  const linesOf = (s: (typeof segs)[number]): TipLine[] => [
    { value: money(s.value), label: s.label, color: s.color },
    { value: pct1(s.share), label: `of ${whole}` },
  ]

  return (
    <ChartCard title={title} subtitle={drawable ? subtitle : undefined} table={table}
      note={notes.length ? notes.join(' ') : undefined}>
      {!drawable ? <Empty>{empty ?? `Inputs ${MISSING}.`}</Empty> : (
        <>
          <Plot tip={tip}>
            <div ref={measure}>
              <svg viewBox={`0 0 ${W} ${H}`} role="group"
                aria-label={`${title}: ${segs.map(s => `${s.label} ${pct1(s.share)}`).join(', ')}`}>
                {segs.map(s => (
                  <g key={s.key} className="ck-hover" {...tip.bind(linesOf(s))}>
                    <rect className="ck-hit" x={s.x} y={0} width={s.w + (s.last ? 0 : GAP)} height={H} />
                    {s.last
                      ? <path className="ck-mark" d={barPath(s.x, s.x + s.w, PAD, BAR)} fill={s.color} />
                      : <rect className="ck-mark" x={s.x} y={PAD} width={s.w} height={BAR} fill={s.color} />}
                  </g>
                ))}
                {/* Slivers get a 24px pointer target on top; keyboard focus already reaches them. */}
                {segs.filter(s => s.w < 24).map(s => {
                  const b = tip.bind(linesOf(s))
                  const x = Math.min(Math.max(0, s.x + s.w / 2 - 12), W - 24)
                  return <rect key={`${s.key}-hit`} className="ck-hit" x={x} y={0} width={24} height={H}
                    onPointerMove={b.onPointerMove} onPointerLeave={b.onPointerLeave} aria-hidden="true" />
                })}
              </svg>
            </div>
          </Plot>
          <div className="capc-legend">
            {parts.map(p => {
              const s = segs.find(g => g.key === p.key)
              if (s) {
                return (
                  <div className="capc-row" key={p.key}>
                    <span className="capc-sw" style={{ background: s.color }} aria-hidden="true" />
                    <span className="capc-lab">{s.label}</span>
                    <span className="capc-pct">{pct1(s.share)}</span>
                    <span className="capc-val">{money(s.value)}</span>
                  </div>
                )
              }
              return has(p.value) ? null : (
                <div className="capc-row" key={p.key}>
                  <span className="capc-sw capc-sw-none" aria-hidden="true" />
                  <span className="capc-lab">{p.label}</span>
                  <span className="capc-miss">{absent(p)}</span>
                </div>
              )
            })}
            <div className="capc-row capc-total">
              <span aria-hidden="true" />
              <span className="capc-lab">{totalLabel}</span>
              <span className="capc-pct" />
              <span className="capc-val">{money(total)}</span>
            </div>
          </div>
        </>
      )}
    </ChartCard>
  )
}

/** Uses and sources of capital, side by side (stacked on phones). */
export function UsesSourcesCharts({ fields }: { fields: DealFields }) {
  ensureStyle()
  // Same derivations as the Underwriting Financials tab.
  const cost = fields.total_project_cost
  const land = fields.land_cost ?? 0
  const hard = fields.hard_costs ?? 0
  const other = has(cost) ? cost - land - hard : 0
  const loan = fields.construction_loan ?? 0
  const equity = fields.total_equity ?? (has(cost) && has(fields.construction_loan) ? cost - fields.construction_loan : null)
  const sponsorEq = has(equity) && has(fields.sponsor_coinvest_pct) ? equity * fields.sponsor_coinvest_pct : 0
  const lpEq = has(equity) ? equity - sponsorEq : 0
  const sources = loan + (equity ?? 0)
  const gap = has(cost) && sources > 0 ? sources - cost : 0
  const contingencyUsd = has(fields.hard_cost_contingency_pct) && hard ? hard * fields.hard_cost_contingency_pct : null

  // Uses. A missing land or hard cost can't be itemised, so the residual is
  // named for what it is rather than passed off as soft costs. The split is
  // drawn only when the whole is the documents' total cost and it adds up.
  const noLand = !has(fields.land_cost)
  const noHard = !has(fields.hard_costs)
  const unitemised = noLand && noHard ? 'Land and hard costs' : noLand ? 'Land cost' : noHard ? 'Hard costs' : null
  const restLabel = unitemised ? 'Rest of total cost' : 'Soft costs & other'
  const over = noLand ? 'Hard costs' : noHard ? 'Land cost' : 'Land and hard costs'
  const usesEmpty = !has(cost) ? `Total project cost ${MISSING} — no split of uses to draw.`
    : cost <= 0 ? `Total project cost reads ${money(cost)} — no split of uses to draw.`
      : other < 0 ? `${over} exceed the ${money(cost)} total project cost by ${money(-other)} — the budget doesn’t add up, so no split is drawn.`
        : noLand && noHard ? `Land and hard costs ${MISSING} — no split of uses to draw.`
          : null
  const uses: Part[] = [
    { key: 'land', label: 'Land', value: noLand ? null : land, color: CK.cat[0] },
    { key: 'hard', label: 'Hard costs', value: noHard ? null : hard, color: CK.cat[1] },
    {
      key: 'other', label: restLabel, value: has(cost) && other >= 0 ? other : null, color: CK.cat[2],
      absent: has(cost) ? `negative — ${over.toLowerCase()} exceed the total` : undefined,
    },
  ]
  const usesNotes: string[] = []
  if (!usesEmpty && unitemised) usesNotes.push(`${unitemised} ${MISSING} — counted in “${restLabel}”.`)
  if (contingencyUsd !== null) {
    usesNotes.push(`Contingency ${pct1(fields.hard_cost_contingency_pct!)} of hard costs ≈ ${money(contingencyUsd)}.`
      + (usesEmpty || unitemised ? '' : ' “Soft costs & other” is total cost less land and hard costs.'))
  }

  // Sources. Total sources are only known when both the loan and the equity
  // are; with either missing there is no whole to take shares of.
  const hasLoan = has(fields.construction_loan)
  const split = has(fields.sponsor_coinvest_pct)
  const srcEmpty = !hasLoan && !has(equity) ? `Construction loan and equity ${MISSING} — no sources to draw.`
    : !hasLoan ? `Construction loan ${MISSING} — total sources unknown, so no split is drawn.`
      : !has(equity) ? `Equity ${MISSING}, and there is no total project cost to derive it from — no split of sources to draw.`
        : equity < 0 ? (fields.total_equity == null && has(cost)
          ? `The ${money(loan)} loan exceeds the ${money(cost)} total project cost, so derived equity is negative — no split drawn.`
          : `Equity reads ${money(equity)} — no split of sources to draw.`)
          : sources > 0 ? null : 'Loan and equity are both $0 — no sources to draw.'
  const srcParts: Part[] = [
    { key: 'loan', label: 'Construction loan', value: hasLoan ? loan : null, color: CK.cat[0] },
    { key: 'lp', label: split ? 'LP equity' : 'Equity (LP / sponsor split unknown)', value: has(equity) ? Math.max(lpEq, 0) : null, color: CK.cat[1] },
    {
      key: 'sponsor', label: 'Sponsor co-invest', value: has(equity) && split ? sponsorEq : null, color: CK.cat[2],
      absent: has(equity) && !split ? `co-invest % ${MISSING}` : undefined,
    },
  ]
  const srcNotes: string[] = []
  if (!srcEmpty) {
    if (!split) srcNotes.push(`Sponsor co-invest % ${MISSING} — equity isn’t split between LP and sponsor.`)
    if (Math.abs(gap) > 1 && has(cost) && Math.abs(gap) / cost > 0.005) {
      srcNotes.push(`Sources ${money(sources)} vs uses ${money(cost)} — a ${money(Math.abs(gap))} ${gap > 0 ? 'surplus' : 'gap'} to ask the sponsor about.`)
    } else if (fields.total_equity == null) {
      srcNotes.push('Equity derived as total cost less the loan.')
    }
  }

  return (
    <div className="capc-two">
      <PartToWhole title="Uses of capital" subtitle="Share of total project cost" head="Use" whole="total project cost"
        parts={uses} notes={usesNotes} empty={usesEmpty}
        totalLabel="Total project cost" knownTotal={has(cost) ? cost : null} />
      <PartToWhole title="Sources of capital" subtitle="Loan and equity, share of total sources" head="Source" whole="total sources"
        parts={srcParts} notes={srcNotes} empty={srcEmpty}
        totalLabel="Total sources" knownTotal={null} />
    </div>
  )
}

// ================================================================ FINANCING

interface RateRow {
  key: string
  label: string
  value: number | null
  emph: boolean
  absent: string
  source: string
  extra?: TipLine
  compare?: string
}

type FinTone = 'pass' | 'flag' | 'na'
const FIN_WORD: Record<FinTone, string> = { pass: 'IN LINE', flag: 'CHECK', na: 'NOTE' }
const FIN_COLOR: Record<FinTone, string> = { pass: CK.pass, flag: CK.watch, na: CK.context }

// Form: emphasis bars — the deal's rate in accent, the market references in
// context gray, value at each bar tip, one % axis from 0.
export function FinancingChart({ fields, market, financingSpreadTypicalBps }: {
  fields: DealFields
  market: MarketContext | null
  financingSpreadTypicalBps: number | null
}) {
  ensureStyle()
  const tip = useTooltip()
  const [measure, width] = useWidth(560)
  const W = Math.max(240, width)

  const fred = (x: number | null | undefined) => (has(x) ? x / 100 : null) // FRED series arrive as percent points
  const sofr = fred(market?.sofr)
  const spreadBps = has(financingSpreadTypicalBps) ? financingSpreadTypicalBps : null
  const prevailing = sofr !== null && spreadBps !== null ? sofr + spreadBps / 10000 : null
  const modeled = has(fields.loan_interest_rate) ? fields.loan_interest_rate : null

  // Compared in whole basis points so a gap of exactly ±0.5 pts lands inside the band.
  const dBps = modeled !== null && prevailing !== null ? Math.round((modeled - prevailing) * 1e4) : null
  let fin: { tone: FinTone; text: string } | null = null
  if (fields.construction_loan === 0) fin = { tone: 'na', text: 'All-equity — no financing exposure' }
  else if (modeled !== null && prevailing !== null && dBps !== null) {
    fin = dBps < -50
      ? { tone: 'flag', text: `Optimistic — modeled ${pct1(modeled)} is ${ptsAbs(dBps)} pts under today’s ≈${pct1(prevailing)}` }
      : dBps <= 50
        ? { tone: 'pass', text: `In line with today’s ≈${pct1(prevailing)} (SOFR + ${spreadBps} bps)` }
        : { tone: 'na', text: `Conservative — modeled ${ptsAbs(dBps)} pts above today’s ≈${pct1(prevailing)}` }
  }
  const vsPrevailing = dBps !== null ? `${dBps >= 0 ? '+' : '−'}${ptsAbs(dBps)} pts` : null
  const subtitle: ReactNode = fin
    ? <><span className="capc-word"><i style={{ background: FIN_COLOR[fin.tone] }} aria-hidden="true" />{FIN_WORD[fin.tone]}</span>{fin.text}</>
    : modeled === null ? `Modeled loan rate ${MISSING} — nothing to compare.`
      : sofr === null ? 'SOFR unavailable — no prevailing rate to compare against.'
        : 'Typical financing spread unavailable — no prevailing rate to compare against.'

  const asof = market?.asofBySeries
  const fredRow = (key: string, label: string, raw: number | null | undefined, date?: string): RateRow => ({
    key, label, value: fred(raw), emph: false, absent: 'not available',
    source: date ? `FRED · ${date}` : 'FRED',
    extra: date ? { value: date, label: 'as of' } : undefined,
  })
  const rows: RateRow[] = [
    {
      key: 'deal', label: 'Deal’s modeled loan rate', value: modeled, emph: true, absent: MISSING, source: 'deal documents',
      extra: vsPrevailing ? { value: vsPrevailing, label: 'vs prevailing' } : undefined,
      compare: vsPrevailing ? `${vsPrevailing} vs prevailing` : undefined,
    },
    {
      key: 'prevailing', label: `Prevailing (SOFR + ${spreadBps ?? '—'} bps)`, value: prevailing, emph: false,
      absent: sofr === null ? 'SOFR unavailable' : 'typical spread unavailable',
      source: spreadBps !== null ? `SOFR + ${spreadBps} bps typical financing spread` : 'SOFR + typical financing spread',
      extra: sofr !== null && spreadBps !== null ? { value: `${pct1(sofr)} + ${spreadBps} bps`, label: 'SOFR + typical spread' } : undefined,
      compare: sofr !== null && spreadBps !== null ? `SOFR ${pct1(sofr)} + ${spreadBps} bps` : undefined,
    },
    fredRow('sofr', 'SOFR', market?.sofr, asof?.sofr),
    fredRow('t10', '10-yr Treasury', market?.treasury10y, asof?.treasury10y),
    fredRow('m30', '30-yr mortgage', market?.mortgage30y, asof?.mortgage30y),
  ]

  const table: TableSpec = {
    columns: ['Rate', 'Value', 'Compared with', 'Source'],
    rows: rows.map(r => [r.label, r.value !== null ? pct1(r.value) : r.absent, r.compare ?? '—', r.source]),
  }
  const note = market?.asof
    ? `Market rates from FRED, as of ${market.asof}. Prevailing = SOFR + the rulebook’s typical financing spread.`
    : 'Market snapshot unavailable.'

  const vals = rows.map(r => r.value).filter(has)
  if (!vals.length) {
    return (
      <ChartCard title="Loan rate vs today’s market" subtitle={subtitle} table={table} note={note}>
        <Empty>No rates to draw — the loan rate is {MISSING} and no market rates are available.</Empty>
      </ChartCard>
    )
  }

  const narrow = W < NARROW
  const labelW = narrow ? 0 : Math.min(200, Math.round(W * 0.38))
  const x0 = labelW
  const x1 = Math.max(x0 + 60, W - 52)
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), narrow ? 4 : 5)
  const x = scaleLinear(ticks[0], ticks[ticks.length - 1], x0, x1)
  const fmtTick = pctTickFormat(ticks)
  const BAR = 16
  const rowH = narrow ? 46 : 32
  const top = 2
  const plotB = top + rows.length * rowH
  const H = plotB + 22
  const grid = gridBands(narrow, rows.length, top, rowH)

  return (
    <ChartCard title="Loan rate vs today’s market" subtitle={subtitle} table={table} note={note}>
      <Plot tip={tip}>
        <div ref={measure}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Deal’s modeled loan rate against prevailing market rates">
            <g className="ck-axis" aria-hidden="true">
              {ticks.map(t => (
                <g key={t}>
                  {grid.map(([y1, y2]) => (
                    <line key={y1} x1={x(t)} x2={x(t)} y1={y1} y2={y2} stroke={t === 0 ? CK.axis : CK.grid} strokeWidth={1} />
                  ))}
                  <text x={x(t)} y={plotB + 15} textAnchor="middle">{fmtTick(t)}</text>
                </g>
              ))}
            </g>
            {rows.map((r, i) => {
              const yTop = top + i * rowH
              const by = narrow ? yTop + 22 : yTop + (rowH - BAR) / 2
              const cy = by + BAR / 2
              const label = narrow
                ? <text className="ck-label" x={0} y={yTop + 13}>{r.label}</text>
                : <text className="ck-label" x={x0 - 10} y={cy} dy="0.35em" textAnchor="end">{r.label}</text>
              if (r.value === null) {
                return (
                  <g key={r.key}>
                    {label}
                    <text className="ck-label" x={x(0) + 4} y={cy} dy="0.35em" style={{ fill: CK.muted, fontStyle: 'italic' }}>{r.absent}</text>
                  </g>
                )
              }
              const v = r.value
              const color = r.emph ? CK.accent : CK.context
              const lines: TipLine[] = [{ value: pct1(v), label: r.label, color }, ...(r.extra ? [r.extra] : [])]
              return (
                <g key={r.key} className="ck-hover" {...tip.bind(lines)}>
                  <rect className="ck-hit" x={0} y={yTop} width={W} height={rowH} />
                  {label}
                  <path className="ck-mark" d={barPath(x(0), x(v), by, BAR)} fill={color} />
                  <text className="ck-value" x={x(v) + (v >= 0 ? 6 : -6)} y={cy} dy="0.35em" textAnchor={v >= 0 ? 'start' : 'end'}>
                    {pct1(v)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </Plot>
    </ChartCard>
  )
}

// ================================================================= TIMELINE

interface Span {
  key: string
  label: string
  from: number | null
  to: number | null
  color: string
  mark: 'bar' | 'line'
  extra?: TipLine[]
  compare?: string
}

/** Month ticks on 1/2/3/6/12-month steps, from 0 past `max`. */
function monthTicks(max: number, count: number): number[] {
  const step = [1, 2, 3, 6, 12, 24, 36, 60, 120].find(s => Math.ceil(max / s) <= count) ?? Math.ceil(max / count)
  const n = Math.max(1, Math.ceil(max / step))
  return Array.from({ length: n + 1 }, (_, i) => i * step)
}

function paceVsRecord(lease: number, record: number): TipLine {
  const d = record - lease
  if (d === 0) return { value: 'same', label: 'pace as the submarket record' }
  return { value: `${mo(Math.abs(d))} mo`, label: d > 0 ? 'faster than the submarket record' : 'slower than the submarket record' }
}

// Form: a month-axis timeline — phases as bars, the submarket's lease-up
// record as a gray reference bar, and the interest reserve as a line so it
// reads as coverage, not a phase. Given Gate 1's interest_reserve check, a
// tick marks the month the engine needs the reserve to reach (construction +
// the rulebook buffer) and the engine's own margin is reported.
export function TimelineChart({ fields, reserveCheck }: { fields: DealFields; reserveCheck?: CheckResult | null }) {
  ensureStyle()
  const tip = useTooltip()
  const [measure, width] = useWidth(560)
  const W = Math.max(240, width)
  const build = fields.construction_duration_months
  const lease = fields.lease_up_months_assumed
  const record = fields.submarket_leaseup_months
  const reserve = fields.interest_reserve_months
  const title = 'Development timeline'

  if (!has(build)) {
    const input = (label: string, v: number | null) => [label, has(v) ? `${mo(v)} mo` : MISSING]
    return (
      <ChartCard title={title} table={{
        columns: ['Input', 'Months'],
        rows: [
          input('Construction duration', build),
          input('Lease-up (underwritten)', lease),
          input('Lease-up (submarket record)', record),
          input('Interest reserve', reserve),
        ],
      }}>
        <Empty>Construction duration {MISSING} — no timeline to draw.</Empty>
      </ChartCard>
    )
  }

  const b = build
  // Gate 1's need: construction + the rulebook buffer (engine: interest_reserve).
  const rc = reserveCheck && reserveCheck.id === 'interest_reserve' ? reserveCheck : null
  const buffer = rc?.threshold?.effective ?? null
  const required = has(buffer) ? b + buffer : null
  const margin = rc && has(rc.margin) ? rc.margin : null
  const signedMo = (n: number) => `${n >= 0 ? '+' : '−'}${mo(Math.abs(n))} mo`

  const pace = has(lease) && has(record) ? paceVsRecord(lease, record) : null
  const reserveTips: TipLine[] = !has(reserve) ? []
    : required !== null && has(buffer)
      ? [
        { value: `month ${mo(required)}`, label: `Gate 1 need (construction + ${mo(buffer)}-mo buffer)` },
        ...(margin !== null ? [{ value: signedMo(margin), label: `Gate 1 margin (${margin >= 0 ? 'spare' : 'short'})` }] : []),
      ]
      : [{ value: `month ${mo(b)}`, label: 'construction ends' }]
  const reserveCompare = !has(reserve) ? undefined
    : required !== null && has(buffer)
      ? `Gate 1 needs month ${mo(required)} (construction + ${mo(buffer)}-mo buffer)`
        + (margin !== null ? `; margin ${signedMo(margin)}` : '')
      : `construction ends at month ${mo(b)}`

  const spans: Span[] = [
    { key: 'build', label: 'Construction', from: 0, to: b, color: CK.cat[0], mark: 'bar' },
    {
      key: 'lease', label: 'Lease-up (underwritten)', from: has(lease) ? b : null, to: has(lease) ? b + lease : null,
      color: CK.cat[1], mark: 'bar', extra: pace ? [pace] : undefined, compare: pace ? `${pace.value} ${pace.label}` : undefined,
    },
    {
      key: 'record', label: 'Lease-up (submarket record)', from: has(record) ? b : null, to: has(record) ? b + record : null,
      color: CK.context, mark: 'bar',
    },
    {
      key: 'reserve', label: 'Interest reserve covers', from: has(reserve) ? 0 : null, to: has(reserve) ? reserve : null,
      color: CK.cat[2], mark: 'line', extra: reserveTips, compare: reserveCompare,
    },
  ]
  const drawn = spans.filter((s): s is Span & { from: number; to: number } => s.from !== null && s.to !== null)
  const needTick = has(reserve) ? required : null

  const table: TableSpec = {
    columns: ['Span', 'From', 'To', 'Length', 'Compared with'],
    rows: spans.map(s => s.from !== null && s.to !== null
      ? [s.label, `month ${mo(s.from)}`, `month ${mo(s.to)}`, `${mo(s.to - s.from)} mo`, s.compare ?? '—']
      : [s.label, '—', '—', MISSING, '—']),
  }
  const legend: LegendItem[] = drawn.map(s => ({ label: s.label, color: s.color, shape: s.mark === 'line' ? 'line' : 'rect' }))
  const note = 'Lease-up is drawn from the end of construction; Gate 1 flags an underwritten lease-up faster than the submarket record. '
    + (required !== null && has(buffer)
      ? `Gate 1 needs the interest reserve to reach month ${mo(required)} — construction plus the rulebook’s ${mo(buffer)}-month buffer`
        + (needTick !== null ? ' (the dark tick on its row)' : '')
        + (margin !== null ? `; this reserve ${margin >= 0 ? `has ${mo(margin)} mo to spare` : `falls ${mo(-margin)} mo short`}.` : '.')
      : 'Gate 1 also wants the interest reserve to outlast construction by the rulebook’s buffer.')

  const narrow = W < NARROW
  const labelW = narrow ? 0 : Math.min(190, Math.round(W * 0.34))
  const rangeW = narrow ? 0 : 78
  const x0 = labelW
  const x1 = Math.max(x0 + 60, W - (narrow ? 18 : rangeW))
  const ticks = monthTicks(Math.max(0, ...drawn.map(s => s.to), needTick ?? 0), narrow ? 4 : 6)
  const x = scaleLinear(0, ticks[ticks.length - 1], x0, x1)
  const BAR = 16
  const rowH = narrow ? 46 : 34
  const top = 2
  const plotB = top + spans.length * rowH
  const H = plotB + 22
  const grid = gridBands(narrow, spans.length, top, rowH)

  return (
    <ChartCard title={title} subtitle="Months from construction start, from the documents’ durations" legend={legend} table={table} note={note}>
      <Plot tip={tip}>
        <div ref={measure}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Development timeline in months">
            <g className="ck-axis" aria-hidden="true">
              {ticks.map((t, i) => (
                <g key={t}>
                  {grid.map(([y1, y2]) => (
                    <line key={y1} x1={x(t)} x2={x(t)} y1={y1} y2={y2} stroke={t === 0 ? CK.axis : CK.grid} strokeWidth={1} />
                  ))}
                  <text x={x(t)} y={plotB + 15} textAnchor="middle">{i === ticks.length - 1 ? `${t} mo` : t}</text>
                </g>
              ))}
            </g>
            {spans.map((s, i) => {
              const yTop = top + i * rowH
              const by = narrow ? yTop + 22 : yTop + (rowH - BAR) / 2
              const cy = by + BAR / 2
              const range = s.from !== null && s.to !== null ? `${mo(s.from)}–${mo(s.to)} mo` : '—'
              const labelY = narrow ? yTop + 13 : cy
              const text = (
                <>
                  {narrow
                    ? <text className="ck-label" x={0} y={labelY}>{s.label}</text>
                    : <text className="ck-label" x={x0 - 10} y={labelY} dy="0.35em" textAnchor="end">{s.label}</text>}
                  <text className="ck-label" x={W} y={labelY} dy={narrow ? undefined : '0.35em'} textAnchor="end"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>{range}</text>
                </>
              )
              if (s.from === null || s.to === null) {
                return (
                  <g key={s.key}>
                    {text}
                    <text className="ck-label" x={x0 + 4} y={cy} dy="0.35em" style={{ fill: CK.muted, fontStyle: 'italic' }}>{MISSING}</text>
                  </g>
                )
              }
              const lines: TipLine[] = [
                { value: `${mo(s.from)}–${mo(s.to)} mo`, label: s.label, color: s.color },
                { value: `${mo(s.to - s.from)} mo`, label: 'length' },
                ...(s.extra ?? []),
              ]
              return (
                <g key={s.key} className="ck-hover" {...tip.bind(lines)}>
                  <rect className="ck-hit" x={0} y={yTop} width={W} height={rowH} />
                  {text}
                  {s.mark === 'bar' ? (
                    s.to > s.from && <path className="ck-mark" d={barPath(x(s.from), x(s.to), by, BAR)} fill={s.color} />
                  ) : (
                    <>
                      {s.key === 'reserve' && needTick !== null && (
                        <line x1={x(needTick)} x2={x(needTick)} y1={by - 3} y2={by + BAR + 3} stroke={CK.ink2} strokeWidth={2} />
                      )}
                      <line className="ck-mark" x1={x(s.from)} x2={x(s.to)} y1={cy} y2={cy} stroke={s.color} strokeWidth={2} strokeLinecap="round" />
                      <circle cx={x(s.to)} cy={cy} r={6.5} fill={CK.surface} />
                      <circle className="ck-mark" cx={x(s.to)} cy={cy} r={4.5} fill={s.color} />
                    </>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </Plot>
    </ChartCard>
  )
}

export default UsesSourcesCharts

// ==================================================================== STYLE

let injected = false
function ensureStyle() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.id = 'capc-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

const CSS = `
.capc-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
@media(max-width:720px){.capc-two{grid-template-columns:minmax(0,1fr)}}
.capc-legend{margin-top:.8rem;font-size:.8rem}
.capc-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto auto;gap:.6rem;align-items:center;padding:.28rem 0}
.capc-sw{width:10px;height:10px;border-radius:2px}
.capc-sw-none{box-sizing:border-box;border:1px solid ${CK.axis};background:transparent}
.capc-miss{grid-column:span 2;text-align:right;color:${CK.muted};font-style:italic}
.capc-lab{color:${CK.ink2};min-width:0}
.capc-pct{color:${CK.ink2};text-align:right;font-variant-numeric:tabular-nums;min-width:3.1rem}
.capc-val{color:${CK.ink};text-align:right;font-variant-numeric:tabular-nums;min-width:4.4rem;font-weight:500}
.capc-total{border-top:1px solid ${CK.grid};margin-top:.25rem;padding-top:.45rem}
.capc-total .capc-lab{color:${CK.ink};font-weight:500}
.capc-empty{font-size:.82rem;color:${CK.ink2};padding:.9rem 0 .2rem;line-height:1.45}
.capc-word{display:inline-flex;align-items:center;gap:.35rem;font-size:9.5px;font-weight:700;letter-spacing:.08em;color:${CK.ink};
  border:1px solid ${CK.grid};border-radius:4px;padding:1px 6px;margin-right:.45rem;vertical-align:1px}
.capc-word i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
`
