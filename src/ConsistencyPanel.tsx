// Document consistency — the OM and the pro forma should tell the same story.
// Every extracted disagreement between them (or inside one of them) is a
// diligence signal the analyst sees before trusting any single number.
import { Info } from './Info'
import type { Discrepancy } from '../netlify/functions/lib/gate1/fields'

export default function ConsistencyPanel({ discrepancies }: { discrepancies: Discrepancy[] }) {
  const material = discrepancies.filter(d => d.severity === 'material').length
  return (
    <div className="card cp-root">
      <style>{CSS}</style>
      <h3>
        Document consistency
        <Info width={280}>
          <b>Document consistency</b> — the offering memorandum and the pro forma should agree
          on every economic fact. Disagreements don't fail a deal by themselves, but each one
          is a question the sponsor must answer before the numbers can be trusted.
        </Info>
        {discrepancies.length > 0 && (
          <span className="cp-count">
            {discrepancies.length} found · {material} material
          </span>
        )}
      </h3>
      {discrepancies.length === 0 ? (
        <div className="cp-clean">✓ No cross-document contradictions detected</div>
      ) : (
        <div className="cp-list">
          {discrepancies.map((d, i) => (
            <div className="cp-row" key={i}>
              <span className={`cp-dot cp-${d.severity}`} aria-hidden="true" />
              <div className="cp-body">
                <div className="cp-topic">
                  {d.topic}
                  <span className={`cp-sev cp-sev-${d.severity}`}>{d.severity.toUpperCase()}</span>
                </div>
                <div className="cp-vals">
                  OM says <b>{d.om_value}</b> · pro forma says <b>{d.proforma_value}</b>
                </div>
                {d.note && <div className="cp-note">{d.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const CSS = `
.cp-root{padding:1.5rem}
.cp-root h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 1rem;font-weight:600;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.cp-count{font-weight:500;color:var(--muted,#5c6b67);letter-spacing:.04em}
.cp-clean{color:var(--success,#3f7d69);font-size:.9rem}
.cp-list{display:flex;flex-direction:column}
.cp-row{display:flex;gap:.8rem;padding:.85rem .25rem;align-items:flex-start}
.cp-row + .cp-row{border-top:1px solid var(--border,#dcebe7)}
.cp-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:0 0 auto}
.cp-dot.cp-material{background:var(--danger,#c2384a)}
.cp-dot.cp-minor{background:var(--warning,#b8860b)}
.cp-topic{font-weight:600;font-size:.9rem}
.cp-sev{font-size:.62rem;letter-spacing:.08em;margin-left:.6rem;padding:1px 6px;border-radius:4px;vertical-align:middle}
.cp-sev-material{background:#fbecef;color:var(--danger,#c2384a)}
.cp-sev-minor{background:#fbf3df;color:#7a5c0d}
.cp-vals{font-size:.85rem;margin-top:.25rem}
.cp-note{font-size:.8rem;color:var(--muted,#5c6b67);margin-top:.25rem;line-height:1.5}
`
