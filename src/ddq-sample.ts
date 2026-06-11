import type { AnswerValue, CategoryId } from './ddq-schema'

// ============================================================================
// FICTIONAL sample DDQ profile — "Beacon Harbor Real Estate Partners".
//
// Every name, person, city, fund, and figure in this file is invented for
// demo purposes so the Institutional DDQ tab never starts from a blank form.
// Nothing here describes a real manager, and none of it derives from any
// client material. The profile is deliberately tuned to land a solid MID
// grade under the schema's autoScore() rules: mostly 3–4s, several 5s, a few
// honest 2s, and no hard-fail triggers — a credible second-quartile Sun Belt
// value-add multifamily shop with one resolved 2020 covenant waiver as its
// blemish.
// ============================================================================

export const SAMPLE_FIRM_NAME = 'Beacon Harbor Real Estate Partners (Fictional Sample)'

export const SAMPLE_ANSWERS: Record<string, AnswerValue> = {
  // ===== A.1 Firm Identification =====
  a1_name: SAMPLE_FIRM_NAME,
  a1_address: '4810 Crescent Quay Drive, Suite 900, Charlotte, NC (fictional address)',
  a1_offices: 'Dallas, TX and Tampa, FL (fictional satellite offices)',
  a1_founded: 2011, // → 3 (2011–2015 band)
  a1_structure: 'Delaware limited liability company; a separate Delaware LP general-partner entity is formed for each fund',
  a1_reg: 'SEC-registered investment adviser (fictional registration); no other licenses or exemptions claimed',
  a1_aum: 1200, // $1.2B → 2 ($0.5–2.5B band)
  a1_strategy_aum: 1050,
  a1_contact: 'Priya Raghavan (fictional person)',
  a1_contact_title: 'Managing Partner & Co-Founder',
  a1_contact_email: 'ir@beaconharbor.example · +1 (704) 555-0142',
  a1_website: 'www.beaconharbor.example',

  // ===== A.2 Ownership & Leadership =====
  a2_orgchart: 'Co-founders Daniel Whitfield (32%) and Priya Raghavan (28%) hold the GP alongside three partners at 8% each; the remaining 16% sits in a broad employee equity pool. There is no outside or passive ownership.',
  a2_single_control: false, // → 5
  a2_keyman_firm: 'Both co-founders are named key persons with firm-paid key-person life insurance, deal teams are cross-trained across markets, and investment authority rests with a five-member committee rather than any individual.',
  a2_changes: 'One partner-level departure since inception: the head of capital markets retired in 2022 on a pre-announced 18-month transition. Responsibilities were absorbed internally with no impact on performance or LP relationships.',
  a2_keyperson_events: 'None', // → 5
  a2_succession: 'No departures are planned in the next 24 months. A written succession plan names an internal successor for each co-founder, and partner equity vests over five years to retain the senior bench.',
  a2_governance: 'A five-member investment committee (both co-founders plus three partners) holds final investment authority. Four affirmative votes are required to approve a transaction; no single member can approve or veto a deal alone.',

  // ===== A.3 History & Track Record =====
  a3_history: 'Founded in 2011 to pursue value-add multifamily in growth Sun Belt metros, the firm has raised three funds and deliberately stayed in one lane. The most significant setback came in 2020, when two Houston assets required a lender covenant waiver during the pandemic; both loans were restored to compliance in 2021 without loss.',
  a3_fund_table: [
    ['Beacon Harbor Value Fund I (fictional)', '2013', '185', '185', '320', '0', '1.73', '1.73', '14.8'],
    ['Beacon Harbor Value Fund II (fictional)', '2017', '320', '320', '290', '215', '1.58', '0.91', '13.2'],
    ['Beacon Harbor Value Fund III (fictional)', '2021', '410', '328', '45', '352', '1.21', '0.14', '9.6'],
  ],
  a3_irr_quartile: 'Second quartile', // → 4
  a3_net_moic: 1.58, // Fund II → 4 (1.5–1.9x band)
  a3_retention: 62, // → 3 (50–75% band)
  a3_restated: 'No restatements ever', // → 5
  a3_distributions: 'One delayed — since paid in full', // → 3, no hard fail
  a3_extensions: 'Fund I exercised one of its two one-year extension options to complete final dispositions in an orderly market. All committed capital was deployed within each fund’s investment period and no capital has been returned early.',

  // ===== A.4 Team & Human Capital =====
  a4_roster: [
    ['Daniel Whitfield (fictional)', 'Managing Partner & Co-Founder', '14', '24', 'Regional REIT acquisitions group', 'IC chair; strategy & sourcing'],
    ['Priya Raghavan (fictional)', 'Managing Partner & Co-Founder', '14', '21', 'National brokerage capital markets desk', 'IC member; capital markets & IR'],
    ['Marcus Oyelaran (fictional)', 'Partner, Asset Management', '9', '18', 'Multifamily owner-operator', 'IC member; asset management'],
    ['Elena Castillo-Reyes (fictional)', 'Partner, Acquisitions', '8', '15', 'Private real estate fund manager', 'IC member; acquisitions'],
    ['Tom Brandvold (fictional)', 'CFO / CCO', '7', '19', 'Fund administration; public accounting', 'Finance, compliance & reporting'],
  ],
  a4_tenure: 8, // → 4 (7–10 yrs band)
  a4_attrition: 9, // → 3 (5–12% band)
  a4_comp: 'Salary plus annual bonus, with carried interest awarded from partner down to associate level on a five-year vesting schedule. Roughly 30% of carry sits below the founders, and the fund-level clawback applies to every carry recipient.',
  a4_carry_below: 30, // → 3 (25–35% band)
  a4_ops: 'Cloud-based portfolio accounting and investor reporting platform, third-party fund administration, annual penetration testing, and outsourced security monitoring. Property management is fully outsourced to vetted regional operators.',

  // ===== A.5 Legal, Compliance & Regulatory =====
  a5_ria: true, // → 5
  a5_reg_actions: 'None ever', // → 5, no hard fail
  a5_bankruptcy: 'None', // → 5
  a5_litigation: 'Disclosed and resolved', // → 4
  a5_aml: 'A written AML/KYC program is administered by the fund administrator with sanctions screening at subscription and quarterly thereafter. FCPA and anti-bribery policies and an annually certified code of ethics apply to all personnel.',
  a5_providers: [
    ['Fund counsel', 'Hartwell & Crane LLP (fictional)', 'Yes'],
    ['Auditor', 'Meridian Whitlock LLP (fictional)', 'Yes'],
    ['Administrator', 'Castlegate Fund Services (fictional)', 'Yes'],
    ['Tax', 'Meridian Whitlock LLP (fictional)', 'Yes'],
    ['Valuation agent', 'Clearspan Advisory (fictional)', 'Yes'],
    ['Placement agent', 'None engaged', '—'],
  ],
  a5_providers_indep: true, // → 5

  // ===== B.1 Key Terms Summary =====
  b1_fund_name: 'Beacon Harbor Multifamily Value Fund IV, L.P. (fictional)',
  b1_target: 450,
  b1_hardcap: 550,
  b1_commitments: 285,
  b1_first_close: 'March 2026 (actual — fictional)',
  b1_final_close: 'Q1 2027 (expected)',
  b1_fee_inv: 1.5, // → 4 (1.3–1.6% band)
  b1_fee_post: 1.25, // → 3 (1.0–1.5% band)
  b1_fee_basis: 'Committed during investment period, invested thereafter',
  b1_pref: 8, // → 5 (≥8%)
  b1_carry: 20, // → 5 (≤20%)
  b1_waterfall: 'Deal-by-deal with escrow & interim true-up', // → 3
  b1_inv_period: 4,
  b1_term: 8,
  b1_extensions: 'Two one-year extensions at GP discretion with LPAC consent',
  b1_min_lp: 5,
  b1_gp_usd: 9,
  b1_gp_pct: 2, // $9M of $450M → 4 (2–3% band)
  b1_gp_financed: false, // → 5
  b1_lpac: true, // → 5
  b1_coinvest: 'Offered pro rata to LPs committing $25M or more on deals exceeding fund concentration limits; no fee, no carry',
  b1_keyman: 'Suspension by LP vote', // → 3
  b1_nofault: 75,
  b1_recycling: 'Proceeds realized within 24 months of an investment may be recycled during the investment period, up to 110% of commitments',
  b1_domicile: 'Delaware, USA',
  b1_inv_domicile: 'Cayman feeder available for non-US and US tax-exempt investors; no blocker required for US taxable LPs',

  // ===== B.2 Fees, Conflicts & Economics =====
  b2_offsets_pct: 100, // → 5
  b2_offsets: '100% of any transaction, monitoring, or deal fees offset management fees. In practice the GP charges none, and no affiliate of the firm receives fee streams from portfolio properties.',
  b2_clawback: 'Fund-level clawback tested at each interim carry distribution and again at final liquidation, calculated pre-tax and supported by several guarantees from all carry recipients. Aggregate GP net worth comfortably exceeds the maximum potential clawback.',
  b2_escrow: 15, // → 4 (10–25% band)
  b2_clawback_gross: false, // pre-tax clawback → 5
  b2_conflicts: 'Principals may co-invest alongside the funds only on identical terms, with all such positions disclosed to the LPAC. The firm has no affiliated property manager, broker, or lender, and any future affiliate arrangement would require LPAC approval.',
  b2_sideletters: 'Limited — MFN, reporting & regulatory provisions only', // → 4

  // ===== C — Real Estate Development module =====
  c1_thesis: 'Development is a satellite sleeve capped at 20% of any fund: garden-style and mid-rise multifamily on infill sites in our existing Sun Belt metros, underwritten to a yield-on-cost premium of at least 125 bps over local stabilized cap rates.',
  c1_timeline: 'A typical project runs 30–36 months from land closing to stabilization. Our last five completed projects averaged 33 months, with one running six months long due to a utility hookup delay.',
  c1_entitlement: 'We buy fully entitled or by-right sites in roughly 80% of cases. On the remainder, our entitlement record is 8 of 9, with one suburban Atlanta rezoning withdrawn in 2019 after neighborhood opposition.',
  c1_preleasing: 'Projects are built speculative-to-lease, as is standard for rental multifamily, but construction starts only once financing is fully committed and hard costs are bought out under GMP contracts.',
  c2_gmp: true, // → 5
  c2_hard_contingency: 5, // → 3 (5–8% band)
  c2_soft_contingency: 2.5, // → 2 (1.5–3% band)
  c2_overruns: 3, // → 3 (3–5 of 10 band)
  c2_schedule: 'GC contracts carry liquidated damages beginning 60 days past the substantial-completion deadline, with milestone-based draw schedules. An in-house construction manager walks every active site monthly.',
  c2_major: 'One 2022 San Antonio project ran roughly 11% over budget on concrete and labor escalation. The overrun was absorbed by contingency plus a reduced development fee, with no additional capital call and no GC default.',
  c3_market: 'Markets are screened quarterly on job and population growth, supply pipeline as a share of existing stock, and absorption trends. We concentrate on submarkets where the projected three-year supply pipeline is below 4% of stock.',
  c3_leaseup: 'Lease-up rents are underwritten at or below today’s effective rents with no trending through the construction period, and lease-up pace is set to the trailing average of the three nearest competitive properties.',
  c3_uw_table: [
    ['Larkspur Bend (fictional — Dallas)', '62', '64', '$1,520/mo', '$1,575/mo', '16.0', '17.4'],
    ['Quarry Vista (fictional — San Antonio)', '48', '53', '$1,310/mo', '$1,295/mo', '15.5', '12.1'],
    ['Mosswood Landing (fictional — Tampa)', '71', '72', '$1,690/mo', '$1,740/mo', '16.5', '18.2'],
    ['Cedar Bluff Commons (fictional — Charlotte)', '55', '57', '$1,440/mo', '$1,455/mo', '15.0', '14.6'],
    ['Halverson Mill (fictional — Nashville)', '66', '69', '$1,580/mo', '$1,560/mo', '16.0', '13.9'],
  ],
  c3_cost_var: 4.6, // avg of the five projects above → 3 (3–7% band)
  c4_stack: 'The typical stack is 35% equity and 65% construction debt from regional banks at floating rates. We do not use mezzanine debt, preferred equity, or C-PACE in the development sleeve.',
  c4_ltc: 65, // → 3 (60–70% band)
  c4_loan_events: 'Never', // → 5 (the 2020 waiver was on acquired assets, see D.4)
  c4_hedge: 'Partially hedged', // → 3
  c5_exit: 'The base case is sale to core or core-plus buyers at stabilization, underwritten at exit cap rates 50 bps wide of today’s market. Recapitalization with a long-term lender is the fallback when sale pricing is soft.',
  c5_missed: 'Quarry Vista missed its projected exit price by about 9% in 2023 when rate volatility thinned the buyer pool. We refinanced, held for 18 additional months, and exited at a 12.1% project IRR versus 15.5% underwritten.',

  // ===== D — Real Estate Acquisition module =====
  d1_strategy: 'Value-add acquisitions of 1990s–2010s vintage garden and mid-rise multifamily across eight Sun Belt metros, creating value through unit renovations, operational upgrades, and expense control. Differentiation comes from deep submarket relationships and a repeatable renovation playbook.',
  d1_hold: 'Target hold is four to six years for value-add deals. We sell once the business plan is complete and the incremental return on remaining capital falls below our reinvestment hurdle, and consider recapitalization when debt markets are more attractive than sale markets.',
  d1_sourcing: 'Sourcing combines long-standing regional brokerage relationships, direct outreach to owners we track in target submarkets, and programmatic repeat business with three family-office sellers.',
  d1_offmarket: 40, // → 3 (25–50% band)
  d1_funnel: [
    ['Opportunities reviewed', '410'],
    ['Advanced to underwriting', '120'],
    ['LOIs submitted', '38'],
    ['PSAs signed', '11'],
    ['Closed', '8'],
    ['Average closing timeline', '75 days'],
    ['Average deal size', '$48M'],
  ],
  d2_process: 'Initial screening against market and yield filters, full underwriting in a standardized model with third-party data, site visits and unit walks, IC review at LOI and again before PSA execution, then confirmatory diligence with outside counsel and engineers.',
  d2_unlev: 5.2, // → 2 (4.5–5.5% band)
  d2_lev_irr: 13, // → 4 (12–14% band)
  d2_em: 1.5, // → 4 (1.5–1.6x band)
  d2_stress: 'Single-factor sensitivities only', // → 3
  d2_replacement: 'We target acquisitions at 70–85% of replacement cost. That discount is our principal margin of safety against new supply, since the rents needed to justify new construction sit well above our basis.',
  d2_dd: 'Every acquisition receives a Phase I ESA, a property condition report, and a full unit-by-unit walk. Red lines are unresolved Phase II findings, structural defects without a fixed-price remedy, and flood-zone exposure without insurable mitigation.',
  d2_lease: 'Lease files are audited on 100% of units once under PSA, with delinquency, concession, and skip patterns reviewed for the trailing twelve months. Tenant credit risk is managed through screening standards rather than single-tenant exposure.',
  d3_platform: 'Each asset manager covers six to eight properties with weekly operator calls and monthly site visits. Investors receive quarterly reports within 45 days of quarter-end and audited financials within 120 days of year-end.',
  d3_pm: 'All properties use third-party managers drawn from a bench of four vetted regional operators. Performance is scored quarterly against budget and local peers, and we have replaced a manager twice for sustained underperformance.',
  d3_capex: 'CapEx reserves are funded at closing at $300 per unit per year plus the full renovation budget. Renovation ROI is re-tested on the first 10% of units before full rollout, requiring a 20% return on renovation cost to proceed.',
  d3_underperform: 'A 2019 Phoenix acquisition achieved only half of its underwritten renovation premium. We paused the renovation program, repositioned the asset toward occupancy and expense control, and exited in 2023 at a 9% IRR versus 14% underwritten.',
  d4_leverage: 65, // → 3 (60–70% band)
  d4_loan_types: 'Agency fixed-rate debt for stabilized core-plus holds; bank or debt-fund floating-rate loans with purchased caps for value-add business plans',
  d4_events: 'Covenant amendments — resolved without loss', // → 3 (the 2020 Houston waiver)
  d4_refi: false, // distributions from operating cash flow → 5
  d4_refi_plan: 'No more than 20% of portfolio debt matures in any 12-month window. Refinancing conversations begin 18 months before maturity, and every floating-rate loan carries at least one extension option.',
  d4_wadm: 4.2,
}

// Analyst subjective 1–5 per risk category, consistent with the narrative:
// a credible second-quartile manager — clean on legal and alignment,
// dependable on distributions, average on most everything else.
export const SAMPLE_SUBJECTIVE: Partial<Record<CategoryId, number>> = {
  team: 3,
  terms: 3,
  strategy: 3,
  track: 3,
  risk: 3,
  ops: 3,
  liquidity: 4,
  legal: 4,
  alignment: 4,
  market: 3,
}
