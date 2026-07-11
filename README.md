# Connected Capital — Deal Diligence

Document-ingest deal screening for real-estate development. Drop in a sponsor's
offering memorandum (PDF) and pro forma (XLSX); the platform extracts every
screening field with confidence scores and citations, flags where the two
documents contradict each other, and runs the deal through **Gate 1** —
10 hard kills and 8 watch flags — under a **macro-aware posture** that
tightens or loosens the bar as the economy moves.

**Connected Capital institutional pilot** — public build (no client data in
the repo; the demo deal is a labeled recorded extraction of example
documents).

## The flow

```
INTAKE   upload OM + pro forma → AI extraction (cited, never guessed)
REVIEW   analyst confirms/corrects; unanswered fields flagged
RESULTS  PASS / CONDITIONAL / FAIL / REVIEW · margin to every kill line ·
         document-consistency panel · KPI scorecard (IRR, cash-on-cash,
         equity multiple vs benchmarks) · deal vs S&P + financing-vs-SOFR ·
         judgment adjustments (reason required, baseline verdict kept)

THRESHOLDS  every band, weight, and stress parameter editable — nothing
            hard-coded; versioned saves, browser drafts preview-only
MACRO       weekly FRED snapshot: 8 weighted signals → regime →
            Green/Yellow/Red posture · four-quadrant inflation×growth
            indicator · 5-year sparklines · manual override with reason
BACKTEST    run past deals + realized outcomes through the current
            rulebook — right calls, missed winners, above/below par
```

## Principles (enforced in code)

- **Zero hardcoded thresholds** — every tunable lives in versioned config.
- **Every decision replayable** — stamped with config version, macro posture,
  inputs, and adjustments; the un-adjusted baseline verdict is always kept.
- **Missing data never passes** — extraction returns null rather than guess;
  unanswered fields force review.
- **Macro moves the bar, never kills alone.**

## Build & dev

```bash
npm install
npm run dev      # vite — all /api/* served via dev bridges (live FRED, no persistence)
npm run build    # gated by three golden suites: parity(16) · gate1(23) · macro(23)
```

Deploys from the `pilot` branch (Netlify, HTTP Basic Auth). Env vars and
operational notes: `HANDOFF.md` (confidential). Supabase schema:
`supabase/migrations/`, config seed: `supabase/seed.sql`.

The verified Monte Carlo market engine (Geltner de-smoothing, empirical
bootstrap, fractional-Kelly sizing) remains in `netlify/functions/lib/` with
its parity suite as server machinery for later deal-level deep review.
