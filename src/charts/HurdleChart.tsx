// HurdleChart — the deal's projected IRR against the required return, with the
// required return built up from the macro snapshot's hurdle stack (macro.ts §5:
// anchor + illiquidity + development + regime premiums) so the reader sees what
// the bar is made of, not only where it sits. Provisional until the client's own
// hurdle formula arrives.
// Form: horizontal waterfall on one % axis from 0 — stack steps in one neutral
// hue, the required-return total in a darker neutral, the deal's two bars in the
// accent, a reference line at the required return, signed deltas at bar ends.
import { useCallback, useRef, useState } from 'react'
import { CK, ChartCard, Plot, niceTicks, scaleLinear, useTooltip, type LegendItem, type TableSpec, type TipLine } from './ChartKit'

export interface HurdleStack {
  anchorPct: number
  illiquidityBps: number
  complexityBps: number
  regimeBps: number
  totalPct: number
}

interface Props {
  /** Sponsor-reported projected IRR (fraction), or null when not in the documents. */
  irr: number | null
  /** MacroSnapshot.hurdle as-is (narrowed here, so an incomplete stack reads as incomplete); null/absent when there is no snapshot. */
  hurdle?: HurdleStack | Record<string, number> | null
  /** Macro regime the stack was priced in (e.g. 'soft_landing'). */
  regime?: string
  /** Flat fee subtracted for the "after fee" bar — an approximation. */
  feePct?: number
}

const DEFAULT_FEE = 0.02 // the client's stated baseline fee (9/9 session), negotiable per deal
const STEP = CK.context
const REQ = CK.ink2
const DEAL = CK.accent
const HALO = { paintOrder: 'stroke', stroke: CK.surface, strokeWidth: 3, strokeLinejoin: 'round' } as const

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`.replace(/^-/, '−')
const bps = (b: number) => `${b >= 0 ? '+' : '−'}${Math.abs(Math.round(b))} bps`
const tickPct = (v: number) => `${Number((v * 100).toFixed(1))}%`.replace(/^-/, '−')
function pts(x: number): string {
  const r = Math.round(x * 1000) / 10
  return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} pts`
}
/** Fee in points at the label's precision (up to 2 dp, at least 1): 2.0, 1.5, 1.25. */
function feeNum(f: number): string {
  const v = Number((f * 100).toFixed(2))
  const s = String(v)
  return s.includes('.') ? s : v.toFixed(1)
}
/** Rough rendered width of an 11.5px label — enough to keep end labels inside the viewBox. */
const textW = (s: string) => s.length * 6.4

/**
 * Narrows MacroSnapshot.hurdle to the stack, or null when absent or incomplete —
 * never a guessed component. The chart takes MacroSnapshot.hurdle directly; use
 * this only where a narrowed stack is needed elsewhere.
 */
export function hurdleStackFrom(h: Record<string, number> | null | undefined): HurdleStack | null {
  return h ? pickStack(h) : null
}

function pickStack(h: Partial<Record<keyof HurdleStack, unknown>>): HurdleStack | null {
  const { anchorPct, illiquidityBps, complexityBps, regimeBps, totalPct } = h
  if (!fin(anchorPct) || !fin(illiquidityBps) || !fin(complexityBps) || !fin(regimeBps) || !fin(totalPct)) return null
  return { anchorPct, illiquidityBps, complexityBps, regimeBps, totalPct }
}

/** Container width, re-measured on resize, so text stays at its real size on a phone. */
function useWidth(initial: number): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(initial)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    const read = () => {
      const cw = Math.round(el.clientWidth)
      if (cw > 0) setW(cw)
    }
    read()
    if (typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver(read)
      ro.current.observe(el)
    }
  }, [])
  return [ref, w]
}

/** Bar from `a` to `b`: 4px rounded data end (b), square start (a). */
function barPath(xa: number, xb: number, y: number, h: number): string | null {
  const w = Math.abs(xb - xa)
  if (w < 0.5) return null
  const r = Math.min(4, w / 2, h / 2)
  return xb >= xa
    ? `M${xa},${y}H${xb - r}A${r},${r} 0 0 1 ${xb},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${xb - r},${y + h}H${xa}Z`
    : `M${xa},${y}H${xb + r}A${r},${r} 0 0 0 ${xb},${y + r}V${y + h - r}A${r},${r} 0 0 0 ${xb + r},${y + h}H${xa}Z`
}

interface Row {
  key: string
  label: string
  group: 'stack' | 'deal'
  strong?: boolean
  /** Bar extent in value units; absent for a text-only (missing input) row. */
  bar?: { from: number; to: number; fill: string }
  /** Waterfall connector from the previous step's end. */
  linkAt?: number
  value?: string
  delta?: string
  missing?: string
  tip?: TipLine[]
}

const endText = (r: Row) => `${r.value ?? ''}${r.delta ? ` · ${r.delta}` : ''}`

export default function HurdleChart({ irr, hurdle, regime, feePct = DEFAULT_FEE }: Props) {
  const tip = useTooltip()
  const [boxRef, width] = useWidth(640)

  const title = 'Return vs required return'
  const regimeText = regime ? regime.replace(/_/g, ' ') : null
  const subtitle = `Sponsor-reported IRR against the required return${regimeText ? ` · ${regimeText} regime` : ''}`
  const feeOk = fin(feePct) && feePct >= 0
  const fee = feeOk ? feePct : 0
  const baselineFee = feeOk && Math.abs(fee - DEFAULT_FEE) < 1e-9
  const feeText = `~${Number((fee * 100).toFixed(2))}%`
  const feePts = `${feeNum(fee)} pts`
  const hasIrr = fin(irr)
  const h = hurdle ? pickStack(hurdle) : null

  // ------------------------------------------------------------ empty state
  if (!h) {
    const why = hurdle
      ? 'The macro snapshot’s hurdle stack is incomplete'
      : 'Required return not available — there is no macro snapshot hurdle stack'
    const table: TableSpec = {
      columns: ['Line', 'Value'],
      rows: [
        ['Required return', hurdle ? 'hurdle stack incomplete' : 'not available — no macro snapshot'],
        ['Projected IRR (sponsor-reported)', hasIrr ? pct1(irr) : 'not in the documents'],
      ],
    }
    return (
      <ChartCard title={title} subtitle={subtitle} table={table}
        note="Provisional — the required return comes from the weekly macro snapshot until the client’s own hurdle formula arrives.">
        <div style={{ marginTop: '.8rem', fontSize: '.85rem', color: CK.ink2, lineHeight: 1.5 }}>
          {why}, so there is nothing to measure the IRR against.
          {hasIrr ? ` Projected IRR (sponsor-reported): ${pct1(irr)}.` : ' The projected IRR is not in the documents either.'}
        </div>
      </ChartCard>
    )
  }

  // ------------------------------------------------------------------ data
  const total = h.totalPct
  // Row labels stay short (the subtitle names the regime); the table and note carry the full name.
  const steps = [
    { key: 'illiquidity', name: 'Illiquidity premium', full: 'Illiquidity premium', short: 'illiquidity', b: h.illiquidityBps },
    { key: 'development', name: 'Development complexity', full: 'Development complexity', short: 'development', b: h.complexityBps },
    { key: 'regime', name: 'Regime premium', full: regimeText ? `Regime premium (${regimeText})` : 'Regime premium', short: 'regime', b: h.regimeBps },
  ]
  const sum = h.anchorPct + (h.illiquidityBps + h.complexityBps + h.regimeBps) / 10_000
  const mismatch = Math.abs(sum - total) > 0.00005 // more than half a basis point apart

  const rows: Row[] = [{
    key: 'anchor', label: 'Base anchor', group: 'stack',
    bar: { from: 0, to: h.anchorPct, fill: STEP },
    value: pct1(h.anchorPct),
    tip: [{ value: pct1(h.anchorPct), label: 'base anchor', color: STEP }],
  }]
  const tableRows: string[][] = [['Base anchor', pct1(h.anchorPct), pct1(h.anchorPct), '']]
  const skipped: string[] = []
  let running = h.anchorPct
  for (const s of steps) {
    const next = running + s.b / 10_000
    const sign = s.b >= 0 ? '+' : '−'
    const label = `${sign} ${s.name}`
    if (s.b === 0) {
      skipped.push(s.full)
      tableRows.push([`${sign} ${s.full}`, bps(0), pct1(next), 'zero in this snapshot — not drawn'])
    } else {
      rows.push({
        key: s.key, label, group: 'stack', linkAt: running,
        bar: { from: running, to: next, fill: STEP },
        value: bps(s.b),
        tip: [
          { value: bps(s.b), label: s.short, color: STEP },
          { value: pct1(next), label: 'running total' },
        ],
      })
      tableRows.push([`${sign} ${s.full}`, bps(s.b), pct1(next), ''])
    }
    running = next
  }
  rows.push({
    key: 'required', label: 'Required return', group: 'stack', strong: true, linkAt: sum,
    bar: { from: 0, to: total, fill: REQ },
    value: pct1(total),
    tip: [
      { value: pct1(total), label: 'required (provisional)', color: REQ },
      ...(mismatch ? [{ value: pct1(sum), label: 'components sum' }] : []),
    ],
  })
  tableRows.push(['Required return', pct1(total), '—',
    mismatch ? `components sum to ${pct1(sum)}; the snapshot’s total is shown` : 'provisional until the client’s hurdle formula arrives'])

  const showNet = hasIrr && feeOk && fee > 0
  if (hasIrr) {
    rows.push({
      key: 'irr', label: 'Projected IRR (sponsor-reported)', group: 'deal', strong: true,
      bar: { from: 0, to: irr, fill: DEAL },
      value: pct1(irr), delta: pts(irr - total),
      tip: [
        { value: pct1(irr), label: 'projected IRR (sponsor)', color: DEAL },
        { value: pts(irr - total), label: 'vs required' },
      ],
    })
    tableRows.push(['Projected IRR (sponsor-reported)', pct1(irr), '—', `${pts(irr - total)} vs required`])
    if (showNet) {
      const net = irr - fee
      const label = `IRR after ${feeText} fee`
      rows.push({
        key: 'net', label, group: 'deal', strong: true,
        bar: { from: 0, to: net, fill: DEAL },
        value: pct1(net), delta: pts(net - total),
        tip: [
          { value: pct1(net), label: `after ${feeText} fee (approx.)`, color: DEAL },
          { value: pts(net - total), label: 'vs required' },
          { value: `−${feePts}`, label: 'fee' },
        ],
      })
      tableRows.push(['Fee deducted (approximation)', feePts, '—',
        `${baselineFee ? 'client’s stated baseline fee' : 'per-deal fee input'}, subtracted flat`])
      tableRows.push([label, pct1(net), '—', `${pts(net - total)} vs required · approximation`])
    } else if (!feeOk) {
      rows.push({ key: 'net', label: 'IRR after fee', group: 'deal', strong: true, missing: 'fee not available' })
      tableRows.push(['IRR after fee', 'not shown — the fee input is not a valid rate', '—', ''])
    }
  } else {
    rows.push({ key: 'irr', label: 'Projected IRR (sponsor-reported)', group: 'deal', strong: true, missing: 'not in the documents' })
    tableRows.push(['Projected IRR (sponsor-reported)', 'not in the documents', '—', ''])
  }

  // ---------------------------------------------------------------- layout
  const narrow = width < 560
  const values = [0, total, sum, h.anchorPct]
  for (const r of rows) if (r.bar) values.push(r.bar.from, r.bar.to)
  const ticks = niceTicks(Math.min(...values), Math.max(...values), narrow ? 4 : 5)
  const d0 = ticks[0]
  const d1 = ticks[ticks.length - 1]

  const labelW = narrow ? 0 : 210
  const x0 = narrow ? 1 : labelW + 14
  const right = width - 2
  // Widest span that still keeps every end label inside the viewBox. A deal label
  // short of the required return may be pushed past the reference line (+1px).
  let span = right - x0 - 14
  for (const r of rows) {
    if (!r.bar) continue
    const deal = r.group === 'deal'
    const end = Math.max(r.bar.from, r.bar.to, deal ? total : -Infinity)
    const frac = (end - d0) / (d1 - d0)
    const lw = (deal ? 7 : 6) + textW(endText(r))
    if (frac > 0) span = Math.min(span, (right - x0 - lw) / frac)
  }
  span = Math.max(60, span)
  const x = scaleLinear(d0, d1, x0, x0 + span)
  const xRef = x(total)

  /** Value-label start: at the bar end, except a deal label that would touch the reference line jumps past it. */
  const labelX = (r: Row): number => {
    if (!r.bar) return x(0) + 6
    const end = Math.max(x(r.bar.from), x(r.bar.to))
    if (r.group !== 'deal' || end >= xRef) return end + 6
    return end + 6 + textW(endText(r)) + 8 <= xRef ? end + 6 : xRef + 7
  }

  const rowH = narrow ? 42 : 30
  const barH = narrow ? 18 : 20
  const barOff = narrow ? 18 : (rowH - barH) / 2
  const groupGap = 12
  let y = 4
  const placed = rows.map((r, i) => {
    if (i > 0 && r.group !== rows[i - 1].group) y += groupGap
    const top = y
    y += rowH
    return { r, top, barY: top + barOff }
  })
  const plotBottom = y + 2
  const H = plotBottom + 22

  const reqRow = placed.find(p => p.r.key === 'required')!
  const dealBars = placed.filter(p => p.r.group === 'deal' && p.r.bar)
  const lastDeal = dealBars[dealBars.length - 1]

  const legend: LegendItem[] = [
    { label: 'Required-return components', color: STEP },
    { label: 'Required return', color: REQ },
    ...(hasIrr ? [{ label: 'This deal', color: DEAL }] : []),
  ]

  const note = [
    'Provisional: the required return is the weekly macro snapshot’s hurdle stack, used until the client’s own hurdle formula arrives.',
    showNet
      ? `The after-fee bar subtracts a flat ${feeText}${baselineFee ? ' (the client’s stated baseline fee)' : ' fee (per-deal input)'} from the sponsor’s IRR — an approximation, not a modeled net IRR.`
      : '',
    hasIrr && !feeOk ? 'The fee input is not a usable rate, so no after-fee bar is drawn.' : '',
    skipped.length ? `${skipped.join(' and ')} ${skipped.length === 1 ? 'is' : 'are'} 0 bps in this snapshot — not drawn.` : '',
    mismatch ? `The components sum to ${pct1(sum)} but the snapshot reports ${pct1(total)}; the total bar shows the snapshot’s figure.` : '',
  ].filter(Boolean).join(' ')

  const aria = `Required return ${pct1(total)}${hasIrr ? `; projected IRR ${pct1(irr)}, ${pts(irr - total)}` : '; projected IRR not in the documents'}`

  return (
    <ChartCard title={title} subtitle={subtitle} legend={legend} table={{ columns: ['Line', 'Value', 'Running total', 'Note'], rows: tableRows }} note={note}>
      <div ref={boxRef}>
        <Plot tip={tip}>
          <svg viewBox={`0 0 ${width} ${H}`} role="group" aria-label={aria}>
            {/* grid + zero baseline */}
            {ticks.map(t => (
              <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={plotBottom} stroke={t === 0 ? CK.axis : CK.grid} strokeWidth={1} />
            ))}
            <g aria-hidden="true">
              {ticks.map((t, i) => {
                const tx = x(t)
                const anchor = i === 0 && tx < 16 ? 'start' : i === ticks.length - 1 && tx + 16 > width ? 'end' : 'middle'
                return <text key={t} className="ck-tick" x={tx} y={plotBottom + 15} textAnchor={anchor}>{tickPct(t)}</text>
              })}
            </g>

            {/* waterfall connectors (wide layout only — on a phone they cross the row labels) */}
            {!narrow && placed.map((p, i) => p.r.linkAt !== undefined && i > 0 && (
              <line key={`l-${p.r.key}`} x1={x(p.r.linkAt)} x2={x(p.r.linkAt)}
                y1={placed[i - 1].barY + barH} y2={p.barY} stroke={CK.axis} strokeWidth={1} />
            ))}

            {/* marks — each whole row is the hover/focus target */}
            {placed.map(({ r, top, barY }) => {
              if (!r.bar) return null
              const d = barPath(x(r.bar.from), x(r.bar.to), barY, barH)
              return (
                <g key={r.key} className="ck-hover" {...tip.bind(r.tip ?? [])}>
                  <rect className="ck-hit" x={0} y={top} width={width} height={rowH} />
                  {d && <path className="ck-mark" d={d} fill={r.bar.fill} />}
                </g>
              )
            })}

            {/* reference line at the required return, down through the deal's bars; on a
                phone the row labels sit between bars, so it is drawn over each bar band only */}
            {lastDeal && (
              <g pointerEvents="none" aria-hidden="true">
                {narrow
                  ? [reqRow, ...dealBars].map(p => (
                    <line key={p.r.key} x1={xRef} x2={xRef} y1={p.barY - 2} y2={p.barY + barH + 2} stroke={REQ} strokeWidth={2} />
                  ))
                  : <line x1={xRef} x2={xRef} y1={reqRow.barY} y2={lastDeal.barY + barH + 4} stroke={REQ} strokeWidth={2} />}
              </g>
            )}

            {/* text above the line, never a pointer target (the row's hit area sits beneath);
                a drawn row's text is aria-hidden — its role="img" label already carries it */}
            <g pointerEvents="none">
              {placed.map(({ r, top, barY }) => {
                const midY = barY + barH / 2
                const style = { ...HALO, ...(r.strong ? { fill: CK.ink, fontWeight: 500 } : {}) }
                const lx = labelX(r)
                return (
                  <g key={r.key} aria-hidden={r.bar ? true : undefined}>
                    {narrow
                      ? <text className="ck-label" style={style} x={1} y={top + 12}>{r.label}</text>
                      : <text className="ck-label" style={style} x={labelW} y={top + rowH / 2} dy="0.35em" textAnchor="end">{r.label}</text>}
                    {r.bar ? (
                      <text x={lx} y={midY} dy="0.35em" style={HALO}>
                        <tspan className={r.strong ? 'ck-value' : 'ck-label'}>{r.value}</tspan>
                        {r.delta && <>
                          <tspan className="ck-label" dx={4}>·</tspan>
                          <tspan className="ck-value" dx={4}>{r.delta}</tspan>
                        </>}
                      </text>
                    ) : (
                      <text x={lx} y={midY} dy="0.35em" className="ck-label" style={{ fill: CK.muted, fontStyle: 'italic' }}>
                        {r.missing}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        </Plot>
      </div>
    </ChartCard>
  )
}
