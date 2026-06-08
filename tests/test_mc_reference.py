"""Regression suite for src/model/mc_reference.py (the app's MC engine).

Each check pins a defect found and fixed during the adversarial review, live-data PoC,
and DDQ integration. Run from the repo root:  python tests/test_mc_reference.py
(exit 0 = all pass). Clean under `python -W error::RuntimeWarning`.
"""
import os, sys, importlib.util
import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("mc_reference", os.path.join(_ROOT, "src", "model", "mc_reference.py"))
mc = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(mc)

POS, VER = "Suggested position % of book", "Position verdict"
EXP = "Expected return (TWR/IRR bullet proxy)"
_p, _f = [], []
def check(name, cond, detail=""):
    (_p if cond else _f).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}  {detail}")


def run():
    fit = mc.fit_distribution(np.array([0.02, 0.0, 0.03, -0.01, 0.01, 0.02, 0.0, 0.01]))
    try: mc.fit_distribution(np.array([])); check("REG1 empty-raises", False)
    except Exception: check("REG1 empty-raises", True)
    try: mc.fit_distribution(np.array([3e5, 3.1e5, 3.05e5, 3.3e5])); check("REG2 prices-raise", False)
    except Exception: check("REG2 prices-raise", True)
    check("REG3 neg-edge->0%", mc.score_opportunity(fit, target_irr=.2, risk_free_rate=.04, seed=1)[POS] == 0.0)
    rc = mc.score_opportunity(mc.fit_distribution(np.array([0.05] * 6)), seed=1)
    check("REG4 zerovar->ABSTAIN", rc[POS] == 0.0 and "ABSTAIN" in rc[VER])
    check("REG4c real-vol sizes",
          mc.score_opportunity(mc.fit_distribution(np.random.default_rng(5).normal(0.12, 0.18, 50)),
                               target_irr=.2, risk_free_rate=.04, seed=1)[POS] > 0)
    np.random.seed(123); a = np.random.rand(); np.random.seed(123)
    mc.score_opportunity(fit, seed=9)
    check("REG5 no-rng-clobber", a == np.random.rand())
    r1 = mc.score_opportunity(fit, seed=None); r2 = mc.score_opportunity(fit, seed=None)
    check("REG6 fresh-rng-differs", r1["P(loss)"]["90%_CI"] != r2["P(loss)"]["90%_CI"])
    q = np.array([0.02, 0.018, 0.025, 0.015] * 4)
    fq = mc.fit_distribution(q, periods_per_year=4); fa = mc.fit_distribution(q, periods_per_year=1)
    check("REG7 quarterly-annualizes", abs(fq['mu'] - ((1 + np.mean(q))**4 - 1)) < 1e-9 and fq['sigma'] > fa['sigma'])
    try:
        mc.simulate_portfolio_irrs(np.array([0.09, 0.20]), np.array([0.10, 0.40]),
                                   np.array([[1, 0.35], [0.35, 1.0]]), weights=np.array([0.6, 0.4]),
                                   holding_years=5, n_sims=5000, rng=np.random.default_rng(0))
        check("REG8 portfolio-runs", True)
    except Exception as e:
        check("REG8 portfolio-runs", False, str(e))
    cb = mc.score_opportunity(mc.fit_distribution(np.random.default_rng(0).normal(0.08, 0.15, 400)), seed=1)["Confidence"]["score_0_100"]
    cs = mc.score_opportunity(mc.fit_distribution(np.random.default_rng(0).normal(0.08, 0.15, 8)), seed=1)["Confidence"]["score_0_100"]
    check("REG9 confidence~n_obs", cb > cs)
    check("REG10 var-is-loss",
          mc.score_opportunity(mc.fit_distribution(np.random.default_rng(2).normal(0.05, 0.30, 60)), target_irr=.2, seed=1)["VaR_5% (loss magnitude)"]["median"] > 0)
    fcs = mc.fit_distribution(np.random.default_rng(1).normal(0.011, 0.02, 156), periods_per_year=4)
    er = mc.score_opportunity(fcs, holding_years=5, target_irr=.5, mode="empirical", rng=np.random.default_rng(1))[EXP]["median"]
    check("REG11 empirical-freq (quarterly)", abs(er - fcs['mu']) < 0.01, f"scored={er:.4f} vs mu_ann={fcs['mu']:.4f}")
    base = mc.fit_distribution(np.random.default_rng(3).normal(0.02, 0.03, 48), periods_per_year=4)
    good = mc.score_opportunity(base, bias_mu=0.05, bias_sigma_mult=0.7, target_irr=.2, mode="empirical", rng=np.random.default_rng(1))
    bad = mc.score_opportunity(base, bias_mu=-0.05, bias_sigma_mult=2.0, target_irr=.2, mode="empirical", rng=np.random.default_rng(1))
    check("REG12 DDQ-bias moves distribution",
          good["P(loss)"]["median"] != bad["P(loss)"]["median"] and good[EXP]["median"] > bad[EXP]["median"])
    drv = mc.score_opportunity(base, target_irr=.05, mode="empirical", rng=np.random.default_rng(1))["Top drivers (sensitivity of P(target))"]
    check("REG13 empirical sensitivity nonzero", any(d["delta_P(target)"] != 0 for d in drv))

    print(f"\nRESULT: {len(_p)} passed, {len(_f)} failed" + (f" -> {_f}" if _f else ""))
    return 1 if _f else 0


if __name__ == "__main__":
    sys.exit(run())
