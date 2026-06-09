/**
 * TypeScript port of the DDQ -> bias-parameter scorecard (ddq_bias.py).
 * Converts qualitative DDQ answers into bounded, auditable bias_mu / sigma_mult /
 * book_correlation. The qualitative layer ADJUSTS the empirical base; caps stop it
 * from fabricating a score. Illustrative priors -> calibrate to the client's outcomes.
 */

export interface Opt { key: string; label: string; mu?: number; sigmaMult?: number; corr?: number; note?: string; }
export interface Field { key: string; question: string; options: Opt[]; }

const MU_CAP = 0.10;
const SIGMA_BOUNDS: [number, number] = [0.6, 2.5];
const CORR_BOUNDS: [number, number] = [0.0, 0.95];

export const SCORECARD: Field[] = [
  { key: 'sponsor_track_record', question: "Sponsor's realized track record on comparable deals?", options: [
    { key: 'first_time', label: 'First-time / no realized exits', mu: -0.030, sigmaMult: 1.35, note: 'Execution risk, no proof of cycle survival.' },
    { key: 'emerging', label: 'Some exits, short history', mu: -0.010, sigmaMult: 1.15, note: 'Limited but non-zero evidence.' },
    { key: 'established', label: 'Multiple realized exits at target', mu: 0.020, sigmaMult: 0.95, note: 'Demonstrated repeatability.' },
    { key: 'institutional', label: 'Long institutional track record', mu: 0.035, sigmaMult: 0.85, note: 'Deep, cycle-tested, audited returns.' },
  ] },
  { key: 'alignment', question: 'Sponsor co-investment / alignment of interest?', options: [
    { key: 'none', label: 'No meaningful GP co-invest', mu: -0.010, sigmaMult: 1.10, note: 'Weak alignment.' },
    { key: 'modest', label: 'Standard GP co-invest (~5-10%)', mu: 0.0, sigmaMult: 1.0, note: 'Market-standard alignment.' },
    { key: 'strong', label: 'Large GP co-invest (>10%)', mu: 0.010, sigmaMult: 0.95, note: 'Strong alignment.' },
  ] },
  { key: 'business_plan', question: 'Business-plan risk profile?', options: [
    { key: 'core', label: 'Core / stabilized', mu: -0.010, sigmaMult: 0.80, note: 'Low risk, low spread.' },
    { key: 'core_plus', label: 'Core-plus / light value-add', mu: 0.0, sigmaMult: 0.95, note: 'Modest reposition.' },
    { key: 'value_add', label: 'Heavy value-add / reposition', mu: 0.020, sigmaMult: 1.25, note: 'Material execution & lease-up risk.' },
    { key: 'opportunistic', label: 'Ground-up dev / opportunistic', mu: 0.035, sigmaMult: 1.60, note: 'Highest upside and highest variance.' },
  ] },
  { key: 'leverage_ltv', question: 'Leverage (loan-to-value)?', options: [
    { key: 'low', label: 'Low (<50% LTV)', mu: -0.005, sigmaMult: 0.85, note: 'De-risked, lower equity return.' },
    { key: 'moderate', label: 'Moderate (50-65% LTV)', mu: 0.0, sigmaMult: 1.0, note: 'Market-standard.' },
    { key: 'high', label: 'High (65-75% LTV)', mu: 0.015, sigmaMult: 1.30, note: 'Amplified equity return and risk.' },
    { key: 'very_high', label: 'Very high (>75% LTV)', mu: 0.025, sigmaMult: 1.70, note: 'Refinance/default risk if plan slips.' },
  ] },
  { key: 'market_quality', question: 'Market tier / liquidity?', options: [
    { key: 'gateway', label: 'Gateway / primary', mu: 0.005, sigmaMult: 0.90, note: 'Deep, liquid, lower exit risk.' },
    { key: 'secondary', label: 'Strong secondary', mu: 0.0, sigmaMult: 1.0, note: 'Adequate liquidity.' },
    { key: 'tertiary', label: 'Tertiary / thin', mu: 0.010, sigmaMult: 1.30, note: 'Higher yield, thinner exit, more risk.' },
  ] },
  { key: 'asset_status', question: 'Asset operating status at entry?', options: [
    { key: 'stabilized', label: 'Stabilized / high occupancy', mu: 0.0, sigmaMult: 0.90, note: 'In-place cash flow.' },
    { key: 'transitional', label: 'Lease-up / transitional', mu: 0.010, sigmaMult: 1.20, note: 'Occupancy ramp risk.' },
    { key: 'predev', label: 'Pre-development / entitlement', mu: 0.020, sigmaMult: 1.55, note: 'Entitlement & timing risk.' },
  ] },
  { key: 'downside_protection', question: 'Structural downside protection (pref, guarantees, seniority)?', options: [
    { key: 'none', label: 'Common equity, no protection', mu: 0.0, sigmaMult: 1.10, note: 'Full equity risk.' },
    { key: 'pref', label: 'Preferred return / waterfall', mu: 0.0, sigmaMult: 0.92, note: 'Downside cushion.' },
    { key: 'secured', label: 'Secured / guaranteed component', mu: -0.005, sigmaMult: 0.80, note: 'Materially de-risked.' },
  ] },
  { key: 'correlation_to_book', question: 'How correlated is this deal with the existing book?', options: [
    { key: 'diversifying', label: 'Diversifying (new market/strategy)', corr: 0.10, note: 'Adds diversification.' },
    { key: 'moderate', label: 'Moderately correlated', corr: 0.40, note: 'Some overlap with book.' },
    { key: 'concentrated', label: 'Highly correlated (same market/sponsor)', corr: 0.75, note: 'Concentration risk -> size down.' },
  ] },
  { key: 'comp_quality', question: 'Quality of the underwriting comps / data?', options: [
    { key: 'strong', label: 'Strong, recent, directly comparable', sigmaMult: 0.95, note: 'Tight underwriting.' },
    { key: 'fair', label: 'Fair / partially comparable', sigmaMult: 1.05, note: 'Some uncertainty.' },
    { key: 'weak', label: 'Weak / sparse comps', sigmaMult: 1.25, note: 'Wide uncertainty; flag low confidence.' },
  ] },
];

const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, x));

export interface DdqResult { biasMu: number; sigmaMult: number; bookCorr: number; drivers: { field: string; answer: string; muDelta: number; sigmaMult: number; note: string }[]; warnings: string[]; }

export function applyDdq(answers: Record<string, string>): DdqResult {
  let totalMu = 0, sigmaMult = 1, bookCorr = 0;
  const drivers: DdqResult['drivers'] = [];
  const warnings: string[] = [];
  for (const f of SCORECARD) {
    const ans = answers[f.key];
    const opt = f.options.find((o) => o.key === ans);
    if (!opt) { warnings.push(`Unanswered/invalid: '${f.key}' -> treated as neutral.`); continue; }
    totalMu += opt.mu ?? 0;
    sigmaMult *= opt.sigmaMult ?? 1;
    if (opt.corr != null) bookCorr = Math.max(bookCorr, opt.corr);
    drivers.push({ field: f.key, answer: opt.label, muDelta: opt.mu ?? 0, sigmaMult: opt.sigmaMult ?? 1, note: opt.note ?? '' });
  }
  const cappedMu = clamp(totalMu, [-MU_CAP, MU_CAP]);
  if (Math.abs(cappedMu - totalMu) > 1e-9) warnings.push(`bias_mu ${totalMu.toFixed(3)} capped to ${cappedMu.toFixed(3)} (qualitative layer bounded).`);
  drivers.sort((a, b) => (Math.abs(b.muDelta) - Math.abs(a.muDelta)) || (Math.abs(b.sigmaMult - 1) - Math.abs(a.sigmaMult - 1)));
  return {
    biasMu: +cappedMu.toFixed(4),
    sigmaMult: +clamp(sigmaMult, SIGMA_BOUNDS).toFixed(4),
    bookCorr: +clamp(bookCorr, CORR_BOUNDS).toFixed(4),
    drivers, warnings,
  };
}

export const DEFAULT_ANSWERS: Record<string, string> = {
  sponsor_track_record: 'established', alignment: 'modest', business_plan: 'value_add',
  leverage_ltv: 'moderate', market_quality: 'secondary', asset_status: 'transitional',
  downside_protection: 'pref', correlation_to_book: 'moderate', comp_quality: 'fair',
};
