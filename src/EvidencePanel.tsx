// Evidence tab — renders the market-predictability evidence map (49 family
// verdicts over a 198-study ledger, cutoff 2026-07-14, v1.1 corrected) and the
// engine ↔ evidence mapping, per reference/market-predictability-evidence/
// APP-INTEGRATION.md. The JSON here is a generated copy of the synced map;
// correct upstream (MDeanH/financial-market-predictability-evidence), re-sync,
// then run reference/market-predictability-evidence/bake_evidence_network.py —
// it writes this file. Never edit src/data/evidence-families.json directly
// (`npm run gate:evidence` fails the build if it drifts from the source).
import { useMemo, useState } from 'react'
import familiesJson from './data/evidence-families.json'

interface Family {
  claim_id: string
  label: string
  asset_tags: string
  target: string
  horizon: string
  scope: string
  summary: string
  key_caveat: string
  positive_evidence?: string
  negative_evidence?: string
  confidence: string
  verdict: string
  evidence_ids: string[]
  p: number
  e: number
  r: number
  i: number
  t: number
  b: number
}

const FAMILIES = familiesJson as Family[]

const VERDICTS = [
  'Supported pre-live',
  'Promising',
  'Not established',
  'Ineffective in tested scope',
  'Methodology — not rated',
] as const

const VERDICT_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  'Supported pre-live': { bg: '#e4f5ee', fg: '#3f7d69', bd: '#bcded3' },
  Promising: { bg: '#fdf3d7', fg: '#8a6d1a', bd: '#eddfa8' },
  'Not established': { bg: '#efefef', fg: '#5a5a5a', bd: '#dcdcdc' },
  'Ineffective in tested scope': { bg: '#fbe7e7', fg: '#a13c3c', bd: '#f0c9c9' },
  'Methodology — not rated': { bg: '#e8eef7', fg: '#41609a', bd: '#ccd9ee' },
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const s = VERDICT_STYLE[verdict] ?? VERDICT_STYLE['Not established']
  return (
    <span className="ev-badge" style={{ background: s.bg, color: s.fg, borderColor: s.bd }}>
      {verdict}
    </span>
  )
}

// Engine ↔ evidence mapping, condensed from APP-INTEGRATION.md.
const ENGINE_MAP: Array<{ component: string; family: string; verdict: string; use: string }> = [
  {
    component: 'MC volatility modeling / de-smoothed vol',
    family: 'vol-rv-forecast',
    verdict: 'Supported pre-live',
    use: "The engine's risk core stands on the best-established predictability result in finance: volatility forecastability.",
  },
  {
    component: 'De-smoothing step (honest volatility)',
    family: 'private-persistence',
    verdict: 'Not established',
    use: 'Direct citation for why appraisal/NAV smoothing must be removed before risk estimates mean anything. The pilot uses transaction-based indices, which sidesteps NAV smoothing.',
  },
  {
    component: 'Yield edge (±0.30%/yr, within-state percentile)',
    family: 'eq-value · rates-carry-roll (analogues)',
    verdict: 'Promising',
    use: "The app's one return predictor is an income/value-type signal — the family type with the strongest support in the map. Cap and transparency match the map's cost/decay warnings.",
  },
  {
    component: 'No national-market timing',
    family: 'eq-aggregate-valuation-macro',
    verdict: 'Not established',
    use: "The engine's refusal to time the aggregate market is itself evidence-aligned.",
  },
  {
    component: 'Document AI (extraction & synthesis, not stock-picking)',
    family: 'eq-llm-agents',
    verdict: 'Ineffective in tested scope',
    use: 'Generic LLM investing does not beat benchmarks — our AI does diligence work, not return prediction.',
  },
  {
    component: 'Crime-as-context, permits headwind',
    family: 'protocol (association vs forecast)',
    verdict: 'Methodology — not rated',
    use: "The map's IS/POOS vocabulary gives the app's context-not-predictor discipline a citable standard.",
  },
  {
    component: 'Conditional market prior (research, not yet live)',
    family: 'method-tsfm',
    verdict: 'Not established',
    use: 'Zero-shot TSFMs are rejected as return forecasters on public markets — but passed our pre-registered housing-index acceptance test (see research note below).',
  },
]

const CSS = `
.ev-root { display: flex; flex-direction: column; gap: 1rem; }
.ev-head h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
.ev-muted { color: var(--muted); font-size: 0.85rem; }
.ev-stats { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: 0.5rem; }
.ev-stat b { font-size: 1.2rem; }
.ev-stat span { display: block; font-size: 0.7rem; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
.ev-badge { display: inline-block; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 6px; border: 1px solid; white-space: nowrap; }
.ev-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.ev-controls input { flex: 1 1 220px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.ev-filter { font-size: 0.72rem; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; cursor: pointer; }
.ev-filter.ev-on { background: var(--accent); color: #fff; border-color: var(--accent); }
.ev-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.ev-table th { text-align: left; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); }
.ev-table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.ev-row { cursor: pointer; }
.ev-row:hover { background: rgba(0,0,0,0.025); }
.ev-detail { background: rgba(0,0,0,0.02); font-size: 0.82rem; }
.ev-detail dt { font-weight: 700; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-top: 0.5rem; }
.ev-detail dd { margin: 0.15rem 0 0; }
.ev-map td:first-child { font-weight: 600; width: 26%; }
.ev-links { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.ev-links a { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 500; color: var(--accent); text-decoration: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; }
`

export default function EvidencePanel() {
  const [verdictFilter, setVerdictFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const studyCount = useMemo(
    () => new Set(FAMILIES.flatMap(f => f.evidence_ids)).size,
    [],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FAMILIES.filter(f => {
      if (verdictFilter && f.verdict !== verdictFilter) return false
      if (!q) return true
      return [f.label, f.claim_id, f.asset_tags, f.summary, f.scope]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [verdictFilter, query])

  return (
    <div className="ev-root">
      <style>{CSS}</style>

      <div className="card ev-head">
        <h2>Evidence — why believe these probabilities?</h2>
        <div className="ev-muted">
          A cutoff-dated public-web evidence map of financial-market predictability: every claim family
          graded against a fixed rubric (in-sample vs pseudo-out-of-sample vs live, costs, replication).
          The engine&rsquo;s design choices line up with what this evidence supports — and it deliberately
          avoids the claim types the evidence rates as not established or ineffective. The map&rsquo;s own
          headline is the honest one: <b>zero</b> families reach &ldquo;established effective&rdquo; without
          live execution — which is exactly why this product reports probabilities with uncertainty, not
          promised alpha.
        </div>
        <div className="ev-stats">
          <div className="ev-stat"><b>{FAMILIES.length}</b><span>claim families</span></div>
          <div className="ev-stat"><b>{studyCount}</b><span>studies cited (198-study ledger)</span></div>
          <div className="ev-stat"><b>{FAMILIES.filter(f => f.verdict === 'Supported pre-live').length}</b><span>supported pre-live</span></div>
          <div className="ev-stat"><b>2026-07-14</b><span>evidence cutoff (v1.1)</span></div>
        </div>
        <div className="ev-links" style={{ marginTop: '0.75rem' }}>
          <a href="/evidence-network.html" target="_blank" rel="noreferrer">Open interactive evidence map ↗</a>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>How the engine maps onto the evidence</h3>
        <table className="ev-table ev-map">
          <thead>
            <tr><th>Platform component</th><th>Evidence family</th><th>Verdict</th><th>What it means</th></tr>
          </thead>
          <tbody>
            {ENGINE_MAP.map(m => (
              <tr key={m.component}>
                <td>{m.component}</td>
                <td><code style={{ fontSize: '0.78rem' }}>{m.family}</code></td>
                <td><VerdictBadge verdict={m.verdict} /></td>
                <td>{m.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Forecasting research note (July 2026)</h3>
        <div className="ev-muted">
          We replicated the 2026 Noguer&nbsp;i&nbsp;Alonso &amp; Franklin benchmark: on daily equity returns,
          zero-shot time-series foundation models rank well but <b>0 of 40</b> tests significantly beat
          &ldquo;predict zero&rdquo; — consistent with the map&rsquo;s <code>method-tsfm</code> verdict. We then ran the same
          pre-registered protocol on the housing indices this platform actually uses (national ZHVI, FHFA,
          Case&ndash;Shiller + 10 metros): conditional forecasts beat the engine&rsquo;s unconditional-drift null on
          <b> 32 of 65</b> tests, and the edge survives Geltner de-smoothing. Index-level predictability is
          not deal-level alpha — any conditional prior enters the engine capped, amortized over the hold, and gated by its own
          out-of-sample record. Full protocol, results, and caveats: <code>research/tsfm_benchmark/</code> in the
          pilot repo.
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Browse all {FAMILIES.length} families</h3>
        <div className="ev-controls" style={{ margin: '0.5rem 0 0.75rem' }}>
          <input
            placeholder="Search families, assets, summaries…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search evidence families"
          />
          {VERDICTS.map(v => (
            <button
              key={v}
              className={`ev-filter${verdictFilter === v ? ' ev-on' : ''}`}
              onClick={() => setVerdictFilter(verdictFilter === v ? null : v)}
            >
              {v} ({FAMILIES.filter(f => f.verdict === v).length})
            </button>
          ))}
        </div>
        <table className="ev-table">
          <thead>
            <tr><th>Family</th><th>Assets</th><th>Verdict</th><th>Conf.</th><th>Summary</th></tr>
          </thead>
          <tbody>
            {rows.map(f => (
              <FamilyRow key={f.claim_id} f={f} open={open === f.claim_id}
                onToggle={() => setOpen(open === f.claim_id ? null : f.claim_id)} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="ev-muted">No families match.</td></tr>
            )}
          </tbody>
        </table>
        <div className="ev-muted" style={{ marginTop: '0.5rem', fontSize: '0.72rem' }}>
          Source: private evidence repo (protocol + study ledger + family ratings), synced read-only into
          this build. Click a row for scope, caveats, and the evidence behind the verdict.
        </div>
      </div>
    </div>
  )
}

function FamilyRow({ f, open, onToggle }: { f: Family; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="ev-row" onClick={onToggle} aria-expanded={open}>
        <td><b>{f.label}</b><div className="ev-muted" style={{ fontSize: '0.7rem' }}>{f.claim_id}</div></td>
        <td>{f.asset_tags}</td>
        <td><VerdictBadge verdict={f.verdict} /></td>
        <td>{f.confidence}</td>
        <td>{f.summary}</td>
      </tr>
      {open && (
        <tr className="ev-detail">
          <td colSpan={5}>
            <dl style={{ margin: 0 }}>
              <dt>Target · horizon · scope</dt>
              <dd>{f.target} · {f.horizon} · {f.scope}</dd>
              <dt>Key caveat</dt>
              <dd>{f.key_caveat}</dd>
              {f.positive_evidence && (<><dt>Strongest positive evidence</dt><dd>{f.positive_evidence}</dd></>)}
              {f.negative_evidence && (<><dt>Strongest negative evidence</dt><dd>{f.negative_evidence}</dd></>)}
              <dt>Studies cited</dt>
              <dd>{f.evidence_ids.length} — {f.evidence_ids.slice(0, 6).join(', ')}{f.evidence_ids.length > 6 ? ', …' : ''}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
