// xlsx is loaded on demand (dynamic import) so it stays out of the entry
// bundle — it's only needed when the user uploads a file or grabs the template.
// A fetch failure here is a network/deploy problem, not a bad spreadsheet —
// say so instead of letting "Failed to fetch module" blame the user's file.
async function loadXlsx() {
  try {
    return await import('xlsx')
  } catch {
    throw new Error('the spreadsheet library could not be downloaded — check your connection and try again (reloading the page may help).')
  }
}

// Shapes match the App's Opportunity / PastDeal interfaces (structural typing).
export interface UploadedPastDeal {
  id: string
  sub_type: string
  sponsor_exits: number
  ltv: number
  execution_risk: string
  realized_irr: number
  outcome_label: string
}

export interface UploadedOpportunity {
  id: string
  name: string
  sub_type: 'Development' | 'Value-Add'
  sponsor_exits: number
  ltv: number
  execution_risk: 'Low' | 'Medium' | 'High'
  rate_environment: 'low' | 'elevated'
  projected_gross_irr?: number
  notes?: string
}

export interface ParseResult {
  pastDeals: UploadedPastDeal[]
  opportunities: UploadedOpportunity[]
  warnings: string[]
  sheetsRead: string[]
}

// Canonical column names per kind; keys are normalized headers from the sheet.
const HEADER_ALIASES: Record<string, string> = {
  id: 'id', deal_id: 'id', deal: 'id',
  name: 'name', deal_name: 'name', opportunity: 'name', opportunity_name: 'name', project: 'name',
  sub_type: 'sub_type', type: 'sub_type', deal_type: 'sub_type', strategy: 'sub_type',
  sponsor_exits: 'sponsor_exits', exits: 'sponsor_exits', sponsor_exits_last_10_yrs: 'sponsor_exits', track_record_exits: 'sponsor_exits',
  ltv: 'ltv', peak_ltv: 'ltv', loan_to_value: 'ltv', ltv_pct: 'ltv',
  execution_risk: 'execution_risk', risk: 'execution_risk', exec_risk: 'execution_risk',
  realized_irr: 'realized_irr', realized_return: 'realized_irr', realized_irr_pct: 'realized_irr',
  outcome_label: 'outcome_label', outcome: 'outcome_label', result: 'outcome_label',
  rate_environment: 'rate_environment', rate_env: 'rate_environment',
  projected_gross_irr: 'projected_gross_irr', projected_irr: 'projected_gross_irr', gross_irr: 'projected_gross_irr', target_irr: 'projected_gross_irr',
  notes: 'notes', comments: 'notes', qualitative_notes: 'notes',
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Returns a fraction: "19%", 19, "19" all become 0.19; 0.19 stays 0.19.
function toFraction(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  let n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%,$\s]/g, ''))
  if (!isFinite(n)) return undefined
  if (Math.abs(n) > 1.5) n = n / 100
  return n
}

function toInt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''))
  return isFinite(n) ? Math.round(n) : undefined
}

function normSubType(v: unknown): 'Development' | 'Value-Add' {
  const s = String(v ?? '').toLowerCase()
  if (s.includes('dev')) return 'Development'
  return 'Value-Add'
}

function normRisk(v: unknown): 'Low' | 'Medium' | 'High' {
  const s = String(v ?? '').toLowerCase()
  if (s.startsWith('l')) return 'Low'
  if (s.startsWith('h')) return 'High'
  return 'Medium'
}

function normRateEnv(v: unknown): 'low' | 'elevated' {
  return String(v ?? '').toLowerCase().includes('low') ? 'low' : 'elevated'
}

type Row = Record<string, unknown>

// Remap raw sheet rows to canonical keys. `irrTarget` resolves the ambiguous
// bare "IRR" header: realized_irr on a past-deals sheet, projected on opportunities.
function canonicalizeRows(rows: Row[], irrTarget: 'realized_irr' | 'projected_gross_irr'): Row[] {
  return rows.map(raw => {
    const out: Row = {}
    for (const [k, v] of Object.entries(raw)) {
      const norm = normalizeHeader(k)
      const canonical = norm === 'irr' ? irrTarget : HEADER_ALIASES[norm]
      if (canonical && out[canonical] === undefined) out[canonical] = v
    }
    return out
  })
}

function sheetKind(name: string, headers: string[]): 'past' | 'opps' | 'unknown' {
  const n = name.toLowerCase()
  if (/past|hist|realized|track/.test(n)) return 'past'
  if (/opp|pipeline|current|prospect|deal/.test(n)) return 'opps'
  if (headers.includes('realized_irr') || headers.includes('outcome_label')) return 'past'
  if (headers.includes('name') || headers.includes('projected_gross_irr') || headers.includes('rate_environment')) return 'opps'
  return 'unknown'
}

export async function parseWorkbook(data: ArrayBuffer): Promise<ParseResult> {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(data, { type: 'array' })
  const result: ParseResult = { pastDeals: [], opportunities: [], warnings: [], sheetsRead: [] }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Row>(ws, { defval: '' })
    if (rawRows.length === 0) continue

    const headers = Object.keys(rawRows[0]).map(normalizeHeader).map(h => HEADER_ALIASES[h] ?? h)
    const kind = sheetKind(sheetName, headers)
    if (kind === 'unknown') {
      result.warnings.push(`Sheet "${sheetName}" skipped — couldn't recognize its columns. Use the template headers.`)
      continue
    }
    result.sheetsRead.push(sheetName)

    if (kind === 'past') {
      const rows = canonicalizeRows(rawRows, 'realized_irr')
      rows.forEach((r, i) => {
        const irr = toFraction(r.realized_irr)
        if (irr === undefined) {
          result.warnings.push(`"${sheetName}" row ${i + 2}: missing/invalid Realized IRR — row skipped.`)
          return
        }
        result.pastDeals.push({
          id: String(r.id || `past_${result.pastDeals.length + 1}`),
          sub_type: normSubType(r.sub_type),
          sponsor_exits: toInt(r.sponsor_exits) ?? 2,
          ltv: toFraction(r.ltv) ?? 0.65,
          execution_risk: normRisk(r.execution_risk),
          realized_irr: irr,
          outcome_label: String(r.outcome_label || (irr >= 0.15 ? 'hit_target' : 'missed')),
        })
      })
    } else {
      const rows = canonicalizeRows(rawRows, 'projected_gross_irr')
      rows.forEach((r, i) => {
        const name = String(r.name || '').trim()
        const hasAnything = name || r.ltv !== '' || r.sponsor_exits !== ''
        if (!hasAnything) return
        if (!name) {
          result.warnings.push(`"${sheetName}" row ${i + 2}: missing deal Name — row skipped.`)
          return
        }
        result.opportunities.push({
          id: String(r.id || `upload_${Date.now()}_${i}`),
          name,
          sub_type: normSubType(r.sub_type),
          sponsor_exits: toInt(r.sponsor_exits) ?? 2,
          ltv: toFraction(r.ltv) ?? 0.65,
          execution_risk: normRisk(r.execution_risk),
          rate_environment: normRateEnv(r.rate_environment || 'elevated'),
          projected_gross_irr: toFraction(r.projected_gross_irr),
          notes: String(r.notes || '') || undefined,
        })
      })
    }
  }

  if (result.sheetsRead.length === 0) {
    result.warnings.push('No usable sheets found. Download the template to see the expected format.')
  }
  if (result.pastDeals.length > 0 && result.pastDeals.length < 3) {
    result.warnings.push(`Only ${result.pastDeals.length} past deal(s) with realized IRRs — at least 3 are needed for the de-smoothing step, so the model will fall back to its default return history until you add more.`)
  }
  return result
}

export async function downloadTemplate() {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  const past = XLSX.utils.aoa_to_sheet([
    ['id', 'sub_type', 'sponsor_exits', 'ltv', 'execution_risk', 'realized_irr', 'outcome_label'],
    ['past_001', 'Value-Add', 5, 0.62, 'Medium', 0.19, 'hit_target'],
    ['past_002', 'Development', 1, 0.78, 'High', 0.08, 'missed'],
    ['past_003', 'Value-Add', 7, 0.55, 'Low', 0.27, 'hit_target'],
  ])
  const opps = XLSX.utils.aoa_to_sheet([
    ['name', 'sub_type', 'sponsor_exits', 'ltv', 'execution_risk', 'rate_environment', 'projected_gross_irr', 'notes'],
    ['Downtown Core Dev', 'Development', 3, 0.72, 'High', 'elevated', 0.24, 'Strong location but heavy lift on entitlements'],
    ['Suburban Value-Add Portfolio', 'Value-Add', 6, 0.58, 'Medium', 'elevated', 0.18, 'Stabilized assets, light reno, good cash flow'],
  ])
  past['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 14 }]
  opps['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 13 }, { wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, past, 'Past Deals')
  XLSX.utils.book_append_sheet(wb, opps, 'Opportunities')
  XLSX.writeFile(wb, 'diligence-data-template.xlsx')
}

/**
 * Deal-document ingest: convert an uploaded pro forma workbook to per-sheet CSV
 * text for the AI extraction endpoint. Parsing happens entirely in the browser —
 * only CSV text leaves the machine. Sheets are capped so a huge workbook can't
 * blow past the sync-function body limit.
 */
export async function workbookToCsvText(data: ArrayBuffer): Promise<{ sheets: Array<{ name: string; csv: string }> }> {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(data, { type: 'array' })
  const MAX_SHEET_CHARS = 60_000
  const sheets: Array<{ name: string; csv: string }> = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    let csv = XLSX.utils.sheet_to_csv(ws)
    // Drop rows that are only commas/whitespace, then skip empty sheets.
    csv = csv.split('\n').filter(line => line.replace(/[,\s]/g, '') !== '').join('\n')
    if (!csv) continue
    if (csv.length > MAX_SHEET_CHARS) csv = csv.slice(0, MAX_SHEET_CHARS) + '\n…[truncated]'
    sheets.push({ name, csv })
  }
  return { sheets }
}

// ---------------------------------------------------------------------------
// Back-testing: Patel's past deals in, Gate 1 verdicts vs realized outcomes out.
// ---------------------------------------------------------------------------

/** One historical deal: Gate 1 inputs plus what actually happened. */
export interface BacktestRow {
  fields: Record<string, string | number | boolean | null>
  realized_irr: number | null
  realized_equity_multiple: number | null
  outcome_notes: string | null
}

/** Column order for the template and the parser (field key = header row 2). */
export const BACKTEST_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'deal_name', label: 'Deal name' },
  { key: 'asset_class', label: 'Asset class (rv_specialty/multifamily/industrial/retail/office)' },
  { key: 'location', label: 'Location' },
  { key: 'sponsor_name', label: 'Sponsor' },
  { key: 'sponsor_integrity_clear', label: 'Sponsor integrity clear (yes/no)' },
  { key: 'site_fully_entitled', label: 'Site fully entitled (yes/no)' },
  { key: 'sponsor_completed_comparables', label: 'Comparable completed projects' },
  { key: 'sponsor_coinvest_pct', label: 'Sponsor co-invest (% of equity)' },
  { key: 'total_project_cost', label: 'Total project cost ($)' },
  { key: 'hard_costs', label: 'Hard costs ($)' },
  { key: 'land_cost', label: 'Land cost ($)' },
  { key: 'hard_cost_contingency_pct', label: 'Hard-cost contingency (%)' },
  { key: 'construction_loan', label: 'Construction loan ($, 0 if all-equity)' },
  { key: 'loan_interest_rate', label: 'Loan rate (%)' },
  { key: 'total_equity', label: 'Total equity ($)' },
  { key: 'stabilized_noi_untrended', label: 'Stabilized NOI untrended ($)' },
  { key: 'exit_cap_rate', label: 'Exit cap rate (%)' },
  { key: 'market_cap_rate_today', label: 'Market cap rate at the time (%)' },
  { key: 'assumed_rent_monthly', label: 'Assumed monthly rent ($)' },
  { key: 'market_comp_rent_monthly', label: 'Market comp monthly rent ($)' },
  { key: 'interest_reserve_months', label: 'Interest reserve (months)' },
  { key: 'construction_duration_months', label: 'Construction duration (months)' },
  { key: 'lease_up_months_assumed', label: 'Assumed lease-up (months)' },
  { key: 'submarket_leaseup_months', label: 'Submarket lease-up record (months)' },
  { key: 'exit_dependent_single_refi', label: 'Exit depends on a single refi (yes/no)' },
  { key: 'has_gmp_or_bonded_gc', label: 'GMP contract / bonded GC (yes/no)' },
  { key: 'has_completion_guarantee', label: 'Completion guarantee (yes/no)' },
  { key: 'guarantor_net_worth', label: 'Guarantor net worth ($)' },
  { key: 'projected_irr', label: 'Projected IRR at underwriting (%)' },
  { key: 'projected_equity_multiple', label: 'Projected equity multiple at underwriting' },
  { key: 'realized_irr', label: 'REALIZED IRR (%)' },
  { key: 'realized_equity_multiple', label: 'REALIZED equity multiple' },
  { key: 'outcome_notes', label: 'Outcome notes' },
]

const PCT_KEYS = new Set([
  'sponsor_coinvest_pct', 'hard_cost_contingency_pct', 'loan_interest_rate',
  'exit_cap_rate', 'market_cap_rate_today', 'projected_irr', 'realized_irr',
])
const BOOL_KEYS = new Set([
  'sponsor_integrity_clear', 'site_fully_entitled', 'exit_dependent_single_refi',
  'has_gmp_or_bonded_gc', 'has_completion_guarantee',
])

function coerceBacktestCell(key: string, v: unknown): string | number | boolean | null {
  if (v === undefined || v === null || v === '') return null
  if (BOOL_KEYS.has(key)) {
    const s = String(v).trim().toLowerCase()
    if (['yes', 'y', 'true', '1'].includes(s)) return true
    if (['no', 'n', 'false', '0'].includes(s)) return false
    return null
  }
  if (typeof v === 'boolean') return v
  const n = Number(String(v).replace(/[$,%\s]/g, ''))
  if (Number.isFinite(n)) {
    // Percent columns accept either 5 (meaning 5%) or 0.05 — normalize to decimal.
    if (PCT_KEYS.has(key)) return n > 1 ? n / 100 : n
    return n
  }
  return String(v)
}

/**
 * Parse a backtest workbook: row 1 = human labels, row 2+ = deals. Columns are
 * matched by the machine key embedded in the template's second header row, or
 * by exact key names if the user built their own sheet.
 */
export async function parseBacktestWorkbook(data: ArrayBuffer): Promise<{ rows: BacktestRow[]; warnings: string[] }> {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('The workbook has no sheets')
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  if (aoa.length < 2) throw new Error('No deal rows found (need a header row plus at least one deal)')

  // Find the header row containing machine keys (template row 2), else assume row 1 holds keys.
  const knownKeys = new Set(BACKTEST_COLUMNS.map(c => c.key))
  let headerIdx = aoa.findIndex(r => r.filter(c => knownKeys.has(String(c ?? '').trim())).length >= 5)
  if (headerIdx === -1) throw new Error('Could not find the header row — download the template and paste your deals into it')
  const headers = aoa[headerIdx].map(h => String(h ?? '').trim())

  const warnings: string[] = []
  const rows: BacktestRow[] = []
  for (const raw of aoa.slice(headerIdx + 1)) {
    if (raw.every(c => c === null || c === '')) continue
    const rec: Record<string, string | number | boolean | null> = {}
    headers.forEach((h, i) => {
      if (knownKeys.has(h)) rec[h] = coerceBacktestCell(h, raw[i])
    })
    if (!rec.deal_name) continue
    const { realized_irr = null, realized_equity_multiple = null, outcome_notes = null, ...fields } = rec
    rows.push({
      fields,
      realized_irr: realized_irr as number | null,
      realized_equity_multiple: realized_equity_multiple as number | null,
      outcome_notes: outcome_notes === null ? null : String(outcome_notes),
    })
  }
  if (!rows.length) throw new Error('No deal rows found under the header')
  if (rows.length > 100) {
    warnings.push(`Capped at 100 deals (${rows.length} provided)`)
    rows.length = 100
  }
  return { rows, warnings }
}

/** Two header rows: human label + machine key, plus two fictional example deals. */
export async function downloadBacktestTemplate() {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  const labels = BACKTEST_COLUMNS.map(c => c.label)
  const keys = BACKTEST_COLUMNS.map(c => c.key)
  const example1: Record<string, unknown> = {
    deal_name: 'EXAMPLE — Pinewood Cottages (delete me)', asset_class: 'rv_specialty', location: 'Ocala, FL',
    sponsor_name: 'Fictional Sponsor A', sponsor_integrity_clear: 'yes', site_fully_entitled: 'yes',
    sponsor_completed_comparables: 3, sponsor_coinvest_pct: 8, total_project_cost: 9200000, hard_costs: 7100000,
    land_cost: 900000, hard_cost_contingency_pct: 6, construction_loan: 5000000, loan_interest_rate: 6.0,
    total_equity: 4200000, stabilized_noi_untrended: 1150000, exit_cap_rate: 7.5, market_cap_rate_today: 7.0,
    assumed_rent_monthly: 850, market_comp_rent_monthly: 825, interest_reserve_months: 20,
    construction_duration_months: 11, lease_up_months_assumed: 20, submarket_leaseup_months: 18,
    exit_dependent_single_refi: 'no', has_gmp_or_bonded_gc: 'yes', has_completion_guarantee: 'yes',
    guarantor_net_worth: 2000000, projected_irr: 16, projected_equity_multiple: 2.1,
    realized_irr: 18.5, realized_equity_multiple: 2.3, outcome_notes: 'Sold year 6, above plan',
  }
  const example2: Record<string, unknown> = {
    ...example1, deal_name: 'EXAMPLE — Bayside Flats (delete me)', asset_class: 'multifamily',
    site_fully_entitled: 'no', hard_cost_contingency_pct: 3.5, sponsor_coinvest_pct: 2,
    projected_irr: 21, realized_irr: 4.2, realized_equity_multiple: 1.1,
    outcome_notes: 'Rezoning delays + overruns — barely returned capital',
  }
  const ws = XLSX.utils.aoa_to_sheet([labels, keys, keys.map(k => example1[k] ?? ''), keys.map(k => example2[k] ?? '')])
  ws['!cols'] = BACKTEST_COLUMNS.map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Past Deals')
  XLSX.writeFile(wb, 'connected-capital-backtest-template.xlsx')
}
