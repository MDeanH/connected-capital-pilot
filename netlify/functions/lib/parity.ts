// Parity check: TS engine vs the Python golden reference (lib/golden.json), plus the
// structural regression behaviors. Run: node --experimental-strip-types parity.ts
import { readFileSync } from 'node:fs';
import { fitDistribution, geltnerUnsmooth, scoreOpportunity, kellyPosition } from './engine.ts';
import { applyDdq, DEFAULT_ANSWERS } from './ddq.ts';

const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url), 'utf8'));
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const within = (name: string, got: number, want: number, tol: number) => {
  const ok = Math.abs(got - want) <= tol;
  (ok ? pass++ : fail++);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}: got ${got.toFixed(4)} vs golden ${want.toFixed(4)} (±${tol})`);
};
const check = (name: string, cond: boolean, detail = '') => { (cond ? pass++ : fail++); console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name} ${detail}`); };

// ---- replicate the golden scenario in TS ----
const bl = baselines.re_value_add;
const fitDes = fitDistribution(geltnerUnsmooth(bl.returns), bl.ppy);
const ddq = applyDdq(DEFAULT_ANSWERS);
const idio = 0.18;
const totalSigma = Math.sqrt(fitDes.sigma ** 2 + idio ** 2);
const effSigmaMult = ddq.sigmaMult * (totalSigma / fitDes.sigma);

console.log('DETERMINISTIC FIT (must match Python closely):');
within('fit.mu', fitDes.mu, golden.fit.mu, 0.0015);
within('fit.sigma', fitDes.sigma, golden.fit.sigma, 0.0015);
check('fit.nObs', fitDes.nObs === golden.fit.n_obs, `(${fitDes.nObs})`);
within('ddq.bias_mu', ddq.biasMu, golden.ddq.bias_mu, 1e-6);
within('ddq.sigma_mult(eff)', effSigmaMult, golden.ddq.sigma_mult, 0.01);

const s = scoreOpportunity({ returns: bl.returns, ppy: bl.ppy, desmooth: true, target: 0.20, rf: 0.04,
  holding: 5, biasMu: ddq.biasMu, sigmaMult: effSigmaMult, bookCorr: ddq.bookCorr, nSims: 40000, nParamBoot: 400, seed: 7 });

console.log('\nMONTE CARLO METRICS (within MC tolerance):');
within('P(target)', s.pTarget.median, golden.expect.p_target, 0.03);
within('Expected', s.expected.median, golden.expect.expected, 0.02);
within('P(loss)', s.pLoss.median, golden.expect.p_loss, 0.04);
within('VaR loss', s.varLoss.median, golden.expect.var_loss, 0.03);
within('Position %', s.position, golden.expect.position, 0.01);
within('Confidence', s.confidence.score, golden.expect.confidence, 6);

console.log('\nSTRUCTURAL REGRESSIONS (the fixes must hold in TS):');
// neg-edge -> 0%
const neg = scoreOpportunity({ returns: [0.02, 0, 0.03, -0.01, 0.01, 0.02, 0, 0.01], ppy: 1, desmooth: false,
  target: 0.2, rf: 0.04, holding: 5, biasMu: 0, sigmaMult: 1, bookCorr: 0, nSims: 8000, nParamBoot: 80, seed: 1 });
check('neg-edge -> 0%', neg.position === 0 && /PASS/.test(neg.verdict), `(pos=${neg.position}, ${neg.verdict})`);
// sigma floor: constant series -> ABSTAIN
const flat = scoreOpportunity({ returns: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05], ppy: 1, desmooth: false,
  target: 0.2, rf: 0.04, holding: 5, biasMu: 0, sigmaMult: 1, bookCorr: 0, nSims: 8000, nParamBoot: 80, seed: 1 });
check('zero-var -> ABSTAIN', flat.position === 0 && /ABSTAIN/.test(flat.verdict), `(${flat.verdict})`);
// kelly direct: edge<=0 -> 0
const k0 = kellyPosition(0.03, 0.2, 0.04);
check('kelly edge<=0 -> 0', k0.position === 0);
// VaR reported as positive loss on a risky deal
const risky = scoreOpportunity({ returns: Array.from({ length: 60 }, (_, i) => 0.05 + 0.3 * Math.sin(i * 1.7)), ppy: 1,
  desmooth: false, target: 0.2, rf: 0.04, holding: 5, biasMu: 0, sigmaMult: 1, bookCorr: 0, nSims: 12000, nParamBoot: 100, seed: 2 });
check('VaR is a positive loss on risky deal', risky.varLoss.median > 0, `(${risky.varLoss.median})`);
// DDQ bias moves the distribution
const good = scoreOpportunity({ returns: bl.returns, ppy: 4, desmooth: true, target: 0.2, rf: 0.04, holding: 5, biasMu: 0.05, sigmaMult: 0.7, bookCorr: 0, nSims: 12000, nParamBoot: 100, seed: 1 });
const bad = scoreOpportunity({ returns: bl.returns, ppy: 4, desmooth: true, target: 0.2, rf: 0.04, holding: 5, biasMu: -0.05, sigmaMult: 2.0, bookCorr: 0, nSims: 12000, nParamBoot: 100, seed: 1 });
check('DDQ bias moves distribution', good.pLoss.median < bad.pLoss.median && good.expected.median > bad.expected.median,
  `(good pLoss=${good.pLoss.median} < bad=${bad.pLoss.median})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
