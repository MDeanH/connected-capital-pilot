// Plain-English glossary for underwriting terms and this product's own
// verdict/posture semantics. Rendered via <Term k="..."> (GlossaryTip.tsx).

export interface GlossaryEntry {
  term: string
  short: string
  long?: string
  formula?: string
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  irr: {
    term: 'IRR',
    short: 'Internal rate of return — the annualized return implied by when cash goes out and comes back.',
    long: 'Timing-sensitive: the same profit earned faster means a higher IRR, so it rewards quick exits.',
    formula: 'NPV(cashflows, IRR) = 0',
  },
  equity_multiple: {
    term: 'Equity multiple',
    short: 'Total cash returned divided by total equity invested.',
    long: 'Ignores timing — a 1.8x over 2 years and over 6 years look the same, so read it alongside IRR.',
    formula: 'EM = total distributions / equity invested',
  },
  dscr: {
    term: 'DSCR',
    short: 'Debt service coverage ratio — operating income divided by loan payments.',
    long: 'Below 1.0x the property cannot pay its own debt; lenders typically want 1.20–1.25x or better.',
    formula: 'DSCR = NOI / annual debt service',
  },
  ltc: {
    term: 'LTC',
    short: 'Loan-to-cost — the share of total project cost funded by debt.',
    long: 'Higher LTC means more leverage: bigger equity returns if it works, thinner cushion if it does not.',
    formula: 'LTC = loan amount / total project cost',
  },
  dev_spread: {
    term: 'Development spread',
    short: 'Yield-on-cost minus the market exit cap rate — the margin for building instead of buying.',
    long: 'A thin spread means you are taking construction risk for a return you could nearly buy stabilized.',
    formula: 'spread = YoC − exit cap',
  },
  yoc: {
    term: 'Yield on cost',
    short: 'Stabilized net operating income divided by total project cost.',
    long: 'The return the project earns on every dollar it took to build, before any sale or refinance.',
    formula: 'YoC = stabilized NOI / total cost',
  },
  exit_cap: {
    term: 'Exit cap rate',
    short: 'The cap rate assumed when the finished project is sold or valued.',
    long: 'Small changes move value a lot; assuming a lower exit cap than today is a common way decks flatter returns.',
    formula: 'exit value = NOI / exit cap',
  },
  contingency: {
    term: 'Contingency',
    short: 'The budget buffer set aside for cost overruns.',
    long: 'Ground-up deals typically carry 5–10% of hard costs; a skinny contingency shifts overrun risk onto equity.',
  },
  coinvest: {
    term: 'GP co-invest',
    short: 'The sponsor’s own cash in the deal alongside investors.',
    long: 'Real skin in the game aligns incentives — check it is cash, not fees or promote credited back.',
  },
  hurdle: {
    term: 'Hurdle rate',
    short: 'The return investors must receive before the sponsor shares in profits.',
    long: 'Above the hurdle, the waterfall splits profits toward the sponsor — the hurdle protects the base return.',
  },
  sahm_rule: {
    term: 'Sahm rule',
    short: 'A recession signal: unemployment rising 0.5 points above its recent 12-month low.',
    long: 'One of the macro signals feeding this tool’s posture; it flags recessions early with few false alarms.',
    formula: 'trigger: 3-mo avg U3 − 12-mo min ≥ 0.50',
  },
  posture: {
    term: 'Posture',
    short: 'The Green/Yellow/Red risk stance computed from 8 weighted macro signals.',
    long: 'Posture shifts the gate thresholds: the same deal must clear higher bars in Yellow, higher still in Red.',
  },
  regime: {
    term: 'Regime',
    short: 'The prevailing macro environment (rates, credit, labor) the posture signals summarize.',
    long: 'Deals are underwritten against the regime they will actually deliver into, not the one in the deck.',
  },
  mini_stress: {
    term: 'Mini-stress',
    short: 'A quick downside test: bump hard costs (funded from equity), widen the exit cap, and add selling costs on untrended NOI.',
    long: 'The levered equity multiple under stress must clear a posture-dependent floor — a deal that only works in the base case fails here.',
  },
  watch_flag: {
    term: 'Watch flag',
    short: 'A non-fatal concern that earns flag points instead of failing the deal.',
    long: 'Flags accumulate: 2–3 points push the verdict to CONDITIONAL, 4 or more to FAIL.',
  },
  hard_kill: {
    term: 'Hard kill',
    short: 'A breach that fails the deal outright — one is enough.',
    long: 'No amount of strength elsewhere offsets a kill; it marks risk the rulebook refuses to average away.',
  },
  verdict: {
    term: 'Verdict',
    short: 'The rulebook’s bottom line: PASS, CONDITIONAL, FAIL, or REVIEW.',
    long: 'PASS = no kills and ≤1 flag point; CONDITIONAL = 2–3 points; FAIL = any kill or ≥4 points; REVIEW = missing data — missing never passes.',
  },
  land_basis: {
    term: 'Land basis',
    short: 'What the deal carries the land at, as a share of total cost.',
    long: 'An inflated land basis (e.g. marked up from recent purchase price) pads the budget in the sponsor’s favor.',
  },
  interest_reserve: {
    term: 'Interest reserve',
    short: 'Money set aside in the budget to pay the construction loan’s interest before the project earns income.',
    long: 'If the reserve is undersized for the real timeline, the sponsor comes back to equity mid-build.',
  },
  absorption: {
    term: 'Absorption',
    short: 'How fast the market leases or sells new units.',
    long: 'Underwriting faster absorption than the market has demonstrated stretches lease-up and burns reserves.',
  },
  profit_margin: {
    term: 'Profit margin',
    short: 'Projected profit as a share of total project cost.',
    long: 'The cushion between cost and value at exit — the first thing overruns and softer pricing eat.',
    formula: 'margin = (exit value − total cost) / total cost',
  },
  completion_guarantee: {
    term: 'Completion guarantee',
    short: 'The sponsor’s promise to the lender to finish the building regardless of overruns.',
    long: 'Its value is only as good as the guarantor’s balance sheet — check net worth and liquidity behind it.',
  },
  track_record: {
    term: 'Track record',
    short: 'The sponsor’s history of comparable completed deals.',
    long: 'Relevant means same product type, similar size, and full-cycle results — not just deals currently in flight.',
  },
  single_exit_refi: {
    term: 'Single-exit refi',
    short: 'A plan that only works if one specific refinancing happens on schedule.',
    long: 'With no credible sale fallback, the deal is hostage to rate and lender conditions at one future moment.',
  },
  gmp: {
    term: 'GMP contract',
    short: 'Guaranteed maximum price — the builder caps construction cost by contract.',
    long: 'Shifts overrun risk to the contractor; without one, the budget is an estimate, not a commitment.',
  },
  rents_vs_comps: {
    term: 'Rents vs. comps',
    short: 'How the deal’s projected rents compare with what nearby comparable properties actually achieve.',
    long: 'Projections meaningfully above comps need a specific, verifiable reason — otherwise the NOI is aspirational.',
  },
  fragile_pass: {
    term: 'Fragile pass',
    short: 'A deal that passes the gates but with almost no margin to spare.',
    long: 'Small input changes would flip it — treat it closer to CONDITIONAL than to a comfortable PASS.',
  },
  baseline_verdict: {
    term: 'Baseline verdict',
    short: 'What the rulebook said before any manual judgment adjustments.',
    long: 'Kept visible so an adjusted verdict can always be compared against the untouched rulebook output.',
  },
  judgment_adjustment: {
    term: 'Judgment adjustment',
    short: 'A per-deal manual change to a threshold, with a required written reason.',
    long: 'Always logged: every adjustment records which threshold moved, by how much, and why.',
  },
  cash_on_cash: {
    term: 'Cash-on-cash',
    short: 'Annual cash flow after debt service divided by the equity invested.',
    long: 'The "what hits the bank account each year" return, separate from sale proceeds. Derived here from stabilized NOI, the loan terms, and equity.',
    formula: 'CoC = (NOI \u2212 annual debt service) / equity',
  },
  financing: {
    term: 'Financing vs market',
    short: 'The loan rate the deal assumes, compared against prevailing rates (SOFR plus a typical spread).',
    long: 'A modeled rate meaningfully below what the market charges today means the returns lean on financing nobody is offering.',
  },
  sofr: {
    term: 'SOFR',
    short: 'The Secured Overnight Financing Rate \u2014 the base rate US lenders price loans from.',
    long: 'Construction loans are typically quoted as SOFR plus a spread, so it anchors the "is this loan realistic" check.',
  },
  quadrant: {
    term: 'Macro quadrant',
    short: 'Which of the four macro states we are in: inflation or disinflation, crossed with expansion or contraction.',
    long: 'Inflationary expansion, disinflationary expansion (goldilocks), stagflation, or deflationary contraction \u2014 the one-look answer to "what kind of economy is this deal being born into."',
  },
  sp500_comparison: {
    term: 'vs. S&P 500',
    short: 'The deal\u2019s projected return against what the public market returned over comparable windows.',
    long: 'Private deals lock money up and add complexity \u2014 they must clear the liquid alternative by a real margin, not just match it.',
  },
  p_loss: {
    term: 'P(loss)',
    short: 'The share of simulated outcomes where the annualized return over the hold comes out negative.',
    long: 'From 20,000 Monte Carlo paths drawn from the de-smoothed market return distribution plus a deal idiosyncratic layer.',
  },
  de_smoothing: {
    term: 'De-smoothing',
    short: 'Appraisal-based indices lag and smooth true prices, so their volatility reads too low.',
    long: 'Geltner de-smoothing reverses the lag before simulating \u2014 risk is measured from the recovered series, never the flattering smoothed one.',
    formula: 'r*_t = (r_t \u2212 \u03c6\u00b7r_{t\u22121}) / (1 \u2212 \u03c6)',
  },
}
