// Pure scoring logic shared by the Netlify function (score.ts) and the local dev
// middleware (vite.config.ts). Runs the verified TS engine + DDQ scorecard.
import { fitDistribution, geltnerUnsmooth, scoreOpportunity } from './engine.ts';
import { applyDdq, DEFAULT_ANSWERS, SCORECARD } from './ddq.ts';
import baselines from './baselines.json';
import metros from './metros.json';

const MACRO = { mortgage30y: 6.48, caseShillerYoy: 0.67, asof: '2026-03-31' };
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
  const bl = BASELINES[body.baseline] || BASELINES[DEFAULT_BASELINE];
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

  const ddq = applyDdq(answers);
  const returns = bl.returns, ppy = bl.ppy;

  const fitRaw = fitDistribution(returns, ppy);
  const fitDes = fitDistribution(geltnerUnsmooth(returns), ppy);
  const sigmaDealTotal = Math.sqrt(fitDes.sigma ** 2 + idiosyncratic ** 2);
  const extraMult = sigmaDealTotal / fitDes.sigma;

  const common = { returns, ppy, target, rf, holding, bookCorr: ddq.bookCorr, biasMu: ddq.biasMu, seed };
  const honest = scoreOpportunity({ ...common, desmooth: true, sigmaMult: ddq.sigmaMult * extraMult });
  const naive = scoreOpportunity({ ...common, desmooth: false, sigmaMult: ddq.sigmaMult });

  return {
    deal: { name: body.name || 'New value-add opportunity', strategy: 'RE value-add', ticket, book, holding, target, rf },
    base: {
      label: bl.label, nObs: fitDes.nObs, muAnn: round(fitDes.mu, 4),
      sigmaIndexRaw: round(fitRaw.sigma, 4), sigmaMarketDesmoothed: round(fitDes.sigma, 4),
      idiosyncratic, sigmaDealTotal: round(sigmaDealTotal, 4),
      lag1: round(fitRaw.lag1, 3), smoothing: fitRaw.smoothing,
    },
    ddq: { biasMu: ddq.biasMu, sigmaMult: round(ddq.sigmaMult, 3), bookCorr: ddq.bookCorr, drivers: ddq.drivers.slice(0, 6) },
    honest, naive: { pLoss: naive.pLoss, varLoss: naive.varLoss },
    macro: MACRO,
  };
}
