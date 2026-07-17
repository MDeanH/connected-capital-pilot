#!/usr/bin/env python3
"""Calibrated diligence prior for a published strategy claim.

Fit on REAL data: 212 published equity predictors from the Open Source Asset
Pricing library (Chen & Zimmermann), monthly long-short returns 1926-2024,
joined to publication years.

WHAT THIS DOES: given the in-sample return a paper reports, it returns the
distribution of what actually survived publication, historically.

WHAT THIS DOES NOT DO: forecast a market, a price, or a date. It is a base
rate, not a crystal ball. The single most important empirical finding behind
it is a NULL: at publication time, *which* published strategy will do better
is barely predictable (forward out-of-sample R^2 ~ 0.03 on the level), and the
decay ratio is not predictable at all (R^2 ~ 0). What survives is a LEVEL and
a RANK, nothing sharper.

Coefficients are locked from the forward-validated fit; see real-data-findings.md.
Re-fit with `python3 diligence_prior.py --refit <path-to-mktdata-dir>`.
"""

import math
import sys

# ---- locked, forward-validated coefficients (see real-data-findings.md) ----
# post_ann = K * is_ann   (through-origin; the intercept is insignificant)
# K estimated on the paper's OWN reported in-sample return, which is what a
# diligence reader actually has. Fitting on OSAP's *replicated* in-sample
# return inflates K (0.41) because it shares construction DNA with the target.
K_FULL_SAMPLE = 0.339      # all cohorts, paper-reported IS return
K_RECOMMENDED = 0.33       # use ~1/3: K_train systematically overstates what
                           # later cohorts realize (0.55->0.39, 0.58->0.36,
                           # 0.50->0.36, 0.44->0.32 across 1995/2000/2005/2010
                           # cutoffs) and is still drifting down.
RESID_SD = 6.05            # pp/yr, one sigma

# Unconditional base rates, n=182 published predictors (post-publication window)
BASE_RATES = {
    "stays significant (t>1.96)": 0.28,
    "clears Harvey-Liu-Zhu (t>3)": 0.11,
    "goes outright negative": 0.15,
}

# Forward-validated rank screen (paper-reported IS return, median split).
# Spearman +0.37 (p<0.001) at 2000/2005 cutoffs; +0.25 at 2010 (n=41, n.s.).
RANK_SCREEN = {
    "top half":    {"post_ann": 5.0, "p_negative": 0.08},
    "bottom half": {"post_ann": 1.0, "p_negative": 0.25},
}
MEDIAN_IS_ANN = 7.9  # pp/yr; the split point among published predictors


def _norm_cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def assess(is_ann, k=K_RECOMMENDED):
    """is_ann: the annualized in-sample return (%/yr) the paper reports."""
    point = k * is_ann
    p_neg = _norm_cdf((0 - point) / RESID_SD)
    return {
        "reported_is_ann": is_ann,
        "expected_post_ann": point,
        "pi95": (point - 1.96 * RESID_SD, point + 1.96 * RESID_SD),
        "p_negative_decade": p_neg,
        "rank_bucket": "top half" if is_ann > MEDIAN_IS_ANN else "bottom half",
        "expected_retention": k,
    }


def report(is_ann):
    a = assess(is_ann)
    lo, hi = a["pi95"]
    print(f"\nPublished in-sample return : {is_ann:.1f}%/yr")
    print(f"Expected post-publication  : {a['expected_post_ann']:.2f}%/yr "
          f"(retain ~{a['expected_retention']:.0%})")
    print(f"95% prediction interval    : [{lo:.1f}%, {hi:.1f}%]/yr")
    print(f"P(negative post-pub decade): {a['p_negative_decade']:.0%}")
    print(f"Rank bucket                : {a['rank_bucket']} "
          f"(median published IS return is {MEDIAN_IS_ANN}%/yr)")
    b = RANK_SCREEN[a["rank_bucket"]]
    print(f"  that bucket historically realized ~{b['post_ann']:.1f}%/yr, "
          f"{b['p_negative']:.0%} negative")
    print("\nUnconditional base rates for ANY published predictor:")
    for k, v in BASE_RATES.items():
        print(f"  {k:32s} {v:.0%}")
    print("\nCaveat: the level is barely forecastable (forward OOS R^2 ~ 0.03) and")
    print("the decay ratio is not forecastable at all. Treat the point estimate as")
    print("a base rate with a wide band, not a prediction. Equity cross-section,")
    print("US, gross of costs; costs push all of the above DOWN.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    report(float(args[0]) if args else 8.0)
