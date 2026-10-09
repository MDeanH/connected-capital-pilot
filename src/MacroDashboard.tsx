// Macro dashboard — Patel's weekly macro snapshot. Refreshable, 5-year signal
// trends, and the four-quadrant inflation/deflation × expansion/recession read.
// Pure presentation: everything renders from the MacroSnapshot the server
// computed; no thresholds or bands are re-derived here. Missing data renders
// as honest empty states — never faked.
import { useState } from 'react'
import type { MacroSnapshot, MacroSignalReading, MacroQuadrant, Regime, Posture } from '../netlify/functions/lib/gate1/types'
import { PostureChip, Kicker } from './cc-ui'
import { Term } from './GlossaryTip'
import { Info } from './Info'
import { type AdminFlag } from './auth'

interface Props {
  snapshot: MacroSnapshot | null
  loading: boolean
  error: string | null
  // signalValues entries: number = set this week's reading; null = explicitly
  // clear the recorded reading (the server honors null as a clear); an absent
  // id means "carry the recorded reading forward" server-side.
  onOverride: (o: { regime?: Regime; signalValues?: Record<string, number | null>; note: string }) => Promise<void>
  onRefresh: () => void
  isAdmin: AdminFlag
}

const REGIME_PRETTY: Record<Regime, string> = {
  soft_landing: 'Soft landing',
  stagflation: 'Stagflation',
  recession: 'Recession',
}

const QUADRANT_PRETTY: Record<MacroQuadrant['label'], string> = {
  inflationary_expansion: 'Inflationary expansion',
  disinflationary_expansion: "Disinflationary expansion ('Goldilocks')",
  stagflation: 'Stagflation',
  deflationary_contraction: 'Deflationary contraction',
  unknown: 'Quadrant unknown',
}

/** Glossary keys per signal id — signals without a key render plain labels. */
const SIGNAL_TERM_KEY: Record<string, string> = { sahm: 'sahm_rule' }

/** Signals whose value is a raw percentage-point reading (not a share). */
const RAW_PP_SIGNALS = new Set(['sahm', 'yield_curve'])

function prettyAssetClass(k: string): string {
  if (k === '*') return 'All asset classes'
  const s = k.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Signal value display. Heuristic per spec: |v| < 1 → decimal share shown as
 *  percent; otherwise a plain number with thousands separators (claims, index
 *  levels, rates already in % units). Sahm & yield-curve show raw pp. */
function fmtSignalValue(s: MacroSignalReading): string {
  if (s.value == null || !Number.isFinite(s.value)) return '—'
  if (RAW_PP_SIGNALS.has(s.id)) return `${s.value.toFixed(2)} pp`
  if (Math.abs(s.value) < 1) return `${(s.value * 100).toFixed(1)}%`
  return s.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Rate LEVEL display: FRED series (SOFR/DGS10/MORTGAGE30US) are already in
 *  percentage points, so 4.31 → "4.31%" and 0.50 → "0.50%" — never rescaled. */
function fmtRateLevelPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(2)}%`
}

/** Return FRACTION display: S&P returns are decimal shares, so 0.12 → "12.00%". */
function fmtReturnPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

function fmtSignedPct1(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function VoteChip({ vote }: { vote: Posture | null }) {
  if (vote == null) {
    return (
      <span className="md-vote md-vote-none">
        <span className="md-vote-dot" aria-hidden="true" />NO DATA
      </span>
    )
  }
  return (
    <span className={`md-vote md-vote-${vote}`}>
      <span className="md-vote-dot" aria-hidden="true" />{vote.toUpperCase()}
    </span>
  )
}

function Sparkline({ signal }: { signal: MacroSignalReading }) {
  const pts = (signal.history ?? []).filter(p => Number.isFinite(p.value))
  if (pts.length < 2) return null // no fake trend lines from 0–1 points
  const W = 220, H = 44, PAD = 4
  const min = Math.min(...pts.map(p => p.value))
  const max = Math.max(...pts.map(p => p.value))
  const span = max - min || 1
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg
      className="md-spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${signal.label} 5-year trend, ${pts.length} points from ${pts[0].date} to ${last.date}`}
    >
      <path d={d} fill="none" stroke="var(--accent,#3f7d69)" strokeWidth="1.5" />
      <circle cx={x(pts.length - 1)} cy={y(last.value)} r="2.6" fill="var(--accent,#3f7d69)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Four-quadrant chart (THE feature)
// ---------------------------------------------------------------------------

// Crosshair boundary DEFAULTS, used only for old snapshots that predate
// quadrant.bands. They mirror the engine's default-config macro.quadrantBands
// (growthRecessionYoy = 0.0 → 0% growth, inflationHotYoy = 0.025 → 2.5%
// inflation) — keep in sync with netlify/functions/lib/gate1/default-config.json.
// When the snapshot carries bands, the crosshairs draw from the bands the
// server actually classified with.
const DEFAULT_GROWTH_BOUNDARY_PCT = 0.0
const DEFAULT_INFLATION_BOUNDARY_PCT = 2.5

/** Boundary label: whole percents without a decimal, else one decimal. */
function fmtBoundaryPct(v: number): string {
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)
}

function QuadrantChart({ quadrant }: { quadrant: MacroQuadrant | undefined }) {
  // Fixed display window (percent units): growth −4…+6, inflation −1…+8.
  const X0 = -4, X1 = 6, Y0 = -1, Y1 = 8
  const W = 460, H = 300
  const PL = 54, PR = 448, PT = 14, PB = 250
  const gx = (p: number) => PL + ((p - X0) / (X1 - X0)) * (PR - PL)
  const gy = (p: number) => PB - ((p - Y0) / (Y1 - Y0)) * (PB - PT)
  // Engine bands are fractions (0.025 = 2.5%); this chart works in percent units.
  const growthBoundaryPct = quadrant?.bands ? quadrant.bands.growthRecessionYoy * 100 : DEFAULT_GROWTH_BOUNDARY_PCT
  const inflationBoundaryPct = quadrant?.bands ? quadrant.bands.inflationHotYoy * 100 : DEFAULT_INFLATION_BOUNDARY_PCT
  const cx = gx(Math.max(X0, Math.min(X1, growthBoundaryPct)))
  const cy = gy(Math.max(Y0, Math.min(Y1, inflationBoundaryPct)))

  const hasFix = quadrant != null && quadrant.growthYoy != null && quadrant.inflationYoy != null
  const growthPct = hasFix ? quadrant!.growthYoy! * 100 : null
  const inflPct = hasFix ? quadrant!.inflationYoy! * 100 : null
  const px = growthPct != null ? gx(Math.max(X0, Math.min(X1, growthPct))) : null
  const py = inflPct != null ? gy(Math.max(Y0, Math.min(Y1, inflPct))) : null

  const label = quadrant?.label ?? 'unknown'
  const aria = hasFix
    ? `Four-quadrant macro chart: ${QUADRANT_PRETTY[label]}. Real GDP growth ${fmtSignedPct1(growthPct!)} year over year, core inflation ${fmtSignedPct1(inflPct!)} year over year.`
    : 'Four-quadrant macro chart: quadrant unknown — GDP growth or inflation data unavailable this week.'

  // Callout side: flip when the dot sits in the right half or near the top.
  const calloutLeft = px != null && px > (PL + PR) / 2
  const calloutBelow = py != null && py < PT + 30

  return (
    <div className="md-quad-wrap">
      <svg className="md-quad-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        {/* quadrant tints — each carries its own text label (never color-alone) */}
        <rect x={PL} y={PT} width={cx - PL} height={cy - PT} fill="var(--danger-soft,#fbecef)" />
        <rect x={cx} y={PT} width={PR - cx} height={cy - PT} fill="var(--warning-soft,#fbf3df)" />
        <rect x={cx} y={cy} width={PR - cx} height={PB - cy} fill="var(--accent-soft,#e4f5ee)" />
        <rect x={PL} y={cy} width={cx - PL} height={PB - cy} fill="var(--surface-3,#eef1f4)" />

        {/* quadrant labels */}
        <text className="md-quad-label" x={PL + 8} y={PT + 16} textAnchor="start">STAGFLATION</text>
        <text className="md-quad-label" x={PR - 8} y={PT + 16} textAnchor="end">INFLATIONARY EXPANSION</text>
        <text className="md-quad-label" x={PR - 8} y={PB - 22} textAnchor="end">DISINFLATIONARY EXPANSION</text>
        <text className="md-quad-label md-quad-label-sub" x={PR - 8} y={PB - 9} textAnchor="end">(‘GOLDILOCKS’)</text>
        <text className="md-quad-label" x={PL + 8} y={PB - 9} textAnchor="start">DEFLATIONARY CONTRACTION</text>

        {/* crosshair boundaries */}
        <line x1={cx} y1={PT} x2={cx} y2={PB} className="md-quad-cross" />
        <line x1={PL} y1={cy} x2={PR} y2={cy} className="md-quad-cross" />
        <text className="md-quad-bound" x={cx + 4} y={PB - 4} textAnchor="start">{fmtBoundaryPct(growthBoundaryPct)}% growth</text>
        <text className="md-quad-bound" x={PR - 4} y={cy - 4} textAnchor="end">{fmtBoundaryPct(inflationBoundaryPct)}% inflation</text>

        {/* axes + ticks */}
        <line x1={PL} y1={PT} x2={PL} y2={PB} className="md-quad-axis" />
        <line x1={PL} y1={PB} x2={PR} y2={PB} className="md-quad-axis" />
        {[-4, -2, 0, 2, 4, 6].map(t => (
          <g key={`x${t}`}>
            <line x1={gx(t)} y1={PB} x2={gx(t)} y2={PB + 4} className="md-quad-axis" />
            <text className="md-quad-tick" x={gx(t)} y={PB + 16} textAnchor="middle">{t}%</text>
          </g>
        ))}
        {[0, 2, 4, 6, 8].map(t => (
          <g key={`y${t}`}>
            <line x1={PL - 4} y1={gy(t)} x2={PL} y2={gy(t)} className="md-quad-axis" />
            <text className="md-quad-tick" x={PL - 8} y={gy(t) + 3.5} textAnchor="end">{t}%</text>
          </g>
        ))}
        <text className="md-quad-axis-title" x={(PL + PR) / 2} y={H - 6} textAnchor="middle">Real GDP growth, yoy →</text>
        <text className="md-quad-axis-title" x={14} y={(PT + PB) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(PT + PB) / 2})`}>Core inflation, yoy →</text>

        {hasFix && px != null && py != null && (
          <g>
            <circle cx={px} cy={py} r={10} className="md-quad-halo" />
            <circle cx={px} cy={py} r={5.5} className="md-quad-dot" />
            <text
              className="md-quad-callout"
              x={px + (calloutLeft ? -14 : 14)}
              y={py + (calloutBelow ? 22 : -12)}
              textAnchor={calloutLeft ? 'end' : 'start'}
            >
              growth {fmtSignedPct1(growthPct!)} · inflation {fmtSignedPct1(inflPct!)}
            </text>
          </g>
        )}
        {!hasFix && (
          <g>
            <rect x={PL + 60} y={(PT + PB) / 2 - 26} width={PR - PL - 120} height={52} rx={8} className="md-quad-empty-box" />
            <text className="md-quad-empty" x={(PL + PR) / 2} y={(PT + PB) / 2 - 4} textAnchor="middle">No quadrant fix this week</text>
            <text className="md-quad-empty-sub" x={(PL + PR) / 2} y={(PT + PB) / 2 + 14} textAnchor="middle">GDP growth or inflation data unavailable</text>
          </g>
        )}
      </svg>
      <div className="md-quad-caption">
        <Term k="quadrant"><b>{QUADRANT_PRETTY[label]}</b></Term>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vote tally
// ---------------------------------------------------------------------------

function VoteTally({ signals, regime }: { signals: MacroSignalReading[]; regime: Regime }) {
  const sums: Record<Posture, number> = { green: 0, yellow: 0, red: 0 }
  for (const s of signals) if (s.vote != null) sums[s.vote] += s.weight
  const total = sums.green + sums.yellow + sums.red
  const order: Posture[] = ['green', 'yellow', 'red']
  return (
    <div>
      {total > 0 ? (
        <>
          <div
            className="md-tally-bar"
            role="img"
            aria-label={`Weighted votes: green ${sums.green.toFixed(1)}, yellow ${sums.yellow.toFixed(1)}, red ${sums.red.toFixed(1)}`}
          >
            {order.map(p => sums[p] > 0 && (
              <span key={p} className={`md-tally-seg md-tally-${p}`} style={{ flexGrow: sums[p] }} />
            ))}
          </div>
          <div className="md-tally-legend">
            {order.map(p => (
              <span key={p} className="md-tally-item">
                <span className={`md-vote-dot md-tally-${p}`} aria-hidden="true" />
                {p.toUpperCase()} {sums[p].toFixed(1)}
              </span>
            ))}
            <span className="md-tally-total">of {total.toFixed(1)} weighted</span>
          </div>
        </>
      ) : (
        <div className="md-empty-note">No voting signals reported this week.</div>
      )}
      <div className="md-tally-caption">weighted votes → <b>{REGIME_PRETTY[regime]}</b></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact strip (results page)
// ---------------------------------------------------------------------------

export function MacroStrip({ snapshot, assetClass }: { snapshot: MacroSnapshot | null; assetClass?: string }) {
  if (!snapshot) {
    return (
      <span className="md-strip">
        <style>{CSS}</style>
        <span className="md-strip-muted">Macro snapshot unavailable</span>
      </span>
    )
  }
  // Posture resolution mirrors scoring (DealIntake's livePosture): the deal's
  // asset class first, '*' fallback — so with an asset-specific override the
  // strip can never show a different colour than the gates actually ran under.
  // Without an assetClass the legacy '*'-first read stands.
  const posture: Posture | undefined = assetClass
    ? snapshot.postures[assetClass] ?? snapshot.postures['*']
    : snapshot.postures['*'] ?? Object.values(snapshot.postures)[0]
  const notPersisted = (snapshot as { persisted?: boolean }).persisted === false
  const qLabel = snapshot.quadrant?.label
  return (
    <span className="md-strip">
      <style>{CSS}</style>
      {posture
        ? <PostureChip posture={posture} />
        : <span className="md-strip-muted">posture unavailable</span>}
      <span className="md-strip-sep" aria-hidden="true">·</span>
      <span className="md-strip-regime">{REGIME_PRETTY[snapshot.regime]}</span>
      {qLabel && qLabel !== 'unknown' && (
        <>
          <span className="md-strip-sep" aria-hidden="true">·</span>
          <span className="md-strip-quad">{QUADRANT_PRETTY[qLabel]}</span>
        </>
      )}
      <span className="md-strip-asof">as of {snapshot.week_of}</span>
      {snapshot.degraded && <span className="md-tag-degraded">DEGRADED</span>}
      {notPersisted && <span className="md-chip-live">live (not persisted)</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function MacroDashboard({ snapshot, loading, error, onOverride, onRefresh, isAdmin }: Props) {
  // '' = no forced regime (signals-only override) — the default, so entering a
  // signal value can never silently force a regime as a side effect.
  const [ovRegime, setOvRegime] = useState<Regime | ''>('')
  const [ovSignals, setOvSignals] = useState<Record<string, string>>({})
  // Signals the analyst has marked "clear the recorded value" (✕ toggle).
  // Only offered where a recorded reading exists — clearing an empty signal
  // is meaningless.
  const [ovClears, setOvClears] = useState<Record<string, boolean>>({})
  const [ovNote, setOvNote] = useState('')
  const [ovBusy, setOvBusy] = useState(false)
  const [ovError, setOvError] = useState<string | null>(null)

  // Configured manual-entry signals (fred: null server-side). The API names
  // them via manualSignalIds; when the field is absent (older stored payloads,
  // degraded rulebook read) no inputs render and the form falls back to the
  // regime-only override exactly as before.
  const manualIds = (snapshot as { manualSignalIds?: string[] } | null)?.manualSignalIds ?? []
  const readingById = new Map((snapshot?.signals ?? []).map(s => [s.id, s] as const))

  // Parse typed values; only finite numbers ride. type="number" inputs make a
  // non-numeric string nearly impossible, but never silently drop one — block
  // the submit instead.
  const parsedSignals: Record<string, number> = {}
  let invalidSignal = false
  for (const [id, raw] of Object.entries(ovSignals)) {
    const t = raw.trim()
    if (!t) continue
    const n = Number(t)
    if (Number.isFinite(n)) parsedSignals[id] = n
    else invalidSignal = true
  }
  // Per-signal submission states — mirrors the server's clearing contract
  // (netlify/functions/macro.ts): for each manual signal id in signalValues,
  //   value  = set   — a finite number becomes this week's manual reading;
  //   null   = clear — explicitly wipes the recorded reading back to NO DATA;
  //   absent = carry — blank-and-untouched leaves the recorded reading to
  //                    carry forward server-side.
  // Clears only ride for signals that still show a recorded value (a refresh
  // can retire a reading after the toggle was set — a stale clear is a no-op
  // and must not enable a payload-free submit).
  const signalPayload: Record<string, number | null> = { ...parsedSignals }
  for (const [id, on] of Object.entries(ovClears)) {
    if (!on) continue
    const cur = readingById.get(id)?.value
    if (cur != null && Number.isFinite(cur)) signalPayload[id] = null
  }
  const hasSignalPayload = Object.keys(signalPayload).length > 0

  // Clearing and typing are mutually exclusive per signal: toggling the clear
  // drops any draft value, and typing (input re-enabled) requires untoggling.
  function toggleClear(id: string) {
    setOvClears(c => ({ ...c, [id]: !c[id] }))
    setOvSignals(v => {
      if (!(id in v)) return v
      const next = { ...v }
      delete next[id]
      return next
    })
  }

  async function applyOverride() {
    setOvBusy(true)
    setOvError(null)
    try {
      await onOverride({
        ...(ovRegime ? { regime: ovRegime } : {}),
        ...(hasSignalPayload ? { signalValues: signalPayload } : {}),
        note: ovNote.trim(),
      })
      setOvNote('')
      setOvSignals({})
      setOvClears({})
    } catch (e) {
      setOvError(e instanceof Error ? e.message : String(e))
    } finally {
      setOvBusy(false)
    }
  }

  return (
    <div className="md-root">
      <style>{CSS}</style>

      {error && (
        <div className="card md-card md-error" role="alert">
          <span className="md-error-dot" aria-hidden="true" />
          <span className="md-error-word">ERROR</span>
          <span className="md-error-msg">{error}</span>
          <button className="secondary md-btn-sm" onClick={onRefresh} disabled={loading}>Refresh</button>
        </div>
      )}

      {loading && !snapshot && (
        <div className="card md-card md-skeleton" aria-busy="true">
          <div className="md-skel-line md-w30" />
          <div className="md-skel-line md-w60" />
          <div className="md-skel-line md-w45" />
          <div className="md-skel-text">Loading weekly macro snapshot…</div>
        </div>
      )}

      {!loading && !snapshot && !error && (
        <div className="card md-card md-empty-note">No macro snapshot available yet — refresh to fetch one.
          {' '}<button className="secondary md-btn-sm" onClick={onRefresh}>Refresh</button>
        </div>
      )}

      {snapshot && (
        <>
          {/* 1 — Header */}
          <div className="card md-card md-header">
            <div className="md-header-main">
              <Kicker>CONNECTED CAPITAL — WEEKLY MACRO SNAPSHOT</Kicker>
              <h2 className="md-regime">
                <Term k="regime">{REGIME_PRETTY[snapshot.regime]}</Term>
              </h2>
              <div className="md-subline">
                as of {snapshot.week_of} · {snapshot.source}
                {snapshot.degraded && (
                  <span className="md-tag-degraded">
                    DEGRADED
                    <Info width={280} below>
                      Fewer than the minimum voting signals reported this week — the regime is held from last week rather than re-decided on thin data.
                    </Info>
                  </span>
                )}
                {snapshot.pending_regime && (
                  <span className="md-chip-pending">
                    challenger: {REGIME_PRETTY[snapshot.pending_regime].toLowerCase()} — needs another week
                  </span>
                )}
              </div>
            </div>
            <button className="secondary md-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {snapshot.source === 'manual' && (
            <div className="md-manual-banner" role="status">
              <span className="md-manual-dot" aria-hidden="true" />
              Manual override active{snapshot.note ? ` — ${snapshot.note}` : ''}
            </div>
          )}

          {/* 2 — Four-quadrant chart */}
          <div className="card md-card">
            <div className="md-section-title">Four-quadrant read</div>
            <QuadrantChart quadrant={snapshot.quadrant} />
          </div>

          {/* 3 — Posture row */}
          <div className="card md-card">
            <div className="md-section-title">
              <Term k="posture">Deployment posture</Term> — how strict the gates are this week
            </div>
            <div className="md-postures">
              {Object.entries(snapshot.postures).map(([asset, posture]) => (
                <div className="md-posture-item" key={asset}>
                  <span className="md-posture-asset">{prettyAssetClass(asset)}</span>
                  <PostureChip posture={posture} />
                </div>
              ))}
              {Object.keys(snapshot.postures).length === 0 && (
                <div className="md-empty-note">No postures reported.</div>
              )}
            </div>
          </div>

          {/* 4 — Signal grid */}
          <div className="card md-card">
            <div className="md-section-title">Signals</div>
            <div className="md-signal-grid">
              {snapshot.signals.map(s => (
                <div className="md-signal" key={s.id}>
                  <div className="md-signal-label">
                    {SIGNAL_TERM_KEY[s.id] ? <Term k={SIGNAL_TERM_KEY[s.id]}>{s.label}</Term> : s.label}
                  </div>
                  <div className="md-signal-value">{fmtSignalValue(s)}</div>
                  <div className="md-signal-meta">
                    <VoteChip vote={s.vote} />
                    <span className="md-weight">weight {s.weight.toFixed(1)}</span>
                    {s.asof && <span className="md-signal-asof">{s.asof}</span>}
                  </div>
                  <Sparkline signal={s} />
                </div>
              ))}
              {snapshot.signals.length === 0 && (
                <div className="md-empty-note">No signals reported this week.</div>
              )}
            </div>
          </div>

          {/* 5 — Vote tally */}
          <div className="card md-card">
            <div className="md-section-title">Vote tally</div>
            <VoteTally signals={snapshot.signals} regime={snapshot.regime} />
          </div>

          {/* 6 — Market context */}
          {snapshot.market && (
            <div className="card md-card">
              <div className="md-section-title">Market context <span className="md-signal-asof">as of {snapshot.market.asof}</span></div>
              <div className="md-market-grid">
                <div className="md-stat">
                  <div className="md-stat-label"><Term k="sofr">SOFR</Term></div>
                  <div className="md-stat-value">{fmtRateLevelPct(snapshot.market.sofr)}</div>
                </div>
                <div className="md-stat">
                  <div className="md-stat-label">10Y Treasury</div>
                  <div className="md-stat-value">{fmtRateLevelPct(snapshot.market.treasury10y)}</div>
                </div>
                <div className="md-stat">
                  <div className="md-stat-label">30Y Mortgage</div>
                  <div className="md-stat-value">{fmtRateLevelPct(snapshot.market.mortgage30y)}</div>
                </div>
                <div className="md-stat">
                  <div className="md-stat-label">S&amp;P 500 · 1y</div>
                  <div className="md-stat-value">{fmtReturnPct(snapshot.market.sp500.ret1y)}</div>
                </div>
                <div className="md-stat">
                  <div className="md-stat-label">S&amp;P 500 · 3y ann.</div>
                  <div className="md-stat-value">{fmtReturnPct(snapshot.market.sp500.ret3y)}</div>
                </div>
                <div className="md-stat">
                  <div className="md-stat-label">S&amp;P 500 · 5y ann.</div>
                  <div className="md-stat-value">{fmtReturnPct(snapshot.market.sp500.ret5y)}</div>
                </div>
              </div>
            </div>
          )}

          {/* 7 — Manual override — admin-only where auth is on; 'auth-off'
              keeps it visible for everyone, exactly as before */}
          {isAdmin !== false && (
          <div className="card md-card">
            <div className="md-section-title">Patel override</div>
            {manualIds.length > 0 && (
              <div className="md-ov-signals">
                <div className="md-ov-signals-title">Analyst-entered signals</div>
                <div className="md-ov-signals-note">
                  These signals have no data feed — a value typed here is recorded as this
                  week's reading and marked manual. It lasts only until the next automatic
                  snapshot; a field left blank carries its recorded value forward, and ✕
                  clears the recorded value back to NO DATA. A regime override is not
                  required to submit values or clears (the reason note is).
                </div>
                <div className="md-ov-signal-grid">
                  {manualIds.map(id => {
                    const reading = readingById.get(id)
                    const current = reading?.value
                    const hasRecorded = current != null && Number.isFinite(current)
                    const cleared = hasRecorded && !!ovClears[id]
                    return (
                      <label className="md-field" key={id}>
                        <span className="md-field-label">{reading?.label ?? id}</span>
                        <span className="md-ov-input-row">
                          <input
                            type="number"
                            step="any"
                            value={cleared ? '' : ovSignals[id] ?? ''}
                            onChange={e => setOvSignals(v => ({ ...v, [id]: e.target.value }))}
                            placeholder={cleared ? 'cleared' : hasRecorded ? String(current) : 'no data'}
                            disabled={ovBusy || cleared}
                          />
                          {hasRecorded && (
                            <button
                              type="button"
                              className="md-clear-btn"
                              aria-pressed={cleared}
                              aria-label={cleared
                                ? `Keep the recorded value for ${reading?.label ?? id}`
                                : `Clear the recorded value for ${reading?.label ?? id}`}
                              title={cleared ? 'Keep the recorded value' : 'Clear recorded value — submits as NO DATA'}
                              onClick={() => toggleClear(id)}
                              disabled={ovBusy}
                            >✕</button>
                          )}
                        </span>
                        {cleared && <span className="md-clear-note">clears to NO DATA on apply</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="md-override">
              <label className="md-field">
                <span className="md-field-label">Regime</span>
                <select
                  value={ovRegime}
                  onChange={e => setOvRegime(e.target.value as Regime | '')}
                  disabled={ovBusy}
                >
                  <option value="">{manualIds.length > 0 ? 'No forced regime — signals only' : 'No forced regime'}</option>
                  {(Object.keys(REGIME_PRETTY) as Regime[]).map(r => (
                    <option key={r} value={r}>{REGIME_PRETTY[r]}</option>
                  ))}
                </select>
              </label>
              <label className="md-field md-field-grow">
                <span className="md-field-label">Reason (required)</span>
                <textarea
                  value={ovNote}
                  onChange={e => setOvNote(e.target.value)}
                  placeholder="Why the model read is wrong this week…"
                  rows={2}
                  disabled={ovBusy}
                />
              </label>
              <button
                className="md-apply"
                onClick={applyOverride}
                disabled={ovBusy || ovNote.trim() === '' || invalidSignal || (ovRegime === '' && !hasSignalPayload)}
              >
                {ovBusy ? 'Applying…' : 'Apply override'}
              </button>
            </div>
            {ovError && (
              <div className="md-ov-error" role="alert">
                <span className="md-error-dot" aria-hidden="true" />Error — {ovError}
              </div>
            )}
            <div className="md-helper">Overrides are logged and hold until next Monday's automatic snapshot, which recomputes from automatic history alone — a forced regime or entered value never outlives the week.</div>
          </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles (md- prefix, CC tokens with fallbacks)
// ---------------------------------------------------------------------------

const CSS = `
.md-root{width:100%;max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:1rem}
.md-card{padding:1.6rem 1.8rem}

/* header */
.md-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.md-regime{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:34px;letter-spacing:-.02em;margin:.35rem 0 .3rem;line-height:1.15}
.md-subline{font-size:.82rem;color:var(--muted,#5c6b67);display:flex;align-items:center;flex-wrap:wrap;gap:.55rem}
.md-refresh{flex-shrink:0}
.md-btn-sm{padding:.3rem .7rem;font-size:.72rem}

.md-tag-degraded{display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:600;letter-spacing:.08em;
  color:var(--warning,#b8860b);border:1px solid var(--warning,#b8860b);border-radius:4px;padding:1px 7px;text-transform:uppercase;line-height:1.6;background:var(--warning-soft,#fbf3df)}
.md-chip-pending{display:inline-block;font-size:11px;color:var(--muted,#5c6b67);border:1px dashed var(--border,#dcebe7);
  border-radius:999px;padding:2px 10px;background:var(--surface-2,#f5fbfa)}
.md-chip-live{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--accent,#3f7d69);border:1px solid var(--accent,#3f7d69);border-radius:999px;padding:1px 8px;line-height:1.6}

.md-manual-banner{display:flex;align-items:center;gap:.6rem;font-size:.85rem;font-weight:500;color:#8a6508;
  background:var(--warning-soft,#fbf3df);border:1px solid var(--warning,#b8860b);border-radius:8px;padding:.7rem 1rem}
.md-manual-dot{width:10px;height:10px;border-radius:50%;background:var(--warning,#b8860b);flex-shrink:0}

.md-section-title{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin-bottom:1rem;display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap}

/* quadrant chart */
.md-quad-wrap{display:flex;flex-direction:column;align-items:center;gap:.6rem}
.md-quad-svg{width:100%;max-width:560px;height:auto;display:block}
.md-quad-label{font-size:9.5px;font-weight:600;letter-spacing:.08em;fill:var(--muted,#5c6b67)}
.md-quad-label-sub{font-weight:400}
.md-quad-cross{stroke:var(--muted,#5c6b67);stroke-width:1;stroke-dasharray:4 4;opacity:.55}
.md-quad-bound{font-size:8.5px;fill:var(--muted,#5c6b67);opacity:.8}
.md-quad-axis{stroke:var(--border,#dcebe7);stroke-width:1;fill:none}
.md-quad-tick{font-size:9px;fill:var(--muted,#5c6b67)}
.md-quad-axis-title{font-size:10px;fill:var(--muted,#5c6b67);letter-spacing:.04em}
.md-quad-halo{fill:var(--accent,#3f7d69);opacity:.18}
.md-quad-dot{fill:var(--accent,#3f7d69);stroke:#fff;stroke-width:1.5}
.md-quad-callout{font-size:11px;font-weight:600;fill:var(--text,#1d2a26)}
.md-quad-empty-box{fill:var(--surface,#fff);opacity:.85;stroke:var(--border,#dcebe7)}
.md-quad-empty{font-size:12.5px;font-weight:600;fill:var(--muted,#5c6b67)}
.md-quad-empty-sub{font-size:10.5px;fill:var(--muted,#5c6b67)}
.md-quad-caption{font-size:1rem}
.md-quad-caption b{font-weight:600}

/* postures */
.md-postures{display:flex;flex-wrap:wrap;gap:1.6rem}
.md-posture-item{display:flex;flex-direction:column;gap:.4rem}
.md-posture-asset{font-size:.8rem;font-weight:500;color:var(--text,#1d2a26)}

/* signal grid */
.md-signal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem}
.md-signal{border:1px solid var(--border,#dcebe7);border-radius:10px;padding:1rem 1.1rem;background:var(--surface-2,#f5fbfa);
  display:flex;flex-direction:column;gap:.45rem;min-width:0}
.md-signal-label{font-size:.78rem;font-weight:600;color:var(--muted,#5c6b67)}
.md-signal-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.md-signal-meta{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.md-signal-asof{font-size:.7rem;font-weight:400;letter-spacing:0;text-transform:none;color:var(--muted,#5c6b67)}
.md-weight{font-size:10px;font-weight:600;letter-spacing:.05em;color:var(--muted,#5c6b67);
  border:1px solid var(--border,#dcebe7);border-radius:4px;padding:1px 6px;background:var(--surface,#fff)}
.md-spark{width:100%;height:44px;display:block;margin-top:.2rem}

/* vote chips */
.md-vote{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.06em}
.md-vote-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0;background:var(--cc-gray,#9c9c9c)}
.md-vote-green{color:var(--posture-green,#3f7d69)}
.md-vote-green .md-vote-dot{background:var(--posture-green,#3f7d69)}
.md-vote-yellow{color:var(--posture-yellow,#b8860b)}
.md-vote-yellow .md-vote-dot{background:var(--posture-yellow,#b8860b)}
.md-vote-red{color:var(--posture-red,#c2384a)}
.md-vote-red .md-vote-dot{background:var(--posture-red,#c2384a)}
.md-vote-none{color:var(--muted,#5c6b67)}
.md-vote-none .md-vote-dot{background:transparent;border:2px solid var(--cc-gray,#9c9c9c);width:8px;height:8px}

/* vote tally */
.md-tally-bar{display:flex;height:16px;border-radius:999px;overflow:hidden;border:1px solid var(--border,#dcebe7)}
.md-tally-seg{display:block;height:100%}
.md-tally-green{background:var(--posture-green,#3f7d69)}
.md-tally-yellow{background:var(--posture-yellow,#b8860b)}
.md-tally-red{background:var(--posture-red,#c2384a)}
.md-tally-legend{display:flex;align-items:center;gap:1.1rem;flex-wrap:wrap;margin-top:.6rem;font-size:11.5px;font-weight:600;letter-spacing:.05em}
.md-tally-item{display:inline-flex;align-items:center;gap:6px;color:var(--text,#1d2a26)}
.md-tally-item .md-vote-dot{width:9px;height:9px}
.md-tally-total{font-weight:400;color:var(--muted,#5c6b67);letter-spacing:0}
.md-tally-caption{margin-top:.7rem;font-size:.85rem;color:var(--muted,#5c6b67)}
.md-tally-caption b{color:var(--text,#1d2a26);font-weight:600}

/* market context */
.md-market-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem}
.md-stat{border:1px solid var(--border,#dcebe7);border-radius:10px;padding:.9rem 1rem;background:var(--surface-2,#f5fbfa);min-width:0}
.md-stat-label{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin-bottom:.4rem}
.md-stat-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:24px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}

/* override */
.md-override{display:flex;align-items:flex-end;gap:1rem;flex-wrap:wrap}
.md-field{display:flex;flex-direction:column;gap:.35rem}
.md-field-grow{flex:1 1 260px}
.md-field-label{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600}
.md-field select,.md-field textarea,.md-field input{border:1px solid var(--border,#dcebe7);border-radius:8px;padding:.5rem .7rem;
  background:var(--surface,#fff);font-size:.88rem;color:inherit}
.md-field textarea{resize:vertical;min-height:2.6rem;width:100%}
.md-ov-signals{margin-bottom:1.1rem;padding-bottom:1.1rem;border-bottom:1px dashed var(--border,#dcebe7)}
.md-ov-signals-title{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin-bottom:.25rem}
.md-ov-signals-note{font-size:.76rem;color:var(--muted,#5c6b67);margin-bottom:.8rem;max-width:64ch}
.md-ov-signal-grid{display:flex;flex-wrap:wrap;gap:1rem}
.md-ov-signal-grid .md-field input{width:10rem}
.md-ov-input-row{display:flex;align-items:center;gap:.45rem}
.md-clear-btn{flex-shrink:0;width:1.75rem;height:1.75rem;display:inline-flex;align-items:center;justify-content:center;padding:0;
  border:1px solid var(--border,#dcebe7);border-radius:8px;background:var(--surface,#fff);color:var(--muted,#5c6b67);
  font-size:.78rem;line-height:1;cursor:pointer}
.md-clear-btn:hover:not(:disabled){color:var(--danger,#c2384a);border-color:var(--danger,#c2384a)}
.md-clear-btn[aria-pressed="true"]{color:#fff;background:var(--danger,#c2384a);border-color:var(--danger,#c2384a)}
.md-clear-btn:disabled{opacity:.5;cursor:default}
.md-clear-note{font-size:.7rem;color:var(--danger,#c2384a);font-weight:500}
.md-apply{flex-shrink:0}
.md-helper{margin-top:.8rem;font-size:.76rem;color:var(--muted,#5c6b67)}
.md-ov-error{display:flex;align-items:center;gap:.5rem;margin-top:.7rem;font-size:.82rem;color:var(--danger,#c2384a);font-weight:500}

/* error / loading / empty */
.md-error{display:flex;align-items:center;gap:.7rem;border-color:var(--danger,#c2384a);background:var(--danger-soft,#fbecef);flex-wrap:wrap}
.md-error-dot{width:10px;height:10px;border-radius:50%;background:var(--danger,#c2384a);flex-shrink:0}
.md-error-word{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--danger,#c2384a)}
.md-error-msg{color:var(--danger,#c2384a);font-size:.86rem;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.md-skeleton{display:flex;flex-direction:column;gap:.7rem}
.md-skel-line{height:14px;border-radius:6px;background:var(--surface-2,#f5fbfa);border:1px solid var(--border,#dcebe7);
  animation:md-pulse 1.3s ease-in-out infinite}
.md-w30{width:30%}.md-w60{width:60%}.md-w45{width:45%}
.md-skel-text{font-size:.82rem;color:var(--muted,#5c6b67)}
@keyframes md-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.md-empty-note{font-size:.85rem;color:var(--muted,#5c6b67)}

/* compact strip */
.md-strip{display:inline-flex;align-items:center;gap:.55rem;flex-wrap:wrap;font-size:13px}
.md-strip-sep{color:var(--muted,#5c6b67)}
.md-strip-regime{font-weight:600}
.md-strip-quad{color:var(--muted,#5c6b67)}
.md-strip-asof{font-size:11.5px;color:var(--muted,#5c6b67)}
.md-strip-muted{font-size:12px;color:var(--muted,#5c6b67)}

@media(max-width:900px){
  .md-root{gap:.8rem}
  .md-card{padding:1.1rem 1.2rem}
  .md-header{flex-direction:column}
  .md-regime{font-size:28px}
  .md-signal-grid{grid-template-columns:1fr}
  .md-market-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .md-override{flex-direction:column;align-items:stretch}
  .md-postures{gap:1rem}
}
`
