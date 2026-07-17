// Conditional market-path fan chart — the 12-month forecast that passed the
// pre-registered acceptance gate (research/tsfm_benchmark/HOUSING-ACCEPTANCE-
// TEST.md). Index-level, distribution-first, honestly labeled: this is the
// market's base rate, not deal alpha. The MC engine consumes the same tilt
// capped at ±2%/yr and amortized over the hold (compute.ts).
import marketPath from '../netlify/functions/lib/market-path.json'

interface Path {
  asof: string
  model: string
  annualMedian: number
  annualQ10: number
  annualQ90: number
  driftAnnual: number
  tiltAnnual: number
  gatePassed: boolean
  geltnerTested: boolean
  cumMed: number[]
  cumQ10: number[]
  cumQ90: number[]
  backtest: { hitRate: number | null; nWindows: number; dmPvsDrift: number | null; protocol: string }
}

const PATHS = marketPath as unknown as Record<string, Path>
const NATIONAL = 'United States'
const METROS = Object.keys(PATHS).filter(k => k !== NATIONAL)

// Exact "City, ST" match only — a substring guess would show another market's
// forecast as this deal's own. No match -> national path, clearly labeled.
function resolveKey(location: string | null): { key: string; exact: boolean } {
  if (location) {
    const norm = location.trim().toLowerCase().replace(/\s+/g, ' ')
    for (const k of METROS) {
      if (norm === k.toLowerCase()) return { key: k, exact: true }
    }
  }
  return { key: NATIONAL, exact: false }
}

const fmtP = (p: number | null) => p === null ? '—' : p < 0.001 ? 'p<0.001' : `p=${p.toFixed(3)}`

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`

export default function MarketPathCard({ location }: { location: string | null }) {
  const { key, exact } = resolveKey(location)
  const p = PATHS[key]
  if (!p) return null

  // SVG fan chart: cumulative price-return paths, months 0-12.
  const W = 560, H = 150, PAD = 34
  const all = [...p.cumQ10, ...p.cumQ90, ...p.cumMed, 0]
  const lo = Math.min(...all), hi = Math.max(...all)
  const x = (m: number) => PAD + (m / 12) * (W - PAD - 8)
  const y = (v: number) => 12 + (hi - v) / (hi - lo || 1) * (H - 34)
  const line = (arr: number[]) => [0, ...arr].map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const band = `${line(p.cumQ90)} ${[...[0, ...p.cumQ10].map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`)].reverse().join(' ')}`

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>
        Market path — {key === NATIONAL ? 'US national (ZHVI)' : key}
        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 500, marginLeft: 8, letterSpacing: '0.06em' }}>
          12-MO CONDITIONAL FORECAST · AS OF {p.asof}
        </span>
      </h3>
      {!exact && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>
          No metro-level path is baked for “{location ?? 'this market'}” — showing the national path, not a guess.
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 720 }} role="img"
        aria-label={`Fan chart: 12-month conditional market path, median ${pct(p.annualMedian)}, 80% band ${pct(p.annualQ10)} to ${pct(p.annualQ90)}`}>
        <polygon points={band} fill="#3f7d69" opacity={0.14} />
        <polyline points={line(p.cumMed)} fill="none" stroke="#3f7d69" strokeWidth={2} />
        <line x1={x(0)} y1={y(0)} x2={x(12)} y2={y(0)} stroke="var(--border)" strokeDasharray="4 3" />
        <text x={x(12) - 2} y={y(p.cumMed[11]) - 6} textAnchor="end" fontSize={11} fill="#3f7d69" fontWeight={700}>
          median {pct(p.annualMedian)}
        </text>
        <text x={x(12) - 2} y={y(p.cumQ90[11]) - 4} textAnchor="end" fontSize={10} fill="var(--muted)">q90 {pct(p.annualQ90)}</text>
        <text x={x(12) - 2} y={y(p.cumQ10[11]) + 12} textAnchor="end" fontSize={10} fill="var(--muted)">q10 {pct(p.annualQ10)}</text>
        <text x={PAD} y={H - 4} fontSize={10} fill="var(--muted)">months 1–12 · cumulative price return · {p.model}, zero-shot</text>
      </svg>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem', marginTop: 6 }}>
        <span><b>Tilt vs trailing drift:</b> {pct(p.gatePassed ? p.tiltAnnual : 0)}{' '}
          {!p.gatePassed ? '(market did not pass its out-of-sample gate — no tilt applied)'
            : Math.abs(p.tiltAnnual) > 0.02 ? '(MC engine caps at ±2%/yr)' : ''}</span>
        <span><b>Out-of-sample record (2015–2025):</b> direction right {p.backtest.hitRate === null ? '—' : `${Math.round((p.backtest.hitRate) * (p.backtest.nWindows))}/${p.backtest.nWindows}`} windows · {fmtP(p.backtest.dmPvsDrift)} vs drift</span>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 6 }}>
        Index-level forecast (rolling-origin 2015–2025 protocol{p.geltnerTested ? '; edge survives de-smoothing on this market' : ''}) —
        the market’s base rate, never deal alpha. Band = pointwise monthly quantiles compounded (approximate).
        The Gate&nbsp;1 verdict above does not use this tilt; in the MC scoring engine it enters capped at ±2%/yr,
        amortized over the hold, and expires with data age. Mean reversion removes it by years 3–5.
      </div>
    </div>
  )
}
