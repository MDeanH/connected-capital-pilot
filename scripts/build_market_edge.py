#!/usr/bin/env python3
"""
Bake netlify/functions/lib/market-edge.json — per-market gross yield and its
WITHIN-STATE percentile, consumed by the Deal Score engine as a modest mu
adjustment ("yield edge").

Basis (reference/correlation-deep-dive.md §3.1): gross yield was the only
context signal that predicted forward price growth in the right direction in
8 of 9 county/city vintages 2016-2022 (Q5−Q1 ≈ +2-3%/yr), and the effect is
robust within state pre-COVID — hence a within-state percentile, which also
removes the cross-state composition that dominated the 2022 vintage.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTEXT = ROOT / "public/market-context.json"
ENGINE = ROOT / "netlify/functions/lib/metros.json"
OUT = ROOT / "netlify/functions/lib/market-edge.json"


def main():
    ctx = json.loads(CONTEXT.read_text())["markets"]
    engine_keys = set(json.loads(ENGINE.read_text()).keys())

    # collect yields per state for engine-known markets
    by_state: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for key, m in ctx.items():
        gy = m.get("grossYield")
        if not isinstance(gy, (int, float)) or gy <= 0:
            continue
        if key not in engine_keys and key.replace(" (city)", "") not in engine_keys:
            continue
        state = key.rsplit(", ", 1)[-1]
        if len(state) == 2:
            by_state[state].append((key, gy))

    out: dict[str, dict] = {}
    for state, rows in by_state.items():
        if len(rows) < 8:   # too few markets to rank meaningfully
            continue
        ys = sorted(gy for _, gy in rows)
        n = len(ys)
        for key, gy in rows:
            below = sum(1 for y in ys if y < gy)
            pct = round(100 * below / (n - 1 if n > 1 else 1))
            out[key] = {"gy": round(gy, 4), "pct": min(99, max(1, pct)), "nState": n}

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    sample = {k: out[k] for k in ("Miami, FL", "Detroit (city), MI", "San Jose, CA") if k in out}
    print(f"Wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB) — {len(out)} markets, {len(by_state)} states")
    print("sample:", json.dumps(sample))


if __name__ == "__main__":
    main()
