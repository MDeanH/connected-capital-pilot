// ChartKit — the one chart system the Underwriting view draws with.
//
// Follows the data-viz method: form first, color by the job it does, thin
// marks, recessive chrome, a hover/focus tooltip on every mark, and a table
// view for every chart (tooltips enhance, never gate). Colors were run through
// the palette validator (2026-09-28, light mode, #ffffff card surface):
//
//   identity  CAT = blue #256abf · lavender #9085e9 · rose #d55181
//             all-pairs PASS (worst CVD ΔE 10.9, normal ΔE 16.3, all ≥ 3:1)
//   emphasis  ACCENT #256abf (the one series that matters) · CONTEXT #b9c4cf
//             (de-emphasis gray; context marks always carry a label)
//   posture   the brand's status colors — green #3f7d69 · yellow #b8860b ·
//             red #c2384a. Green↔red is only ΔE 6.5 under deuteranopia, so a
//             posture mark NEVER relies on color: it always carries its G / Y / R
//             letter (PostureDot) and the tooltip/table name it.
//
// The app is light-only (cc-theme defines no dark scheme), so charts are too.
// Status colors mean pass/watch/fail or a macro posture — never series identity.
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Posture } from '../deal-types'

export const CK = {
  cat: ['#256abf', '#9085e9', '#d55181'] as const,
  accent: '#256abf',
  context: '#b9c4cf',
  posture: { green: '#3f7d69', yellow: '#b8860b', red: '#c2384a' } as Record<Posture, string>,
  pass: '#3f7d69',
  watch: '#b8860b',
  fail: '#c2384a',
  surface: '#ffffff',
  grid: '#e6ecea',
  axis: '#c3cbc8',
  ink: '#090e11',
  ink2: '#5c6b67',
  muted: '#8a9793',
  passWash: 'rgba(63,125,105,0.08)',
  failWash: 'rgba(194,56,74,0.07)',
  /** The washes composited on the white surface — for label halos over a wash. */
  passWashSolid: '#f0f5f3',
  failWashSolid: '#fbf1f2',
}

export const POSTURE_LETTER: Record<Posture, string> = { green: 'G', yellow: 'Y', red: 'R' }

// ------------------------------------------------------------------ scales

/** Linear map domain → range. Degenerate domains map to the range midpoint. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0
  return (v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
}

/** Clean tick values (1/2/5 × 10^k steps) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (max < min) [min, max] = [max, min]
  // A span below float resolution is treated as a single value and padded, so
  // the step never falls under half an ulp (where v += step would not move).
  if (max - min <= Math.abs(max) * 1e-9) { const pad = Math.abs(min) || 1; min -= pad / 2; max += pad / 2 }
  const raw = (max - min) / Math.max(1, count)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow
  const start = Math.floor(min / step) * step
  // Built by index, not by accumulation: bounded, and no drift at the ends.
  const n = Math.min(1000, Math.ceil((max - start) / step - 1e-9))
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const v = Number((start + i * step).toFixed(10))
    if (out[out.length - 1] !== v) out.push(v)
  }
  return out
}

// ----------------------------------------------------------------- tooltip

/** Gap (px) between the tooltip and the point it describes. */
const TIP_GAP = 10

export interface TipLine { value: string; label: string; color?: string }

/**
 * One tooltip per chart. `bind(lines)` returns the props a mark spreads on:
 * pointer + keyboard focus show the same readout; the mark gets tabIndex 0.
 * Content renders as React text (escaped) — never innerHTML.
 */
export function useTooltip() {
  const ref = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // x, y: the anchor point above which the tip sits; yBelow: where it goes
  // instead when above would leave the viewport (plot-relative px).
  const [tip, setTip] = useState<{ x: number; y: number; yBelow: number; w: number; lines: TipLine[] } | null>(null)

  const place = useCallback((clientX: number, clientY: number, clientYBelow: number, lines: TipLine[]) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setTip({ x: clientX - box.left, y: clientY - box.top, yBelow: clientYBelow - box.top, w: box.width, lines })
  }, [])

  // Measured placement, before paint: centre on the anchor, then clamp the
  // tip's real width inside the plot, so it never spills past the card on a
  // phone whatever its content. (.ck-tip is border-box with max-width 100%,
  // so the clamp always has room.)
  useLayoutEffect(() => {
    const el = tipRef.current
    const plot = ref.current
    if (!tip || !el || !plot) return
    const tw = el.offsetWidth
    const th = el.offsetHeight
    el.style.left = `${Math.max(0, Math.min(tip.x - tw / 2, tip.w - tw))}px`
    const fitsAbove = plot.getBoundingClientRect().top + tip.y - th - TIP_GAP >= 0
    el.style.top = `${fitsAbove ? tip.y - th - TIP_GAP : tip.yBelow + TIP_GAP}px`
  }, [tip])

  const bind = useCallback((lines: TipLine[]) => ({
    tabIndex: 0,
    role: 'img' as const,
    'aria-label': lines.map(l => `${l.label}: ${l.value}`).join('; '),
    onPointerMove: (e: React.PointerEvent) => place(e.clientX, e.clientY, e.clientY + 14, lines),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as Element).getBoundingClientRect()
      place(r.left + r.width / 2, r.top, r.bottom, lines)
    },
    onBlur: () => setTip(null),
  }), [place])

  const layer = tip ? (
    // left/top are set by the layout effect above, from the measured size.
    <div className="ck-tip" ref={tipRef} role="status">
      {tip.lines.map((l, i) => (
        <div className="ck-tip-row" key={i}>
          {l.color && <span className="ck-tip-key" style={{ background: l.color }} aria-hidden="true" />}
          <span className="ck-tip-val">{l.value}</span>
          <span className="ck-tip-lab">{l.label}</span>
        </div>
      ))}
    </div>
  ) : null

  return { ref, bind, layer }
}

// ------------------------------------------------------------------ legend

export interface LegendItem { label: string; color: string; shape?: 'rect' | 'line' | 'dot'; letter?: string }

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null // one series: the title names it
  return (
    <div className="ck-legend">
      {items.map(it => (
        <span className="ck-leg" key={it.label}>
          {it.letter
            ? <PostureDotHtml color={it.color} letter={it.letter} />
            : <span className={`ck-sw ck-sw-${it.shape ?? 'rect'}`} style={{ background: it.color }} aria-hidden="true" />}
          {it.label}
        </span>
      ))}
    </div>
  )
}

function PostureDotHtml({ color, letter }: { color: string; letter: string }) {
  return <span className="ck-pdot" style={{ background: color }} aria-hidden="true">{letter}</span>
}

/** SVG posture marker: filled circle with its G/Y/R letter and a 2px surface ring. */
export function PostureDot({ cx, cy, posture, r = 8 }: { cx: number; cy: number; posture: Posture; r?: number }) {
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={r + 2} fill={CK.surface} />
      <circle cx={cx} cy={cy} r={r} fill={CK.posture[posture]} />
      <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={r * 1.15} fontWeight={700} fill="#fff">
        {POSTURE_LETTER[posture]}
      </text>
    </g>
  )
}

// -------------------------------------------------------------- chart card

export interface TableSpec { columns: string[]; rows: Array<Array<string>> }

/**
 * Card frame for one chart: title, optional subtitle and legend, the chart,
 * and a Chart/Table toggle so every value is reachable without hovering.
 */
export function ChartCard({ title, subtitle, legend, table, note, children }: {
  title: ReactNode
  subtitle?: ReactNode
  legend?: LegendItem[]
  table: TableSpec
  note?: ReactNode
  children: ReactNode
}) {
  ensureStyle()
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()
  return (
    <div className="ck-card">
      <div className="ck-head">
        <div className="ck-titles">
          <div className="ck-title" id={titleId}>{title}</div>
          {subtitle && <div className="ck-sub">{subtitle}</div>}
        </div>
        {/* The label names the view it switches TO, so no aria-pressed (a
            changing label plus a pressed state contradict each other);
            aria-describedby ties each card's button to its chart. */}
        <button type="button" className="ck-toggle" aria-describedby={titleId} onClick={() => setAsTable(v => !v)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {!asTable && legend && <Legend items={legend} />}
      {asTable ? (
        <div className="ck-table-wrap">
          <table className="ck-table">
            <thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
      {note && <div className="ck-note">{note}</div>}
    </div>
  )
}

/** Positioning wrapper for a chart body + its tooltip layer. */
export function Plot({ tip, children, minHeight }: { tip: ReturnType<typeof useTooltip>; children: ReactNode; minHeight?: number }) {
  return (
    <div className="ck-plot" ref={tip.ref} style={minHeight ? { minHeight } : undefined}>
      {children}
      {tip.layer}
    </div>
  )
}

let injected = false
function ensureStyle() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.id = 'ck-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

const CSS = `
.ck-card{background:${CK.surface};border:1px solid var(--border,#dcebe7);border-radius:10px;padding:1.1rem 1.35rem 1.2rem;box-sizing:border-box;min-width:0}
.ck-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.ck-titles{min-width:0}
.ck-title{font-size:.9rem;font-weight:500;color:${CK.ink}}
.ck-sub{font-size:.75rem;color:${CK.ink2};margin-top:.15rem;line-height:1.4}
.cc-theme button.ck-toggle,button.ck-toggle{flex-shrink:0;font-size:10px;letter-spacing:.08em;padding:.25rem .6rem;background:transparent;color:${CK.ink2};
  border:1px solid var(--border,#dcebe7);border-radius:6px;box-shadow:none}
.cc-theme button.ck-toggle:hover,button.ck-toggle:hover{background:var(--surface-2,#f5fbfa);color:${CK.ink}}
.ck-legend{display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin:.7rem 0 .2rem;font-size:.75rem;color:${CK.ink2}}
.ck-leg{display:inline-flex;align-items:center;gap:.4rem}
.ck-sw{display:inline-block;flex-shrink:0}
.ck-sw-rect{width:10px;height:10px;border-radius:2px}
.ck-sw-line{width:14px;height:2px;border-radius:1px}
.ck-sw-dot{width:9px;height:9px;border-radius:50%}
.ck-pdot{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;color:#fff;font-size:9.5px;font-weight:700;flex-shrink:0}
.ck-plot{position:relative;margin-top:.6rem}
.ck-plot svg{display:block;width:100%;height:auto;overflow:visible}
.ck-plot [tabindex]{outline:none}
.ck-plot [tabindex]:focus-visible{outline:2px solid ${CK.accent};outline-offset:2px}
.ck-tip{position:absolute;left:0;top:0;z-index:5;pointer-events:none;background:#123028;color:#fff;border-radius:6px;box-sizing:border-box;
  width:max-content;max-width:min(280px,100%);padding:.4rem .6rem;font-size:.74rem;line-height:1.45;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.ck-tip-row{display:flex;align-items:center;gap:.45rem}
.ck-tip-key{width:12px;height:2px;border-radius:1px;flex-shrink:0}
.ck-tip-val{font-weight:600;font-variant-numeric:tabular-nums}
.ck-tip-lab{opacity:.8}
.ck-table-wrap{overflow-x:auto;margin-top:.7rem}
.ck-table{width:100%;border-collapse:collapse;font-size:.78rem}
.ck-table th{text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${CK.ink2};font-weight:600;padding:.4rem .5rem;border-bottom:1px solid ${CK.grid}}
.ck-table td{padding:.4rem .5rem;border-top:1px solid ${CK.grid};font-variant-numeric:tabular-nums}
.ck-note{font-size:.72rem;color:${CK.ink2};margin-top:.6rem;line-height:1.45}
.ck-axis text,.ck-tick{font-size:10.5px;fill:${CK.muted};font-variant-numeric:tabular-nums}
.ck-label{font-size:11.5px;fill:${CK.ink2}}
.ck-value{font-size:11.5px;fill:${CK.ink};font-weight:600;font-variant-numeric:tabular-nums}
.ck-hit{fill:transparent;cursor:default}
.ck-mark{transition:opacity .12s}
.ck-hover:hover .ck-mark,.ck-hover:focus-visible .ck-mark{opacity:.8}
`
