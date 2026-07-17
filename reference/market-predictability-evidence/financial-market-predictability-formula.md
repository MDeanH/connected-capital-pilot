# Predictive formula synthesis (v1.1)

Cutoff: 2026-07-14. Source: corrected evidence map — **198 studies**, **49 families**
(`985a7dd` / `cc5b837` on `cursor/market-predictability-evidence-review`).

## Headline (do not quote v1.0)

| Verdict | Count |
|---|---|
| Established effective | 0 |
| Supported pre-live | **6** |
| Promising | 15 |
| Not established | 21 |
| Ineffective in tested scope | 6 |
| Methodology — not rated | 1 |

**Supported six:** equity value · XS momentum · profitability/quality · liquid-futures trend · corporate default ranking · realized-vol forecasting (last two = decision value, not tradable alpha).

## Working system

### Layer 0 — Integrity
Point-in-time data; lock features before OOS; multiplicity correction.

### Layer 1 — Expected return (Supported core)
```
E_t[r_i,t+1] = β_V Value + β_M Mom + β_Q Qual + β_T Trend + u
```

Evidence-weighted starting mix (P+E+R among Supported return families only):

| Ingredient | Role | Weight |
|---|---|---|
| XS momentum | XS_MOM | ~26% |
| Equity value | VALUE | ~26% |
| Quality / profitability | QUALITY | ~24% |
| Liquid TS trend | TS_TREND | ~24% |

**Promising satellites (not core):** govt-bond carry, FX carry, short reversal, credit-spread value, equity ML, VRP state, forecast combinations/shrinkage.

### Layer 2 — Risk / decision (Supported)
```
RV_{t+1} = c + β_d RV_t + β_w RV_t^(w) + β_m RV_t^(m)
PD_i,t   from default / distress ranking
```
Use for sizing and credit screening — not as equity long-short alpha.

### Layer 3 — Shrinkage (Promising discipline)
Shrink toward equal-weight / economic priors; nested OOS only.

### Layer 4 — Implementable objective
```
max E[r_net] − (γ/2) Risk(r_net) − TC(Δw) − borrow
```

## Explicitly out of the return core (v1.1)

- Aggregate equity-premium timing
- **PEAD / event drift** (new family → Not established; cost/microcap decay)
- **Low-vol / BAB** (new family → Not established for net incremental alpha)
- Anomaly zoos, generic technicals, generic LLM / TSFMs

## Artifacts

- Ledger / families / protocol / README in this repo
- Interactive canvas: `~/.cursor/projects/Users-friday-codex-Knowledge-base/canvases/predictive-formula-synthesis.canvas.tsx`
