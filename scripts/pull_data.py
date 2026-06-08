#!/usr/bin/env python3
"""
Pull live public market data for the diligence platform and (optionally) score it with the verified MC engine.

Usage (from project root, venv active):
    python scripts/pull_data.py                 # just (re)pull + save tidies
    python scripts/pull_data.py --score         # pull + run reference MC on the national ZHVI series (with CIs, confidence, position)
    python scripts/pull_data.py --score --target 0.10 --bias-sigma 1.08

Outputs:
- data/zillow_us_national_zhvi_prices.csv (tidy, committed, small)
- data/zillow_zhvi_metro_raw.csv (large full download, gitignored)
- Prints fit stats + score result when --score.

DEPRECATED in favor of scripts/ingest_real_data.py (the "do it all" framework for the full 120+ inventory in data/data_sources_inventory.md).

See ingest_real_data.py --fetch-all-curated --score for pulling curated direct sources (Zillow, FHFA, FRED, NCREIF snapshots, etc.), processing with the verified reference (prices_to_returns, ppy, geltner, fit), and immediate scoring demo.

This old script kept for backward compat on the original Zillow national example.
"""

import argparse
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "src" / "model"))

ZILLOW_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"


def download_zillow_raw() -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    print(f"Downloading Zillow ZHVI Metro (public, ~monthly updates)...")
    r = requests.get(ZILLOW_URL, headers={"User-Agent": "ai-diligence-tool/1.0"}, timeout=120)
    r.raise_for_status()
    raw = DATA / "zillow_zhvi_metro_raw.csv"
    raw.write_bytes(r.content)
    print(f"  Saved {raw} ({len(r.content)/1024/1024:.2f} MB)")
    return raw


def build_national_tidy(raw_csv: Path) -> Path:
    df = pd.read_csv(raw_csv)
    us = df[df["RegionName"] == "United States"].iloc[0]
    date_cols = [c for c in df.columns if isinstance(c, str) and c[:4].isdigit() and len(c) == 10 and "-" in c]
    prices = pd.Series([us[c] for c in date_cols], index=pd.to_datetime(date_cols), name="zhvi")
    prices = prices.dropna().sort_index()
    out = DATA / "zillow_us_national_zhvi_prices.csv"
    prices.to_csv(out, header=True)
    print(f"  National US ZHVI tidy: {len(prices)} obs, {prices.index.min().date()}..{prices.index.max().date()}")
    print(f"  Saved {out} ({out.stat().st_size/1024:.1f} KB)")
    return out


def score_national(target: float = 0.08, bias_sigma_mult: float = 1.05, holding_years: int = 5):
    from mc_reference import prices_to_returns, fit_distribution, score_opportunity, geltner_unsmooth

    prices_path = DATA / "zillow_us_national_zhvi_prices.csv"
    if not prices_path.exists():
        print("No national prices file; run without --score first or with raw present.")
        return 1

    prices = pd.read_csv(prices_path, parse_dates=[0], index_col=0).iloc[:, 0].values.astype(float)
    rets = prices_to_returns(prices)
    fit = fit_distribution(rets, periods_per_year=12, verbose=True, unbiased_sigma=True)

    print("\nGeltner effect on this smoothed index:")
    unsm = geltner_unsmooth(rets)
    fit_u = fit_distribution(unsm, periods_per_year=12, verbose=False)
    print(f"  sigma_ann raw {fit['sigma']:.4f} -> geltner {fit_u['sigma']:.4f} (n_obs={fit['n_obs']})")

    rng = np.random.default_rng(202406)
    res = score_opportunity(
        fit,
        holding_years=holding_years,
        target_irr=target,
        risk_free_rate=0.04,
        mode="empirical",
        n_param_boot=300,
        bias_mu=0.0,
        bias_sigma_mult=bias_sigma_mult,
        book_correlation=0.0,
        rng=rng,
    )

    print(f"\n=== MC score on pulled Zillow US National ZHVI (target={target:.0%}, ppy=12) ===")
    for k in ["P(IRR>=target)", "Expected return (TWR/IRR bullet proxy)", "P(loss)", "VaR_5% (loss magnitude)", "Suggested position % of book", "Position verdict", "Confidence"]:
        print(f"{k}: {res.get(k)}")
    print("  (Note: residential price appreciation only; no yield. Low/negative edge vs target or rf → 0% position is correct.)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--score", action="store_true", help="After pulling, run the verified reference MC on the national series and print rich outputs + CIs.")
    ap.add_argument("--target", type=float, default=0.08, help="Target IRR for the demo score (default 0.08 for a market price-return + modest yield proxy).")
    ap.add_argument("--bias-sigma", type=float, default=1.05, help="bias_sigma_mult to apply (default 1.05 for residual index smoothing).")
    ap.add_argument("--holding", type=int, default=5)
    ap.add_argument("--no-raw", action="store_true", help="Skip downloading the full 4MB+ metro raw (just rebuild tidy from existing if present).")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)

    if not args.no_raw:
        try:
            raw = download_zillow_raw()
            build_national_tidy(raw)
        except Exception as e:
            print("Download failed or network issue:", e)
            print("Will try to use any existing tidy national file for --score.")
    else:
        # If raw not wanted, still ensure a tidy exists (user may have committed one)
        national = DATA / "zillow_us_national_zhvi_prices.csv"
        if not national.exists():
            print("No raw and no tidy national file present. Re-run without --no-raw (needs net).")
            return 2

    if args.score:
        return score_national(target=args.target, bias_sigma_mult=args.bias_sigma, holding_years=args.holding)

    print("\nPull complete. Tidy national series ready in data/.")
    print("Next: python scripts/pull_data.py --score   (or import from src.data.connectors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
