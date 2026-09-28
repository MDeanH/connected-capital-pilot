// StressChart — the client's worst-case question: after each posture's
// hard-cost overrun (equity-funded) and exit-cap widening, does the deal's
// equity multiple still clear that posture's floor? Every plotted number,
// verdict and margin is the engine's own mini_stress result (scenarios[p].stress
// + the mini_stress check's status, margin and fragile flag). The empty state
// only names a cause after checking it against the deal fields.
//
// Form: bullet chart — one row per posture on ONE shared equity-multiple axis
// from 0; bar = stressed multiple (PASS/FAIL color, word always alongside),
// dark tick = that posture's floor, signed margin (x) at the right.
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { CK, ChartCard, Plot, PostureDot, niceTicks, scaleLinear, useTooltip, type LegendItem, type TableSpec, type TipLine } from './ChartKit'
import { fmtMargin } from '../GateResults'
import { ALL_FIELDS } from '../deal-types'
import type { CheckResult, DealFields, Posture, PostureScenario } from '../deal-types'

type Status = CheckResult['status']

interface Props {
  scenarios?: Record<Posture, PostureScenario>
  posture: Posture
  /** Optional: lets the empty state name exactly which stress inputs are missing. */
  fields?: DealFields | null
}

interface Row {
  p: Posture
  hasStress: boolean
  em: number | null
  floor: number | null
  hardCost: number | null
  capBps: number | null
  status: Status
  /** Engine's thin-pass flag: passes, but within the rulebook's fragile band. */
  fragile: boolean
  margin: number | null
}

const POSTURES: Posture[] = ['green', 'yellow', 'red']
const NAME: Record<Posture, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }
const WORD: Record<Status, string> = { pass: 'PASS', flag: 'WATCH', fail: 'FAIL', missing: 'MISSING', na: 'N/A' }
const BAR: Record<Status, string> = { pass: CK.pass, flag: CK.watch, fail: CK.fail, missing: CK.context, na: CK.context }
const TITLE = 'Worst case: the stress test under each posture'

// Layout (SVG units = CSS px: the viewBox tracks the measured width 1:1).
const DOT_X = 10
const TEXT_X = 26
const PAD_R = 4
const BAR_H = 16
const CH = 6.6 // conservative average glyph width at 11.5px, for fit decisions
const CH_SM = 6.3 // same at 11px

// NaN thresholds arrive as null over JSON — treat both as "not set".
const fin = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
const xm = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}x`
/** Signed margin in x; a sub-0.01x gap reads "<0.01x", never a contradictory "±0.00x". */
const signed = (m: number) => {
  if (m === 0) return '0.00x'
  const s = m > 0 ? '+' : '−'
  return Math.abs(m) < 0.005 ? `${s}<0.01x` : `${s}${fmtMargin('mini_stress', m)}`
}
const bumpPct = (p: number) => { const v = Math.round(p * 1000) / 10; return `${v >= 0 ? '+' : '−'}${Math.abs(v)}%` }
const bumpBps = (b: number) => `${b >= 0 ? '+' : '−'}${Math.abs(Math.round(b))} bps`
const tickLabel = (v: number) => `${v < 0 ? '−' : ''}${Number(Math.abs(v).toFixed(2))}x`
const fieldLabel = (k: keyof DealFields) => ALL_FIELDS.find(d => d.key === k)?.label ?? k

const costText = (r: Row, short = false) =>
  r.hardCost !== null ? `${bumpPct(r.hardCost)} hard costs` : short ? 'overrun not set' : 'hard-cost overrun not set'
const capText = (r: Row, short = false) =>
  r.capBps !== null ? `${bumpBps(r.capBps)} exit cap` : short ? 'cap bump not set' : 'exit-cap widening not set'
const stressText = (r: Row, short = false) => `${costText(r, short)} · ${capText(r, short)}`
const statusWord = (r: Row) => `${WORD[r.status]}${r.fragile ? ' · thin' : ''}`
const resultText = (r: Row) => `${statusWord(r)}${r.margin !== null ? ` ${signed(r.margin)}` : ''}`
const barColor = (r: Row) => (r.fragile ? CK.watch : BAR[r.status])

function rowsOf(sc: Record<Posture, PostureScenario>): Row[] {
  return POSTURES.map(p => {
    const s = sc[p]
    const st = s?.stress
    const ck = s?.checks.find(c => c.id === 'mini_stress')
    const rawEm = st?.stressedEquityMultiple
    const rawFloor = fin(st?.floor) ? st!.floor : ck?.threshold
    const rawCost = st?.hardCostBumpPct
    const rawCap = st?.exitCapBumpBps
    const rawMargin = ck?.margin
    const status: Status = ck?.status ?? 'missing'
    return {
      p,
      hasStress: !!st,
      em: fin(rawEm) ? rawEm : null,
      floor: fin(rawFloor) ? rawFloor : null,
      hardCost: fin(rawCost) ? rawCost : null,
      capBps: fin(rawCap) ? rawCap : null,
      status,
      fragile: status === 'pass' && !!ck?.fragile,
      margin: fin(rawMargin) ? rawMargin : null,
    }
  })
}

function listText(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

const NO_FIELDS =
  'The engine returned no stressed multiple (see the Gate 1 mini-stress check). It needs hard costs, stabilized NOI, the exit cap rate, the construction loan and total equity (or total project cost) from the documents, the rulebook’s selling-costs setting, and equity that stays above zero after the overrun.'

/** Why one posture's stressed multiple is absent — each cause is checked before it is named. */
function causeOf(r: Row, f: DealFields | null | undefined): string {
  if (!r.hasStress) return 'The active rulebook has no mini-stress check.'
  const unset = [
    r.floor === null ? 'stress floor' : '',
    r.hardCost === null ? 'hard-cost overrun' : '',
    r.capBps === null ? 'exit-cap widening' : '',
  ].filter(Boolean)
  if (unset.length) return `The rulebook sets no ${listText(unset)} for this asset class, so the stress test can’t run.`
  if (!f) return NO_FIELDS

  const { hard_costs: hc, stabilized_noi_untrended: noi, exit_cap_rate: cap, construction_loan: loan, total_equity: te, total_project_cost: tpc } = f
  const miss: string[] = []
  if (!fin(hc)) miss.push(fieldLabel('hard_costs'))
  if (!fin(noi)) miss.push(fieldLabel('stabilized_noi_untrended'))
  if (!fin(cap)) miss.push(fieldLabel('exit_cap_rate'))
  if (!fin(loan)) miss.push(fieldLabel('construction_loan'))
  if (!fin(te) && !fin(tpc)) miss.push(`${fieldLabel('total_equity')} (or ${fieldLabel('total_project_cost').toLowerCase()})`)
  if (miss.length || !fin(hc) || !fin(cap) || !fin(loan)) return `The stress test can’t run — not in the documents: ${listText(miss)}.`

  // Same equity and guards as the engine's stressedEquityMultiple.
  const equity = fin(te) ? te : fin(tpc) ? tpc - loan : null
  if (equity !== null && r.hardCost !== null && equity + hc * r.hardCost <= 0)
    return `Equity after the hard-cost overrun comes out at zero or below${fin(te) ? '' : ' (equity here is total project cost minus the construction loan)'}, so the multiple is undefined.`
  if (r.capBps !== null && cap + r.capBps / 1e4 <= 0)
    return 'The stressed exit cap (exit cap plus the widening) is zero or below, so the multiple is undefined.'
  return 'Every deal input and the floor, overrun and exit-cap settings are present, so the gap is most likely the rulebook’s selling-costs setting, which the stress result doesn’t report — see the Gate 1 mini-stress check.'
}

/** Causes grouped by posture; posture names prefix them when they differ or only some postures are missing. */
function whyMissing(rows: Row[], fields: DealFields | null | undefined, partial: boolean): string {
  const groups = new Map<string, Posture[]>()
  for (const r of rows) {
    const c = causeOf(r, fields)
    groups.set(c, [...(groups.get(c) ?? []), r.p])
  }
  if (!partial && groups.size === 1) return [...groups.keys()][0]
  return [...groups]
    .map(([c, ps]) => {
      const names = listText(ps.map(p => NAME[p].toLowerCase()))
      return `${names.charAt(0).toUpperCase()}${names.slice(1)}: ${c}`
    })
    .join(' ')
}

function takeaway(rows: Row[]): string {
  const name = (r: Row) => NAME[r.p].toLowerCase()
  const done = rows.filter(r => r.em !== null && r.floor !== null)
  const clears = done.filter(r => r.status === 'pass').map(name)
  const below = done.filter(r => r.status !== 'pass').map(name)
  const thin = done.filter(r => r.fragile).map(name)
  const skipped = rows.filter(r => !done.includes(r)).map(name)
  const tail = `${thin.length ? ` Thin margin in ${listText(thin)}.` : ''}${skipped.length ? ` Not computed in ${listText(skipped)}.` : ''}`
  if (!below.length && clears.length === 3) return `Clears the floor in all three postures — even red, the harshest.${tail}`
  if (!clears.length) return `Falls below the floor in ${below.length === 3 ? 'every posture' : listText(below)}.${tail}`
  if (!below.length) return `Clears the floor in ${listText(clears)}.${tail}`
  return `Clears the floor in ${listText(clears)}; falls below it in ${listText(below)}.${tail}`
}

function tableOf(rows: Row[], today: Posture): TableSpec {
  return {
    columns: ['Posture', 'Hard-cost overrun', 'Exit-cap widening', 'Stressed equity multiple', 'Floor', 'Result', 'Margin vs floor'],
    rows: rows.map(r => [
      `${NAME[r.p]}${r.p === today ? ' (today)' : ''}`,
      r.hardCost !== null ? bumpPct(r.hardCost) : 'not set',
      r.capBps !== null ? bumpBps(r.capBps) : 'not set',
      r.em !== null ? xm(r.em) : 'not computed',
      r.floor !== null ? xm(r.floor) : 'not set',
      statusWord(r),
      r.margin !== null ? signed(r.margin) : '—',
    ]),
  }
}

/** 4px rounded data-end, square at the zero baseline; works in either direction. */
function barPath(x0: number, x1: number, y: number, h: number): string {
  const w = Math.abs(x1 - x0)
  if (w < 0.5) return ''
  const r = Math.min(4, w, h / 2)
  const dir = x1 > x0 ? 1 : -1
  const e = x1 - dir * r
  const sw = dir > 0 ? 1 : 0
  return `M${x0},${y}H${e}A${r},${r} 0 0 ${sw} ${x1},${y + r}V${y + h - r}A${r},${r} 0 0 ${sw} ${e},${y + h}H${x0}Z`
}

/** Container width via a callback ref, so it re-measures when the Table toggle remounts the plot. */
function useWidth(fallback: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => { const cw = Math.round(el.clientWidth); if (cw > 0) setW(cw) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w] as const
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div role="note" style={{
      marginTop: '.7rem', padding: '.9rem 1rem', border: `1px solid ${CK.grid}`, borderRadius: 8,
      fontSize: '.8rem', lineHeight: 1.5, color: CK.ink2,
    }}>
      {children}
    </div>
  )
}

const METHOD = 'Bar: the equity multiple left after that posture’s hard-cost overrun (paid with equity) and exit-cap widening, on untrended NOI after selling costs, interim cash flow ignored. Tick: that posture’s floor. + = room above the floor.'

const STATUS_KEYS: Array<{ key: string; item: LegendItem }> = [
  { key: 'pass', item: { label: 'PASS — clears the floor', color: CK.pass } },
  { key: 'thin', item: { label: 'PASS · thin — only just clears it', color: CK.watch } },
  { key: 'fail', item: { label: 'FAIL — below the floor', color: CK.fail } },
]

export default function StressChart({ scenarios, posture, fields }: Props) {
  const tip = useTooltip()
  const [measureRef, W] = useWidth(560)

  if (!scenarios) {
    return (
      <ChartCard title={TITLE}
        table={{ columns: ['Posture', 'Stressed equity multiple'], rows: POSTURES.map(p => [NAME[p], 'not in this response']) }}>
        <Empty>Per-posture stress results aren’t in this response (older scoring build), so there is nothing to plot. Rescore the deal to see them.</Empty>
      </ChartCard>
    )
  }

  const rows = rowsOf(scenarios)
  const table = tableOf(rows, posture)

  if (!rows.some(r => r.hasStress)) {
    return (
      <ChartCard title={TITLE} table={table}>
        <Empty>The active rulebook has no mini-stress check, so there is no stress result to plot.</Empty>
      </ChartCard>
    )
  }

  const plotted = rows.filter(r => r.em !== null)
  if (!plotted.length) {
    return (
      <ChartCard title={TITLE} subtitle="Stressed equity multiple not computed in any posture" table={table}>
        <Empty>{whyMissing(rows, fields, false)}</Empty>
      </ChartCard>
    )
  }

  // One shared axis from 0 (extended below 0 only if a stressed multiple is negative).
  const vals = [...plotted.map(r => r.em!), ...rows.flatMap(r => (r.floor !== null ? [r.floor] : []))]
  const lo = Math.min(0, ...vals)
  let hi = Math.max(0, ...vals)
  if (hi <= lo) hi = lo + 1
  const plotL = TEXT_X
  const plotR = W - 14
  const ticks = niceTicks(lo, hi + (hi - lo) * 0.1, Math.max(3, Math.floor((plotR - plotL) / 70)))
  const xs = scaleLinear(ticks[0], ticks[ticks.length - 1], plotL, plotR)
  const x0 = xs(0)

  // Wide: "Green · +10% hard costs · +25 bps exit cap" on one line. Narrow: stress terms drop to a second line.
  const wide = rows.every(r =>
    TEXT_X + (`${NAME[r.p]} · ${stressText(r)}`.length + (r.p === posture ? 7 : 0)) * CH + 16 + resultText(r).length * CH <= W - PAD_R)
  const line2 = (r: Row) => (TEXT_X + stressText(r).length * CH_SM <= W - PAD_R ? stressText(r) : stressText(r, true))
  const barOff = wide ? 22 : 38
  const rowH = barOff + BAR_H + 16
  const top0 = 6
  const axisY = top0 + 2 * rowH + barOff + BAR_H + 18
  const H = axisY + 6

  const shown = new Set<string>(plotted.map(r => (r.fragile ? 'thin' : r.status)))
  const legend: LegendItem[] = [
    ...STATUS_KEYS.filter(k => shown.has(k.key)).map(k => k.item),
    { label: 'Floor', color: CK.ink, shape: 'line' as const },
  ]

  const skipped = rows.filter(r => r.em === null)
  const note = (
    <>
      {METHOD}
      {skipped.length > 0 && <> {whyMissing(skipped, fields, true)}</>}
    </>
  )

  return (
    <ChartCard title={TITLE} subtitle={takeaway(rows)} legend={legend} table={table} note={note}>
      <Plot tip={tip}>
        <div ref={measureRef}>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Stressed equity multiple versus floor, by posture">
            {rows.map((r, i) => {
              const top = top0 + i * rowH
              const barY = top + barOff
              const isToday = r.p === posture
              const bandTop = top - 5
              const bandBottom = barY + BAR_H + 8
              const fx = r.floor !== null ? xs(r.floor) : null
              const color = barColor(r)
              const lines: TipLine[] = [
                { value: r.em !== null ? xm(r.em) : 'not computed', label: `${NAME[r.p]}${isToday ? ' (today)' : ''} stressed multiple`, color: r.em !== null ? color : undefined },
                { value: r.floor !== null ? xm(r.floor) : 'not set', label: 'floor', color: '#fff' },
                { value: resultText(r), label: 'vs floor' },
                { value: `${r.hardCost !== null ? bumpPct(r.hardCost) : '—'} · ${r.capBps !== null ? bumpBps(r.capBps) : '—'}`, label: 'costs · exit cap' },
              ]

              let valueLabel: ReactNode = null
              if (r.em !== null) {
                const x1 = xs(r.em)
                const text = xm(r.em)
                const lw = text.length * CH
                const cy = barY + BAR_H / 2
                const onBar = r.fragile ? CK.ink : '#fff' // white fails contrast on the watch fill
                const outsideAt = (lx: number, anchor?: 'end') => (
                  <text className="ck-value" x={lx} y={cy} dy="0.35em" textAnchor={anchor}
                    stroke={CK.surface} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{text}</text>
                )
                if (r.em >= 0) {
                  // Keep the value off the far side of the floor tick, where it would read as the floor's value.
                  const tickAhead = fx !== null && fx > x1
                  const fitsInside = x1 - x0 >= lw + 12
                  const inside = <text className="ck-value" x={x1 - 6} y={cy} dy="0.35em" textAnchor="end" style={{ fill: onBar }}>{text}</text>
                  if (tickAhead && fx! - x1 >= lw + 12) valueLabel = outsideAt(x1 + 6)
                  else if (tickAhead && fitsInside) valueLabel = inside
                  else {
                    const lx = Math.max(x1, fx !== null ? fx + 3 : x1) + 6
                    if (lx + lw <= W - PAD_R) valueLabel = outsideAt(lx)
                    else if (fitsInside) valueLabel = inside
                  }
                } else {
                  if (x1 - 6 - lw >= 0) valueLabel = outsideAt(x1 - 6, 'end')
                  else if (x0 - x1 >= lw + 12)
                    valueLabel = <text className="ck-value" x={x1 + 6} y={cy} dy="0.35em" style={{ fill: onBar }}>{text}</text>
                }
              }

              return (
                <g key={r.p} className="ck-hover" {...tip.bind(lines)}>
                  {isToday && <rect x={0} y={bandTop} width={W} height={bandBottom - bandTop} rx={6} fill={CK.grid} opacity={0.45} />}
                  <rect className="ck-hit" x={0} y={bandTop} width={W} height={bandBottom - bandTop} />

                  {r.em !== null ? (
                    <>
                      {ticks.map(v => (
                        <line key={v} x1={xs(v)} x2={xs(v)} y1={barY - 5} y2={barY + BAR_H + 5} stroke={CK.grid} strokeWidth={1} />
                      ))}
                      <line x1={x0} x2={x0} y1={barY - 5} y2={barY + BAR_H + 5} stroke={CK.axis} strokeWidth={1} />
                      <path className="ck-mark" d={barPath(x0, xs(r.em), barY, BAR_H)} fill={color} />
                    </>
                  ) : (
                    <text className="ck-label" x={plotL} y={barY + BAR_H / 2} dy="0.35em" style={{ fill: CK.ink2 }}>
                      not computed — see note
                    </text>
                  )}
                  {fx !== null && r.em !== null && (
                    <>
                      <rect x={fx - 3} y={barY - 6} width={6} height={BAR_H + 12} rx={2} fill={CK.surface} />
                      <rect x={fx - 1} y={barY - 4} width={2} height={BAR_H + 8} rx={1} fill={CK.ink} />
                    </>
                  )}
                  {valueLabel}

                  <PostureDot cx={DOT_X} cy={top + 9} posture={r.p} />
                  <text x={TEXT_X} y={top + 9} dy="0.35em" fontSize={11.5} fill={CK.ink}>
                    <tspan fontWeight={600}>{NAME[r.p]}</tspan>
                    {wide && <tspan fill={CK.ink2}>{` · ${stressText(r)}`}</tspan>}
                    {isToday && <tspan dx={8} fontSize={9.5} fontWeight={700} letterSpacing="0.08em">TODAY</tspan>}
                  </text>
                  {!wide && (
                    <text x={TEXT_X} y={top + 25} dy="0.35em" fontSize={11} fill={CK.ink2}>{line2(r)}</text>
                  )}
                  <text x={W - PAD_R} y={top + 9} dy="0.35em" textAnchor="end" fontSize={11.5} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <tspan fontWeight={700} fill={CK.ink}>{statusWord(r)}</tspan>
                    {r.margin !== null && <tspan dx={6} fill={CK.ink2}>{signed(r.margin)}</tspan>}
                  </text>
                </g>
              )
            })}

            <g className="ck-axis" aria-hidden="true">
              {ticks.map(v => (
                <text key={v} x={xs(v)} y={axisY} textAnchor="middle">{tickLabel(v)}</text>
              ))}
            </g>
          </svg>
        </div>
      </Plot>
    </ChartCard>
  )
}
