#!/usr/bin/env python3
"""
Replace the engine's flat income proxy with a market-level rent carry.

Why (see reference/correlation-deep-dive.md §3.1): the engine credited every
market the same +1%/quarter income, so high-yield markets — whose true total
return includes ~4%/yr MORE carry than low-yield markets — were systematically
under-ranked. Yield-Q5 markets showed engine mu_ann 7.69%/yr vs 8.81% for Q1
when their real total-return ordering is the reverse.

New per-quarter income proxy, per market:
    qInc = clamp(0.60 * grossYield, 2%, 8%) / 4      where ZORI yield exists
         = 0.01 (the old flat 4%/yr)                  where it doesn't
(0.60 = expense haircut: taxes, insurance, maintenance, vacancy. The clamp
keeps data artifacts from producing absurd carry.)

The transform is applied to netlify/functions/lib/metros.json in place:
    r_new = round(r_old - 0.01 + qInc, 5)
Keys, lengths and structure are unchanged; a `qInc` field is added per entry
for transparency. Rerunnable: it detects prior application via the qInc field
and rebases correctly.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "netlify/functions/lib/metros.json"
CONTEXT = ROOT / "public/market-context.json"

EXPENSE_FACTOR = 0.60
ANN_FLOOR, ANN_CAP = 0.02, 0.08   # net carry clamp, annual
FALLBACK_Q = 0.01                  # the historical flat proxy (4%/yr)


def main():
    engine = json.loads(ENGINE.read_text())
    ctx = json.loads(CONTEXT.read_text())["markets"]

    def yield_for(key: str) -> float | None:
        m = ctx.get(key)
        if m is None and " (city)" in key:
            m = ctx.get(key.replace(" (city)", ""))
        gy = (m or {}).get("grossYield")
        return gy if isinstance(gy, (int, float)) and gy > 0 else None

    n_carry, n_fallback = 0, 0
    shifts = []
    for key, entry in engine.items():
        gy = yield_for(key)
        if gy is not None:
            ann = min(ANN_CAP, max(ANN_FLOOR, EXPENSE_FACTOR * gy))
            q_new = round(ann / 4, 5)
            n_carry += 1
        else:
            q_new = FALLBACK_Q
            n_fallback += 1
        q_old = entry.get("qInc", FALLBACK_Q)  # rebase if already applied
        if q_new != q_old:
            entry["returns"] = [round(r - q_old + q_new, 5) for r in entry["returns"]]
        entry["qInc"] = q_new
        shifts.append((q_new - FALLBACK_Q) * 4)

    ENGINE.write_text(json.dumps(engine, separators=(",", ":")))

    import statistics as st
    print(f"markets with rent carry: {n_carry} | flat fallback: {n_fallback}")
    print(f"annual income shift vs old flat 4%: median {st.median(shifts)*100:+.2f}pp, "
          f"min {min(shifts)*100:+.2f}pp, max {max(shifts)*100:+.2f}pp")
    for k in ("Miami, FL", "Miami (city), FL", "Phoenix, AZ", "Detroit (city), MI", "San Jose, CA"):
        if k in engine:
            e = engine[k]
            mu = sum(e["returns"]) / len(e["returns"]) * 4
            print(f"  {k:22s} qInc(ann)={e['qInc']*4*100:.2f}%  mu_ann={mu*100:.2f}%")


if __name__ == "__main__":
    main()
