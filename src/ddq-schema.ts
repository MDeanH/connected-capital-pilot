// ============================================================================
// Institutional DDQ — typed schema + grading calibration
//
// Digitized from the ILPA DDQ 2.0-aligned Institutional DDQ template.
// Scope: Section A (Firm & Organizational Overview) and Section B (Fund Terms
// & Structure) in full, plus the Real Estate Development (C) and Real Estate
// Acquisition (D) asset-class modules. The PE Value / PE Growth / Secondaries /
// Venture / Private Credit modules (template sections E–J) are intentionally
// not digitized yet — add them as new DDQSection entries with `module` set.
//
// Grading calibration comes from the three completed sample DDQs:
//   HIGH — Evercrest Capital Partners   (top-tier exemplar; concrete numbers)
//   MID  — Marston Bridge Capital       (credible second-quartile profile)
//   LOW  — Halcyon Peak Partners        (distressed; should fail diligence)
// The Mid and Low samples carry their differentiation in the profile
// narrative + document checklist rather than re-stated numbers, so mid/low
// band edges are derived from those stated hallmarks (e.g. "market-standard
// 1–2% GP commitment", "deal-by-deal waterfall with no escrow", "one resolved
// SEC deficiency item", "suspended distributions") anchored to the High
// sample's concrete figures.
//
// Everything here is pure data + pure functions so the grading math is
// testable without React. Nothing uploads anywhere.
// ============================================================================

// localStorage key for the DDQ tab's persisted intake — lives here (pure
// module) so other tabs can read the saved DDQ without importing the tab UI.
export const DDQ_STORAGE = 'ddqx-intake-v1'

export type AnswerType = 'text' | 'longtext' | 'number' | 'percent' | 'select' | 'boolean' | 'table'

export type AnswerValue = string | number | boolean | string[][] | null

export type CategoryId =
  | 'team' | 'terms' | 'strategy' | 'track' | 'risk'
  | 'ops' | 'liquidity' | 'legal' | 'alignment' | 'market'

// Section weights from the Risk Model v2 workbook (percent; editable in UI)
export const RISK_CATEGORIES: { id: CategoryId; name: string; weight: number }[] = [
  { id: 'team', name: 'Manager & Team', weight: 20 },
  { id: 'terms', name: 'Fund Terms & Structure', weight: 10 },
  { id: 'strategy', name: 'Investment Strategy', weight: 15 },
  { id: 'track', name: 'Track Record & Performance', weight: 15 },
  { id: 'risk', name: 'Risk Management & Governance', weight: 10 },
  { id: 'ops', name: 'Operations & Transparency', weight: 10 },
  { id: 'liquidity', name: 'Liquidity & Exit', weight: 5 },
  { id: 'legal', name: 'Legal & Compliance', weight: 5 },
  { id: 'alignment', name: 'Alignment & Incentives', weight: 5 },
  { id: 'market', name: 'Market Fit & Demand', weight: 5 },
]

// Analyst rubric anchors — short paraphrases of the three sample profiles
// (5 = Evercrest high exemplar, 3 = Marston mid, 1 = Halcyon low).
export const RUBRICS: Record<CategoryId, { five: string; three: string; one: string }> = {
  team: {
    five: '24-partner ownership, founder share diluted 61%→38%, no individual >16%; senior team averages 13 yrs together; dedicated (non-dual-hat) C-suite; a founder retirement ran on a pre-announced 24-month plan.',
    three: 'Credible team but founder-concentrated ownership and carry; one key-person event in prior funds, resolved with LPs.',
    one: 'Acute key-person instability: multiple senior departures, founder controls economics and decisions, no real succession.',
  },
  terms: {
    five: '1.25% fee on committed stepping to 1.0% on invested, 8% pref, 20% carry on a full European whole-fund waterfall; key-man auto-suspension naming four persons.',
    three: 'Market-standard fees and a less LP-favorable deal-by-deal waterfall; protections exist but are weaker than top-tier.',
    one: 'Aggressive deal-by-deal waterfall with no escrow; weak or absent key-man and governance protections.',
  },
  strategy: {
    five: 'Downside-first underwriting (deals must survive a severe-recession case), capacity-constrained fund sizes, declines deals that only work on aggressive exit-cap assumptions.',
    three: 'Sound, consistent strategy but moderate (not conservative) leverage and looser underwriting discipline.',
    one: 'Grew fast on aggressive covenant-lite leverage; strategy drift; deals depend on benign markets to work.',
  },
  track: {
    five: 'Every vintage top-quartile: 18–22% net IRR, 2.0–2.4x net MOIC; only 4 investments ever below 1.0x; largest loss 1.1% of its fund.',
    three: 'Solid but second-quartile returns; several covenant amendments and one small portfolio bankruptcy, all resolved.',
    one: 'Bottom-quartile, partially restated returns; multiple portfolio bankruptcies and lender-forced sales.',
  },
  risk: {
    five: 'Independent CRO outside the deal teams; monthly exposure monitoring, quarterly severe-scenario stress tests; >90% of hard costs under GMP contracts; all floating debt hedged.',
    three: 'A framework exists but exceptions occur — covenant amendments handled reactively rather than prevented.',
    one: 'Dangerous leverage with covenant-lite structures, a prior cyber breach, no independent risk function.',
  },
  ops: {
    five: 'ILPA fee/reporting templates + GIPS verified since 2008; secure LP portal; K-1s in 72 days; complete 23-document data room.',
    three: 'Partial ILPA compliance, no GIPS claim; three diligence documents still outstanding.',
    one: 'Nearly every requested document outstanding (incl. audited financials and track record); certification hedged "subject to change".',
  },
  liquidity: {
    five: 'Zero missed or delayed distributions ever; distributions funded by in-place cash flow, not refinancing events.',
    three: 'One delayed distribution, since paid in full; exits broadly on plan.',
    one: 'Multiple missed distributions and distributions currently suspended; exits forced by lenders.',
  },
  legal: {
    five: 'Clean record: no proceedings, investigations, or deficiency letters ever; SEC-registered since 2004; fully independent service providers.',
    three: 'One SEC exam deficiency letter, remediated and closed; otherwise clean and fully disclosed.',
    one: 'Active SEC enforcement action and multiple pending lawsuits; affiliated, conflicted service-provider arrangement.',
  },
  alignment: {
    five: '4% GP commitment (vs 1–2% market), unfinanced; 30% of distributed carry escrowed; >55% of carry allocated below founder level.',
    three: 'Market-standard 1–2% GP commitment; founder-concentrated carry; standard clawback without extra security.',
    one: 'Minimal GP commitment that is itself financed; no carry escrow; economics concentrated in one principal.',
  },
  market: {
    five: '85% of target raised by second close; >85% of capital is re-up capital from existing LPs across vintages.',
    three: 'Credible fundraise at ~$9B platform scale, but slower re-ups and a thinner institutional LP base.',
    one: 'Stalled fundraise at a stressed ~$2.3B platform; LPs trying to exit; redemptions/distributions suspended.',
  },
}

// ----------------------------------------------------------------------------
// Grading rules
// ----------------------------------------------------------------------------

// Numeric bands are evaluated in order; first band whose min/max constraints
// pass wins. Use ordered descending-min or ascending-max lists.
export interface BandRule { kind: 'bands'; bands: { min?: number; max?: number; score: number }[] }
export interface SelectRule { kind: 'select'; scores: number[] } // parallel to options
export interface BooleanRule { kind: 'boolean'; yes: number; no: number }

export interface GradingHint {
  rule: BandRule | SelectRule | BooleanRule
  ruleText: string // plain-language scoring rule, shown next to the auto score
  calibration: { high: string; mid: string; low: string } // values read from the exemplars
  hardFail?: { on: string | boolean; note: string } // answer that caps the whole DDQ at LOW
}

export interface TableCol { key: string; label: string }

export interface DDQQuestion {
  id: string
  prompt: string
  ilpa?: string // ILPA DDQ 2.0 reference where one exists
  answerType: AnswerType
  unit?: string
  options?: string[]
  columns?: TableCol[]
  placeholder?: string
  category: CategoryId
  grading?: GradingHint
}

export interface DDQSubsection { id: string; title: string; intro?: string; questions: DDQQuestion[] }
export interface DDQSection {
  id: string
  title: string
  module?: string // asset-class module tag, e.g. 'RE-DEV'; absent for core sections
  intro?: string
  subsections: DDQSubsection[]
}

// ----------------------------------------------------------------------------
// The digitized questionnaire
// ----------------------------------------------------------------------------

export const DDQ_SECTIONS: DDQSection[] = [
  // ==========================================================================
  // SECTION A — FIRM & ORGANIZATIONAL OVERVIEW (ILPA §1, §3, §9–10, §13–17)
  // ==========================================================================
  {
    id: 'A',
    title: 'Section A — Firm & Organizational Overview',
    intro: 'All asset classes. Identification, ownership, history, team, and the firm-level legal & compliance record.',
    subsections: [
      {
        id: 'A1',
        title: 'A.1 Firm Identification',
        questions: [
          { id: 'a1_name', prompt: 'Legal name of firm', answerType: 'text', category: 'team' },
          { id: 'a1_address', prompt: 'Principal office address', answerType: 'text', category: 'team' },
          { id: 'a1_offices', prompt: 'Additional office locations', answerType: 'text', category: 'team' },
          {
            id: 'a1_founded', prompt: 'Year firm founded', answerType: 'number', category: 'team',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 2010, score: 5 }, { max: 2015, score: 3 }, { max: 2020, score: 2 }, { score: 1 }] },
              ruleText: 'Founded ≤2010 → 5 · 2011–2015 → 3 · 2016–2020 → 2 · later → 1',
              calibration: { high: 'Evercrest: 2002 (multiple full cycles)', mid: 'Marston: 2012', low: 'Halcyon: 2016 (one cycle, grew fast)' },
            },
          },
          { id: 'a1_structure', prompt: 'Legal structure of firm', answerType: 'text', category: 'team' },
          { id: 'a1_reg', prompt: 'Regulatory status / registrations', answerType: 'text', category: 'legal' },
          {
            id: 'a1_aum', prompt: 'Total firm AUM', answerType: 'number', unit: '$M', category: 'market',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 10000, score: 5 }, { min: 5000, score: 4 }, { min: 2500, score: 3 }, { min: 500, score: 2 }, { score: 1 }] },
              ruleText: '≥$10B → 5 · $5–10B → 4 · $2.5–5B → 3 · $0.5–2.5B → 2 · <$0.5B → 1',
              calibration: { high: 'Evercrest: $94,200M', mid: 'Marston: ~$9,000M', low: 'Halcyon: ~$2,300M and stressed' },
            },
          },
          { id: 'a1_strategy_aum', prompt: 'Strategy-specific AUM', answerType: 'number', unit: '$M', category: 'market' },
          { id: 'a1_contact', prompt: 'Primary contact name', answerType: 'text', category: 'ops' },
          { id: 'a1_contact_title', prompt: 'Primary contact title', answerType: 'text', category: 'ops' },
          { id: 'a1_contact_email', prompt: 'Primary contact email & phone', answerType: 'text', category: 'ops' },
          { id: 'a1_website', prompt: 'Website', answerType: 'text', category: 'ops' },
        ],
      },
      {
        id: 'A2',
        title: 'A.2 Ownership & Leadership',
        questions: [
          { id: 'a2_orgchart', ilpa: '1.3', prompt: 'Provide a complete organizational chart including all principals, senior professionals, and ownership structure. Indicate equity ownership percentages for all holders above 5%.', answerType: 'longtext', category: 'team' },
          {
            id: 'a2_single_control', prompt: 'Does any single individual control more than 50% of the economics or voting authority of the GP entity?', answerType: 'boolean', category: 'team',
            grading: {
              rule: { kind: 'boolean', yes: 1, no: 5 },
              ruleText: 'No → 5 · Yes → 1',
              calibration: { high: 'Evercrest: no individual >16%; founders 38% aggregate', mid: 'Marston: founder-concentrated ownership & carry', low: 'Halcyon: sole-founder control' },
            },
          },
          { id: 'a2_keyman_firm', prompt: 'How is key-man risk managed at the firm level?', answerType: 'longtext', category: 'team' },
          { id: 'a2_changes', prompt: 'Has there been any change in ownership, senior leadership, or key investment personnel in the past five years? If yes, provide a detailed account including circumstances and impact on performance and continuity.', answerType: 'longtext', category: 'team' },
          {
            id: 'a2_keyperson_events', ilpa: '3.11', prompt: 'Has a Key Person event occurred over the life of the last two predecessor funds?', answerType: 'select', category: 'team',
            options: ['None', 'One — resolved with LP consent', 'Multiple or unresolved'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1] },
              ruleText: 'None → 5 · one resolved → 3 · multiple/unresolved → 1',
              calibration: { high: 'Evercrest: none ever (3.11 = No)', mid: 'Marston: one key-person event, resolved', low: 'Halcyon: acute key-person instability, multiple departures' },
            },
          },
          { id: 'a2_succession', ilpa: '3.1', prompt: 'Are there any planned leadership transitions, retirements, or known departures in the next 12–24 months? Describe your succession plan and how institutional knowledge is preserved.', answerType: 'longtext', category: 'team' },
          { id: 'a2_governance', prompt: 'Describe the governance structure of the firm. Who has final investment authority? Describe investment committee composition, quorum requirements, and voting procedures. Can any single member veto a transaction?', answerType: 'longtext', category: 'risk' },
        ],
      },
      {
        id: 'A3',
        title: 'A.3 History & Track Record',
        questions: [
          { id: 'a3_history', ilpa: '1.1', prompt: 'Provide a narrative history of the firm including key milestones, strategy evolution, and pivots. Be candid about setbacks and what did not go according to plan.', answerType: 'longtext', category: 'track' },
          {
            id: 'a3_fund_table', ilpa: '§14', prompt: 'Provide a complete fund-by-fund track record for all vehicles managed since inception, including vehicles wound down with losses.', answerType: 'table', category: 'track',
            columns: [
              { key: 'fund', label: 'Fund' }, { key: 'vintage', label: 'Vintage' }, { key: 'committed', label: 'Committed ($M)' },
              { key: 'called', label: 'Called ($M)' }, { key: 'dist', label: 'Distributed ($M)' }, { key: 'nav', label: 'NAV ($M)' },
              { key: 'tvpi', label: 'TVPI' }, { key: 'dpi', label: 'DPI' }, { key: 'netirr', label: 'Net IRR %' },
            ],
          },
          {
            id: 'a3_irr_quartile', ilpa: '14.6', prompt: 'Benchmark quartile of net IRR for your most recent mature fund (vs Cambridge Associates / Burgiss).', answerType: 'select', category: 'track',
            options: ['Top quartile', 'Second quartile', 'Third quartile', 'Bottom quartile'],
            grading: {
              rule: { kind: 'select', scores: [5, 4, 2, 1] },
              ruleText: 'Top → 5 · 2nd → 4 · 3rd → 2 · bottom → 1',
              calibration: { high: 'Evercrest: every vintage top quartile, net IRR 18–22%', mid: 'Marston: solid but second-quartile', low: 'Halcyon: bottom-quartile, partially restated' },
            },
          },
          {
            id: 'a3_net_moic', prompt: 'Net MOIC of your most recent mature fund.', answerType: 'number', unit: '×', category: 'track',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 1.9, score: 5 }, { min: 1.5, score: 4 }, { min: 1.3, score: 3 }, { min: 1.1, score: 2 }, { score: 1 }] },
              ruleText: '≥1.9x → 5 · 1.5–1.9x → 4 · 1.3–1.5x → 3 · 1.1–1.3x → 2 · <1.1x → 1',
              calibration: { high: 'Evercrest: 2.0–2.4x net across flagship vintages', mid: 'Marston: second-quartile (~1.4–1.6x implied)', low: 'Halcyon: bottom-quartile, restated' },
            },
          },
          {
            id: 'a3_retention', prompt: 'What percentage of current AUM is from repeat investors? (LP retention / re-up rate across fund vintages.)', answerType: 'percent', category: 'market',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 75, score: 5 }, { min: 50, score: 3 }, { min: 30, score: 2 }, { score: 1 }] },
              ruleText: '≥75% → 5 · 50–75% → 3 · 30–50% → 2 · <30% → 1',
              calibration: { high: 'Evercrest: >85% of capital is re-up capital', mid: 'Marston: credible but slower re-ups', low: 'Halcyon: LPs trying to exit' },
            },
          },
          {
            id: 'a3_restated', prompt: 'Have reported returns ever been restated or are any figures currently under review?', answerType: 'select', category: 'track',
            options: ['No restatements ever', 'Minor restatement — disclosed and closed', 'Material restatement or figures under review'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1] },
              ruleText: 'Never → 5 · minor & closed → 3 · material/under review → 1',
              calibration: { high: 'Evercrest: GIPS-verified since 2008, no restatements', mid: 'Marston: none stated', low: 'Halcyon: returns partially restated, certification hedged' },
            },
          },
          {
            id: 'a3_distributions', prompt: 'Have LP distributions ever been missed, delayed, or suspended across any fund?', answerType: 'select', category: 'liquidity',
            options: ['Never missed or delayed', 'One delayed — since paid in full', 'Multiple missed or delayed', 'Suspended — currently not distributing'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 2, 1] },
              ruleText: 'Never → 5 · one delayed → 3 · multiple → 2 · suspended → 1 + HARD FAIL',
              calibration: { high: 'Evercrest: 0 missed/delayed ever', mid: 'Marston: a single delayed distribution', low: 'Halcyon: multiple missed AND suspended' },
              hardFail: { on: 'Suspended — currently not distributing', note: 'LP distributions currently suspended' },
            },
          },
          { id: 'a3_extensions', prompt: 'Has the firm ever returned capital early, extended a fund beyond its scheduled life, or been unable to deploy committed capital within the investment period? Describe the circumstances.', answerType: 'longtext', category: 'liquidity' },
        ],
      },
      {
        id: 'A4',
        title: 'A.4 Team & Human Capital',
        questions: [
          {
            id: 'a4_roster', ilpa: '§9', prompt: 'Provide a complete staff roster: name, title, years at firm, years of industry experience, prior employers, and primary role in the investment process.', answerType: 'table', category: 'team',
            columns: [
              { key: 'name', label: 'Name' }, { key: 'title', label: 'Title' }, { key: 'yrsfirm', label: 'Yrs at firm' },
              { key: 'yrsind', label: 'Yrs industry' }, { key: 'prior', label: 'Prior employers' }, { key: 'role', label: 'Role' },
            ],
          },
          {
            id: 'a4_tenure', ilpa: '9.1', prompt: 'Average senior professional tenure at the firm (years).', answerType: 'number', unit: 'yrs', category: 'team',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 10, score: 5 }, { min: 7, score: 4 }, { min: 5, score: 3 }, { min: 3, score: 2 }, { score: 1 }] },
              ruleText: '≥10 yrs → 5 · 7–10 → 4 · 5–7 → 3 · 3–5 → 2 · <3 → 1',
              calibration: { high: 'Evercrest: senior team avg 13 yrs together; sector heads 8–16 yrs', mid: 'Marston: founded 2012, mid-tenure team', low: 'Halcyon: multiple recent senior departures' },
            },
          },
          {
            id: 'a4_attrition', prompt: 'Annual voluntary attrition rate for investment professionals over the past five years.', answerType: 'percent', category: 'team',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 5, score: 5 }, { max: 12, score: 3 }, { max: 20, score: 2 }, { score: 1 }] },
              ruleText: '≤5% → 5 · 5–12% → 3 · 12–20% → 2 · >20% → 1',
              calibration: { high: 'Evercrest: deep, stable teams (qualitative)', mid: 'Marston: stable but thinner bench', low: 'Halcyon: acute instability, senior exits' },
            },
          },
          { id: 'a4_comp', ilpa: '10.1', prompt: 'How are investment professionals compensated? Describe the carried interest distribution structure, vesting schedule, clawback provisions, and senior vs junior allocation.', answerType: 'longtext', category: 'alignment' },
          {
            id: 'a4_carry_below', prompt: 'Share of carried interest allocated below the founder level.', answerType: 'percent', category: 'alignment',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 50, score: 5 }, { min: 35, score: 4 }, { min: 25, score: 3 }, { min: 10, score: 2 }, { score: 1 }] },
              ruleText: '≥50% → 5 · 35–50% → 4 · 25–35% → 3 · 10–25% → 2 · <10% → 1',
              calibration: { high: 'Evercrest: >55% of carry below founder level, 5-yr vesting', mid: 'Marston: founder-concentrated carry', low: 'Halcyon: economics concentrated in one principal' },
            },
          },
          { id: 'a4_ops', prompt: 'Describe your operational infrastructure: technology systems, data management, reporting platforms, cybersecurity posture, and which critical functions are outsourced and to whom.', answerType: 'longtext', category: 'ops' },
        ],
      },
      {
        id: 'A5',
        title: 'A.5 Legal, Compliance & Regulatory',
        questions: [
          {
            id: 'a5_ria', ilpa: '13.17', prompt: 'Is the firm registered as an investment adviser (or equivalent)? Provide registration details and any exemptions claimed.', answerType: 'boolean', category: 'legal',
            grading: {
              rule: { kind: 'boolean', yes: 5, no: 1 },
              ruleText: 'Registered → 5 · not registered → 1',
              calibration: { high: 'Evercrest: SEC RIA since 2004, FCA + MAS licensed', mid: 'Marston: registered', low: 'Halcyon: registration status entangled in enforcement' },
            },
          },
          {
            id: 'a5_reg_actions', ilpa: '13.19 / 17.1', prompt: 'Has the firm or any principal ever been subject to regulatory action, investigation, SEC/CFTC/FCA/FINRA inquiry, deficiency letter, subpoena, or enforcement proceeding?', answerType: 'select', category: 'legal',
            options: ['None ever', 'Deficiency letter or inquiry — resolved and closed', 'Multiple resolved matters', 'Active investigation or enforcement'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 2, 1] },
              ruleText: 'None → 5 · one resolved → 3 · several resolved → 2 · active → 1 + HARD FAIL',
              calibration: { high: 'Evercrest: none ever (13.19 = No, 17.1 = No)', mid: 'Marston: one SEC deficiency letter, remediated', low: 'Halcyon: ACTIVE SEC enforcement action' },
              hardFail: { on: 'Active investigation or enforcement', note: 'Active regulatory enforcement action' },
            },
          },
          {
            id: 'a5_bankruptcy', ilpa: '1.14 / 14.1', prompt: 'Has the firm, any related entity, or any portfolio company filed for bankruptcy or been subject to insolvency proceedings in the past 10 years?', answerType: 'select', category: 'legal',
            options: ['None', 'One small portfolio company — resolved', 'Multiple portfolio bankruptcies / lender-forced sales', 'Firm, GP, or principal bankruptcy'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1, 1] },
              ruleText: 'None → 5 · one small, resolved → 3 · multiple or firm-level → 1',
              calibration: { high: 'Evercrest: none ever (1.14, 14.1 = No)', mid: 'Marston: one small portfolio bankruptcy', low: 'Halcyon: several portfolio bankruptcies + forced sales' },
            },
          },
          {
            id: 'a5_litigation', ilpa: '17.2 / 17.4', prompt: 'Has the firm or any principal been a defendant in material litigation (claims exceeding $1M) in the past 10 years? Are any proceedings pending?', answerType: 'select', category: 'legal',
            options: ['None', 'Disclosed and resolved', 'Pending — disclosed in full', 'Undisclosed litigation discovered in diligence'],
            grading: {
              rule: { kind: 'select', scores: [5, 4, 2, 1] },
              ruleText: 'None → 5 · resolved → 4 · pending+disclosed → 2 · undisclosed → 1 + HARD FAIL',
              calibration: { high: 'Evercrest: none ever (17.2, 17.4 = No)', mid: 'Marston: none material', low: 'Halcyon: multiple pending lawsuits' },
              hardFail: { on: 'Undisclosed litigation discovered in diligence', note: 'Undisclosed litigation' },
            },
          },
          { id: 'a5_aml', ilpa: '13.26', prompt: 'Describe your AML/KYC procedures, FCPA/anti-bribery policies, sanctions compliance framework, and code of ethics.', answerType: 'longtext', category: 'legal' },
          {
            id: 'a5_providers', prompt: 'Identify all key service providers (fund counsel, GP counsel, auditor, administrator, custodian, tax, placement agent, valuation agent).', answerType: 'table', category: 'ops',
            columns: [{ key: 'role', label: 'Role' }, { key: 'firm', label: 'Firm' }, { key: 'indep', label: 'Independent of GP?' }],
          },
          {
            id: 'a5_providers_indep', ilpa: '15.10 / 15.14', prompt: 'Are all key service providers (auditor, fund administrator, counsel, valuation agent) fully independent of the GP and its affiliates?', answerType: 'boolean', category: 'ops',
            grading: {
              rule: { kind: 'boolean', yes: 5, no: 1 },
              ruleText: 'All independent → 5 · any affiliated → 1',
              calibration: { high: 'Evercrest: independent Big Four auditor + unaffiliated administrator & valuation firm', mid: 'Marston: independent', low: 'Halcyon: affiliated, conflicted service-provider arrangement' },
            },
          },
        ],
      },
    ],
  },

  // ==========================================================================
  // SECTION B — FUND TERMS & STRUCTURE (ILPA §2 + §12)
  // ==========================================================================
  {
    id: 'B',
    title: 'Section B — Fund Terms & Structure',
    intro: 'All asset classes. Key terms of the current vehicle plus fees, conflicts, and GP economics.',
    subsections: [
      {
        id: 'B1',
        title: 'B.1 Key Terms Summary',
        questions: [
          { id: 'b1_fund_name', prompt: 'Fund name', answerType: 'text', category: 'terms' },
          { id: 'b1_target', prompt: 'Target fund size', answerType: 'number', unit: '$M', category: 'market' },
          { id: 'b1_hardcap', prompt: 'Hard cap', answerType: 'number', unit: '$M', category: 'market' },
          { id: 'b1_commitments', prompt: 'Current commitments to date', answerType: 'number', unit: '$M', category: 'market' },
          { id: 'b1_first_close', prompt: 'First close date (actual / expected)', answerType: 'text', category: 'terms' },
          { id: 'b1_final_close', prompt: 'Final close date (expected)', answerType: 'text', category: 'terms' },
          {
            id: 'b1_fee_inv', ilpa: '12.1', prompt: 'Management fee — investment period', answerType: 'percent', category: 'terms',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 1.3, score: 5 }, { max: 1.6, score: 4 }, { max: 2.0, score: 3 }, { max: 2.5, score: 2 }, { score: 1 }] },
              ruleText: '≤1.3% → 5 · 1.3–1.6% → 4 · 1.6–2.0% → 3 · 2.0–2.5% → 2 · >2.5% → 1',
              calibration: { high: 'Evercrest: 1.25% on committed', mid: 'market-standard 1.5–2.0%', low: 'aggressive 2%+ with no step-down' },
            },
          },
          {
            id: 'b1_fee_post', prompt: 'Management fee — post-investment period', answerType: 'percent', category: 'terms',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 1.0, score: 5 }, { max: 1.5, score: 3 }, { max: 2.0, score: 2 }, { score: 1 }] },
              ruleText: '≤1.0% → 5 · 1.0–1.5% → 3 · 1.5–2.0% → 2 · >2.0% → 1',
              calibration: { high: 'Evercrest: steps down to 1.00% on invested capital', mid: 'modest step-down', low: 'no step-down' },
            },
          },
          { id: 'b1_fee_basis', prompt: 'Management fee basis (committed vs invested)', answerType: 'select', category: 'terms', options: ['Committed during investment period, invested thereafter', 'Invested capital throughout', 'Committed capital throughout', 'NAV-based / other'] },
          {
            id: 'b1_pref', ilpa: '12.8', prompt: 'Preferred return / hurdle rate', answerType: 'percent', category: 'terms',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 8, score: 5 }, { min: 7, score: 4 }, { min: 6, score: 3 }, { min: 0.5, score: 2 }, { score: 1 }] },
              ruleText: '≥8% → 5 · 7–8% → 4 · 6–7% → 3 · below 6% → 2 · none → 1',
              calibration: { high: 'Evercrest: 8% compounded annually', mid: '8% market standard', low: 'reduced or no hurdle' },
            },
          },
          {
            id: 'b1_carry', ilpa: '12.12', prompt: 'Carried interest', answerType: 'percent', category: 'terms',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 20, score: 5 }, { max: 25, score: 3 }, { max: 30, score: 2 }, { score: 1 }] },
              ruleText: '≤20% → 5 · 20–25% → 3 · 25–30% → 2 · >30% → 1',
              calibration: { high: 'Evercrest: 20% whole-fund', mid: '20% deal-by-deal', low: 'aggressive premium carry' },
            },
          },
          {
            id: 'b1_waterfall', ilpa: '12.12', prompt: 'Waterfall structure (European / American)', answerType: 'select', category: 'terms',
            options: ['European (whole-fund)', 'Hybrid', 'Deal-by-deal with escrow & interim true-up', 'Deal-by-deal — no escrow'],
            grading: {
              rule: { kind: 'select', scores: [5, 4, 3, 1] },
              ruleText: 'European → 5 · hybrid → 4 · deal-by-deal w/ escrow → 3 · no escrow → 1',
              calibration: { high: 'Evercrest: full European whole-fund, 100% return of capital + pref first', mid: 'Marston: less LP-favorable deal-by-deal', low: 'Halcyon: aggressive deal-by-deal, NO escrow' },
            },
          },
          { id: 'b1_inv_period', prompt: 'Investment period (years)', answerType: 'number', unit: 'yrs', category: 'terms' },
          { id: 'b1_term', prompt: 'Fund term (years)', answerType: 'number', unit: 'yrs', category: 'terms' },
          { id: 'b1_extensions', prompt: 'Extension options', answerType: 'text', category: 'terms' },
          { id: 'b1_min_lp', prompt: 'Minimum LP commitment', answerType: 'number', unit: '$M', category: 'terms' },
          { id: 'b1_gp_usd', prompt: 'GP commitment ($)', answerType: 'number', unit: '$M', category: 'alignment' },
          {
            id: 'b1_gp_pct', ilpa: '10.6', prompt: 'GP commitment (% of fund)', answerType: 'percent', category: 'alignment',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 3, score: 5 }, { min: 2, score: 4 }, { min: 1, score: 3 }, { min: 0.5, score: 2 }, { score: 1 }] },
              ruleText: '≥3% → 5 · 2–3% → 4 · 1–2% → 3 · 0.5–1% → 2 · <0.5% → 1',
              calibration: { high: 'Evercrest: 4.0% ($240M of $6B) — "well above market 1–2%"', mid: 'Marston: market-standard 1–2%', low: 'Halcyon: minimal, and financed' },
            },
          },
          {
            id: 'b1_gp_financed', ilpa: '10.9', prompt: 'Will any commitments from the GP and/or its principals be leveraged or loaned (financed)?', answerType: 'boolean', category: 'alignment',
            grading: {
              rule: { kind: 'boolean', yes: 1, no: 5 },
              ruleText: 'Unfinanced → 5 · financed → 1 (red flag)',
              calibration: { high: 'Evercrest: No (10.9 = No)', mid: 'Marston: unfinanced', low: 'Halcyon: GP commitment itself is financed' },
            },
          },
          {
            id: 'b1_lpac', ilpa: '2.9', prompt: 'Is there an LP Advisory Committee (LPAC) with an annual investor meeting?', answerType: 'boolean', category: 'risk',
            grading: {
              rule: { kind: 'boolean', yes: 5, no: 1 },
              ruleText: 'LPAC + annual meeting → 5 · none → 1',
              calibration: { high: 'Evercrest: LPAC with in-camera sessions, annual meeting', mid: 'Marston: LPAC in place', low: 'Halcyon: weak governance' },
            },
          },
          { id: 'b1_coinvest', ilpa: '5.1', prompt: 'Co-investment rights', answerType: 'text', category: 'terms' },
          {
            id: 'b1_keyman', ilpa: '3.12', prompt: 'Key man provisions (trigger & remedy)', answerType: 'select', category: 'terms',
            options: ['Automatic suspension — named key persons', 'Suspension by LP vote', 'Weak or none'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1] },
              ruleText: 'Automatic suspension → 5 · LP-vote suspension → 3 · weak/none → 1',
              calibration: { high: 'Evercrest: auto-suspension if any 2 of 4 named persons depart; 75% LP vote to resume', mid: 'standard provision', low: 'weak or absent' },
            },
          },
          { id: 'b1_nofault', prompt: 'No-fault divorce threshold (% of LP interests)', answerType: 'percent', category: 'terms' },
          { id: 'b1_recycling', prompt: 'Recycling provisions', answerType: 'text', category: 'terms' },
          { id: 'b1_domicile', prompt: 'Fund domicile / jurisdiction', answerType: 'text', category: 'legal' },
          { id: 'b1_inv_domicile', prompt: 'Investor domicile options (feeders, blockers)', answerType: 'text', category: 'legal' },
        ],
      },
      {
        id: 'B2',
        title: 'B.2 Fees, Conflicts & Economics',
        questions: [
          {
            id: 'b2_offsets_pct', ilpa: '12.6', prompt: 'What percentage of transaction, monitoring, and deal fees is offset against management fees?', answerType: 'percent', category: 'alignment',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 100, score: 5 }, { min: 80, score: 4 }, { min: 50, score: 3 }, { min: 25, score: 2 }, { score: 1 }] },
              ruleText: '100% → 5 · 80–99% → 4 · 50–79% → 3 · 25–49% → 2 · <25% → 1',
              calibration: { high: 'Evercrest: carry net of ALL fees & expenses; ILPA-standard 100% offset posture', mid: 'partial offset', low: 'GP keeps affiliate fee streams' },
            },
          },
          { id: 'b2_offsets', prompt: 'Describe all fee offsets and provide a full accounting of all fee streams received by the GP or any affiliate from portfolio companies.', answerType: 'longtext', category: 'alignment' },
          { id: 'b2_clawback', ilpa: '12.13', prompt: 'Describe the carried interest clawback mechanism in full detail: how calculated, when tested (deal-by-deal vs fund-level), GP net worth relative to potential clawback, and how secured.', answerType: 'longtext', category: 'alignment' },
          {
            id: 'b2_escrow', prompt: 'Share of distributed carry held in escrow until final distribution.', answerType: 'percent', category: 'alignment',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 25, score: 5 }, { min: 10, score: 4 }, { min: 1, score: 3 }, { score: 1 }] },
              ruleText: '≥25% → 5 · 10–25% → 4 · any escrow → 3 · none → 1',
              calibration: { high: 'Evercrest: 30% of distributed carry escrowed; joint-and-several clawback tested at each interim distribution', mid: 'standard clawback, limited escrow', low: 'Halcyon: NO escrow' },
            },
          },
          {
            id: 'b2_clawback_gross', ilpa: '12.14', prompt: 'Are clawback amounts gross of taxes paid?', answerType: 'boolean', category: 'alignment',
            grading: {
              rule: { kind: 'boolean', yes: 1, no: 5 },
              ruleText: 'Pre-tax (No) → 5 · net of taxes (Yes) → 1 — LP-unfavorable',
              calibration: { high: 'Evercrest: No — calculated pre-tax to maximize LP recovery', mid: 'varies', low: 'net-of-tax clawback' },
            },
          },
          { id: 'b2_conflicts', ilpa: '13.4', prompt: 'Describe all conflicts of interest that exist or may exist between the fund, its LPs, the GP, affiliated entities, or principals’ personal investments, and how each is identified, disclosed, and managed.', answerType: 'longtext', category: 'legal' },
          {
            id: 'b2_sideletters', ilpa: '12.4', prompt: 'Are there side letters granting preferential terms to certain LPs? Describe the categories of preferential treatment.', answerType: 'select', category: 'terms',
            options: ['None', 'Limited — MFN, reporting & regulatory provisions only', 'Preferential economics to select LPs'],
            grading: {
              rule: { kind: 'select', scores: [5, 4, 1] },
              ruleText: 'None → 5 · MFN/reporting only → 4 · preferential economics → 1',
              calibration: { high: 'Evercrest: MFN election to all LPs >$50M; economics transparent to every LP', mid: 'standard side letters', low: 'opaque preferential economics' },
            },
          },
        ],
      },
    ],
  },

  // ==========================================================================
  // SECTION C — REAL ESTATE DEVELOPMENT (module)
  // ==========================================================================
  {
    id: 'C',
    title: 'Section C — Real Estate Development',
    module: 'RE-DEV',
    intro: 'Complete for ground-up development, major repositioning, or adaptive reuse strategies.',
    subsections: [
      {
        id: 'C1',
        title: 'C.1 Development Strategy & Thesis',
        questions: [
          { id: 'c1_thesis', prompt: 'Describe your development thesis: property types, geographies, risk/return profiles targeted. What structural, demographic, or regulatory tailwinds underpin the strategy?', answerType: 'longtext', category: 'strategy' },
          { id: 'c1_timeline', prompt: 'What is the typical development timeline from land acquisition through construction completion and stabilization? How does this compare to your last five completed projects?', answerType: 'longtext', category: 'strategy' },
          { id: 'c1_entitlement', prompt: 'Describe your entitlement process: % of pipeline pre-entitled vs requiring full entitlement, historical entitlement success rate, and a project where entitlement was denied or significantly delayed.', answerType: 'longtext', category: 'strategy' },
          { id: 'c1_preleasing', prompt: 'What is your philosophy on speculative vs pre-leased or pre-sold development? At what pre-leasing or pre-sale threshold will you commence construction?', answerType: 'longtext', category: 'strategy' },
        ],
      },
      {
        id: 'C2',
        title: 'C.2 Construction Risk Management',
        questions: [
          {
            id: 'c2_gmp', prompt: 'Do you use fixed-price GMP (guaranteed maximum price) contracts for construction?', answerType: 'boolean', category: 'risk',
            grading: {
              rule: { kind: 'boolean', yes: 5, no: 1 },
              ruleText: 'GMP contracts → 5 · no fixed-price protection → 1',
              calibration: { high: 'Evercrest: >90% of hard costs locked under GMP with bonded, investment-grade GCs', mid: 'partial GMP coverage', low: 'no cost protection' },
            },
          },
          {
            id: 'c2_hard_contingency', prompt: 'Hard-cost contingency reserve as a percentage of total project cost.', answerType: 'percent', category: 'risk',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 8, score: 5 }, { min: 5, score: 3 }, { min: 3, score: 2 }, { score: 1 }] },
              ruleText: '≥8% → 5 · 5–8% → 3 · 3–5% → 2 · <3% → 1',
              calibration: { high: 'Evercrest: 8–10% hard-cost contingency, above market norm', mid: '~5% market norm', low: 'thin or no contingency' },
            },
          },
          {
            id: 'c2_soft_contingency', prompt: 'Soft-cost contingency reserve as a percentage of total project cost.', answerType: 'percent', category: 'risk',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 5, score: 5 }, { min: 3, score: 3 }, { min: 1.5, score: 2 }, { score: 1 }] },
              ruleText: '≥5% → 5 · 3–5% → 3 · 1.5–3% → 2 · <1.5% → 1',
              calibration: { high: 'Evercrest: 5% soft-cost contingency', mid: '~3%', low: 'none' },
            },
          },
          {
            id: 'c2_overruns', prompt: 'Of your last 10 completed projects, how many exceeded contingency budgets?', answerType: 'number', unit: 'of 10', category: 'track',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 2, score: 5 }, { max: 5, score: 3 }, { max: 8, score: 2 }, { score: 1 }] },
              ruleText: '≤2 of 10 → 5 · 3–5 → 3 · 6–8 → 2 · 9–10 → 1',
              calibration: { high: 'Evercrest: 2 of 10, by an average of 2.3% of total cost; no equity rescues', mid: 'several, contained', low: 'routine overruns, equity rescues' },
            },
          },
          { id: 'c2_schedule', prompt: 'How do you manage construction schedule risk? What penalties or liquidated damages provisions are standard in your GC contracts?', answerType: 'longtext', category: 'risk' },
          { id: 'c2_major', prompt: 'Describe any projects with material cost overruns (>10% of budget), significant delays (>6 months), or GC default: causes and resolution.', answerType: 'longtext', category: 'risk' },
        ],
      },
      {
        id: 'C3',
        title: 'C.3 Market & Feasibility Underwriting',
        questions: [
          { id: 'c3_market', prompt: 'Describe your market selection process: supply/demand dynamics, absorption rates, competitive supply pipeline, and demographic trends.', answerType: 'longtext', category: 'market' },
          { id: 'c3_leaseup', prompt: 'How do you underwrite lease-up assumptions? What is the basis for projected rents or sale prices, and how conservative are projections relative to current market?', answerType: 'longtext', category: 'market' },
          {
            id: 'c3_uw_table', prompt: 'Underwriting vs actual outcomes for your last five completed projects.', answerType: 'table', category: 'track',
            columns: [
              { key: 'project', label: 'Project' }, { key: 'pcost', label: 'Proj. cost ($M)' }, { key: 'acost', label: 'Actual cost ($M)' },
              { key: 'prent', label: 'Proj. rent/price' }, { key: 'arent', label: 'Actual rent/price' },
              { key: 'pirr', label: 'Proj. IRR %' }, { key: 'airr', label: 'Actual IRR %' },
            ],
          },
          {
            id: 'c3_cost_var', prompt: 'Average actual cost vs budget across your last five completed projects (% over budget; negative if under).', answerType: 'percent', category: 'track',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 3, score: 5 }, { max: 7, score: 3 }, { max: 12, score: 2 }, { score: 1 }] },
              ruleText: '≤3% over → 5 · 3–7% → 3 · 7–12% → 2 · >12% → 1',
              calibration: { high: 'Evercrest: +1.8% avg vs budget; rents +4% vs UW; realized IRR 21% vs 17% underwritten', mid: 'moderate slippage', low: 'systematic overruns' },
            },
          },
        ],
      },
      {
        id: 'C4',
        title: 'C.4 Capital Structure & Financing',
        questions: [
          { id: 'c4_stack', prompt: 'Describe the typical capital stack: equity-to-cost ratio, use of mezzanine, preferred equity, or C-PACE, and typical construction loan terms.', answerType: 'longtext', category: 'risk' },
          {
            id: 'c4_ltc', prompt: 'Target loan-to-cost (LTC) on development projects.', answerType: 'percent', category: 'risk',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 60, score: 5 }, { max: 70, score: 3 }, { max: 80, score: 2 }, { score: 1 }] },
              ruleText: '≤60% → 5 · 60–70% → 3 · 70–80% → 2 · >80% → 1',
              calibration: { high: 'Evercrest: 55–60% LTC vs 70–75% typical of the sector', mid: 'sector-typical 70–75%', low: 'dangerous leverage above 80%' },
            },
          },
          {
            id: 'c4_loan_events', prompt: 'Have you ever had a construction loan called, modified, or restructured mid-project due to cost overruns, covenant breach, or lender distress?', answerType: 'select', category: 'risk',
            options: ['Never', 'Modified once — resolved, no loss', 'Restructured under stress', 'Called / lender-forced outcome'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 2, 1] },
              ruleText: 'Never → 5 · one resolved modification → 3 · restructured → 2 · lender-forced → 1',
              calibration: { high: 'Evercrest: never (C.4 = No)', mid: 'covenant amendments, resolved', low: 'lender-forced sales' },
            },
          },
          {
            id: 'c4_hedge', prompt: 'Interest-rate risk management on floating-rate construction debt (caps / swaps, strike, tenor).', answerType: 'select', category: 'risk',
            options: ['All floating debt capped or swapped for full term', 'Partially hedged', 'Unhedged'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1] },
              ruleText: 'Fully hedged full-term → 5 · partial → 3 · unhedged → 1',
              calibration: { high: 'Evercrest: all floating construction debt capped for the full construction term', mid: 'partial hedges', low: 'unhedged floating exposure' },
            },
          },
        ],
      },
      {
        id: 'C5',
        title: 'C.5 Exit Strategy',
        questions: [
          { id: 'c5_exit', prompt: 'What are the planned exit strategies? How do you underwrite stabilized exit cap rates, and what assumptions drive projected sale price or recapitalization value?', answerType: 'longtext', category: 'liquidity' },
          { id: 'c5_missed', prompt: 'Describe instances where you were unable to execute your planned exit at the projected price. What happened and what was the ultimate outcome?', answerType: 'longtext', category: 'liquidity' },
        ],
      },
    ],
  },

  // ==========================================================================
  // SECTION D — REAL ESTATE ACQUISITION (module)
  // ==========================================================================
  {
    id: 'D',
    title: 'Section D — Real Estate Acquisition',
    module: 'RE-ACQ',
    intro: 'Complete for core, core-plus, value-add, or opportunistic acquisition strategies.',
    subsections: [
      {
        id: 'D1',
        title: 'D.1 Acquisition Strategy',
        questions: [
          { id: 'd1_strategy', prompt: 'Describe your acquisition strategy in detail: property types, geographies, risk profiles, and value-creation mechanisms. What creates your competitive differentiation?', answerType: 'longtext', category: 'strategy' },
          { id: 'd1_hold', prompt: 'Describe your target hold period by strategy type. How do you determine when to sell vs recapitalize vs hold for income?', answerType: 'longtext', category: 'liquidity' },
          { id: 'd1_sourcing', prompt: 'Describe your deal sourcing approach and how you cultivate proprietary deal flow.', answerType: 'longtext', category: 'strategy' },
          {
            id: 'd1_offmarket', prompt: 'Percentage of transactions sourced off-market or on a proprietary / limited-process basis.', answerType: 'percent', category: 'strategy',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 50, score: 5 }, { min: 25, score: 3 }, { min: 10, score: 2 }, { score: 1 }] },
              ruleText: '≥50% → 5 · 25–50% → 3 · 10–25% → 2 · <10% → 1',
              calibration: { high: 'Evercrest: >70% sourced proprietary / limited-process', mid: 'broker-led with some proprietary flow', low: 'fully auctioned, no edge' },
            },
          },
          {
            id: 'd1_funnel', prompt: 'Describe your deal funnel (annual averages).', answerType: 'table', category: 'strategy',
            columns: [{ key: 'stage', label: 'Funnel stage' }, { key: 'value', label: 'Annual figure' }],
            placeholder: 'Opportunities reviewed · advanced to underwriting · LOIs · PSAs · closed · avg closing timeline · avg deal size',
          },
        ],
      },
      {
        id: 'D2',
        title: 'D.2 Underwriting Discipline',
        questions: [
          { id: 'd2_process', prompt: 'Walk through your underwriting process step by step.', answerType: 'longtext', category: 'strategy' },
          {
            id: 'd2_unlev', prompt: 'Minimum going-in unlevered yield hurdle.', answerType: 'percent', category: 'strategy',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 7, score: 5 }, { min: 6, score: 4 }, { min: 5.5, score: 3 }, { min: 4.5, score: 2 }, { score: 1 }] },
              ruleText: '≥7% → 5 · 6–7% → 4 · 5.5–6% → 3 · 4.5–5.5% → 2 · <4.5% → 1',
              calibration: { high: 'Evercrest: 7%+ going-in unlevered yield', mid: '~6% market', low: 'priced for perfection' },
            },
          },
          {
            id: 'd2_lev_irr', prompt: 'Minimum levered IRR hurdle.', answerType: 'percent', category: 'strategy',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 14, score: 5 }, { min: 12, score: 4 }, { min: 11, score: 3 }, { min: 9, score: 2 }, { score: 1 }] },
              ruleText: '≥14% → 5 · 12–14% → 4 · 11–12% → 3 · 9–11% → 2 · <9% → 1',
              calibration: { high: 'Evercrest: 14%+ levered IRR', mid: '11–13%', low: 'no stated hurdle discipline' },
            },
          },
          {
            id: 'd2_em', prompt: 'Minimum equity multiple hurdle.', answerType: 'number', unit: '×', category: 'strategy',
            grading: {
              rule: { kind: 'bands', bands: [{ min: 1.6, score: 5 }, { min: 1.5, score: 4 }, { min: 1.4, score: 3 }, { min: 1.2, score: 2 }, { score: 1 }] },
              ruleText: '≥1.6x → 5 · 1.5–1.6x → 4 · 1.4–1.5x → 3 · 1.2–1.4x → 2 · <1.2x → 1',
              calibration: { high: 'Evercrest: 1.6x minimum equity multiple', mid: '~1.4–1.5x', low: 'none stated' },
            },
          },
          {
            id: 'd2_stress', prompt: 'Describe your stress testing methodology: rent growth deviation, exit cap expansion, vacancy increases, capital markets disruption.', answerType: 'select', category: 'risk',
            options: ['Combined multi-factor stress — asset must still return capital', 'Single-factor sensitivities only', 'Base case only'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 1] },
              ruleText: 'Combined stress, capital preserved → 5 · single-factor → 3 · base case only → 1',
              calibration: { high: 'Evercrest: 15% rent decline + 150bps exit-cap expansion + 300bps financing cost, combined', mid: 'sensitivities run, not binding', low: 'deals only work in benign base case' },
            },
          },
          { id: 'd2_replacement', prompt: 'What is your typical purchase price relative to replacement cost? How do you think about this discount as a margin of safety?', answerType: 'longtext', category: 'strategy' },
          { id: 'd2_dd', prompt: 'Describe your physical and environmental due diligence process (Phase I/II ESAs, property condition, structural). What are your non-negotiable red lines?', answerType: 'longtext', category: 'risk' },
          { id: 'd2_lease', prompt: 'Describe your lease audit and tenant credit underwriting process: tenant health, rollover exposure, concession risk, rent-to-sales for retail.', answerType: 'longtext', category: 'risk' },
        ],
      },
      {
        id: 'D3',
        title: 'D.3 Asset Management',
        questions: [
          { id: 'd3_platform', prompt: 'Describe your asset management platform. How many assets does each asset manager oversee? What is your reporting cadence to investors?', answerType: 'longtext', category: 'ops' },
          { id: 'd3_pm', prompt: 'How do you manage property management (internal vs third-party)? How do you select, monitor, and when necessary terminate property managers?', answerType: 'longtext', category: 'ops' },
          { id: 'd3_capex', prompt: 'Describe your CapEx reserve policy and capital improvement process. How do you underwrite ROI on value-add renovations?', answerType: 'longtext', category: 'ops' },
          { id: 'd3_underperform', prompt: 'Describe instances where a value-add business plan did not perform as underwritten. What went wrong and how did you respond?', answerType: 'longtext', category: 'track' },
        ],
      },
      {
        id: 'D4',
        title: 'D.4 Financing & Leverage Policy',
        questions: [
          {
            id: 'd4_leverage', prompt: 'Target leverage (LTV) at acquisition, blended across strategies.', answerType: 'percent', category: 'risk',
            grading: {
              rule: { kind: 'bands', bands: [{ max: 60, score: 5 }, { max: 70, score: 3 }, { max: 80, score: 2 }, { score: 1 }] },
              ruleText: '≤60% → 5 · 60–70% → 3 · 70–80% → 2 · >80% → 1',
              calibration: { high: 'Evercrest: moderate leverage, value from operations not debt', mid: 'moderate (not conservative) leverage', low: 'dangerous leverage, covenant-lite' },
            },
          },
          { id: 'd4_loan_types', prompt: 'What loan types do you use by strategy (core, core-plus, value-add)?', answerType: 'text', category: 'risk' },
          {
            id: 'd4_events', ilpa: '4.16 / 14.2', prompt: 'Have any acquired properties experienced loan maturity default, covenant breach, lender-requested restructuring, or forced sale?', answerType: 'select', category: 'risk',
            options: ['None', 'Covenant amendments — resolved without loss', 'Maturity default or restructuring', 'Lender-forced sale or foreclosure'],
            grading: {
              rule: { kind: 'select', scores: [5, 3, 2, 1] },
              ruleText: 'None → 5 · resolved amendments → 3 · default/restructuring → 2 · forced sale → 1',
              calibration: { high: 'Evercrest: none ever (D.5 = No)', mid: 'Marston: several covenant amendments, resolved', low: 'Halcyon: lender-forced sales' },
            },
          },
          {
            id: 'd4_refi', prompt: 'Do investor distributions depend on a cash-out refinancing event?', answerType: 'boolean', category: 'liquidity',
            grading: {
              rule: { kind: 'boolean', yes: 1, no: 5 },
              ruleText: 'Funded by in-place cash flow → 5 · refi-dependent → 1 (red flag)',
              calibration: { high: 'Evercrest: No — distributions funded by in-place cash flow', mid: 'partially', low: 'distributions depend on refinancing that may not come' },
            },
          },
          { id: 'd4_refi_plan', prompt: 'How do you manage refinancing risk at loan maturity?', answerType: 'longtext', category: 'liquidity' },
          { id: 'd4_wadm', prompt: 'Current weighted average debt maturity across the portfolio (years).', answerType: 'number', unit: 'yrs', category: 'liquidity' },
        ],
      },
    ],
  },
]

// ----------------------------------------------------------------------------
// Derived collections
// ----------------------------------------------------------------------------

export const ALL_QUESTIONS: DDQQuestion[] = DDQ_SECTIONS.flatMap(s => s.subsections.flatMap(ss => ss.questions))
export const GRADED_QUESTIONS: DDQQuestion[] = ALL_QUESTIONS.filter(q => q.grading)

// ----------------------------------------------------------------------------
// Grading math (pure, testable with node)
// ----------------------------------------------------------------------------

export function isAnswered(_q: DDQQuestion, v: AnswerValue | undefined): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'boolean') return true
  if (Array.isArray(v)) return v.some(row => row.some(cell => (cell || '').trim() !== ''))
  return false
}

// Auto-score a single answer against its grading hint. Returns null when the
// question is ungraded or unanswered.
export function autoScore(q: DDQQuestion, v: AnswerValue | undefined): number | null {
  if (!q.grading || !isAnswered(q, v)) return null
  const r = q.grading.rule
  if (r.kind === 'boolean') return v === true ? r.yes : r.no
  if (r.kind === 'select') {
    const idx = (q.options || []).indexOf(String(v))
    return idx >= 0 ? r.scores[idx] : null
  }
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) return null
  for (const band of r.bands) {
    if (band.min !== undefined && n < band.min) continue
    if (band.max !== undefined && n > band.max) continue
    return band.score
  }
  return null
}

// Hard-fail check for a single answer. Returns the override note when triggered.
export function hardFailOf(q: DDQQuestion, v: AnswerValue | undefined): string | null {
  if (!q.grading?.hardFail || !isAnswered(q, v)) return null
  const hf = q.grading.hardFail
  if (typeof hf.on === 'boolean') return v === hf.on ? hf.note : null
  return String(v) === hf.on ? hf.note : null
}

export interface GradedField { qid: string; prompt: string; score: number; ruleText: string; category: CategoryId }
export interface CategoryGrade {
  id: CategoryId
  name: string
  weight: number
  auto: GradedField[]
  autoAvg: number | null
  subjective: number | null
  score: number | null // 50/50 blend when both exist; otherwise whichever exists
}
export interface GradingResult {
  perCategory: CategoryGrade[]
  composite: number | null
  band: 'HIGH' | 'MID' | 'LOW' | null
  uncappedBand: 'HIGH' | 'MID' | 'LOW' | null
  hardFails: { qid: string; prompt: string; note: string }[]
  redFlags: GradedField[] // every auto-graded 1
}

export function bandOf(composite: number): 'HIGH' | 'MID' | 'LOW' {
  // Band edges tuned to the exemplars: Evercrest grades ~5 on nearly every
  // calibrated field (HIGH ≥ 4.0); Marston lands ~3 (MID ≥ 2.75); Halcyon
  // bottoms out near 1 and additionally trips hard-fail overrides.
  if (composite >= 4.0) return 'HIGH'
  if (composite >= 2.75) return 'MID'
  return 'LOW'
}

export function computeGrading(
  answers: Record<string, AnswerValue>,
  subjective: Partial<Record<CategoryId, number>>,
  weights: Partial<Record<CategoryId, number>>,
): GradingResult {
  const perCategory: CategoryGrade[] = RISK_CATEGORIES.map(cat => {
    const auto: GradedField[] = []
    for (const q of GRADED_QUESTIONS) {
      if (q.category !== cat.id) continue
      const s = autoScore(q, answers[q.id])
      if (s !== null) auto.push({ qid: q.id, prompt: q.prompt, score: s, ruleText: q.grading!.ruleText, category: cat.id })
    }
    const autoAvg = auto.length ? auto.reduce((s, f) => s + f.score, 0) / auto.length : null
    const subjRaw = subjective[cat.id]
    const subj = typeof subjRaw === 'number' && subjRaw >= 1 && subjRaw <= 5 ? subjRaw : null
    const score = autoAvg !== null && subj !== null ? (autoAvg + subj) / 2 : autoAvg !== null ? autoAvg : subj
    return { id: cat.id, name: cat.name, weight: weights[cat.id] ?? cat.weight, auto, autoAvg, subjective: subj, score }
  })

  const scored = perCategory.filter(c => c.score !== null && c.weight > 0)
  const wSum = scored.reduce((s, c) => s + c.weight, 0)
  const composite = wSum > 0 ? scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wSum : null

  const hardFails: GradingResult['hardFails'] = []
  const redFlags: GradedField[] = []
  for (const q of GRADED_QUESTIONS) {
    const v = answers[q.id]
    const hf = hardFailOf(q, v)
    if (hf) hardFails.push({ qid: q.id, prompt: q.prompt, note: hf })
    const s = autoScore(q, v)
    if (s === 1) redFlags.push({ qid: q.id, prompt: q.prompt, score: s, ruleText: q.grading!.ruleText, category: q.category })
  }

  const uncappedBand = composite !== null ? bandOf(composite) : null
  const band = hardFails.length > 0 ? 'LOW' : uncappedBand
  return { perCategory, composite, band, uncappedBand, hardFails, redFlags }
}
