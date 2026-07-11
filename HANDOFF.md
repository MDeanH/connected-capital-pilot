# Team handoff — Connected Capital pilot

This repo IS the pilot: the client build, split out of the parent platform
repo so the team works on exactly this and nothing else. The site is FULLY
PUBLIC (access gate removed per client direction — nothing private in the
build as of 2026-07-11). Pushing `main` auto-deploys, so treat merges to
`main` as releases — do day-to-day work on feature branches and open PRs.

## Pulling engine/data updates from the parent platform

The Monte Carlo engine, data pipeline and dataset rebakes continue to evolve
in the parent repo (`MDeanH/ai-diligence-platform`). To pull those
improvements in:

```
git remote add upstream https://github.com/MDeanH/ai-diligence-platform.git   # once
git fetch upstream
git merge upstream/pilot     # review, run the parity check below, then push
```

## Run it locally

Prereqs: Node 20+ (22 recommended) and npm.

```
npm install
npm run dev        # app on the printed localhost port
npm run build      # production build into dist/ (runs tsc first)
```

The dev server serves the React app and bridges every `/api/*` endpoint
through Vite middlewares (same engine modules as production; live keyless
FRED fetches; no persistence), so the whole product works locally with no
extra setup.

Engine safety check — `npm run build` runs all three golden suites and
fails on any red: parity (16), gate1 (23), gate1:macro (23).

## Credentials (all optional locally)

- `FRED_API_KEY` — optional; the macro pipeline uses keyless
  `fredgraph.csv` fetches by default.

### The Connected Capital deal product (this build)

The app IS the deal product now: **Intake → Review → Results | Thresholds ·
Macro · Backtest**. Old analytics tabs were removed (recoverable from git
history); the verified MC engine + parity suite remain as server machinery.

**Env vars to go fully live (Netlify site settings):**
- `ANTHROPIC_API_KEY` — live AI extraction (OM PDF + pro forma XLSX →
  ~30 cited fields + cross-document discrepancies, claude-opus-4-8 structured
  outputs). Until set, the "recorded sample" path demos the identical flow.
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — persistence: deals,
  extractions, versioned threshold configs, weekly macro snapshots, and the
  append-only `gate_decisions` replay ledger. Server-only; the SPA never
  talks to Supabase. Without them everything computes and says honestly
  "NOT recorded". Schema: `supabase/migrations/0001_init.sql`; seed
  (config v1): `supabase/seed.sql`.

**Build gates (all must pass or the deploy fails):** `npm run parity` (16),
`npm run gate1` (23), `npm run gate1:macro` (23).

**Endpoints (v2 functions, self-routed):** `/api/gate1/preview|decide`,
`/api/deals`, `/api/extract` + `/api/extractions/:id`,
`/api/macro/latest|history|override`, `/api/config/active|:version` (POST
`/api/config` = new version). `macro-cron.ts` runs Mondays 13:00 UTC once
deployed (writes the weekly snapshot when Supabase is configured; without
rows, `/api/macro/latest` computes live from keyless FRED).

**Rules encoded:** zero hardcoded thresholds (all in config, editable in the
Thresholds screen; browser drafts apply to previews only and can never be
recorded); every decision stamped with config version + macro posture,
baseline verdict kept alongside judgment adjustments (reason required).

**Local dev:** plain `vite` serves all `/api/*` through bridges in
`vite.config.ts` (live FRED fetches, no persistence); `netlify dev` for the
Supabase-backed paths.

No live client data is stored: uploads parse in the browser, deal drafts
live in localStorage, and the demo path is a recorded extraction of the
client-provided Faithful Trails example documents, labeled as such in the
UI. Once Supabase is connected, whatever deals the team records will live
there — revisit the public/gated question before putting real pipeline
deals in.

## Map of the code

- `src/` — the product. `DealIntake.tsx` (shell + state), `IntakeUpload` /
  `IntakeReview` (document ingest + verification), `GateResults` /
  `KpiScorecard` / `JudgmentPanel` / `ConsistencyPanel` / `MarketComparison`
  (results), `ThresholdConfig` (editable rulebook), `MacroDashboard`
  (weekly snapshot + four-quadrant), `Backtest`. Shared: `cc-ui.tsx`,
  `glossary.ts` + `GlossaryTip` (hover definitions), `finance.ts`,
  `sample-extraction.ts` (the recorded demo), `excel.ts`.
- `netlify/functions/` — serverless API. `lib/gate1/` is the deal engine
  (engine/thresholds/macro/fields + `default-config.json`, the editable
  rulebook seed, + three golden suites). `lib/engine.ts` is the verified
  Monte Carlo core kept as machinery. Functions: `gate1`, `deals`,
  `extract`, `macro`, `macro-cron` (Mondays), `gate1-config`, `score`,
  `health`.
- `supabase/` — schema (`migrations/0001_init.sql`) + config seed.
- `scripts/` — the parent repo's data pipeline (kept for engine rebakes).
- `reference/` — the correlation deep-dive behind the MC engine.

## Access

The site is public per client direction (2026-07-11: "nothing private right
now"). The Basic-Auth gate was removed; its history is in git if it's ever
needed again (`netlify/edge-functions/gate.ts`, requires PILOT_PASSWORD).
Don't add real client figures or pipeline deals to the repo or the UI while
the site is ungated.
