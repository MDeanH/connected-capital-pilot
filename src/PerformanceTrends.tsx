import { useState } from 'react'
import { CK, ChartCard, Plot, niceTicks, scaleLinear, useTooltip } from './charts/ChartKit'
import {
  PERFORMANCE_METRICS, PERFORMANCE_SCENARIOS, samplePerformance, performanceSummary,
  type PerformanceMetric, type PerformanceScenario,
} from './sample-performance'

function valueLabel(metric: PerformanceMetric, value: number, signed = false) {
  const prefix = signed && value > 0 ? '+' : ''
  return metric === 'occupancy' ? `${prefix}${value}%` : `${prefix}${value} ($000)`
}
function gapLabel(metric: PerformanceMetric, value: number) {
  return metric === 'occupancy' ? `${value > 0 ? '+' : ''}${value} percentage points` : valueLabel(metric, value, true)
}

export default function PerformanceTrends() {
  const [scenario, setScenario] = useState<PerformanceScenario>('slipping')
  const [metric, setMetric] = useState<PerformanceMetric>('noi')
  const [period, setPeriod] = useState(6)
  const [reviewRequested, setReviewRequested] = useState(false)
  const points = samplePerformance(scenario).slice(-period)
  const summary = performanceSummary(points, metric)!
  const definition = PERFORMANCE_METRICS[metric]
  const tip = useTooltip()
  const width = 640, height = 275, left = 56, right = 18, top = 24, bottom = 38
  const values = points.flatMap(p => [p.plan[metric], p.observed[metric]])
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4)
  const y = scaleLinear(ticks[0], ticks[ticks.length - 1], height - bottom, top)
  const x = scaleLinear(0, points.length - 1, left, width - right)
  const line = (kind: 'plan' | 'observed') => points.map((p, i) => `${x(i)},${y(p[kind][metric])}`).join(' ')
  return (
    <div className="pt-root">
      <style>{CSS}</style>
      <header className="pt-header">
        <h2>Performance trends</h2>
        <span className="pt-sample">Illustrative sample data</span>
      </header>
      <p className="pt-notice">Explore an example multifamily asset's operating progress.
        All observations, plans, dates and review prompts below are fictional UX examples.
        They are separate from your current deal and its screening results. Nothing here is saved.</p>
      <div className="pt-controls">
        <label>Example scenario
          <select value={scenario} onChange={e => { setScenario(e.target.value as PerformanceScenario); setReviewRequested(false) }}>
            {Object.entries(PERFORMANCE_SCENARIOS).map(([id, s]) => <option value={id} key={id}>{s.label}</option>)}
          </select>
        </label>
        <label>Metric
          <select value={metric} onChange={e => setMetric(e.target.value as PerformanceMetric)}>
            {Object.entries(PERFORMANCE_METRICS).map(([id, m]) => <option value={id} key={id}>{m.label}</option>)}
          </select>
        </label>
        <label>Reporting window
          <select value={period} onChange={e => setPeriod(Number(e.target.value))}>
            <option value={6}>All 6 sample months</option><option value={3}>Latest 3 sample months</option>
          </select>
        </label>
      </div>
      <div className="pt-summary" aria-live="polite">
        <div className="card"><span>Latest sample observation</span><strong>{valueLabel(metric, summary.latest)}</strong><small>{points[points.length - 1].month} · plan {valueLabel(metric, summary.plan)}</small></div>
        <div className="card"><span>Gap to sample plan</span><strong>{gapLabel(metric, summary.gap)}</strong><small>{summary.favorable ? 'At or better than plan' : 'Behind plan'} · {definition.higherIsBetter ? 'higher' : 'lower'} is favorable</small></div>
        <div className="card"><span>Change across selected window</span><strong>{gapLabel(metric, summary.change)}</strong><small>From {points[0].month} to {points[points.length - 1].month}</small></div>
      </div>
      <ChartCard title={`${definition.label} over time`} subtitle={`Illustrative observations versus sample plan · ${definition.unit}`}
        legend={[{ label: 'Sample observation', color: CK.accent, shape: 'line' }, { label: 'Sample plan (dashed)', color: CK.cat[1], shape: 'line' }]}
        table={{ columns: ['Sample month', 'Sample observation', 'Sample plan', 'Gap to plan'], rows: points.map(p => [p.month, valueLabel(metric, p.observed[metric]), valueLabel(metric, p.plan[metric]), gapLabel(metric, p.observed[metric] - p.plan[metric])]) }}
        note="Dates and values are examples. Switch to Table for the exact figures; hover or focus a point for its comparison.">
        <Plot tip={tip}>
          <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${definition.label}: illustrative monthly observations and plan`}>
            {ticks.map(t => <g key={t}><line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={CK.grid} /><text x={left - 8} y={y(t) + 4} textAnchor="end" fill={CK.ink2} fontSize={12}>{t}</text></g>)}
            <polyline points={line('plan')} fill="none" stroke={CK.cat[1]} strokeWidth={2} strokeDasharray="6 4" />
            <polyline points={line('observed')} fill="none" stroke={CK.accent} strokeWidth={2} />
            {points.map((p, i) => <g key={p.month}>
              <text x={x(i)} y={height - 12} textAnchor="middle" fill={CK.ink2} fontSize={12}>{p.month.slice(0, 3)}</text>
              <circle cx={x(i)} cy={y(p.observed[metric])} r={5} fill={CK.accent}
                {...tip.bind([{ label: p.month, value: 'Sample' }, { label: 'Observation', value: valueLabel(metric, p.observed[metric]), color: CK.accent }, { label: 'Plan', value: valueLabel(metric, p.plan[metric]), color: CK.cat[1] }, { label: 'Gap to plan', value: gapLabel(metric, p.observed[metric] - p.plan[metric]) }])} />
            </g>)}
          </svg>
        </Plot>
      </ChartCard>
      <section className="card pt-review" aria-label="Illustrative strategy review">
        <h3>{summary.favorable ? 'Monitor progress' : 'Consider a strategy review'}</h3>
        <p>{PERFORMANCE_SCENARIOS[scenario].context}</p>
        <p>{PERFORMANCE_SCENARIOS[scenario].review}</p>
        <p className="pt-muted">This prompt illustrates a review workflow. It is not a rulebook trigger or an investment recommendation.</p>
        <button type="button" onClick={() => setReviewRequested(v => !v)}>{reviewRequested ? 'Clear sample review flag' : 'Flag for review (demo)'}</button>
        {reviewRequested && <p role="status">Sample review flagged in this view only. No task or audit record was created.</p>}
      </section>
    </div>
  )
}
const CSS = `
.pt-root{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:1rem;min-width:0}
.pt-header{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.pt-header h2{font-size:1.5rem;font-weight:300;margin:0}
.pt-sample{font-size:.75rem;color:#8a6508;background:#fbf3df;padding:.3rem .7rem;border-radius:99px}
.pt-notice{font-size:.85rem;color:#5c6b67;line-height:1.6;margin:0}
.pt-controls{display:flex;gap:1rem;flex-wrap:wrap}
.pt-controls label{display:flex;flex-direction:column;gap:.4rem;font-size:.8rem;flex:1 1 180px;min-width:0}
.pt-controls select{font:inherit;padding:.6rem;border:1px solid #dcebe7;border-radius:6px;width:100%;background:white}
.pt-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.pt-summary .card{padding:1rem;display:flex;flex-direction:column;gap:.5rem;min-width:0}
.pt-summary span,.pt-summary small,.pt-muted{font-size:.78rem;color:#5c6b67;line-height:1.5}
.pt-summary strong{font-size:1.15rem;font-weight:500}
.pt-review{padding:1rem 1.25rem;font-size:.85rem;line-height:1.6}
.pt-review h3{margin:0;font-size:1rem;font-weight:500}
.pt-review button{padding:.6rem 1rem;border:1px solid #3f7d69;border-radius:6px;background:#3f7d69;color:white;cursor:pointer}
@media(max-width:700px){.pt-summary{grid-template-columns:1fr}.pt-controls select{font-size:16px}}
`
