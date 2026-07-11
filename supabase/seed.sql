-- Seed: Gate 1 threshold config v1 = the shipped spec defaults (generated from default-config.json)
insert into threshold_configs (version, author, note, config) values (1, 'seed', 'Spec-proposed defaults: Gate 1 bands + macro signals/quadrant + return benchmarks', '{
  "note": "Gate 1 config v1 — every number here is spec-proposed and editable; nothing is hardcoded in the engine. Sources: RE_Development_Gate1_Spec.xlsx, Macro_Overlay_Spec.xlsx, Developer Guide (Gate 1 + Weekly Macro Snapshot). Open spec decisions ship as the spec-proposed default (incl. the mini-stress parameters pending the client''s ''300 bps'' clarification).",
  "checks": [
    {
      "id": "sponsor_integrity",
      "kind": "kill",
      "label": "Sponsor integrity",
      "thresholdKeys": [],
      "tip": "Any SEC/FINRA action, felony, or undisclosed litigation fails the deal outright. Character problems don''t average out against good numbers."
    },
    {
      "id": "site_entitled",
      "kind": "kill",
      "label": "Site fully entitled",
      "thresholdKeys": [],
      "tip": "If the land isn''t zoned and approved for the planned project, the whole business plan rests on a permission nobody has granted yet."
    },
    {
      "id": "ltc_max",
      "kind": "kill",
      "label": "Loan-to-cost",
      "thresholdKeys": ["ltc_max"],
      "tip": "Debt as a share of total project cost. Above the line, the equity cushion is too thin to absorb overruns or a soft exit."
    },
    {
      "id": "dev_spread_min",
      "kind": "kill",
      "label": "Development spread",
      "thresholdKeys": ["dev_spread_min_bps"],
      "tip": "Untrended yield-on-cost minus exit cap rate — the margin for building instead of buying. Below the kill line there is no reward for taking development risk. The kill line tightens as macro posture worsens."
    },
    {
      "id": "contingency_min",
      "kind": "kill",
      "label": "Hard-cost contingency",
      "thresholdKeys": ["contingency_min"],
      "tip": "Budget reserve for cost overruns as a share of hard costs. Thin contingency is one of the most common ways development deals die."
    },
    {
      "id": "coinvest_min",
      "kind": "kill",
      "label": "Sponsor co-invest",
      "thresholdKeys": ["coinvest_min"],
      "tip": "Sponsor''s own cash as a share of total equity — skin in the game. Alignment below the floor means the sponsor is playing with other people''s money."
    },
    {
      "id": "track_record",
      "kind": "kill",
      "label": "Comparable track record",
      "thresholdKeys": ["track_record_min"],
      "tip": "Number of comparable projects the sponsor has actually completed. Zero comparable completions means the LP is funding a first attempt."
    },
    {
      "id": "single_exit_refi",
      "kind": "kill",
      "label": "Single-exit refi dependence",
      "thresholdKeys": [],
      "tip": "If returning capital depends entirely on one future cash-out refinancing, the deal is a bet on credit markets years from now."
    },
    {
      "id": "gmp_required",
      "kind": "kill",
      "label": "GMP contract / bonded GC",
      "thresholdKeys": ["gmp_cost_threshold_usd"],
      "tip": "On large jobs, a guaranteed-maximum-price contract or bonded general contractor caps construction-cost blowouts. Above the size threshold, its absence is fatal."
    },
    {
      "id": "mini_stress",
      "kind": "kill",
      "label": "Mini-stress equity multiple",
      "thresholdKeys": [
        "stress_em_floor",
        "stress_hard_cost_bump",
        "stress_exit_cap_bump_bps",
        "stress_selling_costs"
      ],
      "tip": "The only real math in Gate 1: bump hard costs (equity-funded), widen the exit cap, charge selling costs, use untrended NOI — the levered equity multiple must still clear the floor. The floor rises as macro posture worsens."
    },
    {
      "id": "yoc_vs_benchmark",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Yield-on-cost vs benchmark",
      "thresholdKeys": ["yoc_min"],
      "tip": "Stabilized untrended NOI over all-in cost, against the product-type benchmark. Specialty products (RV resorts) are held to a higher bar than multifamily."
    },
    {
      "id": "exit_cap_vs_market",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Exit cap vs today''s market",
      "thresholdKeys": [],
      "tip": "Assuming you''ll sell at a lower cap rate than today''s market is a bet that pricing improves. It flags — the burden of proof shifts to the sponsor."
    },
    {
      "id": "interest_reserve",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Interest reserve coverage",
      "thresholdKeys": ["interest_reserve_buffer_months"],
      "tip": "The interest reserve should cover construction plus a lease-up buffer. A short reserve means a capital call the moment anything slips."
    },
    {
      "id": "land_basis",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Land basis share",
      "thresholdKeys": ["land_basis_max"],
      "tip": "Land as a share of total cost. Overpaying for land can''t be built out of. RV/outdoor deals get a stricter cap because improvements are cheaper."
    },
    {
      "id": "rents_vs_comps",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Underwritten rents vs comps",
      "thresholdKeys": ["rent_premium_flag", "rent_premium_severe"],
      "tip": "Rents assumed above market comps must be justified. A modest premium flags once; a large premium flags double."
    },
    {
      "id": "absorption",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Absorption vs submarket",
      "thresholdKeys": [],
      "tip": "Leasing up faster than the submarket''s trailing record assumes this project outruns everyone else''s experience."
    },
    {
      "id": "profit_margin",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Profit margin on cost",
      "thresholdKeys": ["profit_margin_min"],
      "tip": "Untrended exit value over total cost, minus one. Thin development margins leave no room between plan and reality."
    },
    {
      "id": "completion_guarantee",
      "kind": "flag",
      "flagPoints": 1,
      "label": "Completion guarantee",
      "thresholdKeys": ["guarantor_net_worth_min_pct"],
      "tip": "Someone credit-worthy should guarantee the building gets finished — a guarantor worth at least the configured share of total cost."
    }
  ],
  "thresholds": [
    { "asset_class": "*", "posture": "*", "key": "ltc_max", "value": 0.75 },
    { "asset_class": "*", "posture": "green", "key": "dev_spread_min_bps", "value": 125 },
    { "asset_class": "*", "posture": "yellow", "key": "dev_spread_min_bps", "value": 175 },
    { "asset_class": "*", "posture": "red", "key": "dev_spread_min_bps", "value": 225 },
    { "asset_class": "*", "posture": "*", "key": "contingency_min", "value": 0.05 },
    { "asset_class": "*", "posture": "*", "key": "coinvest_min", "value": 0.05 },
    { "asset_class": "*", "posture": "*", "key": "track_record_min", "value": 1 },
    { "asset_class": "*", "posture": "*", "key": "gmp_cost_threshold_usd", "value": 10000000 },
    { "asset_class": "*", "posture": "green", "key": "stress_hard_cost_bump", "value": 0.10 },
    { "asset_class": "*", "posture": "yellow", "key": "stress_hard_cost_bump", "value": 0.12 },
    { "asset_class": "*", "posture": "red", "key": "stress_hard_cost_bump", "value": 0.15 },
    { "asset_class": "*", "posture": "green", "key": "stress_exit_cap_bump_bps", "value": 25 },
    { "asset_class": "*", "posture": "yellow", "key": "stress_exit_cap_bump_bps", "value": 50 },
    { "asset_class": "*", "posture": "red", "key": "stress_exit_cap_bump_bps", "value": 75 },
    { "asset_class": "*", "posture": "green", "key": "stress_em_floor", "value": 1.20 },
    { "asset_class": "*", "posture": "yellow", "key": "stress_em_floor", "value": 1.30 },
    { "asset_class": "*", "posture": "red", "key": "stress_em_floor", "value": 1.40 },
    { "asset_class": "*", "posture": "*", "key": "stress_selling_costs", "value": 0.02 },
    { "asset_class": "*", "posture": "*", "key": "yoc_min", "value": 0.07 },
    { "asset_class": "multifamily", "posture": "*", "key": "yoc_min", "value": 0.0625 },
    { "asset_class": "rv_specialty", "posture": "*", "key": "yoc_min", "value": 0.095 },
    { "asset_class": "*", "posture": "*", "key": "land_basis_max", "value": 0.30 },
    { "asset_class": "rv_specialty", "posture": "*", "key": "land_basis_max", "value": 0.20 },
    { "asset_class": "*", "posture": "*", "key": "rent_premium_flag", "value": 0.05 },
    { "asset_class": "*", "posture": "*", "key": "rent_premium_severe", "value": 0.10 },
    { "asset_class": "*", "posture": "*", "key": "interest_reserve_buffer_months", "value": 6 },
    { "asset_class": "*", "posture": "*", "key": "profit_margin_min", "value": 0.15 },
    { "asset_class": "*", "posture": "*", "key": "guarantor_net_worth_min_pct", "value": 0.15 },
    { "asset_class": "*", "posture": "*", "key": "fragile_margin_pct", "value": 0.10 },
    { "asset_class": "*", "posture": "*", "key": "coc_benchmark", "value": 0.08 },
    { "asset_class": "*", "posture": "*", "key": "irr_benchmark", "value": 0.12 },
    { "asset_class": "*", "posture": "*", "key": "equity_multiple_benchmark", "value": 1.8 },
    { "asset_class": "*", "posture": "*", "key": "financing_spread_typical_bps", "value": 250 }
  ],
  "verdictBands": { "passMaxFlagPts": 1, "conditionalMaxFlagPts": 3 },
  "macro": {
    "signalWeights": {
      "sahm": 2.0,
      "core_pce": 1.5,
      "gdp": 1.5,
      "hy_spread": 1.5,
      "unemployment": 1.0,
      "yield_curve": 1.0,
      "jobless_claims": 1.0,
      "ism": 0.5
    },
    "signals": [
      { "id": "sahm", "label": "Sahm rule", "fred": "SAHMREALTIME", "weight": 2.0, "transform": "level", "direction": "high_is_bad", "green": 0.2, "yellow": 0.45 },
      { "id": "core_pce", "label": "Core PCE inflation (yoy)", "fred": "PCEPILFE", "weight": 1.5, "transform": "yoy", "direction": "high_is_bad", "green": 0.025, "yellow": 0.035 },
      { "id": "gdp", "label": "Real GDP growth (yoy)", "fred": "GDPC1", "weight": 1.5, "transform": "yoy", "direction": "high_is_good", "green": 0.02, "yellow": 0.005 },
      { "id": "hy_spread", "label": "High-yield spread", "fred": "BAMLH0A0HYM2", "weight": 1.5, "transform": "level", "direction": "high_is_bad", "green": 4.0, "yellow": 5.5 },
      { "id": "unemployment", "label": "Unemployment rate", "fred": "UNRATE", "weight": 1.0, "transform": "level", "direction": "high_is_bad", "green": 4.5, "yellow": 5.5 },
      { "id": "yield_curve", "label": "Yield curve (10y–3m)", "fred": "T10Y3M", "weight": 1.0, "transform": "level", "direction": "high_is_good", "green": 0.5, "yellow": 0.0 },
      { "id": "jobless_claims", "label": "Initial jobless claims (4-wk avg)", "fred": "IC4WSA", "weight": 1.0, "transform": "level", "direction": "high_is_bad", "green": 260000, "yellow": 320000 },
      { "id": "ism", "label": "ISM manufacturing PMI (manual)", "fred": null, "weight": 0.5, "transform": "level", "direction": "high_is_good", "green": 52, "yellow": 48 }
    ],
    "quadrantBands": { "inflationHotYoy": 0.025, "growthRecessionYoy": 0.0 },
    "postureMatrix": {
      "soft_landing": { "*": "green" },
      "stagflation": { "*": "yellow" },
      "recession": { "*": "red", "private_credit": "yellow", "secondaries": "yellow" }
    },
    "hysteresisWins": 2,
    "minVotes": 4,
    "hurdleStack": {
      "anchorPct": 0.08,
      "illiquidityBpsByLockupYears": [
        { "maxYears": 3, "bps": 150 },
        { "maxYears": 5, "bps": 250 },
        { "maxYears": 7, "bps": 325 },
        { "maxYears": 99, "bps": 400 }
      ],
      "complexityBpsByStrategy": {
        "development": 250,
        "value_add": 150,
        "core_plus": 75
      },
      "regimeBps": { "soft_landing": 0, "stagflation": 100, "recession": 200 }
    }
  }
}
'::jsonb) on conflict (version) do nothing;
