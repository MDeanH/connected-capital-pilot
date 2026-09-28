// CushionChart — "Buffer zone by market posture" on the Summary tab. For every
// check with a numeric margin: how much room the deal has before it fails, and
// how that room shrinks as the market turns green → yellow → red.
//
// Form: diverging dot plot as small multiples — one row per check on its own
// linear scale in that check's units (bps and pp never share an axis), centred
// on a zero line that means "fails here". Each row is scaled to its own bar
// (the threshold, the ratio the engine uses to call a pass thin), so distance
// from the line reads the same way on every row. Every number comes from the
// engine (response.result + response.scenarios); nothing is inferred.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  CK, ChartCard, Plot, POSTURE_LETTER, PostureDot, niceTicks, scaleLinear, useTooltip,
  type LegendItem, type TableSpec, type TipLine,
} from './ChartKit'
import { fmtVal } from '../GateResults'
import type { CheckResult, Gate1Response, GateResult, Posture } from '../deal-types'

type Status = CheckResult['status']
type Unit = 'bps' | 'pp' | 'x' | 'mo' | 'count'

interface PostureCheck {
  status: Status
  value: number | null
  margin: number | null
  fragile?: boolean
  threshold: number | null
}

interface Dot { key: Posture | 'all'; margin: number; fragile: boolean; lines: TipLine[] }

interface Row {
  id: string
  label: string
  kind: 'kill' | 'flag'
  unit: Unit
  today: CheckResult
  per: Partial<Record<Posture, PostureCheck>>
  mode: 'dots' | 'text' | 'yesno'
  dots: Dot[]
  invariant: boolean
  /** Half-width of the row's symmetric scale, in the check's own units. */
  span: number
  text: string
  /** Today's status words for the right column. */
  status: string
  /** Today's flag counts double (severe rent premium). */
  doubled: boolean
}

/** A check's bar under one posture: tooltip value + label, and the table's wording. */
interface Bar { value: string; label: string; table: string }

const POSTURES: Posture[] = ['green', 'yellow', 'red']
const NAME: Record<Posture, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }
const STATUS_WORD: Record<Status, string> = { pass: 'PASS', flag: 'WATCH', fail: 'FAIL', missing: 'MISSING', na: 'N/A' }
const CMP: Record<string, string> = { '<=': '≤', '>=': '≥' }
const GROUPS: Array<{ kind: 'kill' | 'flag'; title: string }> = [
  { kind: 'kill', title: 'HARD KILLS' },
  { kind: 'flag', title: 'WATCH FLAGS' },
]

// runCheck cases that can yield a signed margin; the rest are yes/no.
const NUMERIC = new Set([
  'ltc_max', 'dev_spread_min', 'contingency_min', 'coinvest_min', 'track_record', 'mini_stress',
  'yoc_vs_benchmark', 'exit_cap_vs_market', 'interest_reserve', 'land_basis', 'rents_vs_comps',
  'absorption', 'profit_margin', 'completion_guarantee',
])
// runCheck's comparator per check; its early 'missing' returns omit it.
const CMP_BY_ID: Record<string, '<=' | '>='> = {
  ltc_max: '<=', land_basis: '<=', rents_vs_comps: '<=',
  dev_spread_min: '>=', contingency_min: '>=', coinvest_min: '>=', track_record: '>=', mini_stress: '>=',
  yoc_vs_benchmark: '>=', exit_cap_vs_market: '>=', interest_reserve: '>=', absorption: '>=',
  profit_margin: '>=', completion_guarantee: '>=',
}
// Thresholdless checks: the deal input each is measured against (row scale reference).
const MARKET_REF: Record<string, string> = {
  exit_cap_vs_market: 'today’s market cap rate',
  absorption: 'the submarket lease-up record',
}
const UNIT_CAPTION: Record<Unit, string> = {
  bps: 'bps', pp: 'pct. points', x: 'multiple (x)', mo: 'months', count: 'projects',
}
// Smallest half-width a row's scale may have, so a zero or tiny threshold
// can't blow a hair's-width margin up to the track's end.
const UNIT_FLOOR: Record<Unit, number> = { bps: 100, pp: 0.05, x: 0.5, mo: 6, count: 2 }
// Margin display: scale to the unit, base decimals (fmtMargin's), trim trailing zeros.
const FMT: Record<Unit, { k: number; d: number; trim: boolean; suf: string }> = {
  pp: { k: 100, d: 1, trim: false, suf: ' pp' },
  bps: { k: 1, d: 0, trim: false, suf: ' bps' },
  x: { k: 1, d: 2, trim: false, suf: 'x' },
  mo: { k: 1, d: 1, trim: true, suf: ' mo' },
  count: { k: 1, d: 1, trim: true, suf: '' },
}

// Geometry (px; the SVG's viewBox tracks the measured width, so 1 unit = 1px).
const R = 8 // posture dot radius; PostureDot adds the 2px surface ring
const LANE = 20 // vertical step when dots would overlap (dot + ring diameter)
const TRACK = 26
const PAD = 12 // keeps end dots inside the track
const HIT = 12 // 24px hit target
const THIN_W = 22 // "thin" direct label, 10px text

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
/** Float noise (e.g. 1050/1000 − 1 − 0.05 = −4e-17) is zero, not a shortfall. */
const snap = (m: number) => (Math.abs(m) < 1e-9 ? 0 : m)
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const pctTrim = (x: number) => `${Number((x * 100).toFixed(1))}%`

function unitOf(id: string): Unit {
  switch (id) {
    case 'dev_spread_min':
    case 'exit_cap_vs_market':
      return 'bps'
    case 'mini_stress':
      return 'x'
    case 'interest_reserve':
    case 'absorption':
      return 'mo'
    case 'track_record':
      return 'count'
    default:
      return 'pp' // fractions, shown as percentage points (matches fmtMargin)
  }
}

/** Margin magnitude in its units; adds a decimal (then "<") so a real miss never reads as 0. */
function magnitude(unit: Unit, m: number): string {
  const f = FMT[unit]
  const v = Math.abs(m) * f.k
  if (v === 0) return `${(0).toFixed(f.trim ? 0 : f.d)}${f.suf}`
  for (const d of [f.d, f.d + 1]) {
    const s = v.toFixed(d)
    if (Number(s) !== 0) return `${f.trim ? String(Number(s)) : s}${f.suf}`
  }
  return `<${(10 ** -(f.d + 1)).toFixed(f.d + 1)}${f.suf}`
}

function signed(id: string, raw: number): string {
  const m = snap(raw)
  const unit = unitOf(id)
  const s = `${m > 0 ? '+' : m < 0 ? '−' : ''}${magnitude(unit, m)}`
  return unit === 'count' ? `${s} project${Math.abs(m) === 1 ? '' : 's'}` : s
}

function tick(unit: Unit, v: number): string {
  const n = (x: number) => String(Number(Math.abs(x).toFixed(2)))
  const s = v > 0 ? '+' : v < 0 ? '−' : ''
  switch (unit) {
    case 'bps': return `${s}${n(v)} bps`
    case 'pp': return `${s}${n(v * 100)} pp`
    case 'x': return `${s}${n(v)}x`
    case 'mo': return `${s}${n(v)} mo`
    case 'count': return `${s}${n(v)}`
  }
}

/**
 * Checks without a posture threshold are measured against another deal input;
 * recover it from the engine's own value and margin (value − margin).
 */
function marketBar(id: string, pc: { value: number | null; margin: number | null } | undefined): number | null {
  if (!pc || !has(pc.value) || !has(pc.margin)) return null
  if (id === 'exit_cap_vs_market') return pc.value - pc.margin / 10000 // cap rate, decimal
  if (id === 'absorption') return pc.value - pc.margin // months
  return null
}

/** The bar a check is measured against under one posture, in its own units. */
function barOf(c: CheckResult, t: number | null, pc?: { value: number | null; margin: number | null }): Bar {
  const cmp = CMP[c.comparator ?? CMP_BY_ID[c.id] ?? ''] ?? ''
  const id = c.id
  if (id === 'exit_cap_vs_market' || id === 'absorption') {
    const mk = marketBar(id, pc)
    const cap = id === 'exit_cap_vs_market'
    if (mk === null) {
      const table = cap ? 'exit cap ≥ today’s market cap' : 'lease-up ≥ submarket record'
      return { value: cap ? '≥ market cap' : '≥ submarket', label: 'no set threshold', table }
    }
    const v = cap ? pct1(mk) : fmtVal(id, mk)
    return cap
      ? { value: `≥ ${v}`, label: 'market cap today', table: `exit cap ≥ today’s market cap, ${v}` }
      : { value: `≥ ${v}`, label: 'submarket lease-up', table: `lease-up ≥ submarket record, ${v}` }
  }
  if (t === null) return { value: '—', label: 'no set threshold', table: 'no set threshold' }
  const v = fmtVal(id, t)
  switch (id) {
    case 'completion_guarantee':
      return { value: `${cmp} ${v} of cost`, label: 'guarantor net worth', table: `guarantor net worth ${cmp} ${v} of cost` }
    case 'interest_reserve':
      return { value: `${cmp} duration + ${v}`, label: 'reserve', table: `reserve ${cmp} duration + ${v}` }
    case 'track_record': {
      const p = `${cmp} ${v} project${t === 1 ? '' : 's'}`
      return { value: p, label: 'completed comparables', table: p }
    }
    case 'mini_stress':
      return { value: `${cmp} ${v}`, label: 'floor', table: `${cmp} ${v}` }
    case 'rents_vs_comps':
      return { value: `${cmp} ${v}`, label: 'premium over comps', table: `${cmp} ${v} premium; a severe premium counts double` }
    default:
      return { value: `${cmp} ${v}`, label: 'threshold', table: `${cmp} ${v}` }
  }
}

const statusText = (s: { status: Status; fragile?: boolean }) => `${STATUS_WORD[s.status]}${s.fragile ? ' · thin' : ''}`

type Stress = GateResult['stress']
const stressHow = (s: Stress) =>
  s && has(s.hardCostBumpPct) && has(s.exitCapBumpBps)
    ? { cost: `+${pctTrim(s.hardCostBumpPct)}`, cap: `+${Number(s.exitCapBumpBps.toFixed(1))} bps` }
    : null

/** Tooltip lines describing the deal's side of the comparison under one posture. */
function dealLines(c: CheckResult, p: Posture, pc: PostureCheck | undefined, today: Posture, stress: Stress): TipLine[] {
  const v = pc?.value ?? null
  if (c.id === 'mini_stress' && has(v)) {
    const how = stressHow(stress)
    return [
      { value: `${v.toFixed(2)}x`, label: 'stressed multiple' },
      ...(how ? [{ value: how.cost, label: 'hard-cost overrun' }, { value: how.cap, label: 'exit-cap shock' }] : []),
    ]
  }
  if (c.id === 'exit_cap_vs_market' && has(v)) return [{ value: pct1(v), label: 'underwritten exit cap' }]
  if (c.id === 'absorption' && has(v)) return [{ value: fmtVal(c.id, v), label: 'assumed lease-up' }]
  // valueDisplay's "N mo needed" uses today's buffer; other postures get the bare reserve.
  if (c.id === 'interest_reserve' && p !== today && has(v)) return [{ value: `${v} mo`, label: 'reserve' }]
  return [{ value: c.valueDisplay, label: 'deal' }]
}

function buildRows(response: Gate1Response): Row[] {
  const sc = response.scenarios
  const today = response.posture
  const avail = sc ? POSTURES : [today]
  const meta = new Map(response.checksMeta.map(m => [m.id, m]))
  const stressOf = (p: Posture) => sc?.[p]?.stress ?? (p === today ? response.result.stress : undefined)

  return response.result.checks.map((c): Row => {
    const per: Partial<Record<Posture, PostureCheck>> = {}
    for (const p of avail) {
      const s: PostureCheck | undefined = sc
        ? sc[p]?.checks.find(x => x.id === c.id)
        : { status: c.status, value: c.value, margin: c.margin, fragile: c.fragile, threshold: c.threshold?.effective ?? null }
      if (s) per[p] = s
    }
    const label = c.label || meta.get(c.id)?.label || c.id
    const kind = meta.get(c.id)?.kind ?? c.kind
    const unit = unitOf(c.id)
    // A severe rent premium doubles the flag's points (engine: flagPoints × 2).
    const doubled = c.status === 'flag' && c.flagPoints > (meta.get(c.id)?.flagPoints ?? 1)
    const status = `${statusText(c)}${doubled ? ' · double points' : ''}`
    const base = { id: c.id, label, kind, unit, today: c, per, status, doubled }

    const measured: Array<{ p: Posture; pc: PostureCheck; m: number }> = []
    for (const p of avail) {
      const pc = per[p]
      if (pc && has(pc.margin)) measured.push({ p, pc, m: snap(pc.margin) })
    }
    if (!measured.length) {
      const text = c.status === 'missing' ? 'input missing — can’t measure' : `${c.valueDisplay} — no margin to measure`
      return { ...base, mode: NUMERIC.has(c.id) ? 'text' : 'yesno', dots: [], invariant: false, span: 1, text }
    }

    const ms = measured.map(d => d.m)
    const invariant = measured.length === POSTURES.length && ms.every(m => near(m, ms[0]))
    const head: TipLine = { value: label, label: kind === 'kill' ? 'hard kill' : 'watch flag' }
    const bars = avail.map(p => barOf(c, per[p]?.threshold ?? null, per[p]))
    const sameBar = bars.every(b => b.value === bars[0].value)
    const severe: TipLine[] = doubled ? [{ value: `${c.flagPoints} flag points`, label: 'counts double' }] : []

    const dots: Dot[] = invariant
      ? [{
          key: 'all',
          margin: ms[0],
          fragile: !!(per[today]?.fragile ?? c.fragile),
          lines: [
            head,
            { value: signed(c.id, ms[0]), label: `every posture · ${statusText(per[today] ?? c)}`, color: CK.ink2 },
            sameBar
              ? { value: bars[0].value, label: bars[0].label }
              : { value: avail.map((p, i) => `${POSTURE_LETTER[p]} ${bars[i].value}`).join(' · '), label: bars[0].label },
            ...dealLines(c, today, per[today], today, stressOf(today)),
            ...severe,
          ],
        }]
      : measured.map(({ p, pc, m }) => {
          const b = barOf(c, pc.threshold, pc)
          return {
            key: p,
            margin: m,
            fragile: !!pc.fragile,
            lines: [
              head,
              { value: signed(c.id, m), label: `${NAME[p]}${p === today ? ' (today)' : ''} · ${statusText(pc)}`, color: CK.posture[p] },
              { value: b.value, label: b.label },
              ...dealLines(c, p, pc, today, stressOf(p)),
              ...(p === today ? severe : []),
            ],
          }
        })

    // Scale each row to its own bar — the threshold (the engine's fragility
    // denominator) or, for the two thresholdless checks, the market figure —
    // widened only when a margin is bigger, never below the unit floor.
    const thr = measured.map(d => d.pc.threshold).filter(has).map(Math.abs)
    const mk = marketBar(c.id, measured[0].pc)
    const ref = thr.length ? Math.max(...thr) : mk !== null ? Math.abs(unit === 'bps' ? mk * 10000 : mk) : 0
    const want = Math.max(...ms.map(Math.abs), ref, UNIT_FLOOR[unit])
    const ticks = niceTicks(0, want, 5)
    const span = Math.max(ticks[ticks.length - 1] ?? want, want)
    return { ...base, mode: 'dots', dots, invariant, span, text: '' }
  })
}

/**
 * Lanes for dots that would overlap: if any two collide, every posture gets a
 * fixed lane in posture order (G top, Y middle, R bottom); otherwise one lane.
 */
function lanes(xs: number[]): { off: number[]; count: number } {
  const collide = xs.some((x, i) => xs.some((x2, j) => j > i && Math.abs(x - x2) < LANE))
  if (!collide) return { off: xs.map(() => 0), count: 1 }
  const mid = (xs.length - 1) / 2
  return { off: xs.map((_, i) => (i - mid) * LANE), count: xs.length }
}

function clip(text: string, px: number, charPx: number): string {
  const max = Math.floor(px / charPx)
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

const caption = (r: Row) => `${UNIT_CAPTION[r.unit]}${r.invariant ? ' · same in every posture' : ''}`

// Within each group: rows that move with posture first, then posture-invariant, then unmeasurable.
const rank = (r: Row) => (r.mode !== 'dots' ? 2 : r.invariant || r.dots.length < 2 ? 1 : 0)

function CushionPlot({ rows, today }: { rows: Row[]; today: Posture }) {
  const tip = useTooltip()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => {
      const cw = Math.floor(el.getBoundingClientRect().width)
      if (cw > 0) setW(cw)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const valueOf = (r: Row) => (has(r.today.margin) ? signed(r.id, r.today.margin) : '—')
  const need = Math.max(...rows.map(r => Math.max(r.label.length * 6.6, caption(r).length * 5.7))) + 16
  const valueW = Math.max(96, ...rows.map(r => Math.max(valueOf(r).length * 7.4, r.status.length * 5.8) + 16))
  const wide = w >= 560 && need <= w * 0.4 && valueW <= w * 0.25
  const x0 = wide ? Math.max(150, need) : 0
  const x1 = wide ? w - valueW : w
  const zx = (x0 + x1) / 2

  const ink = { fontSize: 12, fill: CK.ink, fontWeight: 500 }
  const small = { fontSize: 10.5, fill: CK.ink2 }
  const num = { fontVariantNumeric: 'tabular-nums' as const }

  const nodes: ReactNode[] = []
  let y = 0
  nodes.push(
    <g key="head" aria-hidden="true">
      <text x={x0} y={12} {...small}>← shortfall</text>
      <text x={zx} y={12} textAnchor="middle" {...small}>fails here</text>
      <text x={x1} y={12} textAnchor="end" {...small}>room →</text>
      {wide && <text x={w} y={12} textAnchor="end" {...small}>today · {today}</text>}
    </g>,
  )
  y = 20

  for (const g of GROUPS) {
    const rs = rows.filter(r => r.kind === g.kind).map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(o => o.r)
    if (!rs.length) continue
    nodes.push(
      <g key={g.kind} aria-hidden="true">
        <line x1={0} x2={w} y1={y + 6.5} y2={y + 6.5} stroke={CK.grid} strokeWidth={1} />
        <text x={0} y={y + 22} fontSize={10.5} fontWeight={600} letterSpacing="0.08em" fill={CK.ink2}>{g.title}</text>
      </g>,
    )
    y += 32

    for (const r of rs) {
      const valueText = valueOf(r)
      const s = scaleLinear(-r.span, r.span, x0 + PAD, x1 - PAD)
      const xs = r.dots.map(d => s(d.margin))
      const { off, count } = lanes(xs)
      const th = r.mode === 'dots' ? TRACK + (count - 1) * LANE : TRACK
      const top = wide ? y + 4 : y + 34
      const cy = top + th / 2
      const pts = xs.map((x, i) => ({ x, y: cy + off[i] }))

      const labelY = wide ? cy - 2 : y + 12
      const capY = wide ? cy + 12 : y + 26
      const valueY = wide ? cy - 1 : y + 12
      const statusY = wide ? cy + 12 : y + 26
      // Stacked rows share their line with the value/status text on the right.
      const labelPx = wide ? x0 - 12 : w - valueText.length * 7.4 - 14
      const capPx = wide ? x0 - 12 : w - r.status.length * 5.8 - 14
      const shownLabel = clip(r.label, labelPx, 6.6)

      // "thin" direct label beside each fragile dot: right if clear, else left, else leave it to the tooltip.
      const thin = r.dots.map((d, i) => {
        if (!d.fragile) return null
        const p = pts[i]
        const clear = (a: number, b: number) => a >= x0 && b <= x1 &&
          pts.every((q, j) => j === i || q.y !== p.y || q.x + R + 2 < a || q.x - R - 2 > b)
        const ra = p.x + R + 4
        if (clear(ra, ra + THIN_W)) return { x: ra, anchor: 'start' as const, y: p.y }
        const la = p.x - R - 4
        if (clear(la - THIN_W, la)) return { x: la, anchor: 'end' as const, y: p.y }
        return null
      })

      nodes.push(
        <g key={r.id}>
          <text x={0} y={labelY} {...ink}>
            {shownLabel}
            {shownLabel !== r.label && <title>{r.label}</title>}
          </text>
          <text x={0} y={capY} {...small}>{clip(caption(r), capPx, 5.7)}</text>
          <text x={w} y={valueY} textAnchor="end" fontSize={12} fontWeight={600} fill={CK.ink} style={num}>{valueText}</text>
          <text x={w} y={statusY} textAnchor="end" {...small}>{r.status}</text>

          {r.mode === 'text' ? (
            <text x={x0 + PAD} y={cy + 4} fontSize={11} fill={CK.ink2}>{clip(r.text, x1 - x0 - PAD, 5.9)}</text>
          ) : (
            <>
              <rect x={x0} y={top} width={Math.max(0, zx - 1 - x0)} height={th} rx={3} fill={CK.failWash} />
              <rect x={zx + 1} y={top} width={Math.max(0, x1 - zx - 1)} height={th} rx={3} fill={CK.passWash} />
              <line x1={zx} x2={zx} y1={top - 2} y2={top + th + 2} stroke={CK.ink2} strokeWidth={1} />
              {pts.length > 1 && (
                <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none"
                  stroke={CK.context} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {r.dots.map((d, i) => (
                <g key={d.key} className="ck-hover" {...tip.bind(d.lines)}>
                  <circle className="ck-hit" cx={pts[i].x} cy={pts[i].y} r={HIT} fill="transparent" />
                  <g className="ck-mark">
                    {d.key === 'all' ? (
                      <>
                        <circle cx={pts[i].x} cy={pts[i].y} r={R + 2} fill={CK.surface} />
                        <circle cx={pts[i].x} cy={pts[i].y} r={R} fill={CK.ink2} />
                      </>
                    ) : (
                      <PostureDot cx={pts[i].x} cy={pts[i].y} posture={d.key} r={R} />
                    )}
                  </g>
                </g>
              ))}
              {thin.map((t, i) => t && (
                <text key={`thin-${i}`} x={t.x} y={t.y} dy="0.35em" textAnchor={t.anchor} fontSize={10}
                  fontWeight={600} fill={CK.ink2} aria-hidden="true">thin</text>
              ))}
              <g aria-hidden="true">
                <line x1={s(-r.span)} x2={s(-r.span)} y1={top + th} y2={top + th + 3} stroke={CK.axis} strokeWidth={1} />
                <line x1={s(r.span)} x2={s(r.span)} y1={top + th} y2={top + th + 3} stroke={CK.axis} strokeWidth={1} />
                <text x={s(-r.span)} y={top + th + 13} fontSize={10} fill={CK.ink2} style={num}>{tick(r.unit, -r.span)}</text>
                <text x={s(r.span)} y={top + th + 13} textAnchor="end" fontSize={10} fill={CK.ink2} style={num}>{tick(r.unit, r.span)}</text>
              </g>
            </>
          )}
        </g>,
      )
      const below = r.mode === 'dots' ? 15 : 0
      y = top + th + below + (wide ? 8 : 12)
    }
  }

  return (
    <Plot tip={tip}>
      <div ref={box}>
        <svg viewBox={`0 0 ${w} ${Math.ceil(y)}`} role="group"
          aria-label="Room before each Gate 1 check fails, under green, yellow and red postures">
          {nodes}
        </svg>
      </div>
    </Plot>
  )
}

function cellText(r: Row, p: Posture, isToday: boolean, stress: Stress): string {
  const d = r.per[p]
  if (!d) return '—'
  if (!has(d.margin)) return d.status === 'missing' ? 'input missing' : STATUS_WORD[d.status]
  let em = ''
  if (r.id === 'mini_stress' && has(d.value)) {
    const how = stressHow(stress)
    em = ` (stressed ${d.value.toFixed(2)}x${how ? ` after ${how.cost} hard costs, ${how.cap} exit cap` : ''})`
  }
  const dbl = isToday && r.doubled ? ' · double points' : ''
  return `${signed(r.id, d.margin)} · ${statusText(d)}${dbl}${em}`
}

function thresholdCell(r: Row, avail: Posture[]): string {
  if (r.mode === 'yesno') {
    const t = r.today.threshold?.effective ?? null
    return r.id === 'gmp_required' && has(t) ? `required above ${fmtVal(r.id, t)}` : 'yes / no'
  }
  const bars = avail.map(p => {
    const pc = r.per[p]
    return barOf(r.today, pc ? pc.threshold : r.today.threshold?.effective ?? null, pc).table
  })
  if (bars.every(b => b === bars[0])) return avail.length > 1 ? `${bars[0]} (every posture)` : bars[0]
  return avail.map((p, i) => `${POSTURE_LETTER[p]} ${bars[i]}`).join(' · ')
}

export default function CushionChart({ response }: { response: Gate1Response }) {
  const today = response.posture
  const sc = response.scenarios
  const avail = sc ? POSTURES : [today]
  const all = buildRows(response)
  const plotted = all.filter(r => r.mode !== 'yesno')
  const yesNo = all.filter(r => r.mode === 'yesno')
  const stressOf = (p: Posture) => sc?.[p]?.stress ?? (p === today ? response.result.stress : undefined)

  // Legend only for markers actually drawn.
  const drawn = new Set(plotted.flatMap(r => r.dots.map(d => d.key)))
  const legend: LegendItem[] = avail.filter(p => drawn.has(p)).map(p => ({
    label: `${NAME[p]}${p === today ? ' (today)' : ''}`,
    color: CK.posture[p],
    letter: POSTURE_LETTER[p],
  }))
  if (drawn.has('all')) legend.push({ label: 'Same in every posture', color: CK.ink2, shape: 'dot' })

  const table: TableSpec = {
    columns: ['Check', 'Type', ...avail.map(p => `${NAME[p]}${p === today ? ' (today)' : ''}`), 'Threshold'],
    rows: all.map(r => [
      r.label,
      r.kind === 'kill' ? 'Hard kill' : 'Watch flag',
      ...avail.map(p => cellText(r, p, p === today, stressOf(p))),
      thresholdCell(r, avail),
    ]),
  }

  const notes: ReactNode[] = []
  const market = plotted.filter(r => r.mode === 'dots' && MARKET_REF[r.id])
  if (market.length) {
    notes.push(
      <div key="mk">
        No set threshold, so scaled to the market figure it is measured against:{' '}
        {market.map(r => `${r.label} → ${MARKET_REF[r.id]}`).join('; ')}.
      </div>,
    )
  }
  if (yesNo.length) {
    notes.push(
      <div key="yn">
        Yes/no checks, no margin to plot: {yesNo.map(r => `${r.label} ${STATUS_WORD[r.today.status]}`).join(' · ')}.
      </div>,
    )
  }
  if (!sc) {
    notes.push(
      <div key="sc">Only today’s {today} posture is shown — the other two need the updated scoring functions.</div>,
    )
  }

  return (
    <ChartCard
      title="Buffer zone by market posture"
      subtitle={`Room before each check fails (the centre line) and how it shrinks from green to red. Each row is scaled to its own threshold (wider only if a margin is bigger), so a dot close to the line is a thin pass or a near miss. The number on the right is today’s (${today}) margin; + means room to spare.`}
      legend={legend}
      table={table}
      note={notes.length ? <>{notes}</> : undefined}
    >
      {plotted.length ? (
        <CushionPlot rows={plotted} today={today} />
      ) : (
        <div style={{ fontSize: '.82rem', color: CK.ink2, padding: '.8rem 0' }}>
          No check produced a numeric margin, so there is no buffer to draw.
        </div>
      )}
    </ChartCard>
  )
}
