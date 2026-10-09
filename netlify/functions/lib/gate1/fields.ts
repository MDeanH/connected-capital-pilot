// Extraction field registry — the single source of truth for what the AI
// pulls out of uploaded deal documents. Pure data + schema builder (no node
// APIs) so both the Netlify function and the client can import it.
import type { DealFields } from './types'

export interface ExtractFieldDef {
  key: keyof DealFields
  label: string
  kind: 'string' | 'usd' | 'pct' | 'number' | 'boolean' | 'months'
  /** Extra guidance for the extractor about where/how this appears in deal docs. */
  hint?: string
}

export const EXTRACT_FIELDS: ExtractFieldDef[] = [
  { key: 'deal_name', label: 'Deal name', kind: 'string' },
  { key: 'asset_class', label: 'Asset class', kind: 'string', hint: "One of: rv_specialty, multifamily, industrial, retail, office. RV parks/resorts and campgrounds are 'rv_specialty'." },
  { key: 'location', label: 'Location (city, state)', kind: 'string' },
  { key: 'sponsor_name', label: 'Sponsor / GP entity', kind: 'string' },
  { key: 'sponsor_integrity_clear', label: 'Sponsor integrity clear', kind: 'boolean', hint: 'true ONLY if the documents affirmatively disclose no SEC/FINRA actions, felonies, or litigation. If the documents are silent, null.' },
  { key: 'site_fully_entitled', label: 'Site fully entitled', kind: 'boolean', hint: 'false if zoning/entitlement/permits are pending or listed as a risk; true only if approvals are documented as complete.' },
  { key: 'sponsor_completed_comparables', label: 'Comparable completed projects', kind: 'number', hint: 'Count of comparable projects the sponsor has completed, from the track-record/bio section.' },
  { key: 'sponsor_coinvest_pct', label: 'Sponsor co-invest share of equity', kind: 'pct', hint: 'Sponsor cash co-investment ÷ total equity.' },
  { key: 'total_project_cost', label: 'Total project cost', kind: 'usd' },
  { key: 'hard_costs', label: 'Hard construction costs', kind: 'usd', hint: 'Site work + vertical construction; exclude land, soft costs, financing.' },
  { key: 'land_cost', label: 'Land cost', kind: 'usd' },
  { key: 'hard_cost_contingency_pct', label: 'Hard-cost contingency %', kind: 'pct', hint: 'Contingency line ÷ hard costs.' },
  { key: 'construction_loan', label: 'Construction loan', kind: 'usd', hint: '0 if the deal is explicitly all-equity; use the levered case if both are shown and note the other in discrepancies if they conflict.' },
  { key: 'loan_interest_rate', label: 'Modeled loan interest rate', kind: 'pct', hint: 'The interest rate the pro forma assumes on the construction/perm loan.' },
  { key: 'total_equity', label: 'Total equity', kind: 'usd' },
  { key: 'stabilized_noi_untrended', label: 'Stabilized NOI (untrended)', kind: 'usd', hint: 'First stabilized-year NOI without growth trending.' },
  { key: 'exit_cap_rate', label: 'Exit cap rate', kind: 'pct' },
  { key: 'market_cap_rate_today', label: "Today's market cap rate", kind: 'pct', hint: 'From the sales-comps section if present.' },
  { key: 'assumed_rent_monthly', label: 'Assumed monthly rent/pad or unit', kind: 'usd' },
  { key: 'market_comp_rent_monthly', label: 'Market comp monthly rent', kind: 'usd', hint: 'Representative comp from the rent-comps table (monthly-rate comps, not daily).' },
  { key: 'interest_reserve_months', label: 'Interest reserve (months)', kind: 'months' },
  { key: 'construction_duration_months', label: 'Construction duration (months)', kind: 'months' },
  { key: 'lease_up_months_assumed', label: 'Months to stabilized occupancy (as modeled)', kind: 'months', hint: 'From the cash-flow model, not the marketing narrative — note a discrepancy if they disagree.' },
  { key: 'submarket_leaseup_months', label: 'Submarket lease-up record (months)', kind: 'months' },
  { key: 'exit_dependent_single_refi', label: 'Exit depends on a single cash-out refi', kind: 'boolean' },
  { key: 'has_gmp_or_bonded_gc', label: 'GMP contract or bonded GC', kind: 'boolean' },
  { key: 'has_completion_guarantee', label: 'Completion guarantee', kind: 'boolean' },
  { key: 'guarantor_net_worth', label: 'Guarantor net worth', kind: 'usd' },
  { key: 'projected_irr', label: 'Projected IRR (sponsor-reported)', kind: 'pct' },
  { key: 'projected_equity_multiple', label: 'Projected equity multiple (sponsor-reported)', kind: 'number' },
]

export interface ExtractedField {
  value: string | number | boolean | null
  confidence: number
  source: { doc: 'om' | 'proforma' | null; page: number | null; quote: string | null }
  /**
   * Set client-side when the analyst's review value no longer matches `value` —
   * the confidence/citation above describe the ORIGINAL extraction, not the
   * correction. Never produced by the extractor itself.
   */
  edited?: boolean
}

export interface Discrepancy {
  topic: string
  om_value: string
  proforma_value: string
  severity: 'minor' | 'material'
  note: string
}

export interface ExtractionResult {
  fields: Record<string, ExtractedField>
  discrepancies: Discrepancy[]
  model?: string
  recorded?: boolean
  /**
   * Audit-persistence outcome, set by the background worker on the served
   * 'done' record: 'stored' = the extraction row (model, citations,
   * discrepancies) landed in Supabase; 'failed' = that insert failed, so the
   * extracted values are usable but UNAUDITED and a decision recorded now won't
   * link to a stored extraction. Absent on db-null deploys (the field is
   * omitted) and on the recorded sample. Never produced by the extractor.
   */
  provenance?: 'stored' | 'failed'
  /**
   * Client-generated extraction id (crypto.randomUUID()), attached client-side
   * when the result is handed to the app so the decide call can link the
   * persisted extractions row to a deal. Never produced by the extractor and
   * absent on the recorded sample.
   */
  extractionId?: string
}

/**
 * JSON Schema for the structured extraction output.
 *
 * Two Anthropic structured-output limits shape this design:
 *  - union-typed parameters are capped → every value is a plain string
 *    ('' = not stated) plus enums; `coerceExtraction` converts to typed values
 *    deterministically from the field registry kinds;
 *  - the compiled grammar size is capped → fields are an ARRAY of entries with
 *    a keyed enum (one item definition) instead of ~30 named object properties,
 *    and per-field hints live in the prompt text, not schema descriptions.
 */
export function buildExtractionSchema() {
  return {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Exactly one entry per field key listed in the instructions',
        items: {
          type: 'object',
          properties: {
            key: { enum: EXTRACT_FIELDS.map(f => f.key) },
            value: {
              type: 'string',
              description: 'Plain text: "0.05" for 5%, "10921964" for dollars, "true"/"false" for yes-no; EMPTY when not stated — never guess',
            },
            confidence: { type: 'number' },
            doc: { enum: ['om', 'proforma', 'none'] },
            page: { type: 'integer' },
            quote: { type: 'string' },
          },
          required: ['key', 'value', 'confidence', 'doc', 'page', 'quote'],
          additionalProperties: false,
        },
      },
      discrepancies: {
        type: 'array',
        description: 'Every disagreement between the OM and the pro forma on the same economic fact',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            om_value: { type: 'string' },
            proforma_value: { type: 'string' },
            severity: { enum: ['minor', 'material'] },
            note: { type: 'string' },
          },
          required: ['topic', 'om_value', 'proforma_value', 'severity', 'note'],
          additionalProperties: false,
        },
      },
    },
    required: ['fields', 'discrepancies'],
    additionalProperties: false,
  } as const
}

/** Raw (string-typed) per-field entry the schema produces. */
export interface RawExtractedField {
  key: string
  value: string
  confidence: number
  doc: 'om' | 'proforma' | 'none'
  page: number
  quote: string
}

/** Deterministically convert the raw entry array to typed ExtractedFields. */
export function coerceExtraction(raw: {
  fields: RawExtractedField[]
  discrepancies: Discrepancy[]
}): Pick<ExtractionResult, 'fields' | 'discrepancies'> {
  const byKey = new Map((raw.fields ?? []).map(r => [r.key, r]))
  const fields: Record<string, ExtractedField> = {}
  for (const def of EXTRACT_FIELDS) {
    const r = byKey.get(def.key)
    let value: string | number | boolean | null = null
    const s = (r?.value ?? '').trim()
    if (s !== '') {
      if (def.kind === 'boolean') {
        value = /^(true|yes|y)$/i.test(s) ? true : /^(false|no|n)$/i.test(s) ? false : null
      } else if (def.kind === 'string') {
        value = s
      } else {
        const n = Number(s.replace(/[$,%\s]/g, ''))
        // A value the model echoes with an explicit '%' is in percent units —
        // convert to the decimal convention every downstream check expects
        // ('1.8%' -> 0.018, not 1.8, which would flip hard-kill comparisons).
        value = Number.isFinite(n) ? (s.includes('%') ? n / 100 : n) : null
      }
    }
    fields[def.key] = {
      value,
      confidence: value === null ? 0 : Math.max(0, Math.min(1, r?.confidence ?? 0)),
      source: {
        doc: !r || r.doc === 'none' ? null : r.doc,
        page: r && r.page > 0 ? r.page : null,
        quote: r?.quote?.trim() ? r.quote.trim().slice(0, 240) : null,
      },
    }
  }
  return { fields, discrepancies: raw.discrepancies ?? [] }
}

export function buildInstruction(): string {
  const lines = EXTRACT_FIELDS.map(f => `- ${f.key} (${f.kind}): ${f.label}${f.hint ? ` — ${f.hint}` : ''}`)
  return `You are a real-estate due-diligence analyst. Extract the fields below from the attached deal documents (an offering memorandum — a PDF, or plain text extracted from a Word/text file — and/or pro forma spreadsheet CSVs).

Rules:
- Return EXACTLY ONE fields entry per key listed below — all of them, in order.
- NEVER guess. If a field is not stated in the documents, set value to the EMPTY STRING and confidence to 0.
- Every value is plain text: percentages as decimal strings (5% → "0.05"), dollar amounts as plain number strings ("10921964"), months as plain numbers, yes/no as "true"/"false".
- For every non-empty field give confidence (0–1), the source document ('om' or 'proforma', 'none' when empty), the PDF page number (0 for spreadsheet, extracted-text OM, or none), and a short verbatim quote (≤200 chars) supporting the value.
- An OM supplied as extracted text has no page numbers: still cite doc 'om', set page to 0, and rely on the verbatim quote — exactly as for pro forma sheets.
- CRITICAL: compare the OM against the pro forma. List EVERY disagreement on the same economic fact (NOI, unit/pad count, rents, occupancy timeline/stabilization, costs, capital structure, returns) in 'discrepancies' with severity: 'material' when it changes the economics, 'minor' otherwise. Internal contradictions within one document count too (name the doc on both sides).

Fields:
${lines.join('\n')}`
}
