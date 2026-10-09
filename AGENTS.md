# AGENTS.md: Connected Capital Deal Diligence

Connected Capital Deal Diligence is an institutional pilot that screens real-estate development deals.
An analyst uploads an offering memorandum and a pro forma, AI extraction pulls cited fields, and the analyst reviews them.
The deal then runs through **Gate 1** (10 hard kills, 8 watch flags) under a macro **posture** (green, yellow or red) built from FRED data.
Stack: React 18 + Vite 5 SPA (`src/`), Netlify Functions v2 (`netlify/functions/`), Netlify Blobs, Supabase Postgres, Anthropic API.

**Current state and open work: `AGENT_HANDOFF.md`** (dated 2026-10-09; sections 0–9 and Appendices A–C). A shorter 199-line version existed briefly in commit `becef54`; if that is what you have, use the current file instead.

Ignore the repo's `CLAUDE.md` apart from its confidentiality rule: its wiki paths, `~/Claude/hub` notes and `/wiki-*` commands exist only on the owner's machine.

## Start here
- `git fetch origin && git checkout claude/cloud-session-handoff-yilt49` (the PR #11 head: `dev@6671bab` plus 6 chart commits). Use it for PR #11 work and the Dev2 extraction diagnosis. Branch other new work from `dev`.
- **Do not work from `main`**, even though it is the GitHub default branch. It is 54 commits behind `dev` and lacks the auth layer, deal history, the Underwriting view, the charts and migrations 0002–0005. Paths and line numbers in these files refer to `dev` / the PR #11 head.
- You can read, branch, push, open PRs into `dev`, and build and run locally. Deploys, function logs, Blobs, environment variables, Supabase migrations, paid extractions and merges into `main` are owner steps: write the exact command or UI path and ask the owner to run it.

## Setup
- Node 20 (matches the production functions; Node 22 also builds). Use npm with the lockfile: `npm ci`.
- `xlsx` installs from `https://cdn.sheetjs.com/...`, so the install needs network access to that host (and to `registry.npmjs.org`). If your sandbox only has network during setup, run `npm ci` there.
- Python (`requirements.txt`) is only for the data-bake scripts and `tests/test_mc_reference.py`. It is not part of the build.
- **Local secrets:** none are needed for `npm ci`, `npm run build` or the sample-deal walk. Only the dev extraction bridge needs `ANTHROPIC_API_KEY`, exported in the shell that runs `npm run dev` (a `.env` file is not read by the bridges). Take it from your platform's secret store; never write it into the repo or paste it into chat.

## Run
- `npm run dev` starts Vite on http://localhost:5173. The SPA is served at `/`.
  - Dev bridges in `vite.config.ts` serve `/api/score`, `/api/gate1/*`, `/api/extract`, `/api/macro/*` and `/api/config/*` using the same server modules as the functions.
  - There is no persistence under the dev server.
  - `/api/extract` needs `ANTHROPIC_API_KEY` in your shell, and every call costs money and needs the owner's approval.
  - Unbridged routes (`/api/deals`, `/api/extractions/:id`, `/api/users`, `/api/auth/status`, `/api/health`, `/api/cron-run/*`): GET requests return the SPA HTML (200); other methods get a 404 from Vite.
- `npx netlify-cli@27.10.1 dev --framework vite` runs the real functions.
  - Link to a **non-production** site first (Dev2, with the owner's consent). Linking pulls that site's real function secrets into your local process, and it may then write to that site's Supabase database.
  - Deployed sites serve the app at `/app`; `/` is `public/how-it-works.html`.

## Build and test (every gate must pass)
`npm run build` runs these in order and stops at the first failure:
1. `npm run parity`: the TypeScript Monte Carlo engine (`netlify/functions/lib/engine.ts`, `ddq.ts`) must match the Python golden reference (`lib/golden.json`, `lib/baselines.json`).
2. `npm run gate1`: Gate 1 golden suite (`lib/gate1/golden.ts` + `golden.json`). Covers verdicts, boundaries, threshold resolution, adjustments and replay.
3. `npm run gate1:macro`: macro snapshot golden suite (`lib/gate1/golden-macro.ts`), using synthetic data with no network.
4. `npm run gate:evidence`: evidence-map copies must be byte-identical to the bake.
   - On failure, run `python3 reference/market-predictability-evidence/bake_evidence_network.py`.
   - Never hand-edit `public/evidence-network.html`, `sites/evidence-map/public/index.html` or `src/data/evidence-families.json`.
5. `tsc -b` (app and Vite config) and `tsc -p tsconfig.functions.json` (functions). Both are strict, with no unused locals or parameters.
6. `vite build`. The chunk-size warning is expected.

There is no CI. Run `npm run build` yourself before every push and quote the `RESULT:` lines in the PR.

## Product principles (enforced; do not break)
- **Zero hard-coded thresholds.** Every band, weight and stress parameter lives in versioned config: `netlify/functions/lib/gate1/default-config.json` is version 0, and later versions are rows in Supabase `threshold_configs`.
  - A new constant must be definitional and documented in place, as in `lib/gate1/macro.ts`. Otherwise it belongs in config.
- **Every decision is replayable.** Stamp the config version, macro posture, inputs and adjustments, and always keep the unadjusted baseline verdict. `evaluateGate1` stays pure: no I/O, no `Date`, no literals.
- **Missing data never passes.** Extraction returns null rather than guessing, and missing fields produce REVIEW.
- **Macro moves the bar; it never kills on its own.**
- **Manual control is never silent.** Judgment adjustments and macro overrides need a written reason.
- **Honest display.** Label derived numbers as derived, never invent values for missing inputs, and label recorded or sample data.

## Hard rules
- **Never commit or print secrets.** Real secrets live only in Netlify environment variables.
  - `.env` and `.env.*` are gitignored.
  - `.env.production` is committed on purpose and holds only the public Supabase URL and anon key. RLS is deny-all, so all writes go through functions with the service role.
  - Log lengths or booleans, never secret values. Refer to environment variables by name only.
  - Never use a tool or API call that returns environment variable *values* (for example a "get all env vars" call against a Netlify site).
- **`HANDOFF.md` and any `*SETUP-NOTES*` file are confidential.** Do not open, read or display them; do not quote, summarise, ingest or publish them; and do not copy their contents into other files.
  - `HANDOFF.md` is committed on every branch, so it is in your checkout anyway. Skip its hunks in the PR #7 and PR #12 diffs too.
  - When taking changes from PR #7, exclude it: `git checkout 49d857e -- <the other files>` rather than `git cherry-pick`.
- **Branch flow:** feature branch → PR into `dev`; `dev` → PR into `main` is the release.
  - **When opening a PR, set the base to `dev` explicitly.** GitHub's default base is `main`. Never open a PR into `main` yourself; the only `dev` → `main` PR is #12.
  - Never push to `main`, merge into `main`, or deploy production without the owner's explicit approval.
  - **Merging into `main` deploys production**: the production Netlify site is GitHub-linked to `main`, it is unprotected, and publishing is not locked.
- **Never use `npm run deploy` / `scripts/deploy-netlify.sh`.** For any CLI deploy, pass `--site <id>` explicitly, use only Dev2 (`a292223a-…`) unless the owner says otherwise, and make sure `NETLIFY_SITE_ID` is not set to production's id (`8513251e-…`). `.netlify/` is gitignored, so a fresh clone has no `state.json`, and `NETLIFY_SITE_ID` overrides it anyway. Production deploys only by merging into `main`.
- **Keep the golden suites green.** Change golden fixtures only on purpose, and justify it in the commit message.
- **Persistence and auth depend on configuration.** Functions without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` return 503 or `persisted:false` (`/api/users` returns 404).
  - There are two auth switches. `AUTH_ENABLED=1` plus Supabase turns on the admin-only gates (`requireAdmin`). The account gates (`requireAccount`: extract, extraction polls, deals, decide, decisions, macro reads) stay anonymous unless `REQUIRE_ACCOUNTS=1` is also set.
  - Do not assume a site has a database or logins. Probe `/api/auth/status` and `/api/config`.
- **@netlify/blobs 10.7.9:** `setJSON()` ignores the conditional-write flags. Use `set(key, JSON.stringify(v), {onlyIfNew | onlyIfMatch})` for conditional writes.
- **Do not hit shared environments with automation.**
  - Production (`connected-capital-pilot`) and the shared dev site (`connected-capital-pilot-dev`): GET requests only, unless the owner agrees.
  - Paid extraction calls need the owner's approval.

## Verifying UI changes
- Verify in a real browser, not by reading code. The project rule: verified-on-hardware beats spec.
- Drive the flow: load the sample deal ("Load the sample deal") → CONFIRM & SCORE → every Underwriting tab.
- Check widths 1400 and 390 at minimum. For chart tooltips, also check 320, 360 and 768.
- Pass criteria:
  - no text overlaps or text clipped outside its card;
  - no horizontal page overflow (the known exception, until it is fixed, is `scrollWidth` 1405 at 1400 from the hidden glossary popover);
  - no tooltip leaving its card or the viewport;
  - no page errors;
  - the screenshots look right when inspected.
- Playwright harnesses (`walk.cjs`, `tipcheck.cjs`) are in the long `AGENT_HANDOFF.md`, Appendix B. Run them against a local server or a non-production review deploy.
  - Install Playwright in a folder **outside** the repo (or `npm i --no-save playwright`). Never commit `package.json` or `package-lock.json` changes from installing it.
- Charts are hand-rolled SVG built on `src/charts/ChartKit.tsx` (currently only on the PR #11 branch `claude/cloud-session-handoff-yilt49`, not yet in `dev`): scales, `niceTicks`, the measured and clamped `useTooltip`, and ChartCard with a table view. Reuse it rather than adding a chart library.

## Key paths
| Path | What |
|---|---|
| `src/DealIntake.tsx` | App shell: all state, steps and tabs (no router), preview/decide calls, localStorage. |
| `src/IntakeUpload.tsx`, `src/IntakeReview.tsx` | Upload and extraction polling; field review with citations. |
| `src/Underwriting.tsx`, `src/charts/` | Results view and its charts (`src/charts/` on the PR #11 branch until #11 merges into `dev`). |
| `src/ThresholdConfig.tsx`, `src/MacroDashboard.tsx`, `src/Backtest.tsx`, `src/DealHistory.tsx` | Tool tabs. |
| `src/auth.ts`, `src/LoginCard.tsx`, `src/UsersPanel.tsx` | Browser side of auth (opt-in). |
| `src/deal-types.ts`, `src/sample-extraction.ts`, `src/glossary.ts`, `src/format.ts` | Field registry, recorded sample deal, glossary, formatters. |
| `netlify/functions/*.ts` | HTTP functions: each declares its route in `config.path`; `score` and `health` are routed by `netlify.toml`. `macro-cron` and `extractions-reaper` are scheduled (no path) and are triggered over HTTP only through `cron-trigger.ts` (`/api/cron-run/:fn`). |
| `netlify/functions/lib/gate1/` | Gate 1 engine, threshold resolution, preview, default config, macro, FRED, extraction core. |
| `netlify/functions/lib/{engine,compute,ddq}.ts` | Monte Carlo engine (port of `src/model/mc_reference.py`). |
| `netlify/functions/lib/{auth,supabase,cron-auth}.ts` | Identity, service client, cron key check. |
| `netlify.toml` | Build, redirects (`/` landing, `/app` SPA, SPA fallback), security headers and CSP. |
| `supabase/migrations/`, `supabase/seed.sql` | Database schema (RLS on, zero policies) and the v1 config seed. |
| `scripts/check-evidence-sync.ts` | Evidence build gate. |
| `reference/` | Python reference, evidence-map sources and bake script. |
