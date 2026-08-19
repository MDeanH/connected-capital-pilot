// Pure scoring logic shared by the Netlify function (score.ts) and the local dev
// middleware (vite.config.ts). Runs the verified TS engine + DDQ scorecard.
import { fitDistribution, geltnerUnsmooth, scoreOpportunity } from './engine.ts';
import { applyDdq, DEFAULT_ANSWERS, SCORECARD } from './ddq.ts';
import baselines from './baselines.json';
import metros from './metros.json';
import marketEdge from './market-edge.json';
import marketPath from './market-path.json';

// Parent-line /api/score machinery: these macro figures are a pinned snapshot
// (asof 2026-03-31), NOT a live feed. The `note` field ships in every response
// so no consumer can mistake them for current data.
const MACRO = { mortgage30y: 6.48, caseShillerYoy: 0.67, asof: '2026-03-31', note: 'fixed reference vintage — not live' };
type Baseline = { label: string; ppy: number; returns: number[] };
// ~895 real Zillow metro return histories + the named national baselines (Case-Shiller etc.).
const BASELINES: Record<string, Baseline> = {
  ...(metros as unknown as Record<string, Baseline>),
  ...(baselines as unknown as Record<string, Baseline>),
};
const DEFAULT_BASELINE = 'Miami, FL' in BASELINES ? 'Miami, FL' : 're_value_add';

const num = (x: any, d: number) => { const v = Number(x); return Number.isFinite(v) ? v : d; };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d: number) => { const f = 10 ** d; return Math.round(x * f) / f; };

export const BASELINE_OPTIONS = Object.entries(BASELINES).map(([key, v]) => ({ key, label: v.label }));
export const DDQ_FIELDS = SCORECARD.map((f) => ({ key: f.key, question: f.question, options: f.options.map((o) => ({ key: o.key, label: o.label })) }));

export function computeScore(body: any) {
  const bl = (typeof body.baseline === 'string' && Object.hasOwn(BASELINES, body.baseline))
    ? BASELINES[body.baseline] : BASELINES[DEFAULT_BASELINE];
  // All numeric inputs are clamped to sane ranges: they drive Monte Carlo loop
  // sizes, so an unbounded value (e.g. holding=500000) is a CPU-exhaustion lever.
  const target = clamp(num(body.target, 0.2), 0, 1);
  const rf = clamp(num(body.rf, 0.04), 0, 0.5);
  const holding = clamp(Math.round(num(body.holding, 5)), 1, 30);
  const book = clamp(num(body.book, 5_000_000), 0, 1e12);
  const ticket = clamp(num(body.ticket, 250_000), 0, 1e12);
  const idiosyncratic = clamp(num(body.idiosyncratic, 0.18), 0, 0.6);
  const answers: Record<string, string> = { ...DEFAULT_ANSWERS, ...(body.answers || {}) };
  const seed = Math.round(num(body.seed, 7));

  // Optional external tilt from the client-methodology layer (Combined Verdict):
  // Risk Model composite + DDQ grade map to bounded mu/sigma adjustments client-side
  // and arrive here as explicit, auditable parameters. Defaults are a no-op, and the
  // caps sit well inside the DDQ layer's own bounds (±10%/yr, 0.6–2.5×).
  const extBiasMu = clamp(num(body.extBiasMu, 0), -0.03, 0.03);
  // A JSON null slips through num(): Number(null) is 0 and finite, so a null
  // extSigmaMult coerced to 0 and clamped to the 0.7 floor — a 30% volatility
  // UNDERSTATEMENT for an input the caller never set. Nullish means "not
  // provided": map it to exactly 1 (the documented no-op) before clamping;
  // non-finite garbage still falls to num()'s default of 1. extBiasMu is safe
  // as-is — its null-coercion lands on 0, which IS its no-op default. And
  // neutralDdq is compared with `=== true`, so null never changes its path.
  const extSigmaMult = clamp(body.extSigmaMult == null ? 1 : num(body.extSigmaMult, 1), 0.7, 1.6);

  // neutralDdq=true switches the engine's own questionnaire layer off entirely
  // (true zeros, NOT DEFAULT_ANSWERS — those describe a typical value-add deal,
  // ~+5%/yr mu and ~1.38x sigma, which is anything but neutral). Used by the
  // Combined Verdict tab so the client-methodology tilt is the only judgment layer.
  const ddq = body.neutralDdq === true
    ? { biasMu: 0, sigmaMult: 1, bookCorr: 0, drivers: [] as ReturnType<typeof applyDdq>['drivers'] }
    : applyDdq(answers);
  const returns = bl.returns, ppy = bl.ppy;

  const fitRaw = fitDistribution(returns, ppy);
  const fitDes = fitDistribution(geltnerUnsmooth(returns), ppy);
  const sigmaDealTotal = Math.sqrt(fitDes.sigma ** 2 + idiosyncratic ** 2);
  const extraMult = sigmaDealTotal / fitDes.sigma;

  // Yield edge: gross yield's within-state percentile was the only context
  // signal that predicted forward price growth across backtest vintages
  // (see reference/correlation-deep-dive.md §3.1). Modest, transparent mu
  // adjustment: linear in percentile, capped at ±0.30%/yr.
  const edgeInfo = (marketEdge as Record<string, { gy: number; pct: number; nState: number }>)[bl.label];
  const yieldEdgeMu = edgeInfo ? round(((edgeInfo.pct - 50) / 50) * 0.003, 5) : 0;

  // Conditional market-path tilt: the 12-month forecast that passed the
  // pre-registered acceptance gate (research/tsfm_benchmark/HOUSING-ACCEPTANCE-
  // TEST.md — beats the unconditional drift on 32/65 HLN-DM tests, survives
  // Geltner de-smoothing). Year-1 statement only, so it is capped at ±2%/yr and
  // amortized over the holding period (mean reversion kills it by years 3-5);
  // markets without a baked path get zero, never a guess.
  type Mp = { asof: string; tiltAnnual: number; gatePassed: boolean; geltnerTested: boolean; annualMedian: number; annualQ10: number; annualQ90: number; cumMed: number[]; cumQ10: number[]; cumQ90: number[]; backtest: { hitRate: number | null; nWindows: number; dmPvsDrift: number | null } };
  const mpAll = marketPath as unknown as Record<string, Mp>;
  const mpInfo = Object.hasOwn(mpAll, bl.label) ? mpAll[bl.label] : null;
  // Staleness guard: the tilt is a 12-month statement from its asof date; past
  // MP_MAX_AGE_DAYS it is provenance, not a forward view — apply zero.
  const MP_MAX_AGE_DAYS = 270;
  const mpAgeDays = mpInfo ? (Date.now() - Date.parse(mpInfo.asof)) / 86_400_000 : Infinity;
  const mpStale = !mpInfo || !(mpAgeDays <= MP_MAX_AGE_DAYS);
  const marketPathMu = mpInfo && !mpStale && mpInfo.gatePassed
    ? round(clamp(mpInfo.tiltAnnual, -0.02, 0.02) / holding, 5) : 0;

  const common = { returns, ppy, target, rf, holding, bookCorr: ddq.bookCorr, biasMu: ddq.biasMu + yieldEdgeMu + extBiasMu + marketPathMu, seed };
  const honest = scoreOpportunity({ ...common, desmooth: true, sigmaMult: ddq.sigmaMult * extraMult * extSigmaMult });
  const naive = scoreOpportunity({ ...common, desmooth: false, sigmaMult: ddq.sigmaMult * extSigmaMult });

  return {
    deal: { name: body.name || 'New value-add opportunity', strategy: 'RE value-add', ticket, book, holding, target, rf },
    base: {
      label: bl.label, nObs: fitDes.nObs, muAnn: round(fitDes.mu, 4),
      sigmaIndexRaw: round(fitRaw.sigma, 4), sigmaMarketDesmoothed: round(fitDes.sigma, 4),
      idiosyncratic, sigmaDealTotal: round(sigmaDealTotal, 4),
      lag1: round(fitRaw.lag1, 3), smoothing: fitRaw.smoothing,
    },
    ddq: { biasMu: ddq.biasMu, sigmaMult: round(ddq.sigmaMult, 3), bookCorr: ddq.bookCorr, drivers: ddq.drivers.slice(0, 6) },
    external: extBiasMu !== 0 || extSigmaMult !== 1 ? { biasMu: extBiasMu, sigmaMult: round(extSigmaMult, 3) } : null,
    marketEdge: edgeInfo
      ? { grossYield: edgeInfo.gy, statePct: edgeInfo.pct, nState: edgeInfo.nState, muBias: yieldEdgeMu }
      : null,
    marketPath: mpInfo
      ? {
          asof: mpInfo.asof, stale: mpStale, gatePassed: mpInfo.gatePassed,
          geltnerTested: mpInfo.geltnerTested, tiltAnnualRaw: mpInfo.tiltAnnual,
          tiltAnnualCapped: round(clamp(mpInfo.tiltAnnual, -0.02, 0.02), 5), muBias: marketPathMu,
          annualMedian: mpInfo.annualMedian, annualQ10: mpInfo.annualQ10, annualQ90: mpInfo.annualQ90,
          cumMed: mpInfo.cumMed, cumQ10: mpInfo.cumQ10, cumQ90: mpInfo.cumQ90,
          backtest: mpInfo.backtest,
        }
      : null,
    honest, naive: { pLoss: naive.pLoss, varLoss: naive.varLoss },
    macro: MACRO,
  };
}
