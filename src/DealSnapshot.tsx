// Results header — deal identity, verdict (with baseline when judgment moved
// it), macro posture, config provenance and a one-line result summary.
import { Term } from './GlossaryTip'
import { PostureChip, VerdictBadge } from './cc-ui'
import type { DealFields, Gate1Response } from './deal-types'

interface Props {
  fields: DealFields
  response: Gate1Response | null
}

function prettyClass(c: string): string {
  return c === 'rv_specialty' ? 'RV / specialty' : c.replace(/_/g, ' ')
}

export default function DealSnapshot({ fields, response }: Props) {
  const adjusted = !!response && response.adjustments.length > 0
  const showBaseline =
    !!response && adjusted && response.baseline.verdict !== response.result.verdict

  return (
    <div className="card snap-root">
      <style>{CSS}</style>
      <div className="snap-left">
        <h2>{fields.deal_name || 'Untitled deal'}</h2>
        <div className="snap-sub">
          {prettyClass(fields.asset_class || '—')} · {fields.location || '—'} · Sponsor: {fields.sponsor_name || '—'}
        </div>
      </div>

      {response ? (
        <>
          <div className="snap-verdict">
            <div className="snap-klabel"><Term k="verdict">Verdict</Term></div>
            <VerdictBadge
              verdict={response.result.verdict}
              baseline={showBaseline ? response.baseline.verdict : undefined}
            />
            {showBaseline && (
              <div className="snap-baseline">
                <Term k="baseline_verdict">rulebook baseline shown alongside</Term>
              </div>
            )}
          </div>
          <div className="snap-right">
            <div className="snap-klabel"><Term k="posture">Macro posture</Term></div>
            <PostureChip posture={response.posture} asOf={response.postureSource} />
            <div className="snap-muted">config v{response.configVersion}</div>
            <div className="snap-chips">
              {response.result.kills.length} kills · {response.result.flagPoints} flag pts · {response.result.missing.length} missing
            </div>
          </div>
        </>
      ) : (
        <div className="snap-muted">Scoring…</div>
      )}
    </div>
  )
}

const CSS = `
.snap-root{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:1.5rem;flex-wrap:wrap}
.snap-left{flex:1 1 280px;min-width:0}
.snap-left h2{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.7rem;margin:0 0 .35rem;letter-spacing:-.01em}
.snap-sub{color:#5c6b67;font-size:.85rem}
.snap-verdict{flex:0 1 auto;text-align:center}
.snap-right{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;text-align:right}
.snap-klabel{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5c6b67;font-weight:600;margin-bottom:.35rem}
.snap-baseline{font-size:.72rem;color:#5c6b67;margin-top:.4rem}
.snap-muted{color:#5c6b67;font-size:.78rem}
.snap-chips{font-size:.78rem;color:#5c6b67;background:rgba(99,205,169,.12);border:1px solid #dcebe7;border-radius:999px;padding:.25rem .7rem;font-variant-numeric:tabular-nums}
@media(max-width:900px){.snap-root{flex-direction:column;align-items:flex-start}.snap-right{align-items:flex-start;text-align:left}}
`
