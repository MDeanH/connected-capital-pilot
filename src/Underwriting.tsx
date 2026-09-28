// Underwriting — the Results step, reorganised after the layout the client
// preferred in prototype v1 (2026-09-09 working session): Summary · Financials
// · Market · Sponsor · Issues sub-tabs, one tile size on one grid, the deal's
// outcome under green / yellow / red posture side by side, and a visible
// cushion (room before failing) per check.
//
// Display only. The verdict of record is still response.result, scored under
// today's posture; the other two postures come from response.scenarios, which
// is the same engine run with the same rulebook and judgment adjustments.
// Nothing here fabricates data the documents don't give us: a tile with a
// missing input says so instead of showing a number.
import { useState, type ReactNode } from 'react'
import { Term } from './GlossaryTip'
import { PostureChip, VerdictBadge } from './cc-ui'
import ConsistencyPanel from './ConsistencyPanel'
import McProbabilityCard from './McProbabilityCard'
import MarketPathCard from './MarketPathCard'
import { fmtMargin, fmtVal } from './GateResults'
import { annualDebtService, dealCashOnCash, dealDSCR, dealDebtYield, impliedExitValue } from './finance'
import type { CheckResult, DealFields, Gate1Response, Posture, PostureScenario } from './deal-types'
import type { ExtractionResult } from '../netlify/functions/lib/gate1/fields'
import type { MacroSnapshot } from '../netlify/functions/lib/gate1/types'
import type { MarketBenchmarks } from './MarketComparison'

type Status = CheckResult['status']
type Tab = 'summary' | 'financials' | 'market' | 'sponsor' | 'issues'

interface Props {
  fields: DealFields
  response: Gate1Response
  extraction: ExtractionResult | null
  macro: MacroSnapshot | null
  /** Config benchmarks, withheld (null) while the rulebook version is drifting. */
  benchmarks: MarketBenchmarks | null
  /** Active rulebook's par IRR, for the Monte Carlo card. */
  parIrr: number
  onAdjust?: (thresholdKey: string, currentEffective: number) => void
}

const POSTURES: Posture[] = ['green', 'yellow', 'red']
const STATUS_WORD: Record<Status, string> = { pass: 'PASS', flag: 'WATCH', fail: 'FAIL', missing: 'MISSING', na: 'N/A' }
const CMP: Record<string, string> = { '<=': '≤', '>=': '≥' }
const MISSING = 'not in the documents'

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`
const bps = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))} bps`
function money(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

// ---------------------------------------------------------------- primitives

function Section({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="uw-sec">
      <div className="uw-sec-head">
        <h3 className="uw-sec-title">{title}</h3>
        {note && <span className="uw-sec-note">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Pill({ status, word }: { status: Status; word?: string }) {
  return <span className={`uw-pill uw-pill-${status}`}>{word ?? STATUS_WORD[status]}</span>
}

function Tile({ label, value, status, caption, tag }: {
  label: ReactNode
  value: ReactNode
  status?: Status
  caption?: ReactNode
  tag?: ReactNode
}) {
  return (
    <div className={`uw-tile${status ? ` uw-t-${status}` : ''}`}>
      <div className="uw-tile-top">
        <span className="uw-tile-label">{label}</span>
        {status && <Pill status={status} />}
      </div>
      <div className="uw-tile-value">{value}</div>
      <div className="uw-tile-foot">
        {caption && <span className="uw-tile-cap">{caption}</span>}
        {tag}
      </div>
    </div>
  )
}

function Grid({ cols = 4, children }: { cols?: 3 | 4; children: ReactNode }) {
  return <div className={`uw-grid uw-g${cols}`}>{children}</div>
}

// ------------------------------------------------------- verification source

type SrcKind = 'sourced' | 'check' | 'edited' | 'entered'

/**
 * Where a displayed number came from, from the extraction's per-field
 * confidence/citation. Derived metrics take the weakest of their inputs.
 */
function sourceOf(extraction: ExtractionResult | null, keys: string[]): { kind: SrcKind; label: string } {
  if (!extraction) return { kind: 'entered', label: 'entered, not extracted' }
  const fs = keys.map(k => extraction.fields[k])
  if (fs.some(f => !f)) return { kind: 'entered', label: 'entered, not extracted' }
  if (fs.some(f => f.edited)) return { kind: 'edited', label: 'analyst-corrected' }
  if (fs.some(f => f.value === null || f.confidence < 0.8)) return { kind: 'check', label: 'low confidence — check' }
  const docs = [...new Set(fs.map(f => (f.source.doc === 'om' ? 'OM' : f.source.doc === 'proforma' ? 'pro forma' : null)).filter(Boolean))]
  const only = fs.length === 1 ? fs[0] : null
  if (only && only.source.doc === 'om' && only.source.page) return { kind: 'sourced', label: `OM p.${only.source.page}` }
  return { kind: 'sourced', label: docs.length ? `from ${docs.join(' + ')}` : 'extracted' }
}

function SrcTag({ extraction, keys }: { extraction: ExtractionResult | null; keys: string[] }) {
  const s = sourceOf(extraction, keys)
  return <span className={`uw-src uw-src-${s.kind}`}>{s.label}</span>
}

// ------------------------------------------------------------ check helpers

function thresholdText(id: string, comparator: string | undefined, t: number | null): string {
  if (t === null) return ''
  const v = id === 'interest_reserve' ? `duration + ${fmtVal(id, t)}` : fmtVal(id, t)
  return comparator ? `${CMP[comparator] ?? comparator} ${v}` : v
}

function signedMargin(id: string, m: number): string {
  return `${m >= 0 ? '+' : '−'}${fmtMargin(id, m)}`
}

function scenarioCheck(s: PostureScenario | undefined, id: string) {
  return s?.checks.find(c => c.id === id)
}

/**
 * Provisional cushion: the room to the threshold under today's posture, and
 * the worst posture the check still passes. Replaced by the client's cushion
 * formula once it arrives.
 */
function cushion(c: CheckResult, scenarios: Gate1Response['scenarios'], today: Posture): { text: string; tone: Status } {
  if (c.status === 'missing') return { text: 'input missing — can’t measure', tone: 'missing' }
  if (c.status === 'na') return { text: '—', tone: 'na' }
  if (c.status !== 'pass') return { text: 'no cushion — fails today', tone: c.status }
  const room = c.margin !== null ? `${fmtMargin(c.id, c.margin)} of room` : null
  if (!scenarios) return { text: room ?? 'passes today', tone: 'pass' }
  let holds = today
  for (let i = POSTURES.indexOf(today) + 1; i < POSTURES.length; i++) {
    if (scenarioCheck(scenarios[POSTURES[i]], c.id)?.status === 'pass') holds = POSTURES[i]
    else break
  }
  const thin = c.fragile ? ' · thin' : ''
  if (holds === 'red') return { text: `${room ? `${room} · ` : ''}holds through red${thin}`, tone: c.fragile ? 'flag' : 'pass' }
  const breaks = POSTURES[POSTURES.indexOf(holds) + 1]
  return { text: `${room ? `${room} · ` : ''}breaks in ${breaks}`, tone: 'flag' }
}

const passing = (v: string) => v === 'PASS' || v === 'CONDITIONAL'

/** One sentence: how far the market can turn before the deal's verdict breaks. */
function survivalLine(r: Gate1Response): string {
  const today = r.posture
  const v0 = r.result.verdict
  if (v0 === 'REVIEW') return 'Can’t be decided yet — fill the missing inputs, then every posture scores.'
  if (!passing(v0)) return `Fails Gate 1 in today’s ${today} posture.`
  if (!r.scenarios) return `Passes in today’s ${today} posture.`
  for (let i = POSTURES.indexOf(today) + 1; i < POSTURES.length; i++) {
    const p = POSTURES[i]
    if (!passing(r.scenarios[p].verdict)) {
      return `Passes today (${today}); the verdict breaks if the market turns ${p}.`
    }
  }
  return today === 'red'
    ? 'Passes even though today’s posture is already red — the harshest bar.'
    : `Passes today (${today}) and still passes if the market turns red.`
}

// ================================================================== SUMMARY

function ScenarioStrip({ response }: { response: Gate1Response }) {
  const sc = response.scenarios
  const label = new Map(response.checksMeta.map(m => [m.id, m.label]))
  if (!sc) return <div className="uw-muted">The side-by-side view needs the updated scoring functions — redeploy to see it.</div>
  const today = sc[response.posture]
  return (
    <div className="uw-scen">
      {POSTURES.map(p => {
        const s = sc[p]
        const isToday = p === response.posture
        const changed = s.checks
          .filter(c => scenarioCheck(today, c.id)?.status !== c.status)
          .map(c => `${label.get(c.id) ?? c.id} → ${STATUS_WORD[c.status]}`)
        return (
          <div key={p} className={`uw-scen-card uw-scen-${p}${isToday ? ' uw-scen-today' : ''}`}>
            <div className="uw-scen-head">
              <PostureChip posture={p} />
              {isToday && <span className="uw-today">TODAY</span>}
            </div>
            <VerdictBadge verdict={s.verdict} />
            <div className="uw-scen-counts">
              {s.kills.length} hard kill{s.kills.length === 1 ? '' : 's'} · {s.flagPoints} watch pt{s.flagPoints === 1 ? '' : 's'}
            </div>
            <div className="uw-scen-diff">
              {isToday ? 'Verdict of record' : changed.length ? `vs today: ${changed.join(', ')}` : 'Same check results as today'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CheckMatrix({ response, onAdjust }: { response: Gate1Response; onAdjust?: Props['onAdjust'] }) {
  const sc = response.scenarios
  const meta = new Map(response.checksMeta.map(m => [m.id, m]))
  const groups: Array<{ kind: 'kill' | 'flag'; title: ReactNode }> = [
    { kind: 'kill', title: <Term k="hard_kill">Hard kills</Term> },
    { kind: 'flag', title: <Term k="watch_flag">Watch flags</Term> },
  ]
  return (
    <div className="uw-mx-wrap">
      <table className="uw-mx">
        <thead>
          <tr>
            <th className="uw-mx-name">Check</th>
            <th>Deal</th>
            {POSTURES.map(p => (
              <th key={p} className={p === response.posture ? 'uw-mx-today' : undefined}>
                <span className={`uw-pdot uw-pdot-${p}`} aria-hidden="true" />{p}
                {p === response.posture && <span className="uw-today">TODAY</span>}
              </th>
            ))}
            <th>Cushion <span className="uw-prov">provisional</span></th>
            {onAdjust && <th aria-label="Adjust" />}
          </tr>
        </thead>
        {groups.map(g => (
          <tbody key={g.kind}>
            <tr className="uw-mx-group"><td colSpan={onAdjust ? 7 : 6}>{g.title}</td></tr>
            {response.result.checks.filter(c => c.kind === g.kind).map(c => {
              const cu = cushion(c, sc, response.posture)
              const tip = meta.get(c.id)?.tip
              return (
                <tr key={c.id}>
                  <td className="uw-mx-name" title={tip}>{c.label}</td>
                  <td className="uw-mx-val">{c.valueDisplay}</td>
                  {POSTURES.map(p => {
                    const s = sc ? scenarioCheck(sc[p], c.id) : p === response.posture
                      ? { status: c.status, threshold: c.threshold?.effective ?? null, margin: c.margin }
                      : undefined
                    if (!s) return <td key={p} className="uw-mx-cell uw-c-na">—</td>
                    return (
                      <td key={p} className={`uw-mx-cell uw-c-${s.status}${p === response.posture ? ' uw-mx-today' : ''}`}>
                        <b>{STATUS_WORD[s.status]}</b>
                        {s.threshold !== null && <span>{thresholdText(c.id, c.comparator, s.threshold)}</span>}
                        {s.margin !== null && <span className="uw-mx-m">{signedMargin(c.id, s.margin)}</span>}
                      </td>
                    )
                  })}
                  <td className={`uw-mx-cush uw-k-${cu.tone}`}>{cu.text}</td>
                  {onAdjust && (
                    <td className="uw-mx-adj">
                      {c.threshold && (
                        <button className="uw-adjust" onClick={() => onAdjust(c.threshold!.key, c.threshold!.effective)}
                          title={`Adjust the ${c.threshold.key} threshold for this deal (reason required)`}>ADJUST</button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function SummaryTab({ fields, response, extraction, macro }: Props) {
  const ck = new Map(response.result.checks.map(c => [c.id, c]))
  const th = (id: string) => ck.get(id)?.threshold?.effective ?? null
  const cost = fields.total_project_cost
  const noi = fields.stabilized_noi_untrended
  const yoc = has(noi) && has(cost) && cost ? noi / cost : null
  const spread = yoc !== null && has(fields.exit_cap_rate) ? (yoc - fields.exit_cap_rate) * 10000 : null
  const ltc = has(fields.construction_loan) && has(cost) && cost ? fields.construction_loan / cost : null
  const land = has(fields.land_cost) && has(cost) && cost ? fields.land_cost / cost : null
  const irr = fields.projected_irr ?? null
  const hurdle = macro?.hurdle?.totalPct ?? null
  const stress = response.result.stress
  const st = (id: string) => ck.get(id)?.status

  return (
    <>
      <Section title="A. Verdict under each market posture" note={survivalLine(response)}>
        <ScenarioStrip response={response} />
      </Section>

      <Section title="B. Key metrics" note="colored by today’s posture · source shown on each tile">
        <Grid>
          <Tile label={<Term k="irr">Projected IRR</Term>}
            value={has(irr) ? pct1(irr) : '—'}
            status={has(irr) && has(hurdle) ? (irr >= hurdle ? 'pass' : 'fail') : undefined}
            caption={has(hurdle) ? (has(irr) ? `${pts(irr - hurdle)} vs ${pct1(hurdle)} required` : `required ${pct1(hurdle)}`) : 'sponsor-reported'}
            tag={<SrcTag extraction={extraction} keys={['projected_irr']} />} />
          <Tile label={<Term k="yoc">Yield on cost</Term>} value={yoc !== null ? pct1(yoc) : '—'} status={st('yoc_vs_benchmark')}
            caption={th('yoc_vs_benchmark') !== null ? `≥ ${pct1(th('yoc_vs_benchmark')!)}` : 'NOI ÷ total cost'}
            tag={<SrcTag extraction={extraction} keys={['stabilized_noi_untrended', 'total_project_cost']} />} />
          <Tile label={<Term k="dev_spread">Development spread</Term>} value={spread !== null ? `${Math.round(spread)} bps` : '—'}
            status={st('dev_spread_min')}
            caption={th('dev_spread_min') !== null ? `≥ ${Math.round(th('dev_spread_min')!)} bps in ${response.posture}` : 'yield on cost − exit cap'}
            tag={<SrcTag extraction={extraction} keys={['stabilized_noi_untrended', 'total_project_cost', 'exit_cap_rate']} />} />
          <Tile label={<Term k="mini_stress">Stressed equity multiple</Term>}
            value={has(stress?.stressedEquityMultiple) ? `${stress!.stressedEquityMultiple!.toFixed(2)}x` : '—'}
            status={st('mini_stress')}
            caption={stress && Number.isFinite(stress.floor) ? `floor ${stress.floor.toFixed(2)}x after +${Math.round(stress.hardCostBumpPct * 100)}% costs, +${Math.round(stress.exitCapBumpBps)} bps cap` : 'mini stress test'} />
          <Tile label={<Term k="ltc">Loan-to-cost</Term>} value={ltc !== null ? pct1(ltc) : '—'} status={st('ltc_max')}
            caption={th('ltc_max') !== null ? `≤ ${pct1(th('ltc_max')!)}` : 'loan ÷ total cost'}
            tag={<SrcTag extraction={extraction} keys={['construction_loan', 'total_project_cost']} />} />
          <Tile label={<Term k="contingency">Contingency</Term>}
            value={has(fields.hard_cost_contingency_pct) ? pct1(fields.hard_cost_contingency_pct) : '—'} status={st('contingency_min')}
            caption={th('contingency_min') !== null ? `≥ ${pct1(th('contingency_min')!)} of hard costs` : 'share of hard costs'}
            tag={<SrcTag extraction={extraction} keys={['hard_cost_contingency_pct']} />} />
          <Tile label={<Term k="coinvest">Sponsor co-invest</Term>}
            value={has(fields.sponsor_coinvest_pct) ? pct1(fields.sponsor_coinvest_pct) : '—'} status={st('coinvest_min')}
            caption={th('coinvest_min') !== null ? `≥ ${pct1(th('coinvest_min')!)} of equity` : 'sponsor share of equity'}
            tag={<SrcTag extraction={extraction} keys={['sponsor_coinvest_pct']} />} />
          <Tile label={<Term k="land_basis">Land basis</Term>} value={land !== null ? pct1(land) : '—'} status={st('land_basis')}
            caption={th('land_basis') !== null ? `≤ ${pct1(th('land_basis')!)} of cost` : 'land ÷ total cost'}
            tag={<SrcTag extraction={extraction} keys={['land_cost', 'total_project_cost']} />} />
        </Grid>
      </Section>

      <Section title="C. Every check, every posture"
        note="PASS / WATCH / FAIL under each posture, with the threshold and the margin (+ = room to spare)">
        <CheckMatrix response={response} />
        <div className="uw-foot">
          <b>Cushion is provisional:</b> the room to the threshold today and the worst posture the check still
          survives. It switches to the client’s cushion formula once that arrives. Checks whose threshold is the
          same in every posture show the same bar in all three columns — set per-posture values on the
          Thresholds page.
        </div>
      </Section>
    </>
  )
}

// =============================================================== FINANCIALS

const PALETTE = ['#3f7d69', '#63cda9', '#b8860b', '#9c9c9c']

function Donut({ parts }: { parts: Array<{ label: string; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 42
  const C = 2 * Math.PI * r
  let off = 0
  return (
    <svg viewBox="0 0 120 120" className="uw-donut" role="img"
      aria-label={parts.map(p => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      <circle cx={60} cy={60} r={r} fill="none" stroke="var(--surface-2,#f5fbfa)" strokeWidth={16} />
      {parts.map((p, i) => {
        const len = (p.value / total) * C
        const el = (
          <circle key={p.label} cx={60} cy={60} r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={16}
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />
        )
        off += len
        return el
      })}
    </svg>
  )
}

function CapitalCard({ title, parts, note }: { title: string; parts: Array<{ label: string; value: number }>; note?: ReactNode }) {
  const shown = parts.filter(p => p.value > 0)
  const total = shown.reduce((s, p) => s + p.value, 0)
  return (
    <div className="uw-card uw-cap">
      <div className="uw-card-title">{title}</div>
      {total > 0 ? (
        <div className="uw-cap-body">
          <Donut parts={shown} />
          <div className="uw-legend">
            {shown.map((p, i) => (
              <div className="uw-leg-row" key={p.label}>
                <span className="uw-leg-dot" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true" />
                <span className="uw-leg-label">{p.label}</span>
                <span className="uw-leg-pct">{Math.round((p.value / total) * 100)}%</span>
                <span className="uw-leg-val">{money(p.value)}</span>
              </div>
            ))}
            <div className="uw-leg-row uw-leg-total">
              <span className="uw-leg-dot" aria-hidden="true" />
              <span className="uw-leg-label">Total</span>
              <span className="uw-leg-pct" />
              <span className="uw-leg-val">{money(total)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="uw-muted">Inputs {MISSING}.</div>
      )}
      {note && <div className="uw-cap-note">{note}</div>}
    </div>
  )
}

function Timeline({ fields }: { fields: DealFields }) {
  const build = fields.construction_duration_months
  const lease = fields.lease_up_months_assumed
  const market = fields.submarket_leaseup_months
  const reserve = fields.interest_reserve_months
  if (!has(build)) return <div className="uw-card uw-muted">Construction duration {MISSING} — no timeline to draw.</div>
  const bars: Array<{ label: string; from: number; to: number; cls: string }> = [
    { label: 'Construction', from: 0, to: build, cls: 'uw-bar-build' },
    ...(has(lease) ? [{ label: 'Lease-up (underwritten)', from: build, to: build + lease, cls: 'uw-bar-lease' }] : []),
    ...(has(market) ? [{ label: 'Lease-up (submarket record)', from: build, to: build + market, cls: 'uw-bar-ref' }] : []),
    ...(has(reserve) ? [{ label: 'Interest reserve covers', from: 0, to: reserve, cls: 'uw-bar-reserve' }] : []),
  ]
  const max = Math.max(...bars.map(b => b.to)) * 1.05
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f))
  return (
    <div className="uw-card uw-tl">
      {bars.map(b => (
        <div className="uw-tl-row" key={b.label}>
          <span className="uw-tl-label">{b.label}</span>
          <span className="uw-tl-track">
            <span className={`uw-tl-bar ${b.cls}`} style={{ left: `${(b.from / max) * 100}%`, width: `${((b.to - b.from) / max) * 100}%` }} />
          </span>
          <span className="uw-tl-range">{Math.round(b.from)}–{Math.round(b.to)} mo</span>
        </div>
      ))}
      <div className="uw-tl-row uw-tl-axis">
        <span className="uw-tl-label" />
        <span className="uw-tl-track uw-tl-ticks">{ticks.map(t => <span key={t}>{t} mo</span>)}</span>
        <span className="uw-tl-range" />
      </div>
    </div>
  )
}

function FinancialsTab({ fields, extraction }: Props) {
  const cost = fields.total_project_cost
  const land = fields.land_cost ?? 0
  const hard = fields.hard_costs ?? 0
  const other = has(cost) ? cost - land - hard : 0
  const loan = fields.construction_loan ?? 0
  const equity = fields.total_equity ?? (has(cost) && has(fields.construction_loan) ? cost - fields.construction_loan : null)
  const sponsorEq = has(equity) && has(fields.sponsor_coinvest_pct) ? equity * fields.sponsor_coinvest_pct : 0
  const lpEq = has(equity) ? equity - sponsorEq : 0
  const sources = loan + (equity ?? 0)
  const gap = has(cost) && sources > 0 ? sources - cost : 0
  const contingencyUsd = has(fields.hard_cost_contingency_pct) && hard ? hard * fields.hard_cost_contingency_pct : null

  const noi = fields.stabilized_noi_untrended
  const yoc = has(noi) && has(cost) && cost ? noi / cost : null
  const spread = yoc !== null && has(fields.exit_cap_rate) ? (yoc - fields.exit_cap_rate) * 10000 : null
  const ltc = has(fields.construction_loan) && has(cost) && cost ? fields.construction_loan / cost : null
  const ds = has(fields.construction_loan) && fields.construction_loan > 0 && has(fields.loan_interest_rate)
    ? annualDebtService(fields.construction_loan, fields.loan_interest_rate) : null
  const dscr = dealDSCR(fields)
  const dy = dealDebtYield(fields)
  const exitV = impliedExitValue(fields)
  const coc = dealCashOnCash(fields)
  const em = fields.projected_equity_multiple ?? null
  const irr = fields.projected_irr ?? null
  const src = (keys: string[]) => <SrcTag extraction={extraction} keys={keys} />

  return (
    <>
      <Section title="A. Uses & sources of capital">
        <div className="uw-two">
          <CapitalCard title="Uses of capital"
            parts={[{ label: 'Land', value: land }, { label: 'Hard costs', value: hard }, { label: 'Soft costs & other', value: Math.max(other, 0) }]}
            note={contingencyUsd !== null ? `Contingency ${pct1(fields.hard_cost_contingency_pct!)} of hard costs ≈ ${money(contingencyUsd)}. “Soft costs & other” is total cost less land and hard costs.` : undefined} />
          <CapitalCard title="Sources of capital"
            parts={[{ label: 'Construction loan', value: loan }, { label: 'LP equity', value: Math.max(lpEq, 0) }, { label: 'Sponsor co-invest', value: sponsorEq }]}
            note={Math.abs(gap) > 1 && has(cost) && Math.abs(gap) / cost > 0.005
              ? `Sources ${money(sources)} vs uses ${money(cost)} — a ${money(Math.abs(gap))} ${gap > 0 ? 'surplus' : 'gap'} to ask the sponsor about.`
              : fields.total_equity == null ? 'Equity derived as total cost less the loan.' : undefined} />
        </div>
      </Section>

      <Section title="B. Project economics">
        <Grid>
          <Tile label="Stabilized NOI" value={has(noi) ? money(noi) : '—'} caption="untrended" tag={src(['stabilized_noi_untrended'])} />
          <Tile label={<Term k="yoc">Yield on cost</Term>} value={yoc !== null ? pct1(yoc) : '—'} caption="NOI ÷ total cost" />
          <Tile label={<Term k="dev_spread">Development spread</Term>} value={spread !== null ? `${Math.round(spread)} bps` : '—'} caption="yield on cost − exit cap" />
          <Tile label="Total project cost" value={has(cost) ? money(cost) : '—'} caption="all-in" tag={src(['total_project_cost'])} />
        </Grid>
      </Section>

      <Section title="C. Capital structure & investor returns">
        <Grid>
          <Tile label={<Term k="ltc">Loan-to-cost</Term>} value={ltc !== null ? pct1(ltc) : '—'} caption={has(fields.construction_loan) ? `${money(fields.construction_loan)} loan` : 'loan ÷ cost'} />
          <Tile label={<Term k="dscr">DSCR</Term>} value={dscr !== null ? `${dscr.toFixed(2)}x` : '—'} caption={ds !== null ? `NOI ÷ ${money(ds)} debt service` : 'NOI ÷ debt service'} />
          <Tile label="Debt yield" value={dy !== null ? pct1(dy) : '—'} caption="NOI ÷ loan" />
          <Tile label="Implied exit value" value={exitV !== null ? money(exitV) : '—'} caption="NOI ÷ exit cap" />
          <Tile label={<Term k="irr">Projected IRR</Term>} value={has(irr) ? pct1(irr) : '—'} caption="sponsor-reported" tag={src(['projected_irr'])} />
          <Tile label={<Term k="equity_multiple">Equity multiple</Term>} value={has(em) ? `${em.toFixed(2)}x` : '—'} caption="sponsor-reported" tag={src(['projected_equity_multiple'])} />
          <Tile label={<Term k="cash_on_cash">Cash-on-cash</Term>} value={coc !== null ? pct1(coc) : '—'} caption="stabilized, after debt service" />
          <Tile label="Modeled loan rate" value={has(fields.loan_interest_rate) ? pct1(fields.loan_interest_rate) : '—'} caption="25-yr amortization assumed" tag={src(['loan_interest_rate'])} />
        </Grid>
      </Section>

      <Section title="D. Development timeline" note="from the documents’ durations · year-by-year pro forma isn’t extracted yet">
        <Timeline fields={fields} />
      </Section>
    </>
  )
}

// =================================================================== MARKET

function BarRows({ rows }: { rows: Array<{ label: string; value: number | null; cls?: string }> }) {
  const vals = rows.map(r => r.value).filter(has)
  const max = vals.length ? Math.max(...vals) * 1.15 : 1
  return (
    <div className="uw-card uw-bars">
      {rows.map(r => (
        <div className="uw-bar-row" key={r.label}>
          <span className="uw-bar-label">{r.label}</span>
          <span className="uw-bar-track">
            {has(r.value) && <span className={`uw-bar-fill ${r.cls ?? ''}`} style={{ width: `${(r.value / max) * 100}%` }} />}
          </span>
          <span className="uw-bar-val">{has(r.value) ? pct1(r.value) : 'n/a'}</span>
        </div>
      ))}
    </div>
  )
}

function MarketTab({ fields, response, macro, benchmarks, parIrr }: Props) {
  const ck = new Map(response.result.checks.map(c => [c.id, c]))
  const irr = fields.projected_irr ?? null
  const h = macro?.hurdle
  const hurdle = h?.totalPct ?? null
  const FEE = 0.02
  const m = macro?.market ?? null
  const fred = (x: number | null | undefined) => (has(x) ? x / 100 : null) // FRED series arrive as percent points
  const sofr = fred(m?.sofr)
  const spreadBps = benchmarks?.financingSpreadTypicalBps ?? null
  const prevailing = sofr !== null && spreadBps !== null ? sofr + spreadBps / 10000 : null
  const modeled = fields.loan_interest_rate ?? null
  const sp5 = m?.sp500.ret5y ?? null
  const exitCk = ck.get('exit_cap_vs_market')
  const rentCk = ck.get('rents_vs_comps')
  const absCk = ck.get('absorption')
  const premium = has(fields.assumed_rent_monthly) && has(fields.market_comp_rent_monthly) && fields.market_comp_rent_monthly
    ? fields.assumed_rent_monthly / fields.market_comp_rent_monthly - 1 : null
  const flagAt = rentCk?.threshold?.effective ?? null
  const lease = fields.lease_up_months_assumed
  const sub = fields.submarket_leaseup_months

  let finWord: { status: Status; text: string } | null = null
  if (fields.construction_loan === 0) finWord = { status: 'na', text: 'All-equity — no financing exposure' }
  else if (has(modeled) && prevailing !== null) {
    const d = (modeled - prevailing) * 100
    finWord = d < -0.5
      ? { status: 'flag', text: `Optimistic — modeled ${pct1(modeled)} is ${Math.abs(d).toFixed(1)} pts under today’s ≈${pct1(prevailing)}` }
      : d <= 0.5
        ? { status: 'pass', text: `In line with today’s ≈${pct1(prevailing)} (SOFR + ${spreadBps} bps)` }
        : { status: 'na', text: `Conservative — modeled ${d.toFixed(1)} pts above today’s ≈${pct1(prevailing)}` }
  }

  return (
    <>
      <Section title="A. Return vs required return"
        note={h ? `required = ${pct1(h.anchorPct)} base + ${h.illiquidityBps} illiquidity + ${h.complexityBps} development + ${h.regimeBps} regime bps · provisional until the client’s hurdle formula arrives` : 'macro snapshot unavailable'}>
        <Grid>
          <Tile label="Projected IRR" value={has(irr) ? pct1(irr) : '—'} caption="sponsor-reported" />
          <Tile label="Required return" value={has(hurdle) ? pct1(hurdle) : '—'} caption={macro ? `${macro.regime.replace('_', ' ')} regime` : undefined} />
          <Tile label="Delta vs required" value={has(irr) && has(hurdle) ? pts(irr - hurdle) : '—'}
            status={has(irr) && has(hurdle) ? (irr >= hurdle ? 'pass' : 'fail') : undefined} caption="gross, before fees" />
          <Tile label="After a 2% fee" value={has(irr) && has(hurdle) ? pts(irr - FEE - hurdle) : '—'}
            status={has(irr) && has(hurdle) ? (irr - FEE >= hurdle ? 'pass' : 'fail') : undefined}
            caption="approx. · 2% is the baseline fee from the 9/9 session, negotiable per deal" />
        </Grid>
      </Section>

      <Section title={<Term k="sp500_comparison">B. Against the public-market alternative</Term>}
        note={m?.asof ? `market data as of ${m.asof}` : 'market snapshot unavailable'}>
        <Grid>
          <Tile label="S&P 500 · 1 yr" value={has(m?.sp500.ret1y) ? pct1(m!.sp500.ret1y!) : '—'} />
          <Tile label="S&P 500 · 3 yr ann." value={has(m?.sp500.ret3y) ? pct1(m!.sp500.ret3y!) : '—'} />
          <Tile label="S&P 500 · 5 yr ann." value={has(sp5) ? pct1(sp5) : '—'} />
          <Tile label="IRR premium over S&P 5 yr" value={has(irr) && has(sp5) ? pts(irr - sp5) : '—'}
            status={has(irr) && has(sp5) ? (irr > sp5 ? 'pass' : 'flag') : undefined} caption="what the illiquidity buys" />
        </Grid>
      </Section>

      <Section title={<Term k="financing">C. Financing context</Term>}
        note={finWord ? <><Pill status={finWord.status} word={finWord.status === 'pass' ? 'IN LINE' : finWord.status === 'flag' ? 'CHECK' : 'NOTE'} /> {finWord.text}</> : undefined}>
        <BarRows rows={[
          { label: 'Deal’s modeled loan rate', value: modeled, cls: 'uw-fill-deal' },
          { label: `Prevailing (SOFR + ${spreadBps ?? '—'} bps)`, value: prevailing },
          { label: 'SOFR', value: sofr },
          { label: '10-yr Treasury', value: fred(m?.treasury10y) },
          { label: '30-yr mortgage', value: fred(m?.mortgage30y) },
        ]} />
      </Section>

      <Section title={<Term k="exit_cap">D. Cap-rate analysis</Term>}>
        <Grid>
          <Tile label="Market cap rate today" value={has(fields.market_cap_rate_today) ? pct1(fields.market_cap_rate_today) : '—'} />
          <Tile label="Sponsor exit cap" value={has(fields.exit_cap_rate) ? pct1(fields.exit_cap_rate) : '—'} />
          <Tile label="Exit vs today" value={has(exitCk?.margin) ? bps(exitCk!.margin!) : '—'} status={exitCk?.status}
            caption="exit should be at or above today’s cap" />
          <Tile label="Implied exit value" value={impliedExitValue(fields) !== null ? money(impliedExitValue(fields)!) : '—'} caption="NOI ÷ exit cap" />
        </Grid>
      </Section>

      <Section title={<Term k="rents_vs_comps">E. Rents vs comparables</Term>}>
        <Grid cols={3}>
          <Tile label="Underwritten rent" value={has(fields.assumed_rent_monthly) ? `${dollars(fields.assumed_rent_monthly)}/mo` : '—'} />
          <Tile label="Market comp rent" value={has(fields.market_comp_rent_monthly) ? `${dollars(fields.market_comp_rent_monthly)}/mo` : '—'} />
          <Tile label="Premium over comps" value={premium !== null ? `${premium >= 0 ? '+' : '−'}${Math.abs(premium * 100).toFixed(1)}%` : '—'}
            status={rentCk?.status} caption={flagAt !== null ? `watch above ${pct1(flagAt)}` : undefined} />
        </Grid>
      </Section>

      <Section title={<Term k="absorption">F. Absorption</Term>}>
        <Grid cols={3}>
          <Tile label="Underwritten lease-up" value={has(lease) ? `${lease} mo` : '—'} />
          <Tile label="Submarket record" value={has(sub) ? `${sub} mo` : '—'} />
          <Tile label="Faster than market by" value={has(lease) && has(sub) ? `${Math.round(sub - lease)} mo` : '—'} status={absCk?.status}
            caption="a much faster lease-up than the market has managed is a watch item" />
        </Grid>
      </Section>

      <details className="uw-adv">
        <summary>Market risk context — statistical, not part of the verdict</summary>
        <div className="uw-adv-body">
          <p>
            These two cards describe the <b>local market</b>, not this deal, and neither changes the Gate 1 result.
            <b> Return distribution</b> is a Monte Carlo simulation of how investments in this metro have tended to
            turn out: the chance of beating your {pct1(parIrr)} benchmark and the chance of losing money.
            <b> Market path</b> is a 12-month outlook for the metro’s typical home values: the line is the most
            likely path and the shaded band is the range that covers 8 in 10 outcomes.
          </p>
          <McProbabilityCard location={typeof fields.location === 'string' ? fields.location : null} parIrr={parIrr}
            dealName={fields.deal_name?.trim() || undefined} />
          <MarketPathCard location={typeof fields.location === 'string' ? fields.location : null} />
        </div>
      </details>
    </>
  )
}

// ================================================================== SPONSOR

const SPONSOR_CHECKS = ['sponsor_integrity', 'track_record', 'coinvest_min', 'completion_guarantee', 'gmp_required', 'single_exit_refi']

function sponsorCaption(c: CheckResult): string {
  const t = c.threshold?.effective ?? null
  const kind = c.kind === 'kill' ? 'hard kill' : 'watch flag'
  if (c.id === 'completion_guarantee' && t !== null) return `${kind} · guarantor net worth ≥ ${pct1(t)} of cost`
  if (c.id === 'gmp_required' && t !== null) return `${kind} · required on projects over ${fmtVal(c.id, t)}`
  if (c.id === 'track_record' && t !== null) return `${kind} · ≥ ${t} completed comparable project${t === 1 ? '' : 's'}`
  if (t !== null) return `${kind} · ${thresholdText(c.id, c.comparator, t)}`
  return kind
}

function SponsorTab({ fields, response }: Props) {
  const ck = new Map(response.result.checks.map(c => [c.id, c]))
  return (
    <>
      <Section title="A. Sponsor" note={fields.sponsor_name || 'sponsor not named in the documents'}>
        <Grid cols={3}>
          {SPONSOR_CHECKS.map(id => ck.get(id)).filter((c): c is CheckResult => !!c).map(c => (
            <Tile key={c.id} label={c.label} value={c.valueDisplay} status={c.status}
              caption={sponsorCaption(c)} />
          ))}
        </Grid>
      </Section>
      <div className="uw-foot">
        Gate 1 checks only what the offering documents say about the sponsor. The full due-diligence questionnaire,
        background and credit checks are Gate 2 — not part of this screen.
      </div>
    </>
  )
}

// =================================================================== ISSUES

function IssueList({ items, empty }: { items: Array<{ key: string; status: Status; title: string; detail: string }>; empty: string }) {
  if (!items.length) return <div className="uw-card uw-clean">✓ {empty}</div>
  return (
    <div className="uw-card uw-issues">
      {items.map(i => (
        <div className="uw-issue" key={i.key}>
          <Pill status={i.status} />
          <div><div className="uw-issue-title">{i.title}</div><div className="uw-issue-detail">{i.detail}</div></div>
        </div>
      ))}
    </div>
  )
}

function checkIssue(c: CheckResult) {
  const t = c.threshold ? ` (needs ${thresholdText(c.id, c.comparator, c.threshold.effective)})` : ''
  const miss = c.margin !== null ? ` — misses by ${fmtMargin(c.id, c.margin)}` : ''
  return { key: c.id, status: c.status, title: c.label, detail: `${c.valueDisplay}${t}${miss}` }
}

function IssuesTab({ response, extraction }: Props) {
  const checks = response.result.checks
  const kills = checks.filter(c => c.kind === 'kill' && c.status === 'fail').map(checkIssue)
  const flags = checks.filter(c => c.kind === 'flag' && c.status === 'flag').map(checkIssue)
  const missing = checks.filter(c => c.status === 'missing').map(c => ({
    key: c.id, status: c.status, title: c.label, detail: 'an input this check needs is missing — find it or ask the sponsor',
  }))
  return (
    <>
      <Section title="A. Hard kills tripped"><IssueList items={kills} empty="No hard kills" /></Section>
      <Section title="B. Watch flags tripped"><IssueList items={flags} empty="No watch flags" /></Section>
      <Section title="C. Missing inputs">
        <IssueList items={missing} empty="Every check had its inputs" />
      </Section>
      <Section title="D. OM vs pro forma">
        {extraction
          ? <ConsistencyPanel discrepancies={extraction.discrepancies ?? []} />
          : <div className="uw-card uw-muted">Entered by hand — no documents to cross-check.</div>}
      </Section>
      <Section title="E. Judgment adjustments">
        {response.adjustments.length ? (
          <div className="uw-card uw-issues">
            {response.adjustments.map(a => (
              <div className="uw-issue" key={a.key}>
                <Pill status="na" word="ADJUSTED" />
                <div><div className="uw-issue-title">{a.key} → {a.value}</div><div className="uw-issue-detail">“{a.reason}”</div></div>
              </div>
            ))}
          </div>
        ) : <div className="uw-card uw-clean">✓ Scored on the rulebook as written — no adjustments</div>}
      </Section>
    </>
  )
}

// ===================================================================== ROOT

export default function Underwriting(props: Props) {
  const [tab, setTab] = useState<Tab>('summary')
  const { response, extraction } = props
  const checks = response.result.checks
  const material = (extraction?.discrepancies ?? []).filter(d => d.severity === 'material').length
  const issueCount = checks.filter(c => c.status === 'fail' || c.status === 'flag' || c.status === 'missing').length + material
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'financials', label: 'Financials' },
    { id: 'market', label: 'Market' },
    { id: 'sponsor', label: 'Sponsor' },
    { id: 'issues', label: issueCount ? `Issues · ${issueCount}` : 'Issues' },
  ]
  return (
    <div className="uw-root">
      <style>{CSS}</style>
      <nav className="uw-tabs" role="tablist" aria-label="Underwriting sections">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`uw-tab${tab === t.id ? ' uw-tab-on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div role="tabpanel">
        {tab === 'summary' && <SummaryTab {...props} />}
        {tab === 'financials' && <FinancialsTab {...props} />}
        {tab === 'market' && <MarketTab {...props} />}
        {tab === 'sponsor' && <SponsorTab {...props} />}
        {tab === 'issues' && <IssuesTab {...props} />}
      </div>
    </div>
  )
}

const CSS = `
.uw-root{width:100%;max-width:1180px;margin:1rem auto 0;box-sizing:border-box}
.uw-tabs{display:flex;gap:.25rem;border-bottom:1px solid var(--border,#dcebe7);margin-bottom:.5rem;overflow-x:auto}
.cc-theme button.uw-tab,button.uw-tab{background:transparent;color:var(--muted,#5c6b67);border:none;border-bottom:2px solid transparent;border-radius:0;
  box-shadow:none;padding:.7rem 1rem;font-size:12px;letter-spacing:.08em;white-space:nowrap}
.cc-theme button.uw-tab:hover,button.uw-tab:hover{color:var(--text,#090e11);background:transparent}
.cc-theme button.uw-tab-on,button.uw-tab-on{color:var(--cc-deep,#3f7d69);border-bottom-color:var(--cc-deep,#3f7d69)}
.uw-sec{margin-top:1.6rem}
.uw-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.7rem}
.uw-sec-title{font-size:12px!important;letter-spacing:.1em;text-transform:uppercase;font-weight:600!important;margin:0;color:var(--text,#090e11)}
.uw-sec-note{font-size:.78rem;color:var(--muted,#5c6b67);display:inline-flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.uw-muted{color:var(--muted,#5c6b67);font-size:.85rem}
.uw-foot{font-size:.76rem;color:var(--muted,#5c6b67);margin-top:.7rem;line-height:1.5}
.uw-card{background:var(--surface,#fff);border:1px solid var(--border,#dcebe7);border-radius:10px;padding:1.25rem 1.5rem}
.uw-card-title{font-size:.85rem;font-weight:500;margin-bottom:.9rem}

/* One tile size, one grid — every tile on a row is the same height. */
.uw-grid{display:grid;gap:1rem}
.uw-g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.uw-g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.uw-tile{display:flex;flex-direction:column;min-height:118px;box-sizing:border-box;padding:1rem 1.15rem;background:var(--surface,#fff);
  border:1px solid var(--border,#dcebe7);border-top:3px solid var(--border,#dcebe7);border-radius:10px;min-width:0}
.uw-t-pass{border-top-color:var(--posture-green,#3f7d69)}
.uw-t-flag{border-top-color:var(--posture-yellow,#b8860b)}
.uw-t-fail,.uw-t-missing{border-top-color:var(--posture-red,#c2384a)}
.uw-tile-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;min-height:30px}
.uw-tile-label{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;min-width:0}
.uw-tile-value{font-weight:300;font-size:1.65rem;letter-spacing:-.01em;line-height:1.15;margin:.35rem 0 .3rem;font-variant-numeric:tabular-nums;
  overflow-wrap:anywhere}
.uw-t-pass .uw-tile-value{color:var(--success,#157f3c)}
.uw-t-flag .uw-tile-value{color:var(--warning,#b8860b)}
.uw-t-fail .uw-tile-value,.uw-t-missing .uw-tile-value{color:var(--danger,#c2384a)}
.uw-tile-foot{margin-top:auto;display:flex;flex-wrap:wrap;gap:.3rem .6rem;align-items:center}
.uw-tile-cap{font-size:.72rem;color:var(--muted,#5c6b67);line-height:1.35}

.uw-pill{flex-shrink:0;display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.08em;padding:2px 7px;border-radius:4px;line-height:1.5}
.uw-pill-pass{background:#e4f5ee;color:#2f6b57}
.uw-pill-flag{background:#fbf3df;color:#8a6508}
.uw-pill-fail{background:#fbecef;color:#a52c3d}
.uw-pill-missing{background:#fff;color:#a52c3d;border:1px solid #c2384a;padding:1px 6px}
.uw-pill-na{background:#f1f3f3;color:#5c6b67}
.uw-src{font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:1px 6px;border-radius:4px;border:1px solid currentColor;line-height:1.5}
.uw-src-sourced{color:#3f7d69}
.uw-src-edited{color:#5c6b67}
.uw-src-entered{color:#9c9c9c}
.uw-src-check{color:#b8860b}

/* Scenario strip */
.uw-scen{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.uw-scen-card{display:flex;flex-direction:column;align-items:flex-start;gap:.6rem;min-height:170px;box-sizing:border-box;padding:1.1rem 1.25rem;
  background:var(--surface,#fff);border:1px solid var(--border,#dcebe7);border-radius:10px;border-left:4px solid var(--border,#dcebe7)}
.uw-scen-green{border-left-color:var(--posture-green,#3f7d69)}
.uw-scen-yellow{border-left-color:var(--posture-yellow,#b8860b)}
.uw-scen-red{border-left-color:var(--posture-red,#c2384a)}
.uw-scen-today{box-shadow:0 0 0 2px rgba(63,125,105,.25)}
.uw-scen-head{display:flex;align-items:center;gap:.6rem;width:100%}
.uw-today{font-size:9.5px;font-weight:700;letter-spacing:.08em;color:#fff;background:var(--cc-deep,#3f7d69);border-radius:4px;padding:1px 6px;margin-left:.4rem}
.uw-scen-counts{font-size:.78rem;color:var(--muted,#5c6b67);font-variant-numeric:tabular-nums}
.uw-scen-diff{font-size:.74rem;color:var(--muted,#5c6b67);margin-top:auto;line-height:1.4}

/* Check matrix — scrolls sideways on narrow screens, never the page. */
.uw-mx-wrap{overflow-x:auto;background:var(--surface,#fff);border:1px solid var(--border,#dcebe7);border-radius:10px}
.uw-mx{width:100%;border-collapse:collapse;font-size:.8rem;min-width:860px}
.uw-mx th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600;text-align:left;
  padding:.7rem .75rem;border-bottom:1px solid var(--border,#dcebe7);white-space:nowrap}
.uw-mx td{padding:.55rem .75rem;border-top:1px solid #eef4f2;vertical-align:middle}
.uw-mx-group td{background:var(--surface-2,#f5fbfa);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;padding:.45rem .75rem}
.uw-mx-name{width:22%;font-weight:500}
.uw-mx-val{font-variant-numeric:tabular-nums;width:16%}
.uw-mx-cell{width:13%;font-variant-numeric:tabular-nums;line-height:1.3}
.uw-mx-cell b{display:block;font-size:10px;letter-spacing:.08em}
.uw-mx-cell span{display:block;font-size:.72rem;color:var(--muted,#5c6b67)}
.uw-mx-cell .uw-mx-m{color:inherit}
.uw-c-pass{background:#f1faf6;color:#2f6b57}
.uw-c-flag{background:#fdf8ea;color:#8a6508}
.uw-c-fail{background:#fdf1f3;color:#a52c3d}
.uw-c-missing{background:#fff;color:#a52c3d}
.uw-c-na{color:#9c9c9c}
th.uw-mx-today{color:var(--cc-deep,#3f7d69)}
td.uw-mx-today{box-shadow:inset 2px 0 0 var(--cc-deep,#3f7d69),inset -2px 0 0 var(--cc-deep,#3f7d69)}
.uw-pdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}
.uw-pdot-green{background:var(--posture-green,#3f7d69)}
.uw-pdot-yellow{background:var(--posture-yellow,#b8860b)}
.uw-pdot-red{background:var(--posture-red,#c2384a)}
.uw-prov{font-size:9px;letter-spacing:.06em;color:#b8860b;border:1px solid #f0e0b0;background:#fbf3df;border-radius:4px;padding:0 4px;margin-left:4px}
.uw-mx-cush{font-size:.74rem;width:16%}
.uw-k-pass{color:#2f6b57}
.uw-k-flag{color:#8a6508}
.uw-k-fail,.uw-k-missing{color:#a52c3d}
.uw-k-na{color:#9c9c9c}
.uw-mx-adj{width:1%;white-space:nowrap}
.cc-theme button.uw-adjust,button.uw-adjust{font-size:10px;letter-spacing:.06em;padding:.2rem .5rem;background:transparent;color:#3f7d69;border:none;
  text-decoration:underline;box-shadow:none}

/* Capital cards */
.uw-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.uw-cap{display:flex;flex-direction:column}
.uw-cap-body{display:flex;align-items:center;gap:1.25rem}
.uw-donut{width:120px;height:120px;flex-shrink:0}
.uw-legend{flex:1;min-width:0;font-size:.82rem}
.uw-leg-row{display:grid;grid-template-columns:12px minmax(0,1fr) 3rem auto;gap:.5rem;align-items:center;padding:.28rem 0;font-variant-numeric:tabular-nums}
.uw-leg-dot{width:10px;height:10px;border-radius:2px}
.uw-leg-pct{color:var(--muted,#5c6b67);text-align:right}
.uw-leg-val{text-align:right}
.uw-leg-total{border-top:1px solid var(--border,#dcebe7);margin-top:.2rem;padding-top:.45rem;font-weight:500}
.uw-cap-note{font-size:.72rem;color:var(--muted,#5c6b67);margin-top:auto;padding-top:.8rem}

/* Timeline + bar rows */
.uw-tl-row,.uw-bar-row{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr) 5.5rem;gap:1rem;align-items:center;padding:.35rem 0;font-size:.82rem}
.uw-tl-label,.uw-bar-label{color:var(--muted,#5c6b67);text-align:right}
.uw-tl-track,.uw-bar-track{position:relative;height:14px;background:var(--surface-2,#f5fbfa);border-radius:4px}
.uw-tl-bar{position:absolute;top:0;bottom:0;border-radius:4px}
.uw-bar-build{background:#63cda9}
.uw-bar-lease{background:#3f7d69}
.uw-bar-ref{background:repeating-linear-gradient(45deg,#c2c8d2 0 4px,#e3e7ec 4px 8px)}
.uw-bar-reserve{background:#b8860b;opacity:.7}
.uw-tl-range,.uw-bar-val{font-variant-numeric:tabular-nums;text-align:right}
.uw-tl-axis{padding-top:0}
.uw-tl-ticks{background:transparent;display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted,#5c6b67);height:auto}
.uw-bar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:#9cb8ae}
.uw-fill-deal{background:#b8860b}

/* Issues */
.uw-issues{display:flex;flex-direction:column;gap:.75rem;padding:1rem 1.5rem}
.uw-issue{display:flex;gap:.8rem;align-items:flex-start}
.uw-issue .uw-pill{min-width:64px;text-align:center;margin-top:2px}
.uw-issue-title{font-size:.88rem;font-weight:500}
.uw-issue-detail{font-size:.78rem;color:var(--muted,#5c6b67)}
.uw-clean{color:var(--cc-deep,#3f7d69);font-size:.85rem}

/* Advanced market context */
.uw-adv{margin-top:1.6rem;border:1px dashed var(--border,#dcebe7);border-radius:10px;padding:.8rem 1.1rem;background:var(--surface,#fff)}
.uw-adv summary{cursor:pointer;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--muted,#5c6b67)}
.uw-adv-body p{font-size:.84rem;color:var(--muted,#5c6b67);line-height:1.55}

@media(max-width:980px){
  .uw-g4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .uw-scen,.uw-g3{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:720px){
  .uw-scen,.uw-g3,.uw-two{grid-template-columns:minmax(0,1fr)}
  .uw-scen-card{min-height:0}
  .uw-cap-body{flex-direction:column;align-items:stretch}
  .uw-donut{align-self:center}
  .uw-tl-row,.uw-bar-row{grid-template-columns:minmax(0,1fr) 4.5rem;gap:.3rem .75rem}
  .uw-tl-label,.uw-bar-label{grid-column:1 / -1;text-align:left}
}
@media(max-width:480px){.uw-g4{grid-template-columns:minmax(0,1fr)}}
`
