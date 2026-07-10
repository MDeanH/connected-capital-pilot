// Recorded extraction of the client's sample deal documents:
//   Faithful_Trails_RV_Estates_OM_v2.pdf  +  Okeechobee 22 acre RV Pro Forma 190 units v18.xlsx
// This is what /api/extract returns for those documents — captured so the full
// ingest flow can be demoed without an API key. Values are the documents' own;
// fields the documents do NOT state are null (extraction never guesses) and the
// analyst supplies them at review. Clearly labeled `recorded: true` in the UI.
import type { ExtractionResult } from '../netlify/functions/lib/gate1/fields'

export const SAMPLE_EXTRACTION: ExtractionResult = {
  recorded: true,
  model: 'claude-opus-4-8',
  fields: {
    deal_name: { value: 'Faithful Trails RV Estates', confidence: 0.99, source: { doc: 'om', page: 1, quote: 'Faithful Trails RV Estates' } },
    asset_class: { value: 'rv_specialty', confidence: 0.95, source: { doc: 'om', page: 3, quote: '190-pad Class-A RV / park-home community on 22 acres' } },
    location: { value: 'Okeechobee, FL', confidence: 0.98, source: { doc: 'om', page: 3, quote: 'fronting US-441 across from Lake Okeechobee, Okeechobee, Florida' } },
    sponsor_name: { value: 'DB Fortune Investments, LLC', confidence: 0.97, source: { doc: 'om', page: 24, quote: 'Sponsor: DB Fortune Investments, LLC — David Deka and Barry Schwarzberg' } },
    sponsor_integrity_clear: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    site_fully_entitled: { value: false, confidence: 0.85, source: { doc: 'proforma', page: null, quote: 'Zoning approval — identified as the major risk item; site currently unentitled' } },
    sponsor_completed_comparables: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    sponsor_coinvest_pct: { value: 0.018, confidence: 0.92, source: { doc: 'om', page: 7, quote: 'Sponsor co-investment $200,000 (1.8% of total equity)' } },
    total_project_cost: { value: 10921964, confidence: 0.98, source: { doc: 'om', page: 7, quote: 'Total project cost $10,921,964 (~$61.7K per pad)' } },
    hard_costs: { value: 8500000, confidence: 0.55, source: { doc: 'proforma', page: null, quote: 'Land development budget $10,136,964 incl. soft costs — hard-cost subset ≈ $8.5M (septic $1.31M, clubhouse $780K, per-site electric $475K…)' } },
    land_cost: { value: 785000, confidence: 0.95, source: { doc: 'proforma', page: null, quote: 'Land acquisition $785,000' } },
    hard_cost_contingency_pct: { value: 0.03, confidence: 0.8, source: { doc: 'proforma', page: null, quote: 'Contingency (3% of hard costs)' } },
    construction_loan: { value: 6290000, confidence: 0.85, source: { doc: 'proforma', page: null, quote: 'Levered case: $6,290,000 construction-to-perm loan, 6.5% fixed, 25-yr amortization' } },
    total_equity: { value: 4630000, confidence: 0.7, source: { doc: 'proforma', page: null, quote: 'Levered case equity: $4,430,000 LP + $200,000 sponsor' } },
    stabilized_noi_untrended: { value: 1472158, confidence: 0.9, source: { doc: 'proforma', page: null, quote: 'Year-2 (stabilized) NOI $1,472,158' } },
    exit_cap_rate: { value: 0.07, confidence: 0.95, source: { doc: 'om', page: 6, quote: 'Exit at a 7.0% capitalization rate in Year 10' } },
    market_cap_rate_today: { value: 0.065, confidence: 0.55, source: { doc: 'om', page: 16, quote: 'FL RV-park sales comps: 5.5%–7.6% cap rates' } },
    assumed_rent_monthly: { value: 1175, confidence: 0.95, source: { doc: 'om', page: 6, quote: 'Blended average rent $1,175 per month per pad' } },
    market_comp_rent_monthly: { value: 950, confidence: 0.5, source: { doc: 'om', page: 15, quote: 'Local monthly-rate comps predominantly $375–$1,100 (Okeechobee KOA and Taylor Creek higher)' } },
    interest_reserve_months: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    construction_duration_months: { value: 10, confidence: 0.85, source: { doc: 'om', page: 22, quote: '~8 months pre-development, ~10 months construction, certificate of occupancy at ~18 months' } },
    lease_up_months_assumed: { value: 13, confidence: 0.85, source: { doc: 'proforma', page: null, quote: 'Cash-flow model assumes 90% occupancy from month 13' } },
    submarket_leaseup_months: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    exit_dependent_single_refi: { value: false, confidence: 0.7, source: { doc: 'om', page: 6, quote: '10+ year Opportunity Zone hold; exit modeled as a Year-10 sale' } },
    has_gmp_or_bonded_gc: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    has_completion_guarantee: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    guarantor_net_worth: { value: null, confidence: 0, source: { doc: null, page: null, quote: null } },
    projected_irr: { value: 0.177, confidence: 0.95, source: { doc: 'om', page: 5, quote: '17.7% unlevered project IRR' } },
    projected_equity_multiple: { value: 3.07, confidence: 0.95, source: { doc: 'om', page: 5, quote: '3.07x LP equity multiple over a 10-year hold' } },
  },
  discrepancies: [
    {
      topic: 'Stabilized NOI',
      om_value: '$1,546,572 (Project Summary)',
      proforma_value: '$1,472,158 (Year-2 cash flow)',
      severity: 'material',
      note: 'The OM summary and the pro forma disagree by ~$74K/yr — at the 7% exit cap that is ~$1.06M of exit value.',
    },
    {
      topic: 'Pad count',
      om_value: '190 pads throughout',
      proforma_value: '190 pads on most sheets, 177 on others',
      severity: 'material',
      note: 'The pro forma is internally inconsistent about the unit count the revenue model is built on.',
    },
    {
      topic: 'Stabilization timeline',
      om_value: '~30 months to stabilization (narrative)',
      proforma_value: '90% occupancy at month 13 (cash flow) vs ~6.5 years (Development Timeline sheet)',
      severity: 'material',
      note: 'Three different stabilization stories; the returns are computed on the fastest one. The timeline sheet itself notes the 18-month construction period is not modeled in the cash flows.',
    },
    {
      topic: 'Year-1 NOI',
      om_value: '$577,729 (monthly lease-up model)',
      proforma_value: '$487,700 (10-year annual model)',
      severity: 'material',
      note: 'The two models inside the workbook disagree about the first year.',
    },
    {
      topic: 'Capital structure',
      om_value: '100% equity — no debt shown',
      proforma_value: 'Levered case: $6.29M construction-to-perm loan',
      severity: 'minor',
      note: 'Both cases are presented, but the OM leads investors with the unlevered story while the model carries debt.',
    },
    {
      topic: 'Underwritten rent vs own comps',
      om_value: '$1,175/mo assumed',
      proforma_value: 'Own comp table: mostly $375–$1,100/mo',
      severity: 'material',
      note: 'The assumed rent sits above nearly every comp the sponsor themselves lists.',
    },
  ],
}
