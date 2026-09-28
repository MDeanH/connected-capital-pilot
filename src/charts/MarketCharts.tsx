// MarketCharts — the Market tab's two deal-vs-market comparisons.
//
// RentChart: underwritten rent vs the deal's one comp rent, with the
// rents_vs_comps watch line drawn at comp × (1 + rent_premium_flag) on the same
// $/month axis. AbsorptionChart: underwritten lease-up vs the submarket's
// record, per the absorption check (margin = underwritten − record, months;
// it flags when the underwriting beats the record).
//
// Form: emphasis — two horizontal bars on one axis (market in context gray, the
// deal in accent), the gap drawn as a dimension line and labeled. One axis, no
// dual scale. Bars, premium and gap all come from `fields`; the engine supplies
// only status, threshold and margin, and only while its result matches those
// fields (the view can hold an older response while a re-score is pending or
// has failed). A missing input renders "… not in the documents", never a number.
import {
  useLayoutEffect, useState,
  type FocusEvent as RFocusEvent, type PointerEvent as RPointerEvent, type ReactNode,
} from 'react'
import {
  CK, ChartCard, Legend, Plot, PostureDot, niceTicks, scaleLinear, useTooltip,
  type LegendItem, type TableSpec, type TipLine,
} from './ChartKit'
import { fmtMargin, fmtVal } from '../GateResults'
import type { CheckResult, DealFields, Gate1Response, Posture } from '../deal-types'

type Status = CheckResult['status']

interface Props {
  fields: DealFields
  response: Gate1Response
}

const POSTURES: Posture[] = ['green', 'yellow', 'red']
const STATUS_WORD: Record<Status, string> = { pass: 'PASS', flag: 'WATCH', fail: 'FAIL', missing: 'MISSING', na: 'N/A' }
const STATUS_COLOR: Record<Status, string> = { pass: CK.pass, flag: CK.watch, fail: CK.fail, missing: CK.fail, na: CK.muted }
const MISSING = 'not in the documents'
const RESCORING = 'Re-scoring — the last engine result was for different inputs'
const RENT = 'rents_vs_comps'
const ABS = 'absorption'
const EPS = 1e-9

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
const num = (n: number | null | undefined) => (has(n) ? n : null)
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
const perMo = (n: number) => `${money(n)}/mo`
const mo = (n: number) => { const a = Math.abs(n); return `${n < 0 ? '−' : ''}${Number.isInteger(a) ? a : a.toFixed(1)} mo` }
const signedMo = (m: number) => `${m >= 0 ? '+' : '−'}${mo(Math.abs(m))}`
const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`
const absPct = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`
const signedMargin = (id: string, m: number) => `${m >= 0 ? '+' : '−'}${fmtMargin(id, m)}`
const pts = (n: number) => `${n} flag pt${n === 1 ? '' : 's'}`
const postureList = (ps: Posture[]) => (ps.length === POSTURES.length ? 'all postures' : ps.join(' · '))
/** Rough rendered width of an SVG label (no DOM measuring in render). */
const textW = (s: string, px = 11.5) => s.length * px * 0.58
/** Rough width of a ChartKit tooltip (.74rem, one row per line). */
const tipW = (lines: TipLine[]) => 24 + Math.max(...lines.map(l => (l.color ? 19 : 0) + 7 + (l.value.length + l.label.length) * 6.6))
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

function findCheck(response: Gate1Response, id: string): CheckResult | undefined {
  return response.result.checks.find(c => c.id === id)
}

/** Per-posture status/margin/threshold for one check (today's row falls back to result). */
function postureRows(response: Gate1Response, id: string) {
  const sc = response.scenarios
  const ck = findCheck(response, id)
  if (!sc) {
    return ck ? [{ posture: response.posture, status: ck.status, margin: ck.margin, threshold: ck.threshold?.effective ?? null }] : []
  }
  return POSTURES.flatMap(p => {
    const c = sc[p]?.checks.find(x => x.id === id)
    return c ? [{ posture: p, status: c.status, margin: c.margin, threshold: c.threshold }] : []
  })
}

// ------------------------------------------------------------ shared pieces

function useWidth(fallback = 480) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
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
  return { setEl, W: Math.max(240, w) }
}

/** ChartKit's tooltip with its anchor clamped so the centered box stays on screen. */
function useTip() {
  const tip = useTooltip()
  const bind = (lines: TipLine[]) => {
    const b = tip.bind(lines)
    const half = tipW(lines) / 2
    const at = (x: number, y: number) => {
      const vw = document.documentElement.clientWidth || window.innerWidth
      b.onPointerMove({ clientX: clamp(x, half + 6, vw - half - 6), clientY: y } as RPointerEvent)
    }
    return {
      ...b,
      onPointerMove: (e: RPointerEvent) => at(e.clientX, e.clientY),
      onFocus: (e: RFocusEvent) => {
        const r = (e.currentTarget as Element).getBoundingClientRect()
        at(r.left + r.width / 2, r.top)
      },
    }
  }
  return { ...tip, bind }
}

/** Ticks from 0 whose last tick sits closest above the data (fewest ticks on a tie). */
function axisTicks(maxV: number, W: number) {
  const most = Math.min(8, Math.max(3, Math.floor(W / 56)))
  let best = niceTicks(0, maxV, 3)
  for (let n = 4; n <= most; n++) {
    const t = niceTicks(0, maxV, n)
    if (t.length - 1 <= most && t[t.length - 1] < best[best.length - 1] - EPS) best = t
  }
  return best
}

/** Horizontal bar: square at the baseline, 4px rounded data end. */
function barPath(x0: number, y: number, w: number, h: number) {
  if (w <= 0.5) return ''
  const r = Math.min(4, w, h / 2)
  const x1 = x0 + w
  return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x1 - r},${y + h}H${x0}Z`
}

function StatusLine({ status, children }: { status: Status | null; children: ReactNode }) {
  return (
    <div style={{ marginTop: '.7rem', fontSize: '.8rem', lineHeight: 1.45, color: CK.ink }}>
      {status && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', marginRight: '.55rem', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
          <span aria-hidden="true" style={{
            width: 8, height: 8, borderRadius: '50%', boxSizing: 'border-box',
            background: status === 'missing' ? CK.surface : STATUS_COLOR[status],
            border: status === 'missing' ? `2px solid ${CK.fail}` : 'none',
          }} />
          {STATUS_WORD[status]}
        </span>
      )}
      {children}
    </div>
  )
}

function Empty({ status, children }: { status: Status | null; children: ReactNode }) {
  return (
    <div style={{ marginTop: '.8rem', padding: '.85rem 1rem', borderRadius: 8, background: 'var(--surface-2,#f5fbfa)', border: `1px solid ${CK.grid}` }}>
      <StatusLine status={status}><span style={{ color: CK.ink2 }}>{children}</span></StatusLine>
    </div>
  )
}

interface BarRow { label: string; value: number; valueText: string; color: string; tip: TipLine[] }
interface RefLine { value: number; color: string; text: string | null; postures: Posture[] | null; tip: TipLine[] }
interface Span { from: number; to: number; text: string; tip: TipLine[] }

const DOT_R = 8, DOT_STEP = 21, DOT_ROW = 22

/**
 * Two bars on one linear axis from zero: row 0 is the market reference, row 1
 * the deal. Optional vertical reference lines (a check's threshold), drawn
 * behind the bars so a bar end near the line is never masked, and a dimension
 * line under the deal bar spanning the gap between the two ends. The viewBox
 * tracks the measured width, so text renders at its true size.
 */
function TwoBarPlot({ label, rows, refs, span, tick }: {
  label: string
  rows: [BarRow, BarRow]
  refs: RefLine[]
  span: Span | null
  tick: (v: number, last: boolean) => string
}) {
  const tip = useTip()
  const { setEl, W } = useWidth()
  const maxV = Math.max(1, ...rows.map(r => r.value), ...refs.map(r => r.value))
  const ticks = axisTicks(maxV, W)
  const dMax = ticks.length ? ticks[ticks.length - 1] : maxV
  const x = scaleLinear(0, dMax, 1, W - 2)

  const dotMode = refs.some(r => r.postures)
  const refH = refs.length === 0 ? 4 : dotMode ? refs.length * DOT_ROW + 4 : 24
  const ROW = 50, LAB = 12, BAR_Y = 17, BAR_H = 20
  const rowTop = (i: number) => refH + i * ROW
  const barsEnd = rowTop(1) + BAR_Y + BAR_H
  const spanY = barsEnd + 10
  const axisY = span ? spanY + 24 : barsEnd + 8
  const H = axisY + 14
  const halo = { stroke: CK.surface, strokeWidth: 3, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }

  const refGeom = refs.map((r, k) => {
    const xv = x(r.value)
    if (r.postures) {
      const cy = 12 + k * DOT_ROW
      const half = ((r.postures.length - 1) * DOT_STEP) / 2 + DOT_R + 2
      const gc = clamp(xv, half, W - half)
      return {
        r, xv, gc, cy, lineTop: cy + DOT_R + 2, tx: 0, anchor: 'start' as const,
        hit: { x0: Math.min(gc - half, xv - 12), x1: Math.max(gc + half, xv + 12), y0: cy - 12, y1: cy + 12 },
      }
    }
    const tw = r.text ? textW(r.text) : 0
    const place = xv + 6 + tw <= W ? { tx: xv + 6, anchor: 'start' as const }
      : xv - 6 - tw >= 0 ? { tx: xv - 6, anchor: 'end' as const }
        : { tx: clamp(xv, tw / 2, W - tw / 2), anchor: 'middle' as const }
    const left = place.anchor === 'start' ? place.tx : place.anchor === 'end' ? place.tx - tw : place.tx - tw / 2
    return {
      r, xv, gc: xv, cy: 0, lineTop: 4, ...place,
      hit: { x0: Math.min(xv - 12, left - 2), x1: Math.max(xv + 12, left + tw + 2), y0: 0, y1: refH },
    }
  })

  const spanGeom = span ? (() => {
    const a = x(Math.min(span.from, span.to))
    const b = x(Math.max(span.from, span.to))
    const tw = textW(span.text)
    const cx = clamp((a + b) / 2, tw / 2, W - tw / 2)
    const x0 = Math.min(a, cx - tw / 2, (a + b) / 2 - 12) - 4
    const x1 = Math.max(b, cx + tw / 2, (a + b) / 2 + 12) + 4
    return { a, b, cx, x0, x1 }
  })() : null

  return (
    <Plot tip={tip}>
      <div ref={setEl}>
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
          {ticks.map((t, i) => (
            <line key={`g${t}`} x1={x(t)} x2={x(t)} y1={rowTop(0)} y2={axisY} stroke={i === 0 ? CK.axis : CK.grid}
              strokeWidth={1} shapeRendering="crispEdges" />
          ))}
          <g className="ck-axis">
            {ticks.map((t, i) => (
              <text key={`t${t}`} x={x(t)} y={axisY + 11}
                textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{tick(t, i === ticks.length - 1)}</text>
            ))}
          </g>

          {spanGeom && (
            <line x1={x(rows[0].value)} x2={x(rows[0].value)} y1={rowTop(0) + BAR_Y + BAR_H} y2={spanY - 4}
              stroke={CK.axis} strokeWidth={1} shapeRendering="crispEdges" pointerEvents="none" />
          )}

          {refGeom.map(g => (
            <g key={`r${g.r.value}`} className="ck-hover" {...tip.bind(g.r.tip)}>
              <line className="ck-mark" x1={g.xv} x2={g.xv} y1={g.lineTop} y2={barsEnd + 4}
                stroke={g.r.color} strokeWidth={2} strokeLinecap="round" />
              {g.r.postures
                ? g.r.postures.map((p, j, all) => (
                  <PostureDot key={p} cx={g.gc + (j - (all.length - 1) / 2) * DOT_STEP} cy={g.cy} posture={p} r={DOT_R} />
                ))
                : g.r.text && (
                  <text x={g.tx} y={13} textAnchor={g.anchor} className="ck-label" {...halo}>{g.r.text}</text>
                )}
              <rect className="ck-hit" x={g.hit.x0} y={g.hit.y0} width={g.hit.x1 - g.hit.x0} height={g.hit.y1 - g.hit.y0} />
            </g>
          ))}

          {rows.map((r, i) => (
            <g key={r.label} className="ck-hover" {...tip.bind(r.tip)}>
              <path className="ck-mark" d={barPath(x(0), rowTop(i) + BAR_Y, x(r.value) - x(0), BAR_H)} fill={r.color} />
              <rect className="ck-hit" x={0} y={rowTop(i)} width={W} height={BAR_Y + BAR_H + 4} />
            </g>
          ))}

          {rows.map((r, i) => (
            <text key={`l${r.label}`} x={x(0)} y={rowTop(i) + LAB} className="ck-label" {...halo} pointerEvents="none">
              {r.label}<tspan className="ck-value" dx={6}>{r.valueText}</tspan>
            </text>
          ))}

          {span && spanGeom && (
            <g className="ck-hover" {...tip.bind(span.tip)}>
              <g className="ck-mark" stroke={CK.ink2} strokeWidth={1} shapeRendering="crispEdges">
                <line x1={spanGeom.a} x2={spanGeom.b} y1={spanY} y2={spanY} />
                <line x1={spanGeom.a} x2={spanGeom.a} y1={spanY - 4} y2={spanY + 4} />
                <line x1={spanGeom.b} x2={spanGeom.b} y1={spanY - 4} y2={spanY + 4} />
              </g>
              <text x={spanGeom.cx} y={spanY + 16} textAnchor="middle" className="ck-value" {...halo}>{span.text}</text>
              <rect className="ck-hit" x={spanGeom.x0} y={spanY - 8} width={spanGeom.x1 - spanGeom.x0} height={28} />
            </g>
          )}
        </svg>
      </div>
    </Plot>
  )
}

// ================================================================= RENTS

export function RentChart({ fields, response }: Props) {
  const assumed = num(fields.assumed_rent_monthly)
  const comp = num(fields.market_comp_rent_monthly)
  const ck = findCheck(response, RENT)
  // The engine's derive() on these same fields; a result whose premium differs
  // was scored on other inputs, so its status/threshold/margin are withheld.
  const derived = assumed !== null && comp !== null && comp !== 0 ? assumed / comp - 1 : null
  const fresh = !ck || !has(ck.value) || (derived !== null && Math.abs(ck.value - derived) <= EPS)
  const eng = fresh ? ck : undefined
  const invalid = (assumed !== null && assumed < 0) || (comp !== null && comp < 0)
  const premium = assumed !== null && assumed >= 0 && comp !== null && comp > 0 ? assumed / comp - 1 : null
  const baseFp = response.checksMeta.find(m => m.id === RENT)?.flagPoints ?? 1
  const severe = eng?.status === 'flag' && eng.flagPoints > baseFp
  const flagToday = eng?.threshold?.effective ?? null
  const adj = eng?.threshold?.adjustment
  const scored = !!eng && eng.status !== 'missing' && has(eng.margin) && flagToday !== null

  // Watch line per posture, grouped: one tick when every posture shares it.
  const byPosture = eng ? postureRows(response, RENT) : []
  const groups: Array<{ flag: number; postures: Posture[] }> = []
  for (const r of byPosture) {
    if (!has(r.threshold)) continue
    const g = groups.find(x => Math.abs(x.flag - r.threshold!) < 1e-12)
    if (g) g.postures.push(r.posture)
    else groups.push({ flag: r.threshold, postures: [r.posture] })
  }
  const postureMode = groups.length > 1
  const title = 'Rent vs market comp'
  const subtitle = '$ per month · the deal gives one comp rent · watch line = comp × (1 + the rulebook’s premium limit)'
  const note = (
    <>
      The severe-premium line (double flag points) isn’t drawn; the table says whether it applied.
      {adj ? ` Watch line judgment-adjusted from ${fmtVal(RENT, eng!.threshold!.base)}: “${adj.reason}”.` : ''}
    </>
  )

  const table: TableSpec = {
    columns: ['Measure', 'Value', 'Basis'],
    rows: [
      ['Market comp rent', comp !== null ? perMo(comp) : MISSING,
        comp !== null && comp <= 0 ? 'deal inputs · not a usable comp' : 'deal inputs · the only comp given'],
      ['Underwritten rent', assumed !== null ? perMo(assumed) : MISSING,
        assumed !== null && assumed < 0 ? 'deal inputs · not a usable rent' : 'deal inputs'],
      ['Premium over comp', premium !== null ? signedPct(premium) : '—',
        premium !== null ? 'underwritten ÷ comp − 1' : 'needs both rents, comp above $0'],
      ...(!fresh
        ? [['Engine result', 'Re-scoring', 'last result was for different inputs — status, watch line and margin hidden']]
        : eng
          ? [
            ...groups.map(g => [
              `Watch line · ${postureList(g.postures)}`,
              `${signedPct(g.flag)}${comp !== null && comp > 0 ? ` → ${perMo(comp * (1 + g.flag))}` : ''}`,
              `rent_premium_flag${adj ? ' · judgment-adjusted' : ''}${eng.status === 'missing' ? ' · check did not score' : ''}`,
            ]),
            ['Severe line',
              invalid ? '—'
                : eng.status === 'flag' ? (severe ? 'crossed — flag points doubled' : 'not crossed')
                  : eng.status === 'pass' ? 'no effect — watch line not crossed' : '—',
              'rent_premium_severe · value not returned by the engine'],
            ...byPosture.map(r => [
              `Status · ${r.posture}${r.posture === response.posture ? ' (today)' : ''}`,
              `${STATUS_WORD[r.status]}${has(r.margin) && !invalid ? ` · ${signedMargin(RENT, r.margin)}` : ''}${r.posture === response.posture && eng.status === 'flag' ? ` · ${pts(eng.flagPoints)}` : ''}`,
              invalid ? 'engine · scored from the negative input as given' : 'margin to the watch line (+ = room to spare)',
            ]),
          ]
          : []),
    ],
  }

  if (premium === null || assumed === null || comp === null) {
    const problem = (name: string, v: number | null, zeroOk: boolean) =>
      v === null ? `${name} ${MISSING}`
        : v < 0 ? `${name} reads ${perMo(v)} — not a usable rent`
          : !zeroOk && v === 0 ? `${name} reads $0` : null
    const pA = problem('Underwritten rent', assumed, true)
    const pC = problem('Market comp rent', comp, false)
    const text = assumed === null && comp === null
      ? `Underwritten rent and market comp rent ${MISSING}.`
      : `${[pA, pC].filter(Boolean).join('. ')}. There’s no premium to measure.`
        + (!pA ? ` Underwritten rent is ${perMo(assumed!)}.` : !pC ? ` Market comp rent is ${perMo(comp!)}.` : '')
    return (
      <ChartCard title={title} subtitle={subtitle} table={table}>
        <Empty status={eng && !invalid ? eng.status : null}>{text}{fresh ? '' : ` ${RESCORING}.`}</Empty>
      </ChartCard>
    )
  }

  const rel = premium >= 0 ? `${signedPct(premium)} over the comp` : `${absPct(premium)} under the comp`
  let status: Status | null = eng?.status ?? null
  let statusText: string
  if (!fresh) {
    status = null
    statusText = `${rel}. ${RESCORING}, so its status, watch line and margin are hidden.`
  } else if (!ck) {
    statusText = `${rel}. The rents-vs-comps check isn’t in the active rulebook.`
  } else if (flagToday === null) {
    statusText = `${rel}. The rulebook returned no watch line for this check, so it couldn’t score.`
  } else if (!scored) {
    statusText = `${rel}. The engine couldn’t score this check — an input or threshold it needs was absent when it last ran.`
  } else {
    const m = eng!.margin!
    const where = `${fmtMargin(RENT, m)} ${m >= 0 ? 'inside' : 'past'} the ${fmtVal(RENT, flagToday)} watch line`
    const fp = eng!.status === 'flag' ? ` · ${severe ? 'severe premium, ' : ''}${pts(eng!.flagPoints)}` : ''
    statusText = `${rel} — ${where}${postureMode ? ` in today’s ${response.posture} posture` : ''}${fp}`
  }

  // In posture mode the G/Y/R dots carry the posture, so the lines stay neutral ink.
  const lineColor = postureMode ? CK.ink2 : CK.watch
  const refs: RefLine[] = scored ? groups.map(g => {
    const price = comp * (1 + g.flag)
    return {
      value: price,
      color: lineColor,
      text: postureMode ? null : `watch ${signedPct(g.flag)} · ${money(price)}`,
      postures: postureMode ? g.postures : null,
      tip: [
        { value: signedPct(g.flag), label: 'watch line', color: lineColor },
        { value: perMo(price), label: 'watch price' },
        ...(postureMode ? [{ value: postureList(g.postures), label: 'postures' }] : []),
      ],
    }
  }) : []

  const span: Span | null = assumed === comp ? null : {
    from: comp,
    to: assumed,
    text: premium >= 0 ? `${signedPct(premium)} over comp` : `${absPct(premium)} under comp`,
    tip: [
      { value: signedPct(premium), label: 'vs comp' },
      ...(scored ? [{ value: signedMargin(RENT, eng!.margin!), label: 'margin to watch' }] : []),
      ...(eng ? [{ value: STATUS_WORD[eng.status], label: 'status today' }] : []),
    ],
  }

  const legend: LegendItem[] = [
    { label: 'Market comp rent', color: CK.context },
    { label: 'Underwritten rent', color: CK.accent },
    ...(refs.length ? [{ label: postureMode ? 'Watch line, by posture' : 'Watch line', color: lineColor, shape: 'line' as const }] : []),
    ...(refs.length && postureMode
      ? POSTURES.filter(p => groups.some(g => g.postures.includes(p)))
        .map(p => ({ label: `${p[0].toUpperCase()}${p.slice(1)} posture`, color: CK.posture[p], letter: p[0].toUpperCase() }))
      : []),
  ]

  return (
    <ChartCard title={title} subtitle={subtitle} table={table} note={scored ? note : undefined}>
      <StatusLine status={status}>{statusText}</StatusLine>
      <Legend items={legend} />
      <TwoBarPlot
        label={`Underwritten rent ${perMo(assumed)} vs market comp ${perMo(comp)}`}
        rows={[
          { label: 'Market comp', value: comp, valueText: perMo(comp), color: CK.context,
            tip: [{ value: perMo(comp), label: 'market comp rent', color: CK.context }] },
          { label: 'Underwritten', value: assumed, valueText: perMo(assumed), color: CK.accent,
            tip: [{ value: perMo(assumed), label: 'underwritten rent', color: CK.accent }, { value: signedPct(premium), label: 'vs comp' }] },
        ]}
        refs={refs}
        span={span}
        tick={v => (v >= 10000 ? `$${(v / 1000).toLocaleString('en-US')}K` : `$${v.toLocaleString('en-US')}`)}
      />
    </ChartCard>
  )
}

// ============================================================ ABSORPTION

export function AbsorptionChart({ fields, response }: Props) {
  const lease = num(fields.lease_up_months_assumed)
  const sub = num(fields.submarket_leaseup_months)
  const ck = findCheck(response, ABS)
  const gap = lease !== null && sub !== null ? lease - sub : null
  // Engine: value = underwritten months, margin = underwritten − record. A
  // result that disagrees with these fields was scored on other inputs.
  const fresh = !ck || (has(ck.margin)
    ? gap !== null && lease !== null && Math.abs(ck.margin - gap) <= EPS && (!has(ck.value) || Math.abs(ck.value - lease) <= EPS)
    : gap === null)
  const eng = fresh ? ck : undefined
  const invalid = (lease !== null && lease < 0) || (sub !== null && sub < 0)
  const byPosture = eng ? postureRows(response, ABS) : []
  const title = 'Lease-up vs submarket record'
  const subtitle = 'Months to lease up · the check flags an underwriting that leases up faster than the submarket’s record'
  const sameEverywhere = byPosture.length === POSTURES.length && byPosture.every(r => r.status === byPosture[0].status)

  const table: TableSpec = {
    columns: ['Measure', 'Value', 'Basis'],
    rows: [
      ['Submarket lease-up record', sub !== null ? mo(sub) : MISSING, sub !== null && sub < 0 ? 'deal inputs · not a usable duration' : 'deal inputs'],
      ['Underwritten lease-up', lease !== null ? mo(lease) : MISSING, lease !== null && lease < 0 ? 'deal inputs · not a usable duration' : 'deal inputs'],
      ['Gap (underwritten − record)', gap !== null && !invalid ? signedMo(gap) : '—',
        gap !== null && !invalid ? '+ = slower than the record, the safe side' : 'needs both durations'],
      ...(!fresh
        ? [['Engine result', 'Re-scoring', 'last result was for different inputs — status hidden']]
        : byPosture.map(r => [
          `Status · ${r.posture}${r.posture === response.posture ? ' (today)' : ''}`,
          `${STATUS_WORD[r.status]}${r.posture === response.posture && eng?.status === 'flag' ? ` · ${pts(eng.flagPoints)}` : ''}`,
          invalid ? 'engine · scored from the negative input as given' : 'no posture threshold — underwritten must not beat the record',
        ])),
    ],
  }

  if (lease === null || sub === null || gap === null || invalid) {
    const problem = (name: string, v: number | null) =>
      v === null ? `${name} ${MISSING}` : v < 0 ? `${name} reads ${mo(v)} — not a usable duration` : null
    const pL = problem('Underwritten lease-up', lease)
    const pS = problem('The submarket’s lease-up record', sub)
    const text = lease === null && sub === null
      ? `Underwritten lease-up and the submarket’s lease-up record ${MISSING}.`
      : `${[pL, pS].filter(Boolean).join('. ')}. There’s no gap to measure.`
        + (!pL ? ` Underwritten lease-up is ${mo(lease!)}.` : !pS ? ` The submarket record is ${mo(sub!)}.` : '')
    return (
      <ChartCard title={title} subtitle={subtitle} table={table}>
        <Empty status={eng && !invalid ? eng.status : null}>{text}{fresh ? '' : ` ${RESCORING}.`}</Empty>
      </ChartCard>
    )
  }

  const gapText = gap < 0 ? `${mo(-gap)} faster than the record` : gap > 0 ? `${mo(gap)} slower than the record` : ''
  let statusText = gap < 0
    ? `Underwritten lease-up is ${mo(-gap)} faster than the submarket’s record`
    : gap > 0
      ? `Underwritten lease-up is ${mo(gap)} slower than the submarket’s record — the safe side`
      : 'Underwritten lease-up matches the submarket’s record'
  if (eng?.status === 'flag') statusText += ` · ${pts(eng.flagPoints)}`
  if (!ck) statusText += '. The absorption check isn’t in the active rulebook.'
  if (!fresh) statusText += `. ${RESCORING}, so its status is hidden.`

  const note = (
    <>
      Rule: the underwritten lease-up should not beat the submarket’s record (margin = underwritten − record;
      + = slower, the safe side).{sameEverywhere ? ' No posture threshold — the same result in green, yellow and red.' : ''}
    </>
  )

  return (
    <ChartCard title={title} subtitle={subtitle} table={table} note={note}>
      <StatusLine status={eng?.status ?? null}>{statusText}</StatusLine>
      <Legend items={[
        { label: 'Submarket record', color: CK.context },
        { label: 'Underwritten', color: CK.accent },
      ]} />
      <TwoBarPlot
        label={`Underwritten lease-up ${mo(lease)} vs submarket record ${mo(sub)}`}
        rows={[
          { label: 'Submarket record', value: sub, valueText: mo(sub), color: CK.context,
            tip: [{ value: mo(sub), label: 'submarket record', color: CK.context }] },
          { label: 'Underwritten', value: lease, valueText: mo(lease), color: CK.accent,
            tip: [{ value: mo(lease), label: 'underwritten lease-up', color: CK.accent }, { value: signedMo(gap), label: 'vs record' }] },
        ]}
        refs={[]}
        span={gap === 0 ? null : {
          from: sub,
          to: lease,
          text: gapText,
          tip: [
            { value: signedMo(gap), label: 'gap vs record' },
            ...(eng ? [{ value: STATUS_WORD[eng.status], label: 'status today' }] : []),
          ],
        }}
        tick={(v, last) => (last ? `${v} mo` : `${v}`)}
      />
    </ChartCard>
  )
}

export default RentChart
