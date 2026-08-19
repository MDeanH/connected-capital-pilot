// Financial summary — the deal's absolute dollars in one place (capital stack,
// stabilized NOI, debt service, implied exit value) plus the coverage ratios
// the KPI tiles don't carry (DSCR, debt yield). Derived rows are computed
// client-side from the coerced fields; a row with any missing input is
// omitted, never faked.
import { Term } from './GlossaryTip'
import { annualDebtService, dealDSCR, dealDebtYield, impliedExitValue } from './finance'
import { fmtNumber, fmtPct, fmtUSD } from './format'
import type { DealFields } from './deal-types'

interface Props {
  fields: DealFields
}

interface Row {
  label: string
  glossaryKey?: string
  value: string | null
  caption?: string
}

const usd = (n: number | null | undefined) => (n !== null && n !== undefined ? fmtUSD(n) : null)

export default function FinancialSummary({ fields }: Props) {
  const loan = fields.construction_loan
  const rate = fields.loan_interest_rate
  const debtService =
    loan !== null && loan !== undefined && loan !== 0 && rate !== null && rate !== undefined
      ? annualDebtService(loan, rate)
      : null
  const dscr = dealDSCR(fields)
  const debtYield = dealDebtYield(fields)

  const rows: Row[] = [
    { label: 'Total project cost', value: usd(fields.total_project_cost) },
    { label: 'Construction loan', value: usd(fields.construction_loan) },
    { label: 'Total equity', value: usd(fields.total_equity) },
    { label: 'Stabilized NOI (untrended)', value: usd(fields.stabilized_noi_untrended) },
    { label: 'Annual debt service', value: usd(debtService), caption: 'modeled rate · 25-yr amortization' },
    { label: 'Implied exit value', glossaryKey: 'exit_cap', value: usd(impliedExitValue(fields)), caption: 'NOI ÷ exit cap' },
    { label: 'DSCR', glossaryKey: 'dscr', value: dscr !== null ? `${fmtNumber(dscr)}x` : null, caption: 'NOI ÷ annual debt service' },
    { label: 'Debt yield', value: debtYield !== null ? fmtPct(debtYield) : null, caption: 'NOI ÷ loan' },
  ].filter(r => r.value !== null)

  if (rows.length === 0) return null

  return (
    <div className="card fs-root">
      <style>{CSS}</style>
      <h2 className="fs-title">Financial summary</h2>
      <div className="fs-grid">
        {rows.map(r => (
          <div className="fs-cell" key={r.label}>
            <div className="fs-label">
              {r.glossaryKey ? <Term k={r.glossaryKey}>{r.label}</Term> : r.label}
            </div>
            <div className="fs-value">{r.value}</div>
            {r.caption && <div className="fs-cap">{r.caption}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
.fs-root{max-width:1180px;margin:0 auto;padding:1.5rem}
.fs-title{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;letter-spacing:-.01em;margin:0 0 1rem}
.fs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem 1.5rem}
.fs-cell{display:flex;flex-direction:column;min-width:0}
.fs-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin-bottom:.35rem}
.fs-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.35rem;letter-spacing:-.01em;line-height:1.15;font-variant-numeric:tabular-nums}
.fs-cap{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:.3rem}
@media(max-width:900px){.fs-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
