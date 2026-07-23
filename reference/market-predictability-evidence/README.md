# Financial-Market Predictability Evidence Map

A cutoff-dated (2026-07-14), protocol-documented map of publicly discoverable
evidence on financial-market predictability: **can information available at a
real forecast origin predict a financial target better than a relevant
benchmark, and does the improvement survive realistic implementation costs?**

## Files

| File | What it is |
| --- | --- |
| [financial-market-predictability-protocol.md](financial-market-predictability-protocol.md) | Methodology: scope, search design, eligibility, extraction schema, P/E/R/I/T/B rating rubric, verdict gates, known blind spots, corrections log |
| [financial-market-predictability-evidence.csv](financial-market-predictability-evidence.csv) | Study ledger — 198 scoped claims, each a `market × target × horizon × predictor × method × benchmark` extraction with evidence-stage, result, point-in-time, cost, and replication fields |
| [financial-market-predictability-families.json](financial-market-predictability-families.json) | 49 family-level effectiveness ratings (P/E/R/I/T/B scores 0–4, confidence A–D, verdict), each joined to its ledger rows via `evidence_ids` |

## Keeping the app in sync

The two data files above are the only source of truth. Three files in the app
are **derived** from them, and `bake_evidence_network.py` writes all three:

| Derived file | What it feeds |
| --- | --- |
| `evidence-network.html` (here) | The interactive network viz — graph JSON baked between the `GRAPH-DATA` markers |
| `public/evidence-network.html` | The **served** copy of that viz (`/evidence-network.html`) |
| `src/data/evidence-families.json` | The app's EVIDENCE tab (`src/EvidencePanel.tsx`) |

After any correction to the CSV or families JSON — including a re-sync from
upstream `MDeanH/financial-market-predictability-evidence` — run:

```
python3 bake_evidence_network.py
```

It is idempotent: a re-bake with no data change rewrites nothing (`unchanged`
on every line) and leaves a clean `git diff`.

`npm run build` fails if any derived copy has drifted (`npm run gate:evidence`
→ `scripts/check-evidence-sync.ts`). The gate byte-compares the copies and
checks the `meta.inputs_sha256` fingerprint the bake stamps into the payload
against the current source files, so corrected data can never deploy behind a
stale visualization. `python3 bake_evidence_network.py --check` does the same
without writing.

## Headline (v1.1, corrected)

- **Established effective: 0** — nothing in the public literature clears the
  live-execution bar.
- **Supported pre-live: 6** — equity value, cross-sectional momentum,
  profitability/quality, liquid-futures trend, corporate default ranking, and
  realized-volatility forecasting (the last two on decision value, not
  tradable alpha).
- **Promising: 15**, **Not established: 21**, **Ineffective in tested
  scope: 6**, **Methodology — not rated: 1**.

Verdicts are derived from scores through explicit gates; null and negative
results are preserved; contemporaneous fit dressed up as forecasting is
tagged invalid. See the protocol's corrections log for what changed in v1.1
after a 54-agent adversarial review of v1.0.

## How to read a family

Each family in the JSON scopes a claim (market, target, horizon,
implementation) and scores six dimensions: **P**redictive accuracy,
**E**conomic/decision value, independent **R**eplication,
**I**mplementability/capacity, **T**emporal stability, and resistance to
publication/data-mining **B**ias. Scores are not summed. `evidence_ids` join
to `study_id` in the CSV; the CSV's `family_claim` column joins back.

## Known limitations

Single-reviewer single-pass compilation (an AI agent with web access); no
dual screening or PRISMA flow counts; subscription databases unavailable;
English-dominant discovery; several prespecified scopes still thin (see the
protocol's blind-spots section). Treat this as a rigorous map, not a
registered systematic review.
