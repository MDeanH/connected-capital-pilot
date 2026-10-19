import { useState } from 'react'
import { CK, ChartCard, Plot, scaleLinear, useTooltip } from './charts/ChartKit'
import { SIGNALS, POSTURE_LABEL, analyzeTrend, normalize, scoreBand, groupScore, estimateLabel, type Group, type GroupTrend, type WeeklySnapshot } from './macro-trends/model'
import { SAMPLE_SCENARIOS, macroSample, readingLabel, type SampleScenarioId } from './macro-trends/sample'

const fixed = (n: number | null, digits = 3) => n === null ? 'Unavailable' : n.toFixed(digits)
function ScoreChart({ group, snapshots }: { group: Group; snapshots: WeeklySnapshot[] }) {
  const tip = useTooltip()
  const values = snapshots.map(s => ({ date: s.date, score: groupScore(s, group) }))
  const x = scaleLinear(0, values.length - 1, 48, 610), y = scaleLinear(-1, 2, 188, 16)
  return <ChartCard title={group === 'slowdown' ? 'Slowdown score · 13-week window' : 'Inflation pressure · 13-week window'}
    subtitle="Dated sample weekly snapshots; last published readings carried forward"
    table={{ columns: ['Sample week', 'Score', 'Band'], rows: values.map(v => [v.date, fixed(v.score), scoreBand(v.score)]) }}
    note="Yellow starts at 0; Red starts at 1. Higher scores mean worsening conditions. No interpolated releases.">
    <Plot tip={tip}>
      <svg viewBox="0 0 640 225" role="group" aria-label={`${group} sample weekly scores with Yellow and Red boundaries`}>
        {[-1,0,1,2].map(t => <g key={t}>
          <line x1={48} x2={610} y1={y(t)} y2={y(t)} stroke={t === 0 ? CK.watch : t === 1 ? CK.fail : CK.grid} strokeDasharray={t === 0 || t === 1 ? '5 4' : undefined} />
          <text x={40} y={y(t)+4} textAnchor="end" fill={CK.ink2} fontSize={12}>{t}</text>
          {(t === 0 || t === 1) && <text x={606} y={y(t)-5} textAnchor="end" fill={CK.ink2} fontSize={11}>{t === 0 ? 'Yellow' : 'Red'}</text>}
        </g>)}
        {values.slice(1).map((v,i) => v.score !== null && values[i].score !== null ? <line key={v.date} x1={x(i)} x2={x(i+1)} y1={y(values[i].score!)} y2={y(v.score)} stroke={CK.accent} strokeWidth={2} /> : null)}
        {values.map((v,i) => v.score !== null ? <circle key={v.date} cx={x(i)} cy={y(v.score)} r={4} fill={CK.accent}
          {...tip.bind([{label:v.date,value:'Sample week'}, {label:group,value:fixed(v.score)}, {label:'Band',value:scoreBand(v.score)}])} /> : null)}
        <text x={48} y={216} fill={CK.ink2} fontSize={11}>{values[0]?.date}</text>
        <text x={610} y={216} textAnchor="end" fill={CK.ink2} fontSize={11}>{values[values.length-1]?.date}</text>
      </svg>
    </Plot>
  </ChartCard>
}
function ScoreSection({ name, trend, children }: { name: string; trend: GroupTrend; children: React.ReactNode }) {
  return <section className="card mt-score" aria-label={`${name} comparison`}>
    <div className="mt-score-top"><h3>{name}</h3><span className={`mt-band mt-${scoreBand(trend.score).toLowerCase()}`}>{scoreBand(trend.score)}</span></div>
    <strong className="mt-number">{fixed(trend.score)}</strong>
    <p>{trend.status} · {estimateLabel(trend.weeks)}</p>
    <dl>
      <div><dt>13 weeks ago</dt><dd>{fixed(trend.prior)}</dd></div>
      <div><dt>Weekly speed</dt><dd>{trend.speed === null ? 'Unavailable' : `${trend.speed > 0 ? '+' : ''}${trend.speed.toPrecision(3)} / week`}</dd></div>
      <div><dt>Room to next threshold</dt><dd>{trend.room === null ? 'No next threshold' : `${fixed(trend.room)} score units`}</dd></div>
    </dl>
    <p className="mt-muted">{children}</p>
  </section>
}
export default function MacroTrends() {
  const [scenario, setScenario] = useState<SampleScenarioId>('inflation')
  const sample = macroSample(scenario)
  const result = analyzeTrend(sample.posture, sample.snapshots, sample.asOf, sample.releases.pce)
  return <div className="mt-root">
    <style>{CSS}</style>
    <div className="mt-header"><h2>Macroeconomic trends</h2><span className="mt-demo">Illustrative economic data</span>
      <label>Demo scenario <select value={scenario} onChange={e => setScenario(e.target.value as SampleScenarioId)}>
        {Object.entries(SAMPLE_SCENARIOS).map(([id,s]) => <option key={id} value={id}>{s.label}</option>)}
      </select></label>
    </div>
    <p className="mt-muted">Fictional releases and weekly snapshots as of {sample.asOf}. These are not actual current economic conditions or individual deal results.</p>
    <section className="card mt-headline" aria-live="polite">
      <span className="mt-eyebrow">Current posture · sample weekly evaluation</span>
      <h3>{POSTURE_LABEL[sample.posture]}</h3>
      <p className="mt-trend">Trend: {result.projection.text}. {result.projection.target && estimateLabel(result.projection.weeks)}{result.projection.target ? '.' : ''}</p>
      {result.projection.leader && <p className="mt-muted">Leading condition: {result.projection.leader === 'both' ? 'both groups must fall below Yellow' : result.projection.leader === 'slowdown' ? 'slowdown' : 'inflation pressure'}.</p>}
      <p className="mt-muted">The trend never changes the current posture. The existing weekly posture evaluation determines changes separately. Week estimates extend the 13-week average pace; they are not a forecast guarantee.</p>
    </section>
    <div className="mt-columns">
      <ScoreSection name="Slowdown" trend={result.slowdown}>
        {result.worsening} worsening · {result.improving} improving · {result.unchanged} unchanged · {result.unavailable} unavailable, out of 6 signals over 13 weeks.
        {' '}Moving with the group: {result.slowdown.direction === 'worsening' ? result.worsening : result.slowdown.direction === 'improving' ? result.improving : 0} of 6.
      </ScoreSection>
      <ScoreSection name="Inflation pressure" trend={result.inflation}>
        Core PCE: {result.inflation.direction === 'worsening' ? 'Rising' : result.inflation.direction === 'improving' ? 'Easing' : result.inflation.direction === 'holding' ? 'Holding' : 'Comparison unavailable'}. Kept separate from the slowdown score.
      </ScoreSection>
    </div>
    <div className="mt-columns">{(['slowdown','inflation'] as const).map(group => <ScoreChart key={`${scenario}-${group}`} group={group} snapshots={sample.snapshots} />)}</div>
    <section className="card mt-indicators">
      <h3>Seven economic indicators</h3>
      <div className="mt-table-scroll" tabIndex={0} role="region" aria-label="Sample economic indicators and client thresholds">
        <table><thead><tr>{['Indicator','Weight','Sample reading','Yellow','Red','Score / band','Published (sample)'].map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
          <tbody>{SIGNALS.map(def => {
            const reading = result.current?.readings[def.id] ?? null
            const score = normalize(reading, def.yellow, def.red)
            return <tr key={def.id}><th scope="row">{def.label}<small>{def.group === 'inflation' ? 'Inflation' : 'Slowdown'} · {def.red < def.yellow ? 'lower is worse' : 'higher is worse'}</small></th>
              <td>{def.weight.toFixed(1)}</td><td>{readingLabel(def.id,reading)}</td>
              <td>{readingLabel(def.id,def.yellow)}</td><td>{readingLabel(def.id,def.red)}</td><td>{fixed(score)} · {scoreBand(score)}</td>
              <td>{result.current?.published[def.id] ?? 'Unavailable'}</td></tr>
          })}</tbody>
        </table>
      </div>
      <p className="mt-muted">Claims are scored by YoY change (+5% / +25%). The client's accompanying levels (260,000 / 320,000) are illustrative references, not separate cutoffs. GDP uses the client's literal 0.02% / 0.005% boundaries.</p>
    </section>
    <section className="card mt-notes">
      <h3>How to read the direction</h3>
      <p>Each indicator is normalized as (reading − Yellow) ÷ (Red − Yellow), capped from −1 to 2. Slowdown is the weighted average of six signals; inflation is Core PCE alone. Weekly speed compares this week with the dated snapshot exactly 13 weeks earlier.</p>
      <p>Recovery confirmation: {result.improving}/6 slowdown signals improving (at least 5 required); three consecutive monthly Core PCE declines {result.pceEasing ? 'confirmed' : 'not confirmed'}. Four distinct monthly release readings establish three declines.</p>
      <p>Only a threshold relevant to the current posture can lead the headline. Returning from Stagflation to Soft Landing requires both groups below Yellow, so the later crossing determines the estimate. Recovery from Recession proceeds through Stagflation.</p>
      <p>At 0 the current band is Yellow; at 1 it is Red. Improving below a boundary requires crossing it. No estimate is invented for a missing 13-week comparison or a group with no next threshold; zero speed means Holding.</p>
      <p className="mt-muted">S&amp;P 500 returns, SOFR, Treasury and mortgage rates are excluded from these calculations and remain in their existing views. Trend parameters do not change Gate 1 thresholds, deal scores or benchmark requirements.</p>
    </section>
  </div>
}
const CSS = `
.mt-root{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:1rem;min-width:0}
.mt-header{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}.mt-header h2{font-weight:300;font-size:1.5rem;margin:0}
.mt-demo{font-size:.72rem;background:#fbf3df;color:#745400;border:1px solid #e8d69b;padding:.3rem .65rem;border-radius:99px}
.mt-header label{margin-left:auto;font-size:.78rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.mt-header select{font:inherit;padding:.5rem;max-width:100%;background:white;border:1px solid #dcebe7;border-radius:6px}
.mt-muted{font-size:.78rem;color:#5c6b67;line-height:1.6;margin:.35rem 0}.mt-headline{padding:1.3rem 1.5rem;border-left:4px solid #3f7d69}
.mt-eyebrow{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:#5c6b67}.mt-headline h3{font-size:1.8rem;font-weight:400;margin:.4rem 0}
.mt-trend{font-size:1.05rem;line-height:1.6;margin:.5rem 0}.mt-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.mt-score{padding:1.1rem 1.3rem;min-width:0}.mt-score-top{display:flex;justify-content:space-between;align-items:center;gap:.5rem}.mt-score h3{font-size:1rem;font-weight:500;margin:0}
.mt-number{display:block;font-size:2rem;font-weight:400;margin:.6rem 0}.mt-score p{font-size:.82rem;line-height:1.6}
.mt-band{font-size:.72rem;border-radius:99px;padding:.25rem .65rem;border:1px solid #dcebe7}.mt-green{background:#e4f5ee;color:#346651}.mt-yellow{background:#fbf3df;color:#745400}.mt-red{background:#fbecef;color:#a82c3d}
.mt-score dl{display:grid;grid-template-columns:1fr;gap:.4rem;font-size:.78rem;margin:1rem 0}.mt-score dl div{display:flex;gap:1rem;justify-content:space-between}.mt-score dt{color:#5c6b67}.mt-score dd{margin:0;text-align:right}
.mt-indicators,.mt-notes{padding:1.2rem 1.4rem;min-width:0}.mt-indicators h3,.mt-notes h3{font-size:1rem;font-weight:500;margin:0 0 .8rem}.mt-table-scroll{overflow-x:auto;max-width:100%}.mt-indicators table{border-collapse:collapse;width:100%;min-width:760px;font-size:.78rem}
.mt-indicators th,.mt-indicators td{padding:.65rem .5rem;border-bottom:1px solid #e6ecea;text-align:left;font-variant-numeric:tabular-nums}.mt-indicators thead th{font-size:.7rem;color:#5c6b67;font-weight:500}.mt-indicators tbody th{font-weight:500}.mt-indicators small{display:block;color:#5c6b67;font-size:.7rem;font-weight:400;margin-top:.25rem}
.mt-notes p{font-size:.8rem;line-height:1.65;margin:.6rem 0}
@media(max-width:700px){.mt-columns{grid-template-columns:1fr}.mt-header label{margin-left:0;width:100%}.mt-header select{font-size:16px}.mt-headline{padding:1rem}.mt-indicators,.mt-notes{padding:1rem}}
`
