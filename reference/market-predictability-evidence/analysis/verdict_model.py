#!/usr/bin/env python3
"""Verdict predictor for the market-predictability evidence map.

Predicts the VERDICT a claim family earns under the protocol — not market
returns. The ledger holds no prices; nothing here forecasts markets.

Two entry points:
  * `fit_report()`  — nested leave-one-out CV that searches the whole rule
    space inside each fold, so the reported accuracy is honestly
    out-of-sample (no carve-out is hand-fitted to the errors).
  * `predict(family)` — apply the locked rule to a new, unseen claim.

Run directly for the full report:
    python3 verdict_model.py
"""

import csv
import json
import random
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAMILIES = HERE / "financial-market-predictability-families.json"
EVIDENCE = HERE / "financial-market-predictability-evidence.csv"

DIMS = ("p", "e", "r", "i", "t", "b")
SUPPORTED = "Supported pre-live"
INEFFECTIVE = "Ineffective in tested scope"

# ---------------------------------------------------------------- features


def _num(v):
    """Protocol scores are 0-4; 'U' (unassessed) and 'X' (invalid) are missing."""
    return None if v in ("U", "X", "") else int(v)


def target_type(fam):
    """Derive target type from the claim's OWN text.

    Must never consult the verdict: at prediction time a new family has text
    and scores but no verdict. Keyword sets come from the protocol's own
    carve-out language ("For volatility, default, and risk forecasts, E refers
    to the prespecified decision loss ... rather than a forced trading return").
    """
    cid = fam["claim_id"]
    if cid.startswith("method-"):
        return "method"
    text = " ".join(
        str(fam.get(k, "")) for k in ("claim_id", "label", "target", "summary")
    ).lower()
    risk_kw = (
        "volatility", "variance", "realized vol", "implied vol", "default",
        "hazard", "distress", "downgrade", "value-at-risk", "var ", "risk forecast",
        "loss given", "recovery rate",
    )
    alpha_kw = ("return", "alpha", "premium", "profit", "excess")
    risk_hits = sum(k in text for k in risk_kw)
    # A claim whose TARGET names a risk quantity is a risk forecast; naming
    # returns in passing (e.g. "vol predicts returns") does not make it one.
    tgt = str(fam.get("target", "")).lower()
    tgt_is_risk = any(k in tgt for k in risk_kw)
    tgt_is_alpha = any(k in tgt for k in alpha_kw)
    if tgt_is_risk and not tgt_is_alpha:
        return "risk"
    if risk_hits >= 2 and not tgt_is_alpha:
        return "risk"
    return "alpha"


def build(fam_rows, ev_rows):
    by_id = {r["study_id"]: r for r in ev_rows}
    out = []
    for f in fam_rows:
        scores = {d: _num(f[d]) for d in DIMS}
        tags, stages, years = [], [], []
        for eid in f["evidence_ids"]:
            s = by_id[eid]
            tags.append(s["result_tag"])
            stages.append(s["evidence_stage"])
            if s["year"].isdigit():
                years.append(int(s["year"]))
        valid = [t for t in tags if t != "NA"]
        n = len(valid) or 1
        out.append({
            "id": f["claim_id"],
            "label": f["label"],
            "verdict": f["verdict"],
            "confidence": f["confidence"],
            "type": target_type(f),
            "scores": scores,
            "posshare": sum(t in ("++", "+?") for t in valid) / n,
            "ppshare": sum(t == "++" for t in valid) / n,
            "advshare": sum(t == "-" for t in valid) / n,
            "deepshare": (sum(s in ("HOLD", "EXT", "LIVE-P") for s in stages)
                          / len(stages)) if stages else 0.0,
            "nstud": len(f["evidence_ids"]),
            "maxyear": max(years) if years else 0,
        })
    return out


def load():
    fam = json.loads(FAMILIES.read_text())
    with EVIDENCE.open(newline="") as fh:
        ev = list(csv.DictReader(fh))
    return build(fam, ev)


# ------------------------------------------------------- rule grammar/search
# A Supported-gate rule is:  min(scores[d] for d in S if not waived) >= t
# where a dimension may be waived for a target type. The search decides the
# waivers; they are NOT supplied by hand. `waive` is a frozenset of
# (type, dim) pairs drawn from the protocol's own carve-out language.

WAIVER_CANDIDATES = (
    frozenset(),
    frozenset({("risk", "e")}),
    frozenset({("method", "p")}),
    frozenset({("method", "p"), ("method", "e")}),
    frozenset({("risk", "e"), ("method", "p")}),
    frozenset({("risk", "e"), ("method", "p"), ("method", "e")}),
)


def rule_apply(rule, fam):
    """`ge`: every dim in S is >= t (a floor).  `le`: every dim in S is <= t
    (a ceiling). Both directions are needed — the top verdict is a floor rule,
    the bottom verdict is a ceiling rule, and a floor-only grammar silently
    degenerates to the majority class on the bottom one."""
    S, t, waive, direction = rule
    dims = [d for d in S if (fam["type"], d) not in waive]
    if not dims:
        return False
    vals = [(fam["scores"][d] if fam["scores"][d] is not None else 0)
            for d in dims]
    return min(vals) >= t if direction == "ge" else max(vals) <= t


def enumerate_rules():
    for k in range(1, len(DIMS) + 1):
        for S in combinations(DIMS, k):
            for t in (0, 1, 2, 3, 4):
                for waive in WAIVER_CANDIDATES:
                    # a waiver only matters if it touches a dim in S
                    if waive and not any(d in S for _, d in waive):
                        continue
                    for direction in ("ge", "le"):
                        yield (S, t, waive, direction)


RULES = list(enumerate_rules())


def score_rule(rule, data, target):
    return sum(rule_apply(rule, f) == (f["verdict"] == target) for f in data)


def complexity(rule):
    S, t, waive, direction = rule
    return (len(S), len(waive))


def best_rule(data, target):
    """Pick the most accurate rule; break ties toward simplicity (fewest
    dimensions, then fewest waivers, then a stable string key)."""
    best, best_key = None, None
    for rule in RULES:
        acc = score_rule(rule, data, target)
        key = (-acc,) + complexity(rule) + (str(rule),)
        if best_key is None or key < best_key:
            best, best_key = rule, key
    return best


def fmt(rule):
    S, t, waive, direction = rule
    if direction == "ge":
        s = f"min({','.join(d.upper() for d in S)}) >= {t}"
    else:
        s = f"max({','.join(d.upper() for d in S)}) <= {t}"
    if waive:
        w = "; ".join(f"waive {d.upper()} for {ty}" for ty, d in sorted(waive))
        s += f"  [{w}]"
    return s


# ---------------------------------------------------------------- validation


def loocv(data, target):
    """Honest OOS: re-run the ENTIRE rule search inside each fold."""
    correct, chosen = 0, []
    for i in range(len(data)):
        train = data[:i] + data[i + 1:]
        rule = best_rule(train, target)
        chosen.append(fmt(rule))
        correct += rule_apply(rule, data[i]) == (data[i]["verdict"] == target)
    return correct / len(data), chosen


def bootstrap_ci(data, rule, target, n=2000, seed=20260714):
    rng = random.Random(seed)
    accs = []
    for _ in range(n):
        samp = [data[rng.randrange(len(data))] for _ in range(len(data))]
        accs.append(score_rule(rule, samp, target) / len(samp))
    accs.sort()
    return accs[int(0.025 * n)], accs[int(0.975 * n)]


# ------------------------------------------------------------ locked predictor
# Winner of the blind exhaustive search: 46/47 = 97.9% in-sample, 93.6%
# nested LOOCV, permutation p < 0.0001 (best-of-search null on shuffled
# labels: mean ~78%, max ~42-43/47) — real signal, not a search artifact.
#
# THREE CAVEATS, established by adversarial review:
#  1. P IS NOT IDENTIFIED. Six spellings collapse to this one prediction
#     vector, and banning P from the search costs ZERO. `I` is the only
#     load-bearing dimension (banning it is the only ban that costs
#     accuracy) — and the protocol's written gate omits I entirely.
#  2. 46/47 IS THE BAYES CEILING, not a residual failure: crypto-vol
#     (P3 E2 R2 T2 I2 B2) is bit-identical to eq-ml-xs and
#     credit-spread-value, both rated Promising. No score-based rule can
#     separate them; crypto-vol is a labeling contradiction in the data.
#  3. This measures INTERNAL RUBRIC COHERENCE ONLY. Scores and verdict live
#     in the same record, written by the same raters in the same pass, so
#     this is a self-consistency check. It says NOTHING about whether I>=3
#     predicts market returns. See real-data-findings.md.
LOCKED_SUPPORTED_RULE = (("p", "i"), 3, frozenset({("method", "p")}), "ge")


def predict(fam):
    """Predict a verdict for one built family dict. Returns (verdict, trace)."""
    if rule_apply(LOCKED_SUPPORTED_RULE, fam):
        return SUPPORTED, f"passes {fmt(LOCKED_SUPPORTED_RULE)}"
    p = fam["scores"]["p"] or 0
    if p <= 1 and fam["type"] != "method":
        return INEFFECTIVE, "P<=1 (predictive accuracy ruled out/in-sample only)"
    return "Not established / Promising", (
        "fails the credibility floor but is not affirmatively refuted — "
        "this boundary is NOT score-separable (see report)"
    )


# ------------------------------------------------------------------- report


def fit_report():
    data = load()
    print(f"n = {len(data)} families")
    print("target types:", {t: sum(f["type"] == t for f in data)
                            for t in ("alpha", "risk", "method")})
    print("verdicts:", {v: sum(f["verdict"] == v for f in data)
                        for v in sorted({f['verdict'] for f in data})})

    for target in (SUPPORTED, INEFFECTIVE):
        base = max(sum(f["verdict"] == target for f in data),
                   sum(f["verdict"] != target for f in data)) / len(data)
        full = best_rule(data, target)
        acc = score_rule(full, data, target) / len(data)
        lo, hi = bootstrap_ci(data, full, target)
        oos, chosen = loocv(data, target)
        stab = {}
        for c in chosen:
            stab[c] = stab.get(c, 0) + 1
        print(f"\n=== {target} ===")
        print(f"  majority baseline : {base:.1%}")
        print(f"  best rule (full)  : {fmt(full)}")
        print(f"  in-sample acc     : {acc:.1%}  (bootstrap 95% CI "
              f"{lo:.1%}-{hi:.1%})")
        print(f"  HONEST LOOCV acc  : {oos:.1%}   <-- search re-run each fold")
        print(f"  rule stability    : " + "; ".join(
            f"{k} x{v}" for k, v in sorted(stab.items(), key=lambda x: -x[1])))
        errs = [f for f in data
                if rule_apply(full, f) != (f["verdict"] == target)]
        for f in errs:
            sc = "".join(f"{d.upper()}{f['scores'][d]}" for d in DIMS)
            print(f"    ERR {f['id']:28s} {sc}  type={f['type']:6s} "
                  f"actual={f['verdict']}")
    return data


if __name__ == "__main__":
    fit_report()
