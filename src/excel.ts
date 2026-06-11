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
