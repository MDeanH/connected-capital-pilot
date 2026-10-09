# Connected Capital pilot: handoff for the next agent

Written 2026-10-09 by Claude Code at the end of its session, for ChatGPT (or any agent) taking over.
It contains no secrets. Secret values live only in Netlify environment variables.
Do not share or ingest `HANDOFF.md` or `ai-diligence-platform-SETUP-NOTES.md`. They are confidential.

## TL;DR

- **Product:** a Gate 1 deal-screening web app for Connected Capital, covering real-estate development deals. It's a React + Vite SPA with a Netlify Functions (v2) API, Supabase persistence, Claude-based document extraction, and FRED macro data.
- **Repo:** `github.com/MDeanH/connected-capital-pilot` (private). The latest work is on branch `claude/cloud-session-handoff-yilt49`, which is PR #11 into `dev`, still a draft.
- **Review build of that branch:** https://connected-capital-pilot-dev2.netlify.app/app
- **Decision 1 (owner):** PR #12 merges `dev` into `main`, which is the production release, and it does not include PR #11's chart work. Merge #11 into `dev` first if the charts should ship.
- **Open bug:** on Dev2, "Extract with AI" accepts documents, but the background worker never processes them. The next step is to read the Netlify function log (see Open issues 1).

## Product flow

1. **Intake.** Upload an offering memorandum (PDF, Word or text) and a pro forma (XLSX), then click **Extract with AI**. Alternatively, **Load the sample deal**, a recorded extraction of the client's Faithful Trails example documents.
2. **Review.** Verify about 30 extracted fields. Each has a citation and a confidence tag, plus independent market cross-checks.
3. **Results.** Shows the Gate 1 verdict (PASS / CONDITIONAL / REVIEW / FAIL) under today's macro posture. The Underwriting view has Summary, Financials, Market, Sponsor and Issues sub-tabs. Judgment adjustments require a reason. **Record decision** writes to an append-only ledger.
4. **Other tabs:**
   - Thresholds: the versioned rulebook editor
   - Macro: the weekly snapshot and four-quadrant view
   - Backtest
   - Evidence: the evidence map
   - Deals: history
   - Users: only when auth is on

Principles enforced in code:
- Zero hardcoded thresholds; every tunable lives in versioned config.
- Every decision is replayable: it's stamped with the config version, macro posture and inputs, and the baseline verdict is kept.
- Missing data never passes.
- Macro moves the bar but never kills a deal on its own.

## Architecture and code map

| Area | Where | Notes |
|---|---|---|
| SPA shell and state | `src/DealIntake.tsx` | Step state, scoring calls and persistence of drafts in localStorage |
| Intake and review | `src/IntakeUpload.tsx`, `src/IntakeReview.tsx` | Upload, extraction polling, field verification |
| Results view | `src/Underwriting.tsx` | Summary, Financials, Market, Sponsor and Issues tabs |
| Charts | `src/charts/` | `ChartKit.tsx` (scales, measured tooltip, legend, card with Table toggle), `CushionChart`, `StressChart`, `HurdleChart`, `CapRateChart`, `MarketCharts` (rent, absorption), `CapitalCharts` (uses/sources, financing, timeline) |
| Shared formatting | `src/format.ts` | `fmtMoneyShort`, `fmtPct1`, `fmtSignedPts`, threshold units |
| Glossary | `src/glossary.ts`, `src/GlossaryTip.tsx`, `src/Info.tsx` | Hover/focus definitions |
| Recorded demo | `src/sample-extraction.ts` | |
| Auth (opt-in) | `src/auth.ts`, `netlify/functions/lib/auth.ts` | Off unless `AUTH_ENABLED=1` |
| Gate 1 engine | `netlify/functions/lib/gate1/` | `engine.ts`, `thresholds.ts`, `macro.ts`, `preview.ts` (scenarios per posture), `types.ts`, `fields.ts`, `extract-core.ts`, `default-config.json` (rulebook seed), golden suites |
| Monte Carlo engine | `netlify/functions/lib/engine.ts` | With its parity suite |
| Database | `supabase/migrations/0001`–`0005`, `supabase/seed.sql` | Supabase project ref `rbodmakhvjhpxobactev`; the public URL is in `.env.production` |
| Data pipeline | `scripts/`, `research/` | Engine rebakes; the evidence-map bake |

API endpoints. Each function sets its own path in `export const config`:

| Path | Function |
|---|---|
| `/api/gate1/preview`, `/api/gate1/decide`, `/api/gate1/decisions` | `gate1.ts` |
| `/api/deals`, `/api/deals/:id` | `deals.ts` |
| `/api/extract` (submit, sync) | `extract-submit.ts` |
| `/api/extract-run` (worker, background) | `extract-run-background.ts` |
| `/api/extractions/:id` (poll) | `extractions.ts` |
| `/api/macro/latest`, `/history`, `/override` | `macro.ts` |
| `/api/config/active`, `/api/config/:version`, `POST /api/config` | `gate1-config.ts` |
| `/api/score` | `score.ts` |
| `/api/health`, `/api/auth/status`, `/api/users` | `health.ts`, `auth-status.ts`, `users.ts` |
| `/api/cron-run/:fn` | `cron-trigger.ts`: external cron dispatcher, because the platform scheduler wasn't firing |

The scheduled functions are `macro-cron.ts` (weekly macro snapshot) and `extractions-reaper.ts` (cleans up stale extraction blobs).

How AI extraction works:
1. The browser POSTs the documents to `/api/extract`.
2. The submit function stages them in Netlify Blobs (store `extractions`). It writes `{status:'running', submittedAt}`.
3. It triggers `/api/extract-run` with header `x-cc-worker-token`. That header is an HMAC-SHA256 of the extraction id, keyed with `ANTHROPIC_API_KEY`.
4. The worker checks the token. It claims the job by writing `startedAt`, then calls Claude through `extract-core.ts`. The model constant there is `claude-opus-4-8`; check that this model id is current.
5. It writes the `done` or `error` status, plus a provenance row in Supabase.
6. The browser polls `/api/extractions/:id`.

Environment variables the code reads. Names only:
- `ANTHROPIC_API_KEY`: AI extraction. It's also the HMAC key for the worker trigger.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: server-side persistence. Without them, everything still computes and the UI says "not recorded".
- `AUTH_ENABLED=1`: turns on login.
- `REQUIRE_ACCOUNTS=1`: with auth on, data endpoints require an account.
- `BOOTSTRAP_ADMIN_EMAIL`: the first admin.
- `CRON_TRIGGER_SECRET`: authenticates external cron runs.
- `EXTRACTION_DAILY_CAP`: daily paid-extraction limit, default 200.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: build time. These are public and committed in `.env.production`.

Routing (`netlify.toml`):
- `/` serves the how-it-works landing page, `public/how-it-works.html`.
- `/app` and `/app/*` serve the SPA, under a strict CSP (`script-src 'self'`).
- All other paths fall back to `index.html`.

## Branches and PRs (as of 2026-10-09)

| Branch / PR | What it is |
|---|---|
| `main` | Production. Repo docs say merging or pushing `main` deploys production, so treat merges to `main` as releases. |
| `dev` | Integration branch. Its tip `6671bab` is the merge of PR #10 (Underwriting view). |
| `claude/cloud-session-handoff-yilt49` | The latest work: `dev` + `d274703` (WIP charts) + `65a9c3a` + `ee5c0a5` + `e10783a` + `44de4df` |
| PR #11 | That branch into `dev`. Draft: "Underwriting view charts: browser-verified, with fixes" |
| PR #12 | `dev` into `main`. Opened 2026-10-09, mergeable, no check runs. Does not include #11. |
| PR #7 | `cursor/remove-pilot-password-gate-e610` into `dev`, open |
| PR #8 | `claude/jev-integration-3h28ai` into `main`, draft. A research note on where Jev fits. |

No GitHub Actions check runs were seen on these PRs. The build gates run inside `npm run build`, which also runs on Netlify builds.

## Deployments (Netlify)

| Site | URL | Serves | How it's deployed | Backend |
|---|---|---|---|---|
| `connected-capital-pilot` | https://connected-capital-pilot.netlify.app | Production | From `main`, per repo docs. Confirm in Netlify. | Production env |
| `connected-capital-pilot-dev` | https://connected-capital-pilot-dev.netlify.app | `dev` as of PR #10, deployed 2026-09-28, without the charts | Manual Netlify CLI uploads. Not git-linked, so PRs get no deploy previews. | Supabase `rbodmakhvjhpxobactev` and the Anthropic key; `REQUIRE_ACCOUNTS=1`; `AUTH_ENABLED` unset, so it runs login-free |
| `connected-capital-pilot-dev2` | https://connected-capital-pilot-dev2.netlify.app/app | PR #11 at `44de4df`, the review build | Source upload with a Netlify remote build. Not git-linked. | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, copied from dev. It shares dev's database. |

To redeploy Dev2 after new commits, use a checkout of the branch with the Netlify CLI logged in to the team:
`npx netlify-cli deploy --build --prod --site connected-capital-pilot-dev2`
The build runs the golden-suite gates, so a red gate fails the deploy.

## What the last session did

The WIP commit `d274703` added the chart kit and nine charts but had never been checked in a browser. The session ran the app with Playwright at widths from 320 to 1400px. Eight reviewers found issues, eight independent skeptics re-checked each finding, then six fixers worked with before/after evidence.

- **`65a9c3a`, chart kit:**
  - Tooltips are measured and clamped inside their card, and flip below their mark when there's no room above. Before, they ran off-screen on phones and could cut "13.5%" to "3.5%".
  - The Table/Chart toggle drops `aria-pressed`.
  - `niceTicks` handles reversed or tiny ranges.
  - Engine scenarios now report per-posture `flagPoints` (display only).
  - New shared formatters.
- **`ee5c0a5`, buffer-zone and capital charts:**
  - Double points are shown per posture.
  - The "thin" label has a halo, so the line between dots no longer strikes it through.
  - A posture that can't be measured is named in the row.
  - Captions clip only when they really overflow.
  - Tapping a thin bar segment shows its tooltip.
  - Negative equity is no longer shown as a made-up $0 LP line.
  - A co-invest % outside 0–100% leaves equity unsplit and says so.
  - A $0 part stays in the legend.
  - The LP/sponsor split is labelled as derived.
- **`e10783a`, market, stress, cap-rate and hurdle charts, plus the Underwriting tiles:**
  - One formatter for the IRR-vs-required delta, so a miss never reads "+0.0 pts".
  - Tiles reject an incomplete hurdle stack the same way the chart does.
  - The severe rent line is shown per posture.
  - The watch price keeps its cents.
  - Axis ticks switch to $M for very large rents.
  - Older scoring responses are labelled as such.
  - Glossary definitions are back on four chart titles.
  - The decorative "i" glyph is aria-hidden.
- **`44de4df`, the "blank viewport" from the WIP note.** Under `netlify dev`, the strict `/app` CSP blocked Vite's inline React Refresh script, so the page stayed white. A dev-only plugin in `vite.config.ts` now serves that script as an external file. Production builds are unchanged.

Results:
- Tooltip probe: 18 tooltip escapes at 360px on the original code; none at 320, 360, 390, 768 or 1400px after the fixes.
- Full walks of every tab: no page errors.
- `npm run build` is green: parity 16/0, gate1 23/0, gate1:macro 23/0, evidence 4/0, then tsc (app, functions, node) and the vite build.
- Three review findings were refuted. They were artifacts of the sandbox's fallback font.
- A final independent re-verification of the combined fixes was started twice and interrupted. It is not complete.

## Open issues (priority order)

1. **Dev2: Extract with AI never completes.**
   - Symptom: POST `/api/extract` returns 200 `{status:'running'}`. GET `/api/extractions/<id>` stays `{status:'running', submittedAt}` with no `startedAt`; one test job was stuck for over 12 hours. POST `/api/extract-run` returns 202, so the background function is routed.
   - Meaning: the worker is invoked but exits before claiming the job, and it never records an error. Either the trigger-token check fails (the worker returns 401, which is invisible behind the 202), or Netlify Blobs calls fail inside the background function.
   - Next step: in Netlify, open connected-capital-pilot-dev2 → Logs → Functions → `extract-run-background` and read the errors. Also try the button on the original dev site to see whether the problem is specific to Dev2. Code: `netlify/functions/extract-submit.ts`, `extract-run-background.ts`, `extractions.ts`, `lib/gate1/extract-core.ts`.
2. **Merge order:** PR #11 into `dev`, then PR #12 into `main`, if the charts should ship. Merging #12 deploys production.
3. **The final re-verification** of the combined chart fixes was not completed. Re-walk the Underwriting tabs at about 360 and 1400px on Dev2 before release.
4. **Pre-existing follow-ups** found during review, not fixed:
   - Closed glossary popovers still take up layout space and widen the page: 5px at 1400, 91px at 1024, also on `main`. Open ones aren't clamped to the viewport. (`src/Info.tsx`)
   - The Issues tab starts off-screen at 390px. (`src/Underwriting.tsx`, `.uw-tabs`)
   - Keyboard focus can land under the sticky header above 700px.
   - The S&P 500 figures are price-only (FRED `SP500`, no dividends) but presented as the public-market alternative.
   - The sample deal's co-invest "1.8% of total equity" is actually $200K ÷ total cost, which is 4.3% of equity. (`src/sample-extraction.ts`)
   - The engine flags a rent exactly at the watch line, because of float error. (`engine.ts`, `rents_vs_comps`)
   - `netlify.toml` has no `[dev]` framework setting.
   - The `sessionStorage` calls in `main.tsx` are unguarded.

## How to run, test and build

- Node 20+ (22 recommended): `npm install`.
- `npm run dev` starts Vite. Every `/api/*` route is served by dev bridges in `vite.config.ts`, which run the same engine modules, fetch live keyless FRED data and persist nothing. The whole product works locally without env vars, using the sample deal.
- `npm run build` runs `parity` (16), `gate1` (23), `gate1:macro` (23) and `gate:evidence` (4), then `tsc -b`, `tsc -p tsconfig.functions.json` and the vite build. Any red gate fails the build and the deploy.
- `npx tsc -p tsconfig.app.json --noEmit` typechecks the app. `npx tsc -p tsconfig.node.json --noEmit` checks the Vite config.
- `netlify dev` runs the Supabase-backed paths locally and needs the env vars set locally. The `/app` CSP now works under it.
- Verify UI changes in a real browser at desktop and phone widths, around 1400 and 360–390px. Load the sample deal, Confirm & Score, then check every Underwriting tab.

## Rules the owner relies on

- Feature branches open PRs into `dev`. `dev` into `main` is a release. Never push `main` directly.
- Keep the golden suites green, and never weaken or skip a gate to get a build through.
- Secrets live only in Netlify env vars; never commit them. `.env.production` holds only the public Supabase anon values.
- `HANDOFF.md` and `ai-diligence-platform-SETUP-NOTES.md` are confidential. Don't share or ingest them.
- Engine and data updates come from the parent repo, `MDeanH/ai-diligence-platform`. Merge them in and run the parity check.

## Glossary (short)

- **Gate 1:** the first screening pass. The verdict is PASS, CONDITIONAL, REVIEW or FAIL.
- **Posture:** the macro regime's strictness (green, yellow or red). Thresholds can differ by posture, and the Underwriting view shows the same deal under all three.
- **Kill:** a hard-kill check. Failing it means FAIL.
- **Flag:** a watch check that adds flag points. Verdict bands turn the points into a verdict. A severe rent premium doubles the points.
- **Cushion / buffer zone:** room before a check fails, under each posture.
- **Mini-stress:** the equity multiple after a hard-cost overrun (paid with equity) and exit-cap widening, compared against a floor, per posture.
- **Hurdle stack:** the required return. It's a base anchor plus illiquidity, complexity and regime premiums, all from the macro snapshot, and provisional until the client's own formula arrives.
- **Judgment adjustment:** a per-deal threshold override. It requires a reason and is logged, and the baseline verdict is kept alongside it.
