// CapRateChart — the Market tab's cap-rate read: today's market cap rate, the
// sponsor's exit cap, and the exit cap the mini stress test sells at under each
// posture (sponsor exit + that posture's stress_exit_cap_bump_bps / 10000 —
// exactly how engine.ts stressedEquityMultiple applies it). The exit − market
// gap is computed from the same fields the dots use, (exit − market) × 10000 —
// the exit_cap_vs_market margin in bps (+ = exit at or above today); the
// engine's PASS/WATCH word is shown only when its margin agrees with that gap.
// Form: dot plot on ONE shared % axis — labeled rows (market · sponsor exit ·
// stressed exit as a G/Y/R ladder); the job is positions on a common scale, so
// dots, not bars from zero.
import { useLayoutEffect, useState } from 'react'
import {
  CK,
  ChartCard,
  Plot,
  POSTURE_LETTER,
  PostureDot,
  niceTicks,
  scaleLinear,
  useTooltip,
  type LegendItem,
  type TableSpec,
  type TipLine,
} from './ChartKit'
import { Term } from '../GlossaryTip'
import type { DealFields, Posture, PostureScenario } from '../deal-types'

export interface CapRateChartProps {
  fields: DealFields
  scenarios?: Record<Posture, PostureScenario>
  posture: Posture
}

type Status = PostureScenario['checks'][number]['status']

const POSTURES: Posture[] = ['green', 'yellow', 'red']
const MISSING = 'not in the documents'
const STALE = 'engine scored other inputs'
const NO_MULTIPLE = 'inputs missing or equity ≤ 0'
const OLDER = 'not in this response (older scoring build)' // short enough for the phone lane
const GAP_STATUS: Partial<Record<Status, { word: string; color: string }>> = {
  pass: { word: 'PASS', color: CK.pass },
  flag: { word: 'WATCH', color: CK.watch },
  fail: { word: 'FAIL', color: CK.fail },
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/** Cap rate in percent: two decimals only when the second one carries (7.25%), else one (7.0%). */
function capPct(x: number): string {
  const two = (x * 100).toFixed(2)
  return two.endsWith('0') ? `${(x * 100).toFixed(1)}%` : `${two}%`
}

/**
 * Signed bps. `exact` (the engine-checked gap) keeps the sign of a nonzero gap
 * under half a bp ('−<1 bps') so the number agrees with the check's status.
 */
function signedBps(b: number, exact = false): string {
  const r = Math.abs(Math.round(b))
  if (b === 0 || (r === 0 && !exact)) return '0 bps'
  return `${b > 0 ? '+' : '−'}${r === 0 ? '<1' : r} bps`
}

// -------------------------------------------------------------------- data

interface Stressed {
  posture: Posture
  bumpBps: number | null
  value: number | null
  /** Why there is no value (null when there is one). */
  why: string | null
  /** The mini stress produced an equity multiple under this posture. */
  ran: boolean
}

interface CapData {
  market: number | null
  exit: number | null
  stressed: Stressed[]
  /** (exit − market) × 10000 from the plotted fields. */
  gapBps: number | null
  /** The engine's check status — only when its margin matches gapBps. */
  gapStatus: { word: string; color: string } | null
  /** The engine scored this check on different inputs than the ones plotted. */
  gapStale: boolean
}

function capRateData(fields: DealFields, scenarios: CapRateChartProps['scenarios'], posture: Posture): CapData {
  const market = has(fields.market_cap_rate_today) ? fields.market_cap_rate_today : null
  const exit = has(fields.exit_cap_rate) ? fields.exit_cap_rate : null
  const stressed = POSTURES.map((p): Stressed => {
    const sc = scenarios?.[p]
    const st = sc?.stress
    const bumpBps = st && has(st.exitCapBumpBps) ? st.exitCapBumpBps : null
    const miss = (why: string): Stressed => ({ posture: p, bumpBps, value: null, why, ran: false })
    if (!sc) return miss('posture scenarios not in this result')
    // The engine emits stress whenever the rulebook has a mini_stress check, so
    // the check without it is a pre-stress response, not a missing test.
    if (!st) return miss(sc.checks.some(c => c.id === 'mini_stress') ? OLDER : 'stress test not in the rulebook')
    if (bumpBps === null) return miss('cap bump not configured')
    if (exit === null) return miss('needs the sponsor exit cap')
    const value = exit + bumpBps / 10000
    if (!(value > 0)) return miss('stressed cap ≤ 0 — the engine skips it')
    return { posture: p, bumpBps, value, why: null, ran: has(st.stressedEquityMultiple) }
  })
  // Same formula as engine.ts exit_cap_vs_market, on the same fields the dots use.
  const gapBps = exit !== null && market !== null ? (exit - market) * 10000 : null
  const ec = scenarios?.[posture]?.checks.find(c => c.id === 'exit_cap_vs_market')
  const m = ec?.margin
  const engineGap = has(m) ? m : null
  const agrees = ec !== undefined && gapBps !== null && engineGap !== null
    && Math.abs(engineGap - gapBps) <= 0.5 && (gapBps >= 0) === (ec.status === 'pass')
  const gapStatus = agrees ? GAP_STATUS[ec.status] ?? null : null
  return { market, exit, stressed, gapBps, gapStatus, gapStale: gapBps !== null && ec !== undefined && !agrees }
}

// ------------------------------------------------------------------- chart

/** Rendered width of an element, so the viewBox matches it 1:1 and text stays true size. */
function useWidth(el: HTMLElement | null, fallback = 640): number {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    if (!el) return
    const read = () => { if (el.clientWidth > 0) setW(el.clientWidth) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

type TextClass = 'ck-label' | 'ck-value' | 'ck-tick'
const CHAR_PX: Record<TextClass, number> = { 'ck-label': 6.2, 'ck-value': 7, 'ck-tick': 5.8 }

/** In-plot text on a surface patch, so grid lines and the market rule never run through it. */
function Txt({ x, y, text, cls, anchor = 'start', baseline = false, missing = false }: {
  x: number
  y: number
  text: string
  cls: TextClass
  anchor?: 'start' | 'middle' | 'end'
  /** y is the baseline (row label above a lane) rather than the vertical center. */
  baseline?: boolean
  missing?: boolean
}) {
  const w = text.length * CHAR_PX[cls]
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  const cy = baseline ? y - 4 : y
  return (
    <g aria-hidden="true">
      <rect x={left - 3} y={cy - 8} width={w + 6} height={16} fill={CK.surface} />
      <text className={cls} x={x} y={y} dy={baseline ? undefined : '0.35em'} textAnchor={anchor}
        fill={missing ? CK.ink2 : undefined} fontStyle={missing ? 'italic' : undefined}>{text}</text>
    </g>
  )
}

function Strip({ d, posture }: { d: CapData; posture: Posture }) {
  const tip = useTooltip()
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const W = Math.max(280, Math.round(useWidth(el)))
  const wide = W >= 520
  const x0 = wide ? 146 : 20
  const x1 = W - 22

  const vals = [d.market, d.exit, ...d.stressed.map(s => s.value)].filter(has)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.08, (0.01 - (hi - lo)) / 2, 0.001) // axis spans ≥ 100 bps
  const ticks = niceTicks(lo - pad, hi + pad, Math.max(4, Math.floor((x1 - x0) / 90)))
  const x = scaleLinear(ticks[0], ticks[ticks.length - 1], x0, x1)

  // Rows top → bottom. On a phone each row's label sits above its lane.
  const above = wide ? 0 : 18
  const anyStressed = d.stressed.some(s => s.value !== null)
  const hasGap = d.gapBps !== null
  let y = 4
  const mTop = y
  const mDot = mTop + above + 12
  y = mDot + 18
  const eTop = y
  const eDot = eTop + above + 12
  y = eDot + (hasGap ? 34 : 18)
  const sTop = y
  const sBase = sTop + above + 12
  const lanes = anyStressed ? POSTURES.map((_, i) => sBase + i * 24) : [sBase]
  const axisY = lanes[lanes.length - 1] + 20
  const H = axisY + 20
  // Vertical rules run only through the lanes, so the phone's row-label bands stay clear of them.
  const bands: Array<[number, number]> = wide
    ? [[4, axisY]]
    : [[mDot - 12, mDot + 12], [eDot - 12, eDot + (hasGap ? 28 : 12)], [lanes[0] - 12, axisY]]
  const rowLabel = (top: number, dot: number, text: string) =>
    <Txt cls="ck-label" x={0} y={wide ? dot : top + 11} baseline={!wide} text={text} />

  /** Value label beside a dot: preferred side unless it would leave the plot. */
  const beside = (cx: number, text: string, prefer: 'right' | 'left', px = 7) => {
    const w = text.length * px
    let side = prefer
    if (side === 'right' && cx + 12 + w > W - 2) side = 'left'
    if (side === 'left' && cx - 12 - w < x0 - 14) side = 'right'
    return side === 'right' ? { x: cx + 12, anchor: 'start' as const } : { x: cx - 12, anchor: 'end' as const }
  }

  const statusWord = d.gapStatus ? ` · ${d.gapStatus.word}` : ''
  const gapText = d.gapBps !== null ? `${signedBps(d.gapBps, true)} vs market${statusWord}` : ''
  const staleLine: TipLine[] = d.gapStale ? [{ value: 'no status', label: STALE }] : []
  const gapLines: TipLine[] = d.gapBps !== null
    ? [
        { value: signedBps(d.gapBps, true), label: 'sponsor exit − market today', color: d.gapStatus?.color ?? CK.muted },
        ...(d.gapStatus ? [{ value: d.gapStatus.word, label: 'exit-vs-market check' }] : staleLine),
      ]
    : []

  const aria = [
    'Cap rates on one axis',
    `market today ${d.market !== null ? capPct(d.market) : MISSING}`,
    `sponsor exit ${d.exit !== null ? capPct(d.exit) : MISSING}`,
    ...(d.gapBps !== null ? [`gap ${signedBps(d.gapBps, true)} vs market${statusWord}`] : []),
    ...d.stressed.filter(s => s.value !== null).map(s => `stressed exit ${s.posture} ${capPct(s.value!)}`),
  ].join(', ')

  const mx = d.market !== null ? x(d.market) : null
  const ex = d.exit !== null ? x(d.exit) : null
  const gapLine = mx !== null && ex !== null && d.gapBps !== null && Math.abs(ex - mx) > 0.5
  // Pointer-reachable width between the two dots' 12px hit circles.
  const gapHitW = mx !== null && ex !== null ? Math.abs(ex - mx) - 24 : 0

  return (
    <Plot tip={tip}>
      <div ref={setEl}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={aria}>
          {/* grid + axis */}
          <g className="ck-axis" aria-hidden="true">
            {ticks.map(t => bands.map(([a, b]) => (
              <line key={`${t}-${a}`} x1={x(t)} x2={x(t)} y1={a} y2={b} stroke={CK.grid} strokeWidth={1} />
            )))}
            <line x1={x0} x2={x1} y1={axisY} y2={axisY} stroke={CK.axis} strokeWidth={1} />
            {ticks.map(t => (
              <text key={t} x={x(t)} y={axisY + 15} textAnchor="middle">{capPct(t)}</text>
            ))}
          </g>

          {/* today's market as a reference rule through the rows below it */}
          {mx !== null && bands.map(([a, b]) => Math.max(a, mDot) < b && (
            <line key={a} x1={mx} x2={mx} y1={Math.max(a, mDot)} y2={b} stroke={CK.context} strokeWidth={1} aria-hidden="true" />
          ))}

          {/* row labels */}
          {rowLabel(mTop, mDot, 'Market cap today')}
          {rowLabel(eTop, eDot, 'Sponsor exit cap')}
          {rowLabel(sTop, lanes[0], wide ? 'Stressed exit cap' : 'Stressed exit cap (sponsor exit + posture bump)')}
          {wide && anyStressed && <Txt cls="ck-tick" x={0} y={lanes[1]} text="sponsor exit + bump" />}

          {/* exit − market gap, in the engine's status color when its check agrees */}
          {gapLine && (
            <line x1={mx!} x2={ex!} y1={eDot} y2={eDot} stroke={d.gapStatus?.color ?? CK.muted}
              strokeWidth={2} strokeLinecap="round" aria-hidden="true" />
          )}
          {d.gapBps !== null && ex !== null && (() => {
            const w = gapText.length * 6.2
            const mid = mx !== null ? (mx + ex) / 2 : ex
            const cx = Math.min(Math.max(mid, x0 - 10 + w / 2), W - 2 - w / 2)
            return <Txt cls="ck-label" x={cx} y={eDot + 21} baseline anchor="middle" text={gapText} />
          })()}

          {/* market today */}
          {mx !== null ? (() => {
            const lab = beside(mx, capPct(d.market!), 'right')
            return (
              <>
                <g className="ck-hover" {...tip.bind([
                  { value: capPct(d.market!), label: 'market cap rate today', color: CK.context },
                  ...(d.gapBps !== null ? [{ value: signedBps(d.gapBps, true), label: 'sponsor exit vs this' }] : []),
                ])}>
                  <circle className="ck-hit" cx={mx} cy={mDot} r={12} />
                  <g className="ck-mark">
                    <circle cx={mx} cy={mDot} r={8} fill={CK.surface} />
                    <circle cx={mx} cy={mDot} r={6} fill={CK.context} />
                  </g>
                </g>
                <Txt cls="ck-value" x={lab.x} y={mDot} anchor={lab.anchor} text={capPct(d.market!)} />
              </>
            )
          })() : (
            <Txt cls="ck-label" x={x0} y={mDot} missing text={MISSING} />
          )}

          {/* sponsor exit */}
          {ex !== null ? (() => {
            const lab = beside(ex, capPct(d.exit!), mx !== null && ex < mx ? 'left' : 'right')
            return (
              <>
                <g className="ck-hover" {...tip.bind([
                  { value: capPct(d.exit!), label: 'sponsor exit cap', color: CK.accent },
                  ...(d.gapBps !== null ? [{ value: signedBps(d.gapBps, true), label: `vs market today${statusWord}` }] : []),
                  ...staleLine,
                ])}>
                  <circle className="ck-hit" cx={ex} cy={eDot} r={12} />
                  <g className="ck-mark">
                    <circle cx={ex} cy={eDot} r={8} fill={CK.surface} />
                    <circle cx={ex} cy={eDot} r={6} fill={CK.accent} />
                  </g>
                </g>
                <Txt cls="ck-value" x={lab.x} y={eDot} anchor={lab.anchor} text={capPct(d.exit!)} />
              </>
            )
          })() : (
            <Txt cls="ck-label" x={x0} y={eDot} missing text={MISSING} />
          )}

          {/* gap hit target after both dots (reading order), only where it clears their hit circles */}
          {gapLine && gapHitW >= 24 && (
            <g {...tip.bind(gapLines)}>
              <rect className="ck-hit" x={Math.min(mx!, ex!) + 12} y={eDot - 12} width={gapHitW} height={24} />
            </g>
          )}

          {/* stressed exit, one lane per posture so equal bumps never hide each other */}
          {anyStressed ? d.stressed.map((s, i) => {
            const ly = lanes[i]
            if (s.value === null) {
              return <Txt key={s.posture} cls="ck-tick" x={x0} y={ly} missing text={`${s.posture}: ${s.why}`} />
            }
            const sx = x(s.value)
            const isToday = s.posture === posture
            const lines: TipLine[] = [
              { value: capPct(s.value), label: `stressed exit · ${s.posture}${isToday ? ' (today’s posture)' : ''}`, color: CK.posture[s.posture] },
              { value: signedBps(s.bumpBps!), label: 'bump on sponsor exit' },
              ...(d.market !== null ? [{ value: signedBps((s.value - d.market) * 10000), label: 'vs market today' }] : []),
              ...(!s.ran ? [{ value: 'no multiple', label: NO_MULTIPLE }] : []),
            ]
            const tagText = 'today’s posture'
            const tag = isToday ? beside(sx, tagText, 'right', CHAR_PX['ck-label']) : null
            return (
              <g key={s.posture}>
                <g className="ck-hover" {...tip.bind(lines)}>
                  <circle className="ck-hit" cx={sx} cy={ly} r={12} />
                  <g className="ck-mark"><PostureDot cx={sx} cy={ly} posture={s.posture} /></g>
                </g>
                {tag && <Txt cls="ck-label" x={tag.x} y={ly} anchor={tag.anchor} text={tagText} />}
              </g>
            )
          }) : (
            <Txt cls="ck-label" x={x0} y={lanes[0]} missing text={d.stressed[0]?.why ?? 'stress test unavailable'} />
          )}
        </svg>
      </div>
    </Plot>
  )
}

// -------------------------------------------------------------------- card

// The glossary (i) rides on the last word, held on one line with it, so a
// phone-width wrap never strands the icon on a line of its own.
const TITLE = <>Cap rates: today, the sponsor’s exit, and the stressed <span style={{ whiteSpace: 'nowrap' }}><Term k="exit_cap">exit</Term></span></>
const SUBTITLE = 'The exit should sit at or above today’s market cap · the stress test widens the sponsor’s exit by each posture’s bump'

export default function CapRateChart({ fields, scenarios, posture }: CapRateChartProps) {
  const d = capRateData(fields, scenarios, posture)

  const gapCell = d.gapBps === null
    ? '—'
    : `${signedBps(d.gapBps, true)}${d.gapStatus ? ` · ${d.gapStatus.word}` : d.gapStale ? ` (no status: ${STALE})` : ''}`
  const table: TableSpec = {
    columns: ['Cap rate', 'Value', 'Bump on exit', 'vs market today'],
    rows: [
      ['Market cap rate today', d.market !== null ? capPct(d.market) : MISSING, '—', '—'],
      ['Sponsor exit cap', d.exit !== null ? capPct(d.exit) : MISSING, '—', gapCell],
      ...d.stressed.map(s => [
        `Stressed exit · ${s.posture}${s.posture === posture ? ' (today’s posture)' : ''}`,
        s.value !== null ? capPct(s.value) : s.why ?? '—',
        s.bumpBps !== null ? signedBps(s.bumpBps) : '—',
        s.value !== null && d.market !== null ? signedBps((s.value - d.market) * 10000) : '—',
      ]),
    ],
  }

  if (d.market === null && d.exit === null) {
    return (
      <ChartCard title={TITLE} subtitle={SUBTITLE} table={table}>
        <div style={{ marginTop: '.8rem', fontSize: '.84rem', color: CK.ink2, lineHeight: 1.5 }}>
          The exit cap and today’s market cap rate are {MISSING} — nothing to plot.
        </div>
      </ChartCard>
    )
  }

  const legend: LegendItem[] = [
    ...(d.market !== null ? [{ label: 'Market cap today', color: CK.context, shape: 'dot' as const }] : []),
    ...(d.exit !== null ? [{ label: 'Sponsor exit cap', color: CK.accent, shape: 'dot' as const }] : []),
    ...d.stressed
      .filter(s => s.value !== null)
      .map(s => ({ label: `Stressed exit · ${s.posture}`, color: CK.posture[s.posture], letter: POSTURE_LETTER[s.posture] })),
  ]

  const notRun = d.stressed.filter(s => s.value !== null && !s.ran).map(s => s.posture)
  const note = d.stressed.some(s => s.value !== null) ? (
    <>
      Stressed exit = sponsor exit + each posture’s stress-test cap bump, the cap the engine’s mini stress sells at.
      {notRun.length > 0 && ` The mini stress produced no equity multiple under ${notRun.join(', ')} (inputs missing, or stressed equity ≤ 0), so these are the caps it would apply.`}
    </>
  ) : undefined

  return (
    <ChartCard title={TITLE} subtitle={SUBTITLE} legend={legend} table={table} note={note}>
      <Strip d={d} posture={posture} />
    </ChartCard>
  )
}
