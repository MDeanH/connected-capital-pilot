---
name: grok-montecarlo-review-findings
description: "What was wrong with Grok's Monte Carlo investment code and what the corrected mc_invest_score.py fixes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 84c66f9d-608b-4b7d-aed8-d456c694b87b
---

Adversarially reviewed Grok's Monte Carlo investment-scoring code (part of [[ai-investment-ddq-platform]]). 42 issues raised, 41 confirmed by re-running the code. The corrected version is `Client prediction model/mc_invest_score.py` (validated: demo runs clean under `-W error::RuntimeWarning`; 10/10 independent regression checks pass).

Defects that were fixed (each verified by execution, not eyeballing):
- **Risk-understatement trap (critical):** smooth/short input → σ collapses → Kelly explodes → maxed 25% position on a near-zero-probability deal. Worst failure mode for a *risk* tool. Fixed via de-smoothing, σ floor (`_SIGMA_FLOOR=1e-4`, abstain below — caught a residual where a constant series fit to σ≈1e-18 and slipped the `<=0` guard), and bias-correction args.
- **Quarterly NCREIF treated as annual** → 4× return understatement. Fixed with explicit `periods_per_year` annualization.
- **Portfolio/correlation branch crashed** (Cholesky matmul dim mismatch) and was never called. Rewritten to actually run.
- **Kelly floor `max(kelly*0.5,0.01)`** bet 1% on negative-edge deals; **dimensionally inconsistent** (annualized-IRR edge ÷ 1-yr log variance). Fixed: same-units, returns 0% for edge≤risk-free.
- **"Confidence" tied to n_sims** (a category error — that's only MC sampling noise) and always printed "N/A" (globals bug). Now derived from n_obs + bootstrap CI width.
- **Lognormal can't represent VC power-law** (modeled 21% loss vs ~50–65% real). Added empirical-bootstrap + VC mixture mode.
- **VaR/CVaR mislabeled** (came out positive = upside under a loss label); **"top drivers" was a hardcoded list** (fake explainability). Now real loss magnitudes + one-at-a-time sensitivity attribution. Also: no parameter-uncertainty CIs, ddof=0, global-RNG clobber via fixed seed=42, dead `initial_investment` param, TWR-mislabeled-as-IRR — all fixed; a true cashflow IRR (`irr_from_cashflows`) added.

Reusable scratch venv with numpy/pandas/scipy: `/tmp/mcrev/bin/python`.
