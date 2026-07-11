# Team handoff — Connected Capital pilot

You're on the `pilot` branch: the gated client build. `main` is the public
site. Pushing to either branch auto-deploys (pilot →
https://pilot--ai-diligence-platform.netlify.app, main → production), so
treat pushes as releases.

## Run it locally

Prereqs: Node 20+ (22 recommended) and npm.

```
npm install
npm run dev        # app on the printed localhost port
npm run build      # production build into dist/ (runs tsc first)
```

The dev server serves the React app and emulates the scoring API
(`/api/score`) through a Vite middleware, so Deal Score and the Combined
Verdict work locally with no extra setup. The landing page is at
`/how-it-works.html`.

Engine safety check — run before pushing changes to anything under
`netlify/functions/lib/`:

```
cd netlify/functions/lib && npx tsx parity.ts    # expect: 16 passed, 0 failed
```

## Credentials (all optional locally)

- `XAI_API_KEY` — the Grok copilot chat. Without it the copilot errors; all
  other tabs work fine.
- `PILOT_PASSWORD` — only used by the deployed Basic-Auth gate
  (`netlify/edge-functions/gate.ts`); irrelevant locally. The landing page
  (`/` and `/how-it-works.html`) is deliberately exempt from the gate.
- `FRED_API_KEY` — only for refreshing the US-market macro data
  (`scripts/load_us_market.py`); the repo ships with current baked data.

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

No client data is in the repo: the Excel upload parses entirely in the
browser, DDQ/Risk Model state lives in localStorage, and the sample
manager/deal ("Beacon Harbor", "Palmetto Court") is fictional and labeled
as such in the UI.

## Map of the code

- `src/` — React app. One file per tab: `DealScore`, `Underwrite`,
  `RiskModel`, `DDQ` (+ `ddq-schema.ts` with the 116-question schema and
  grading math), `CombinedVerdict`, `USMarket`, `EngineExplainer` (the
  in-app "How It Works"), `Home`. Shared: `underwrite-lib.ts` (gate math),
  `Provenance.tsx` (sample/real badges), `ErrorBoundary.tsx`.
- `netlify/functions/` — serverless API. `lib/engine.ts` is the verified
  Monte Carlo core (Geltner de-smoothing, bootstrap, Kelly), `lib/compute.ts`
  the scoring pipeline, `lib/parity.ts` the 16-test golden suite.
- `netlify/edge-functions/gate.ts` — the pilot password gate.
- `public/` — the landing page (`how-it-works.html`) and the baked data
  overlays (crime, market context, correlations, vintages).
- `scripts/` — the data pipeline (Zillow/FBI/BEA/FEMA/IRS/HMDA/Census
  loaders). `scripts/write_data_vintages.py` is the single post-refresh
  step: it rewrites the vintages manifest, site stats, and the landing-page
  numbers.
- `reference/` — the correlation deep-dive behind the engine's income-carry
  and yield-edge adjustments.

## Editing the landing page (`public/how-it-works.html`)

Self-contained file (inline CSS/JS, baked numbers; only Google Fonts loads
externally). Two traps:

1. **Scroll-reveal is all-or-nothing.** Three pieces must stay together: the
   head script that adds the `js` class to `<html>`, the `html.js .reveal`
   CSS rules (both the hide rule AND the `.in` show rule), and the bottom
   script with the IntersectionObserver + 3-second failsafe. Removing half
   of them renders the page completely blank with no error. Remove all
   three or none.
2. **Numbers are auto-patched by label.** `scripts/write_data_vintages.py`
   updates the hero stats and prose figures by matching their surrounding
   label text. Reword the labels and the auto-updater silently stops
   maintaining those numbers.

Name draft versions distinctly; the winning version replaces
`public/how-it-works.html` on this branch.

## Confidentiality

The methodology content (underwriting gates, Risk Model v2 structure, DDQ
calibration) derives from Connected Capital's materials. Don't publish the
code or deploy copies anywhere ungated, and don't add client figures, names
or deal data to the landing page — it is publicly reachable by design.
