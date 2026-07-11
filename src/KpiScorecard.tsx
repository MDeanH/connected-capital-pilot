// KPI scorecard — the deal's headline economics computed client-side from the
// coerced fields, colored by the matching Gate 1 check where one exists, with
// the governing threshold as a caption.
import { Term } from './GlossaryTip'
import { dealCashOnCash } from './finance'
import type { CheckResult, DealFields, Gate1Response } from './deal-types'

interface Props {
  fields: DealFields
  response: Gate1Response | null
  /** Config-sourced return benchmarks (optional — captions/coloring appear only when provided). */
  benchmarks?: { coc: number; irr: number; equityMultiple: number }
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`

interface Kpi {
  glossaryKey: string
  label: string
  value: string
  caption: string
  checkId?: string
  /** Explicit value class for KPIs colored against a benchmark (no gate check). */
  valueClass?: string
}

function statusClass(c: CheckResult | undefined): string {
  if (!c) return ''
  switch (c.status) {
    case 'pass': return 'kpi-good'
    case 'flag': return 'kpi-warn'
    case 'fail':
    case 'missing': return 'kpi-bad'
    default: return ''
  }
}

export default function KpiScorecard({ fields, response, benchmarks }: Props) {
  const checks = new Map((response?.result.checks ?? []).map(c => [c.id, c]))
  const th = (id: string) => checks.get(id)?.threshold?.effective ?? null

  const cost = fields.total_project_cost
  const noi = fields.stabilized_noi_untrended
  const yoc = noi !== null && cost ? noi / cost : null
  const devSpreadBps = yoc !== null && fields.exit_cap_rate !== null
    ? (yoc - fields.exit_cap_rate) * 10000 : null
  const ltc = fields.construction_loan !== null && cost ? fields.construction_loan / cost : null
  const landBasis = fields.land_cost !== null && cost ? fields.land_cost / cost : null
  const stress = response?.result.stress
  const coc = dealCashOnCash(fields)

  const kpis: Kpi[] = [
    {
      glossaryKey: 'irr', label: 'IRR',
      value: fields.projected_irr != null ? pct1(fields.projected_irr) : '—',
      caption: benchmarks
        ? `sponsor-reported · benchmark ≥ ${pct1(benchmarks.irr)}`
        : 'sponsor-reported, not verified',
    },
    {
      glossaryKey: 'equity_multiple', label: 'Equity multiple',
      value: fields.projected_equity_multiple != null ? `${fields.projected_equity_multiple.toFixed(2)}x` : '—',
      caption: benchmarks
        ? `sponsor-reported · benchmark ≥ ${benchmarks.equityMultiple.toFixed(2)}x`
        : 'sponsor-reported, not verified',
    },
    {
      glossaryKey: 'cash_on_cash', label: 'Cash-on-cash',
      value: coc !== null ? pct1(coc) : '—',
      caption: benchmarks ? `benchmark ≥ ${pct1(benchmarks.coc)}` : '(NOI − debt service) ÷ equity',
      valueClass: coc !== null && benchmarks
        ? (coc >= benchmarks.coc ? 'kpi-good' : 'kpi-bad')
        : undefined,
    },
    {
      glossaryKey: 'yoc', label: 'Yield on cost',
      value: yoc !== null ? pct1(yoc) : '—',
      caption: th('yoc_vs_benchmark') !== null ? `benchmark ≥ ${pct1(th('yoc_vs_benchmark')!)}` : 'NOI ÷ total cost',
      checkId: 'yoc_vs_benchmark',
    },
    {
      glossaryKey: 'dev_spread', label: 'Dev spread',
      value: devSpreadBps !== null ? `${Math.round(devSpreadBps)} bps` : '—',
      caption: th('dev_spread_min') !== null ? `kill line ≥ ${Math.round(th('dev_spread_min')!)} bps` : 'YoC − exit cap',
      checkId: 'dev_spread_min',
    },
    {
      glossaryKey: 'ltc', label: 'LTC',
      value: ltc !== null ? pct1(ltc) : '—',
      caption: th('ltc_max') !== null ? `max ${pct1(th('ltc_max')!)}` : 'loan ÷ total cost',
      checkId: 'ltc_max',
    },
    {
      glossaryKey: 'contingency', label: 'Contingency',
      value: fields.hard_cost_contingency_pct !== null ? pct1(fields.hard_cost_contingency_pct) : '—',
      caption: th('contingency_min') !== null ? `min ${pct1(th('contingency_min')!)} of hard costs` : 'share of hard costs',
      checkId: 'contingency_min',
    },
    {
      glossaryKey: 'coinvest', label: 'Co-invest',
      value: fields.sponsor_coinvest_pct !== null ? pct1(fields.sponsor_coinvest_pct) : '—',
      caption: th('coinvest_min') !== null ? `min ${pct1(th('coinvest_min')!)}` : 'sponsor share of equity',
      checkId: 'coinvest_min',
    },
    {
      glossaryKey: 'land_basis', label: 'Land basis',
      value: landBasis !== null ? pct1(landBasis) : '—',
      caption: th('land_basis') !== null ? `max ${pct1(th('land_basis')!)}` : 'land ÷ total cost',
      checkId: 'land_basis',
    },
    {
      glossaryKey: 'mini_stress', label: 'Stressed EM',
      value: stress?.stressedEquityMultiple != null ? `${stress.stressedEquityMultiple.toFixed(2)}x` : '—',
      caption: stress && Number.isFinite(stress.floor) ? `floor ${stress.floor.toFixed(2)}x` : 'mini-stress result',
      checkId: 'mini_stress',
    },
  ]

  return (
    <div className="kpi-root">
      <style>{CSS}</style>
      <div className="kpi-grid">
        {kpis.map(k => (
          <div className="card kpi-card" key={k.label}>
            <div className="kpi-label"><Term k={k.glossaryKey}>{k.label}</Term></div>
            <div className={`kpi-value ${k.valueClass ?? statusClass(k.checkId ? checks.get(k.checkId) : undefined)}`}>{k.value}</div>
            <div className="kpi-cap">{k.caption}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
.kpi-root{width:100%;max-width:1180px;margin:0 auto}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem}
.kpi-card{padding:1.5rem;min-width:0}
.kpi-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;margin-bottom:.6rem}
.kpi-value{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:30px;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi-value.kpi-good{color:var(--success,#157f3c)}
.kpi-value.kpi-warn{color:var(--warning,#b8860b)}
.kpi-value.kpi-bad{color:var(--danger,#c2384a)}
.kpi-cap{font-size:.74rem;color:var(--muted,#5c6b67);margin-top:.55rem}
@media(max-width:900px){.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
