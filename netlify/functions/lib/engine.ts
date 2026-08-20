/**
 * TypeScript port of the verified Monte Carlo scoring engine (src/model/mc_reference.py).
 *
 * This runs inside the Netlify `score` function so the deployed app uses the SAME
 * calibrated engine as the Python reference — empirical bootstrap, Geltner de-smoothing,
 * DDQ pool adjustment, sigma-floor Kelly, n_obs-driven confidence, sensitivity attribution,
 * and parameter-bootstrap CIs. Validated against the Python golden reference within Monte
 * Carlo tolerance (see lib/golden.json + the parity check).
 *
 * Not bit-identical to numpy (different RNG); statistically equivalent by design.
 */

const SIGMA_FLOOR = 1e-4;

// ---- seeded RNG (mulberry32) + gaussian -----------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- numeric helpers -------------------------------------------------------
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function std(a: number[], ddof = 0): number {
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - ddof);
  return Math.sqrt(v);
}
// Lanczos log-gamma, for the c4 small-sample sigma de-bias.
function lgamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function c4(n: number): number {
  if (n < 2) return 1.0;
  return Math.sqrt(2.0 / (n - 1)) * Math.exp(lgamma(n / 2) - lgamma((n - 1) / 2));
}
// numpy-compatible linear-interpolation percentile (p in 0..100)
function percentile(arr: number[], p: number): number {
  const a = [...arr].sort((x, y) => x - y);
  if (a.length === 1) return a[0];
  const rank = (p / 100) * (a.length - 1);
  const lo = Math.floor(rank), frac = rank - lo;
  return lo + 1 < a.length ? a[lo] + frac * (a[lo + 1] - a[lo]) : a[lo];
}

// ---- conversions / fitting -------------------------------------------------
export function pricesToReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) out.push(prices[i] / prices[i - 1] - 1);
  return out;
}
function lag1Autocorr(r: number[]): number {
  if (r.length < 3) return 0;
  const r0 = r.slice(0, -1), r1 = r.slice(1);
  const m0 = mean(r0), m1 = mean(r1);
  const denom = std(r0) * std(r1);
  if (denom === 0) return 0;
  let cov = 0;
  for (let i = 0; i < r0.length; i++) cov += (r0[i] - m0) * (r1[i] - m1);
  return cov / r0.length / denom;
}
// De-smoothing autocorrelation cap. Full-empirical Geltner divides by (1-a); at the
// ~0.9 autocorr of heavily-smoothed indices (Zillow ZHVI) that explodes the variance.
// Cap at 0.6 so de-smoothing stays a sane ~2x lift, not 6x+. National Case-Shiller
// (a~0.53) sits below the cap and is unaffected (preserves the Python parity golden).
const GELTNER_A_CAP = 0.6;
export function geltnerUnsmooth(returns: number[]): number[] {
  const a = Math.min(lag1Autocorr(returns), GELTNER_A_CAP);
  if (!(a > 0 && a < 0.99)) return [...returns];
  const out: number[] = [];
  for (let i = 1; i < returns.length; i++) out.push((returns[i] - a * returns[i - 1]) / (1 - a));
  return out;
}

export interface Fit { mu: number; sigma: number; nObs: number; ppy: number; lag1: number; smoothing: boolean; logReturns: number[]; }

export function fitDistribution(returns: number[], ppy: number, unbiased = true): Fit {
  const n = returns.length;
  const muP = mean(returns);
  let s = unbiased ? std(returns, 1) / c4(n) : std(returns, 0);
  const muAnn = Math.pow(1 + muP, ppy) - 1;
  const sigmaAnn = s * Math.sqrt(ppy);
  const ac1 = lag1Autocorr(returns);
  return { mu: muAnn, sigma: sigmaAnn, nObs: n, ppy, lag1: ac1, smoothing: ac1 > 0.2, logReturns: returns.map((r) => Math.log1p(r)) };
}

// ---- DDQ pool adjustment (shape-preserving recenter/rescale) ---------------
export function adjustEmpiricalPool(logReturns: number[], biasMuAnnual: number, sigmaMult: number, ppy: number): number[] {
  const r = logReturns.map((lr) => Math.expm1(lr));
  const muP = mean(r);
  const muAnnCur = Math.pow(1 + muP, ppy) - 1;
  const base = 1 + muAnnCur + biasMuAnnual;
  const targetMuP = base > 0 ? Math.pow(base, 1 / ppy) - 1 : muP + biasMuAnnual / ppy;
  const shift = targetMuP - muP;
  return r.map((x) => {
    const scaled = muP + sigmaMult * (x - muP) + shift;
    return Math.log1p(Math.max(scaled, -0.999));
  });
}

// ---- simulate empirical bullet IRRs ---------------------------------------
function simulateIrrs(pool: number[], holding: number, ppy: number, nSims: number, rng: () => number): number[] {
  const nPeriods = holding * Math.max(1, ppy);
  const L = pool.length;
  const out = new Array(nSims);
  for (let s = 0; s < nSims; s++) {
    let cum = 0;
    for (let p = 0; p < nPeriods; p++) cum += pool[(rng() * L) | 0];
    out[s] = Math.pow(Math.exp(cum), 1 / holding) - 1;
  }
  return out;
}

interface RiskMetrics { pTarget: number; expected: number; median: number; pLoss: number; varLoss: number; cvarLoss: number; }
function riskMetrics(irrs: number[], target: number): RiskMetrics {
  const finite = irrs.filter((x) => Number.isFinite(x));
  const q = percentile(finite, 5);
  const tail = finite.filter((x) => x <= q);
  const cq = tail.length ? mean(tail) : q;
  return {
    pTarget: finite.filter((x) => x >= target).length / finite.length,
    expected: mean(finite),
    median: percentile(finite, 50),
    pLoss: finite.filter((x) => x < 0).length / finite.length,
    varLoss: -q,
    cvarLoss: -cq,
  };
}

export function kellyPosition(expectedArith: number, sigmaArith: number, rf: number, fraction = 0.5, cap = 0.25, bookCorr = 0) {
  const edge = expectedArith - rf;
  if (!Number.isFinite(edge) || !Number.isFinite(sigmaArith)) return { position: 0, rawKelly: NaN, verdict: 'INVALID (non-finite inputs)' };
  if (sigmaArith < SIGMA_FLOOR) return { position: 0, rawKelly: 0, verdict: 'ABSTAIN (no modeled risk; need a real return distribution)' };
  if (edge <= 0) return { position: 0, rawKelly: edge / (sigmaArith * sigmaArith), verdict: 'PASS (edge <= risk-free)' };
  const rawKelly = edge / (sigmaArith * sigmaArith);
  let sized = fraction * rawKelly * (1 - Math.max(0, bookCorr));
  const position = Math.min(Math.max(sized, 0), cap);
  let verdict = position > 0 ? 'INVEST' : 'PASS';
  if (position >= cap) verdict = 'INVEST (capped; note Kelly is sensitive to a possibly-understated sigma)';
  return { position, rawKelly, verdict };
}

function confidenceScore(nObs: number, ciLo: number, ciHi: number) {
  const width = ciHi - ciLo;
  const sizeTerm = Math.min(1, nObs / 60);
  const widthTerm = Math.max(0, 1 - width / 0.3);
  const score = Math.round(100 * 0.5 * (sizeTerm + widthTerm) * 10) / 10;
  let band = 'REASONABLE (for a backward-looking fit; bias caveats still apply)';
  if (nObs < 10) band = 'LOW (thin history; CIs are wide -- treat point estimates as indicative)';
  else if (nObs < 30) band = 'MODERATE (limited history; respect the CI band)';
  return { score, band, nObs, ci: [Math.round(ciLo * 1e4) / 1e4, Math.round(ciHi * 1e4) / 1e4] };
}

// ---- top-level score -------------------------------------------------------
export interface ScoreParams {
  returns: number[]; ppy: number; desmooth: boolean;
  target: number; rf: number; holding: number;
  biasMu: number; sigmaMult: number; bookCorr: number;
  nSims?: number; nParamBoot?: number; seed?: number;
}

export function scoreOpportunity(p: ScoreParams) {
  const nSims = p.nSims ?? 20000;
  const nParamBoot = p.nParamBoot ?? 200;
  const rng = mulberry32(p.seed ?? 12345);
  const baseReturns = p.desmooth ? geltnerUnsmooth(p.returns) : p.returns;
  const fit = fitDistribution(baseReturns, p.ppy);

  const sigmaForKelly = fit.sigma * p.sigmaMult; // annual arithmetic sigma after DDQ/idio
  const eff = adjustEmpiricalPool(fit.logReturns, p.biasMu, p.sigmaMult, p.ppy);

  // point-estimate run
  const baseIrrs = simulateIrrs(eff, p.holding, p.ppy, nSims, rng);
  const base = riskMetrics(baseIrrs, p.target);

  // parameter-uncertainty bootstrap -> CIs
  const bootSims = Math.max(2000, Math.floor(nSims / 5));
  const keys = ['pTarget', 'expected', 'median', 'pLoss', 'varLoss', 'cvarLoss'] as const;
  const boot: Record<string, number[]> = { pTarget: [], expected: [], median: [], pLoss: [], varLoss: [], cvarLoss: [] };
  for (let b = 0; b < nParamBoot; b++) {
    const resampled: number[] = new Array(eff.length);
    for (let i = 0; i < eff.length; i++) resampled[i] = eff[(rng() * eff.length) | 0];
    const m = riskMetrics(simulateIrrs(resampled, p.holding, p.ppy, bootSims, rng), p.target);
    for (const k of keys) boot[k].push(m[k]);
  }
  const ci = (k: string) => ({ median: percentile(boot[k], 50), lo: percentile(boot[k], 5), hi: percentile(boot[k], 95) });

  const pos = kellyPosition(base.expected, sigmaForKelly, p.rf, 0.5, 0.25, p.bookCorr);
  const conf = confidenceScore(fit.nObs, ci('pTarget').lo, ci('pTarget').hi);

  // sensitivity: perturb on the eff pool
  const baseP = base.pTarget;
  const sensOne = (label: string, pool: number[], _mu: number, _sigma: number, holding: number) => {
    const r2 = mulberry32((p.seed ?? 12345) + label.length * 7919);
    const irrs = simulateIrrs(pool, holding, p.ppy, Math.max(4000, Math.floor(nSims / 4)), r2);
    const pp = irrs.filter((x) => x >= p.target).length / irrs.length;
    return { factor: label, delta: Math.round((pp - baseP) * 1e4) / 1e4 };
  };
  const drivers = [
    sensOne('Expected return (mu)', adjustEmpiricalPool(eff, 0.01, 1.0, p.ppy), 0, 0, p.holding),
    sensOne('Volatility (sigma)', adjustEmpiricalPool(eff, 0.0, 1.2, p.ppy), 0, 0, p.holding),
    sensOne('Holding period', eff, 0, 0, Math.max(1, p.holding + 1)),
  ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // histogram of the point-estimate IRR distribution (clipped for display)
  const clipped = baseIrrs.map((x) => Math.min(Math.max(x, -0.6), 0.8));
  const nb = 46, lo = -0.6, hi = 0.8, bw = (hi - lo) / nb;
  const counts = new Array(nb).fill(0);
  for (const x of clipped) { const idx = Math.min(nb - 1, Math.max(0, Math.floor((x - lo) / bw))); counts[idx]++; }
  const edges = Array.from({ length: nb + 1 }, (_, i) => +(lo + i * bw).toFixed(4));

  const m3 = (k: string) => { const c = ci(k); return { median: +c.median.toFixed(4), ci: [+c.lo.toFixed(4), +c.hi.toFixed(4)] as [number, number] }; };
  return {
    fit: { mu: +fit.mu.toFixed(5), sigma: +fit.sigma.toFixed(5), nObs: fit.nObs, lag1: +fit.lag1.toFixed(3), smoothing: fit.smoothing },
    pTarget: m3('pTarget'), expected: m3('expected'), median: m3('median'),
    pLoss: m3('pLoss'), varLoss: m3('varLoss'), cvarLoss: m3('cvarLoss'),
    position: Math.round(pos.position * 1000) / 10, verdict: pos.verdict,
    confidence: conf, drivers, hist: { edges, counts },
    sigmaForKelly: +sigmaForKelly.toFixed(4),
  };
}
