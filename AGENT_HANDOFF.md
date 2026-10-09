# Connected Capital pilot: agent handoff

**Date:** 2026-10-09 (facts checked between about 14:00 and 15:00 UTC).
**Repo:** `MDeanH/connected-capital-pilot` (private GitHub repo, default branch `main`).
**Written for:** an AI coding agent taking over with no access to the previous Claude session, its scratchpad, or the owner's machine. You get the GitHub repo (if the owner connects it) and whatever files the owner uploads. Section 0.2 lists what you can and cannot do without the owner.

**Earlier version.** Commit `becef54` briefly put a shorter 199-line quick handoff at this same path. This file replaced it in the next commit on `claude/cloud-session-handoff-yilt49`, together with `AGENTS.md`. If you were given the short one, use this one; 3.4 lists what the short one got wrong.

**How facts are marked.** Unmarked statements were checked against the code, git, the GitHub REST API, Netlify deploy metadata, or public GET requests on 2026-10-09. **[unverified]** means nobody could confirm it from this environment. Where the previous session's own notes turned out wrong, this document says so in place. A few facts about what the previous session did (timestamps, tool calls, environment variable *names*) come from its local session record; no values were taken from it.

**Not used as sources:** `HANDOFF.md` and any `*SETUP-NOTES*` file. They are confidential and were not opened. Section 8 has the rules.

**No secret values appear in this document.** It gives environment variable names only. The Supabase project ref and URL are public because they are committed in `.env.production`.

---

## Before you hand over (for the owner)

1. **`HANDOFF.md` is committed to git.** It is tracked on every branch, `main` included, appears in 7 commits of history, and has hunks in the diffs of PR #7 and PR #12. Any agent you give repo access to can read it. Decide first:
   - (a) accept that;
   - (b) remove it from the branch tips with `git rm --cached HANDOFF.md` through a PR into `dev` (and later `main`), keeping your local copy. It stays readable in history unless you also rewrite history and force-push, which is a bigger step;
   - (c) give the agent a sanitized fork or copy of the repo without it.
   No `*SETUP-NOTES*` file is tracked on any branch.
2. **This file and `AGENTS.md` are committed** at the repo root on `claude/cloud-session-handoff-yilt49` (PR #11). If the agent will not have repo access, upload both files to it.
3. **Consider rotating secrets** that the previous session's tooling exposed in its own transcript (6.5).
4. **Decide what Netlify, Supabase and Anthropic access the agent gets.** The default assumption here is none: the agent writes the exact command or UI path and you run it (0.2).

---

## 0. TL;DR

- **What it is.** Connected Capital Deal Diligence is an institutional pilot that screens real-estate development deals.
  - An analyst uploads an offering memorandum and a pro forma. AI extraction pulls about 30 fields, each with a citation, and the analyst confirms them.
  - The deal then runs through **Gate 1**: 10 hard kills and 8 watch flags. The thresholds tighten or loosen with a macro **posture** (green, yellow or red) computed weekly from FRED data.
  - Stack: a React/Vite SPA, Netlify Functions (v2), Netlify Blobs, Supabase Postgres, and the Anthropic API.
- **Where it stands.**
  - Production serves `main@54bd114` from 2026-07-31. It is 54 commits behind `dev`.
  - PR #12 (`dev` → `main`) is open. It releases the auth layer, deal history and the Underwriting redesign.
  - PR #11 (charts for the Underwriting view, browser-verified with fixes) is a draft into `dev`. PR #12 does **not** include it.
  - Login is off on every deployed site, so admin actions are open to anyone.
  - On the review site Dev2, "Extract with AI" was reported to hang by the previous session; it has not been reproduced since **[unverified]**. Dev2's functions have no database (verified).
- **The three most important next actions:**
  1. **Get the owner's release decision before anyone merges PR #12.** Merging into `main` very likely deploys production automatically (production is GitHub-linked; 4.2). The questions are in 0.3, 3.3 and 4.3: merge #11 into `dev` first or not, and which production environment variables, auth settings and database migrations should be in place.
  2. **Diagnose the Dev2 extraction hang** (6.1). Add a log line before each silent early return in `netlify/functions/extract-run-background.ts`, have it deployed to Dev2, submit one fresh extraction, and read the function log.
  3. **Finish PR #11's verification and mark it ready** (6.3). The per-finding edge-case checks still need to run on the combined head.

### 0.1 Start here: which branch

```bash
git fetch origin && git checkout claude/cloud-session-handoff-yilt49
```

- `claude/cloud-session-handoff-yilt49` is the PR #11 head: `dev@6671bab` plus 6 chart commits. Use it for PR #11 work and the Dev2 diagnosis. Branch other new work from `dev`.
- **Do not work from `main`**, even though it is GitHub's default branch and the one most tools open first. It is 54 commits behind `dev` and lacks the auth layer, deal history, the Underwriting view, the charts, `.env.production` and migrations 0002–0005.
- Every path and line number in this document refers to `dev` or the PR #11 head. For the extraction files they are identical; `src/charts/` and the `externalReactPreamble()` plugin exist only on the PR #11 head.
- When you open a PR, **set the base to `dev` explicitly.** GitHub defaults the base to `main`, `main` is unprotected, and a merge there publishes production.

### 0.2 Access and limits

- **With GitHub access you can:** read, branch, push, and open PRs into `dev`; run `npm ci`, `npm run build`, `npm run dev` and the Appendix B harnesses locally; and send GET requests to the public sites.
- **You cannot, without the owner:** deploy to any Netlify site, read function logs or Blobs, read or change environment variables, apply Supabase migrations, submit a paid extraction, or merge into `main`. For each of these, write the exact command or UI path, ask the owner to run it, and ask them to paste the output with any secret values redacted.
- **Network:** `npm ci` needs `registry.npmjs.org` and `cdn.sheetjs.com`. If your sandbox only has network during setup **[unverified for ChatGPT/Codex]**, run `npm ci` in the setup step. After install, the build gates and the sample-deal walk under `npm run dev` need no network and no secrets; macro signals are simply null offline.

### 0.3 Owner decisions needed (ask first)

1. Release order: Option A (#11 into `dev`, then #12) or Option B (#12 now, charts later) (3.3).
2. Production environment before #12 merges (4.3): which Supabase project; `AUTH_ENABLED`, `REQUIRE_ACCOUNTS` and `BOOTSTRAP_ADMIN_EMAIL`; `ANTHROPIC_API_KEY` and `EXTRACTION_DAILY_CAP`; `CRON_TRIGGER_SECRET` plus a pg_cron job; which migrations to apply.
3. Approval for one paid extraction on Dev2, and who runs the Dev2 deploy and reads the log (6.1).
4. Should Dev2 use the dev site's database (6.2)?
5. Turn auth on for the dev site, or accept the open admin actions and anonymous paid extraction (6.5).
6. Whether to rotate the secrets exposed in the previous session's transcript, and remove dev's keys from Dev2 (6.5).
7. Whether `AGENT_HANDOFF.md` and `AGENTS.md` should merge into `dev` with PR #11, or be removed before it merges.
8. Close #7; retarget #8 to `dev` or leave it as a draft (9).
9. Add a CI workflow, protect `main`, make `dev` the default branch, git-link the dev site (6.5, 9).
10. Keep `HANDOFF.md` in the repo the agent can read (see "Before you hand over").

---

## 1. Project overview and product flow

The app lives at `/app`. The landing page at `/` is the static `public/how-it-works.html`, forced by a redirect in `netlify.toml`. The SPA has **no client-side router**: `src/DealIntake.tsx` owns all state and switches screens with an internal `Step` value.

1. **Intake** (`src/IntakeUpload.tsx`). There are two ways in; there is no blank form.
   - **Upload documents.** The OM can be a PDF, or a .docx or .txt file that `src/docx.ts` converts to text in the browser using mammoth. The pro forma can be .xlsx, .xls, .xlsm or .csv, which `src/excel.ts` converts to CSV text using SheetJS. The browser then sends `POST /api/extract` and polls `GET /api/extractions/:id`. Section 2.3 has the full flow.
   - **"Load the sample deal".** This uses `SAMPLE_EXTRACTION` in `src/sample-extraction.ts`, a recorded extraction of the Faithful Trails RV OM and the Okeechobee pro forma. It is marked `recorded: true` and the UI shows a banner saying so.
2. **Review** (`src/IntakeReview.tsx`). The analyst confirms or corrects about 30 fields. Each field shows its confidence and a citation (document, page, quote), and missing fields are flagged.
   - The consistency panel (`src/ConsistencyPanel.tsx`) compares the OM against the pro forma.
   - Market cross-checks (`src/marketCrossChecks.tsx`) and `src/LocationIntelCard.tsx` come from a neutral `/api/score` call keyed on the deal's location.
3. **Results.**
   - **Live verdict.** `POST /api/gate1/preview`, debounced 400 ms, returns PASS, CONDITIONAL, FAIL or REVIEW.
   - **Underwriting view** (`src/Underwriting.tsx`). Tabs: Summary, Financials, Market, Sponsor and Issues. It shows the green, yellow and red posture scenarios side by side, with charts from `src/charts/` (PR #11 branch only until #11 merges into `dev`).
   - **Judgment panel** (`src/JudgmentPanel.tsx`). Per-deal threshold overrides; a reason is required and the baseline verdict is kept.
   - **RECORD DECISION.** `POST /api/gate1/decide` writes an append-only ledger row that can be replayed.
4. **Tool tabs:**
   - **THRESHOLDS** (`src/ThresholdConfig.tsx`): edit every band, weight and stress parameter. A draft affects previews only. Saving creates a new config version (`POST /api/config`, note required, admin only), or the draft can be exported as JSON.
   - **MACRO** (`src/MacroDashboard.tsx`): the weekly FRED snapshot (8 weighted signals, then regime, then a posture per asset class), an inflation-by-growth quadrant, 5-year sparklines, and a manual override that requires a note (admin only).
   - **BACKTEST** (`src/Backtest.tsx`): runs past deals from a template workbook through the current rulebook using `/api/gate1/preview-batch`, falling back to row-by-row preview.
   - **EVIDENCE** (`src/EvidencePanel.tsx`): the market-predictability evidence map (49 families, 198 studies) from `src/data/evidence-families.json`.
   - **DEALS** (`src/DealHistory.tsx`): the decision ledger, with cursor paging and admin deletes.
   - **USERS** (`src/UsersPanel.tsx`): shown only to a signed-in admin, and only when auth is on.

There is also a legacy Python line (`app.py` Streamlit, `src/model/*.py`, `src/data/*.py`, `tests/test_mc_reference.py`, `requirements.txt`). It is not built or deployed. `src/model/mc_reference.py` is the reference that the TypeScript Monte Carlo engine must match through the parity suite.

According to the previous session, the engine and data pipeline also evolve in a parent repo, `MDeanH/ai-diligence-platform`. That repo was not accessible from this environment **[unverified]**.

---

## 2. Architecture and code map

### 2.1 Stack (versions from `package.json`, with installed versions in brackets)

- **Frontend:**
  - React ^18.3.1, Vite ^5.4.0 [5.4.21], @vitejs/plugin-react ^4.3.1 [4.7.0], TypeScript ^5.5.3 [5.9.3].
  - mammoth ^1.12.1 and xlsx 0.20.3 are loaded on demand. xlsx installs from the tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, not from npm.
  - @supabase/supabase-js ^2.110.2 is used in the browser for Auth only.
  - lucide-react is listed but nothing imports it.
  - Charts are hand-rolled SVG; there is no chart library.
- **Backend:**
  - Netlify Functions v2 (@netlify/functions ^5.3.0) on Node 20 (`NODE_VERSION = "20"` in `netlify.toml`).
  - @netlify/blobs 10.7.9, @anthropic-ai/sdk ^0.111.0, and supabase-js with the service role.
- **Tooling:** tsx runs the golden suites. There is no `engines` field, `.nvmrc` or CI.
- **Extraction model:** `MODEL = 'claude-opus-4-8'` in `netlify/functions/lib/gate1/extract-core.ts:23`, using `output_config.format` (json_schema) and `max_tokens` 16000. This is a valid current Anthropic model id; a newer Opus exists.

### 2.2 Directory map

```
index.html                 Vite entry (Roboto from Google Fonts)
netlify.toml               build, redirects, headers/CSP (2.4); no [dev] block
.env.production            PUBLIC build-time vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, committed on purpose
vite.config.ts             React plugin + 5 local-dev API bridges + externalReactPreamble() (7.2)
tsconfig.app.json / tsconfig.node.json / tsconfig.functions.json
src/
  main.tsx, App.tsx        mount; lazy DealIntake behind ErrorBoundary
  DealIntake.tsx           THE app: state, steps/tabs, preview/decide, macro/config fetch, localStorage
  IntakeUpload.tsx, IntakeReview.tsx, Underwriting.tsx, JudgmentPanel.tsx, GateResults.tsx,
  ConsistencyPanel.tsx, KpiScorecard.tsx, FinancialSummary.tsx, MarketComparison.tsx,
  McProbabilityCard.tsx, MarketPathCard.tsx, LocationIntelCard.tsx, marketCrossChecks.tsx,
  useMarketContext.ts, MacroDashboard.tsx, ThresholdConfig.tsx, Backtest.tsx,
  EvidencePanel.tsx, DealHistory.tsx, DealSnapshot.tsx
  auth.ts, LoginCard.tsx, UsersPanel.tsx      browser half of the auth layer
  deal-types.ts            field registry + client types (re-exports server types)
  sample-extraction.ts     recorded sample extraction
  excel.ts, docx.ts        in-browser parsing (size caps mirrored server-side)
  finance.ts, format.ts, glossary.ts, GlossaryTip.tsx, Info.tsx, cc-ui.tsx, cc-theme.css, cc-tokens.ts
  data/evidence-families.json   build-gated copy of the evidence map
  charts/                  (PR #11 branch only) ChartKit.tsx + Cushion/Stress/Hurdle/CapRate/Market/Capital charts
netlify/functions/         14 functions (2.5) + lib/
  lib/engine.ts, compute.ts, ddq.ts       Monte Carlo engine (TS port of src/model/mc_reference.py)
  lib/parity.ts, golden.json, baselines.json   parity suite
  lib/metros.json (about 15 MB, 20,216 market histories), market-edge.json, market-path.json
  lib/auth.ts, cron-auth.ts, supabase.ts
  lib/gate1/               engine.ts, thresholds.ts, preview.ts, default-config.json, macro.ts, fred.ts,
                           fields.ts, extract-core.ts, types.ts, golden.ts, golden.json, golden-macro.ts
supabase/migrations/0001..0005, supabase/seed.sql
scripts/                   check-evidence-sync.ts (build gate), deploy-netlify.sh, deploy-evidence-map.sh, Python data-bake scripts
reference/                 Python MC reference, scoping docs, market-predictability-evidence/ (source + bake_evidence_network.py)
sites/evidence-map/        separate static Netlify site (own strict CSP); public/index.html is generated
research/                  TSFM benchmarks (bake_market_path.py writes lib/market-path.json)
public/                    how-it-works.html (landing), evidence-network.html (baked), market-context.json, crime-*.json
```

`public/market-context.json` and `public/crime-*.json` are deployed, but nothing in `src/` fetches them. Several Python scripts refer to parent-repo files that do not exist here, such as `src/market3d-data.json`, `src/us-market.json` and `public/data-vintages.json`.

### 2.3 Request flows

**AI extraction (deployed path):**

1. The browser mints a v4 UUID with `crypto.randomUUID()` and sends `POST /api/extract`, handled by `netlify/functions/extract-submit.ts`. It also stores `{id, owner, submittedAt}` in localStorage key `cc_pending_extraction_v1` so the job can be resumed later.
2. `extract-submit` validates the request:
   - Body at most 4.5 MB.
   - OM text at most 200k characters.
   - At most 50 sheets, each at most 64k characters, with at most 200k characters in total.
   - The id must be a v4 UUID.
   - `ANTHROPIC_API_KEY` must be set; otherwise it returns 500 "not configured".
3. It checks the daily cap in Blobs store `extraction-budget`, key `submits-YYYY-MM-DD`. The cap is `EXTRACTION_DAILY_CAP`, default 200.
4. It claims the id in Blobs store `extractions` with `set(id, {status:'running', submittedAt}, {onlyIfNew:true})`. A duplicate id gets 409.
5. It stages the documents at `payload-<id>`.
6. It calls `POST ${origin}/api/extract-run` with header `x-cc-worker-token`, which is the hex HMAC-SHA256 of the id keyed by `ANTHROPIC_API_KEY`.
   - Only a trigger status of 400 or more counts as failure. Background functions always answer 202, so a 401 from the worker is never seen here.
7. It returns `200 {extractionId, status:'running'}`.
8. `netlify/functions/extract-run-background.ts` is a background function with a 15-minute limit:
   - It verifies the HMAC token (lines 28–33). On a mismatch it returns 401 and writes nothing.
   - It calls `getStore('extractions')` at line 35. This is **outside** the try/catch.
   - It does a strong-consistency read of the record. If `startedAt` is already set, it returns silently (line 47).
   - It makes an etag-conditional claim with `set(id, {status:'running', startedAt}, {onlyIfMatch: etag})`. If `claim.modified` is false, it returns silently (line 68).
   - It does a strong read of the payload, then deletes it.
   - It calls `runExtraction()` in `lib/gate1/extract-core.ts`. That logs `extract: model=... ms=...` on success (line 88).
   - It inserts an optional provenance row into Supabase `extractions`.
   - It writes `{status:'done', ...result, startedAt, completedAt}`. Any thrown error inside the try writes a generic `{status:'error'}`.
9. The client polls `GET /api/extractions/:id` (`extractions.ts`) at 3 s, then 6 s, then 12 s, for up to 15 minutes.
   - A missing record is reported as `{"status":"running"}`.
   - A record stuck in `running` for more than 24 h (`STUCK_RUNNING_MS`) is deleted and answers 410.
   - Finished records are kept 7 days.

**Under `npm run dev`:** the Vite bridge runs `runExtraction` synchronously and returns the result directly. The client handles both response shapes.

**Preview, decide and ledger** (`netlify/functions/gate1.ts`):
- **Preview.** The client sends `{fields, adjustments, posture?, configOverride?}`. The server picks the active config: the highest `threshold_configs.version` in Supabase, otherwise the baked-in version 0 (`lib/gate1/default-config.json`). It picks the posture in this order: request override, latest macro snapshot, live FRED compute if no snapshots exist, then green. `computeGate1()` (`lib/gate1/preview.ts`) returns the result, the baseline, and scenarios for all three postures.
- **Decide**, with Supabase configured, accepts no posture override. The server resolves config and posture again and answers **409** if they differ from the client's `expectedPosture` / `expectedConfigVersion`.
  - A draft config gets 400. A snapshot older than 14 days gets 503.
  - On success it inserts a version-0 `threshold_configs` row if needed, links or creates a `deals` row, appends to `gate_decisions`, and sets `extractions.deal_id` (best effort).
  - Without Supabase it returns `persisted:false`, and it scores under the client's `expectedPosture` (or `body.posture`), so the verdict matches the preview the analyst saw (`gate1.ts` ~452–457).

### 2.4 Routing, headers, CSP (`netlify.toml`)

- **Build:** `npm run build`, publish `dist`, functions in `netlify/functions`, Node 20. There is no `[dev]` block.
- **Redirects, in order:**
  1. `/` → `/how-it-works.html` (200, force).
  2. `/app` and `/app/*` → `/index.html`.
  3. `/api/score` → the `score` function.
  4. `/api/health` → the `health` function.
  5. `/*` → `/index.html`. Because of this fallback, an unknown `/api/*` path returns **200 HTML**, not 404.
- All other APIs route themselves through each function's `config.path`.
- **Headers on `/*`:** X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS, and a CSP that allows `'unsafe-inline'` scripts. Only the static landing and evidence pages need that.
- **`/app`** gets a stricter `script-src 'self'`.
- **On `main` today**, `netlify.toml` has only the `/assets/*` cache rule, so production serves **no CSP and no X-Frame-Options**.
- **Stale comments:** `netlify.toml` mentions a "1.4 MB plotly chunk" (plotly is not a dependency) and says "DealIntake instantiates a Worker from a blob URL", but there is no `new Worker` in `src/`.

### 2.5 API endpoints (each function's `config.path`)

- **Rate limit:** 120 requests per 60 s per function, except `/api/extract` (10 per 60 s) and extract-run, cron-trigger and health (none). The code says `aggregateBy: 'ip'`, but Netlify's deploy metadata shows only a `domain` aggregate, so the limit may be per site rather than per IP **[unverified]**.
- **"Auth gate" column.** There are two switches (2.6), and they cover different endpoints:
  - **`requireAdmin`** takes effect with `AUTH_ENABLED=1` plus Supabase.
  - **`requireAccount`** takes effect only with `AUTH_ENABLED=1`, **`REQUIRE_ACCOUNTS=1`** and Supabase (`lib/auth.ts` `accountsRequired()`, ~194–210). With `AUTH_ENABLED=1` alone, every `requireAccount` endpoint stays open to anonymous callers, including paid `POST /api/extract`.
  - Today `AUTH_ENABLED` is off on every site, so both gates let everything through. `/api/users` is the exception: it returns 404 whenever auth is off.

| Path | Method | File | What it does | Auth gate |
|---|---|---|---|---|
| `/api/score` (redirect) | POST | `score.ts` → `lib/compute.ts` | Monte Carlo deal score: `honest` (de-smoothed) vs `naive`, plus `marketEdge` and `marketPath`. Macro figures are pinned at 2026-03-31. Body at most 32 kB. | none |
| `/api/health` (redirect) | GET | `health.ts` | Hard-coded `{ok, service, version:"0.2-netlify", timestamp}`; it does not identify the build. | none |
| `/api/auth/status` | GET | `auth-status.ts` | `{enabled, accountsRequired}` | none |
| `/api/gate1/preview` | POST | `gate1.ts` | Stateless evaluation; allows a what-if `posture` and a draft `configOverride`. | none |
| `/api/gate1/preview-batch` | POST | `gate1.ts` | Up to 100 rows. | none |
| `/api/gate1/decide` | POST | `gate1.ts` | Evaluate and persist, with the 409 handshake. | requireAccount |
| `/api/gate1/decisions` | GET | `gate1.ts` | Ledger with `?limit` (at most 200) and `?before=createdAt\|id` cursor. | requireAccount |
| `/api/gate1/decisions/:id` | DELETE | `gate1.ts` | Delete one decision. | requireAdmin |
| `/api/config` | GET | `gate1-config.ts` | List of versions (metadata). | none |
| `/api/config` | POST | `gate1-config.ts` | Append a version `{config, note, baseVersion}`, validated by `configShapeError`. 409 if `baseVersion` is stale; 503 without Supabase. | requireAdmin |
| `/api/config/active`, `/api/config/:version` | GET | `gate1-config.ts` | Active config, or a specific version (0 = baked default). | none |
| `/api/macro/latest` | GET | `macro.ts` | The newest stored snapshot if it is at most 14 days old; otherwise a live FRED compute with a warning. | requireAccount |
| `/api/macro/history` | GET | `macro.ts` | Last 52 snapshots; `[]` without Supabase. | requireAccount |
| `/api/macro/override` | POST | `macro.ts` | Manual regime or signal values; note required. | requireAdmin |
| `/api/deals`, `/api/deals/:id` | GET, POST, PATCH, DELETE | `deals.ts` | Deal CRUD. DELETE uses RPC `delete_deal`. 503 without Supabase. | requireAccount; DELETE also requireAdmin |
| `/api/extract` | POST | `extract-submit.ts` | Submit an extraction (2.3). | requireAccount |
| `/api/extract-run` | POST | `extract-run-background.ts` | Background worker. | HMAC header `x-cc-worker-token` |
| `/api/extractions/:id` | GET | `extractions.ts` | Poll an extraction. | requireAccount |
| `/api/users`, `/api/users/:id` | GET, POST, PATCH | `users.ts` | Admin user management through Supabase Auth admin and `profiles`. PATCH goes through RPC `update_profile_guarded`. **Returns 404 when auth is off.** | requireAdmin |
| `/api/cron-run/:fn` | POST | `cron-trigger.ts` | External cron dispatcher; `fn` is `macro-cron` or `extractions-reaper`. | `x-cron-key` must equal `CRON_TRIGGER_SECRET` |
| (scheduled) | — | `macro-cron.ts` | `0 13 * * 1` (Mondays 13:00 UTC). Config has `schedule` only, no `path`; reachable over HTTP only through `/api/cron-run/macro-cron`. | — |
| (scheduled) | — | `extractions-reaper.ts` | `30 3 * * *`. Same: no `path`; reachable only through `/api/cron-run/extractions-reaper`. | — |

`health.ts` exports no `config` at all; it is reached only through the `netlify.toml` redirect.

**Consequence of auth being off (the current state).** On any site that has Supabase configured (today, only the dev site), anyone can:
- save a rulebook version;
- record a macro override;
- delete deals and decisions.

On any site with `ANTHROPIC_API_KEY` set, anyone can submit paid extractions. Those are limited only by the rate limit and the daily cap. This exposure was inferred from the code and not exercised.

**Consequence of `AUTH_ENABLED=1` without `REQUIRE_ACCOUNTS=1`.** The admin actions above close, but paid extraction, extraction polls, deal create/read/update, decide, the decisions ledger and the macro reads all stay anonymous.

### 2.6 Environment variables (names only)

| Name | Read in | Effect | When unset |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts` `serviceClient()`; `lib/auth.ts` | Server persistence for every table; also a precondition for auth. | Deals, decisions and config POST return 503 "Persistence not configured"; `/api/users` returns 404 (auth counts as off). Decide and override return `persisted:false`. Config shows version 0 only. Macro history is `[]` and latest is computed live. |
| `AUTH_ENABLED` | `lib/auth.ts` | `'1'`, together with Supabase, switches on the `requireAdmin` gates (config POST, macro override, DELETE decision, DELETE deal, `/api/users`). | Login-free: every gate lets requests through and `/api/users` returns 404. |
| `REQUIRE_ACCOUNTS` | `lib/auth.ts` | `'1'`, together with `AUTH_ENABLED=1` and Supabase, switches on the `requireAccount` gates: every data endpoint (extract, extraction polls, deals, decide, decisions, macro reads) then requires a valid Supabase JWT, and the SPA shows a sign-in wall. **Required, not optional, to close paid extraction and the deal, decision and extraction reads to anonymous users.** | No wall, and the `requireAccount` endpoints stay anonymous even when `AUTH_ENABLED=1`. **It has no effect unless `AUTH_ENABLED=1`.** |
| `BOOTSTRAP_ADMIN_EMAIL` | `lib/auth.ts` | The first verified user with this email becomes admin. | No automatic first admin. |
| `ANTHROPIC_API_KEY` | `extract-submit.ts`, `extract-run-background.ts`, `extract-core.ts` | Anthropic calls; also the **HMAC key for the worker trigger**. | `/api/extract` returns 500; the worker returns 401. |
| `EXTRACTION_DAILY_CAP` | `extract-submit.ts` | Global cap on paid runs per UTC day. | 200. |
| `CRON_TRIGGER_SECRET` | `lib/cron-auth.ts` | Checked in constant time against the `x-cron-key` header. | Fails closed: every external cron call gets 403. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `src/auth.ts` (build time, from the committed `.env.production`) | The browser Supabase Auth client. The auth UI appears only when `/api/auth/status` also reports enabled. | The browser client is null and `authFetch` is plain `fetch`. Vite loads `.env.production` only for production builds, so under `npm run dev` auth is off. |

- **Names set on the dev site** as of 2026-09-28 (from the previous session's record; names only): `ANTHROPIC_API_KEY`, `BOOTSTRAP_ADMIN_EMAIL`, `CRON_TRIGGER_SECRET`, `GATE_SIGNING_SECRET`, `PILOT_PASSWORD`, `REQUIRE_ACCOUNTS`, `SECRETS_SCAN_OMIT_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`.
  - `AUTH_ENABLED` is not among them, which matches dev's `/api/auth/status` reporting `enabled:false`; so `REQUIRE_ACCOUNTS` currently has no effect there.
  - `PILOT_PASSWORD` and `GATE_SIGNING_SECRET` are read by no code, left over from the removed edge gate.
- **Netlify build setting, not app code:** `SECRETS_SCAN_OMIT_KEYS`.
- **Python scripts only:** `FRED_API_KEY`, `FRED_CACHE`, `FBI_CDE_API_KEY`, `FBI_YEAR`, `ADT_CHECKOUT`.
- **Deploy scripts:** `NETLIFY_AUTH_TOKEN`, `EVIDENCE_MAP_SITE_ID`.

### 2.7 Persistence

**Supabase Postgres**, project ref `rbodmakhvjhpxobactev` (URL `https://rbodmakhvjhpxobactev.supabase.co`, which is public).
- RLS is enabled on every table with **zero policies**, so only the service role, held by the Netlify functions, can read or write. The browser uses Supabase for Auth only.
- Which project each site's function-side `SUPABASE_URL` points at is **[unverified]**.

| Table / RPC | Written by | Notes |
|---|---|---|
| `deals` | decide (create or link), `/api/deals` | name, asset_class, location, sponsor, status, fields (jsonb) |
| `deal_documents` | nothing | Only removed by `delete_deal`. |
| `extractions` | the worker (provenance row); decide sets `deal_id` | The primary key is the client-minted UUID. |
| `threshold_configs` | `POST /api/config`; decide's version-0 self-insert; `seed.sql` (v1) | Append-only; `version` is the primary key. |
| `macro_snapshots` | macro-cron, `/api/macro/override` | `snapshot` jsonb (0002), `author_email` (0004). |
| `gate_decisions` | decide | Append-only. Holds inputs, overrides, baseline and adjusted results, config version, snapshot id, `decided_by_email` (0004). |
| `profiles` | `/api/users`, admin bootstrap | Keyed to `auth.users` (0004). |
| `delete_deal(p_deal_id)` | — | Migration 0003. One transaction; P0002 = not found. |
| `update_profile_guarded(...)` | — | Migration 0005. AD001 = cannot change self; AD002 = would remove the last admin. |

- **Migrations** live in `supabase/migrations/0001_init.sql` … `0005_profile_update_rpc.sql`.
- There is no `supabase/config.toml`. How migrations get applied (SQL editor or `supabase db push`) is **[unverified]**.
- On the dev database, 0001 and 0002 are applied, since it has working deals, configs and snapshots. At least the `gate_decisions.decided_by_email` column from 0004 also appears applied: dev's ledger has decisions recorded on 2026-10-02, after `dev@6671bab` was deployed, and that code's decide insert always writes `decided_by_email`, which PostgREST would reject as an unknown column. This is an inference, not a schema read. Whether 0003, 0005 and the rest of 0004 are applied anywhere is **[unverified]**.

**Netlify Blobs** (per site):
- Store `extractions`: `<uuid>` status and result records, plus `payload-<uuid>` staged documents.
- Store `extraction-budget`: `submits-YYYY-MM-DD` counters.
- Workaround to keep: in @netlify/blobs 10.7.9, `setJSON()` silently drops the conditional-write flags. Conditional writes therefore use `set()` with `JSON.stringify`.

**Browser:**
- localStorage `cc_deal_intake_v1`, `cc_config_draft_v1` and `cc_pending_extraction_v1`. Each is stamped with an owner, so a different identity's data is discarded on a shared browser.
- sessionStorage `chunk-reload-attempted`.

### 2.8 Engines

**Gate 1** (`netlify/functions/lib/gate1/`):
- **`engine.ts` `evaluateGate1()`** is pure: no I/O, no `Date`, no threshold literals.
  - **Kills:** sponsor_integrity, site_entitled, single_exit_refi, ltc_max, dev_spread_min, contingency_min, coinvest_min, track_record, gmp_required, mini_stress.
  - **Flags:** yoc_vs_benchmark, exit_cap_vs_market, interest_reserve, land_basis, rents_vs_comps, absorption, profit_margin, completion_guarantee.
  - **Verdict:**
    - Any kill → FAIL.
    - Otherwise, any missing field → REVIEW.
    - Otherwise, flag points ≤ 1 → PASS.
    - Otherwise, flag points ≤ 3 → CONDITIONAL.
    - Otherwise → FAIL.
- **`thresholds.ts` `resolveThresholds()`:** the most specific row wins, in this order: (class, posture), ('*', posture), (class, '*'), ('*', '*'). Adjustments need a reason, a finite value and a known key.
- **`default-config.json`** is version 0: 18 checks, 33 threshold rows, verdict bands, and the macro section.
  - Signals: sahm, core_pce, gdp, hy_spread, unemployment, yield_curve, jobless_claims, and ism (entered manually).
  - `postureMatrix`, `hysteresisWins` 2, `minVotes` 4.
  - `hurdleStack`: anchor 8%, plus illiquidity, complexity and regime add-ons.
- **`macro.ts`** (pure): `computeMacroSnapshot` and `buildMarketContext`. The S&P 500 series is FRED `SP500`, a price index that excludes dividends.
- **`fred.ts`** is the only networked module in the macro pipeline (`extract-core.ts`, in the same directory, calls Anthropic). It uses the keyless `fredgraph.csv` endpoint and returns `[]` on failure.

**Monte Carlo** (`lib/engine.ts`, `lib/compute.ts`, `lib/ddq.ts`):
- A TypeScript port of `src/model/mc_reference.py`: mulberry32 random numbers, Geltner de-smoothing, empirical bootstrap, DDQ adjustments, and sigma-floor fractional Kelly sizing.
- Location resolves by exact "City, ST" match against `metros.json`, otherwise the national baseline.
- **Staleness guard:** the market-path tilt is zeroed 270 days after `market-path.json`'s `asof` (2026-04-30), which is around **2027-01-25**.
- Used by `McProbabilityCard` and `useMarketContext`.

### 2.9 Scheduling

- **The Netlify scheduler.** Code comments in `lib/cron-auth.ts` and `cron-trigger.ts`, dated 2026-08-24, say it never fired on these API/CLI-deployed sites, and that Netlify refuses HTTP calls to scheduled functions.
- **What fires instead.** An external **Supabase pg_cron** job calls `POST /api/cron-run/{macro-cron|extractions-reaper}` with `x-cron-key`, and `cron-trigger.ts` dispatches to the right function.
- **The job definition is not in the repo.** Its target URL and schedule are **[unverified]**.
- **Evidence that it fires on the dev site.** The dev site has 7 automatic weekly snapshots, from 2026-08-24 through 2026-10-05, all `soft_landing`.
- **Double runs are harmless.** `macro-cron` skips a week that is already recorded.
- **Production** has no `cron-trigger` function and no Supabase, so it computes macro live on every request.

---

## 3. Repos, branches and pull requests (as of 2026-10-09)

### 3.1 Repo facts

- **Remote and checkout.** The only remote is `origin` = `https://github.com/MDeanH/connected-capital-pilot`.
- **Protection and CI.** No branch protection: every branch reports `protected: false`, rulesets are empty, there are no required checks, no tags and no releases.
- **No GitHub Actions.** There is no `.github/` directory and no workflows. The only build gates are the ones inside `npm run build`.
- **Default branch is `main`.** New PRs therefore default to base `main`; set `dev` explicitly (0.1).
- **Merge settings.** Merge, squash and rebase are all allowed. Branches are not deleted after merge. PRs #1–#6, #9 and #10 (8 PRs) were merged as merge commits with no reviews; #7 and #8 are still open. `dev` also carries about 35 commits pushed directly rather than through a PR, mostly on 2026-08-19, plus `b94a073` (2026-09-09, which removed the edge gate).
- **Installed GitHub Apps:** claude, cursor, netlify, netlify-coding. They create empty check suites but have posted no check runs.

### 3.2 Branches

"Behind/ahead" counts commits relative to `dev`.

| Branch | Tip | Behind/ahead `dev` | Status |
|---|---|---|---|
| `main` | `54bd114` (2026-07-31) | 54 / 0 | Release branch; production builds from it. Not touched since July. |
| `dev` | `6671bab` (2026-09-28, merge of PR #10) | — | Integration branch; contains PRs #1–#6, #9 and #10, plus direct pushes (e.g. `b94a073`). |
| `claude/cloud-session-handoff-yilt49` | `becef54` (2026-10-09) | 0 / 6 | PR #11 head. |
| `feature/underwriting-charts` | `d274703` | 0 / 1 | Already contained in PR #11; delete after #11 merges. |
| `feature/underwriting-view` | `90770d9` | merged (#10) | Can be deleted. |
| `feature/no-login` | `5adba39` | merged (#9) | Can be deleted. |
| `claude/jev-integration-3h28ai` | `d7876f7` | branched from `main` | PR #8 head. |
| `cursor/remove-pilot-password-gate-e610` | `49d857e` | 5 / 1 | PR #7 head. |

There is **no `pilot` branch** and no `pilotrepo` remote, whatever `README.md` and `CLAUDE.md` say.

### 3.3 Open pull requests and the merge-order decision

| PR | Head → base | State | Contents |
|---|---|---|---|
| **#12** "Add auth layer, deal history, and underwriting UI redesign" | `dev` (`6671bab`) → `main` | Open, ready for review. Created 2026-10-09T14:04Z. | 54 commits, 84 files, +8603/−553. `mergeable_state: clean`. No checks and no reviews. The body is **truncated mid-sentence** and does not mention that login is off by default. Deploy preview: `https://deploy-preview-12--connected-capital-pilot.netlify.app` (serves `dev@6671bab`, no charts). |
| **#11** "Underwriting view charts: browser-verified, with fixes" | `claude/cloud-session-handoff-yilt49` (`becef54`) → `dev` | **Draft** | 6 commits, 14 files, +3828/−286, clean. Commits: `d274703`, `65a9c3a`, `ee5c0a5`, `e10783a`, `44de4df`, `becef54`. The last one adds the short `AGENT_HANDOFF.md` only (3.4); a further documentation commit replaces it with this file and adds `AGENTS.md` (file and line counts here are as of `becef54`). There is no deploy preview because PRs into `dev` get none; Dev2 is the review build. |
| **#8** "research: assess where Jev (TypeSafe System One) fits the deal product" | `claude/jev-integration-3h28ai` → **`main`** | Draft | Docs only: adds `research/jev/JEV-INTEGRATION.md`. It skips the dev-first flow. |
| **#7** "Remove the pilot password edge gate…" (commit authored by Cursor Agent; opened under MDeanH) | `cursor/remove-pilot-password-gate-e610` → `dev` | Open, ready | Mostly superseded: `dev` already deleted `netlify/edge-functions/gate.ts` in `b94a073`. What is left is comment fixes in `lib/cron-auth.ts`, `macro-cron.ts` and `src/auth.ts`, a README wording change that still says "pilot branch", and edits to `HANDOFF.md`. Its body says the dev site "auto-deploys from dev", which is false: dev is deployed by CLI upload. |

- **Conflicts.** None. I tested every combination with `git merge-tree` and they all merge cleanly: #11 into dev, #7 into dev (with or without #11), #8 into main or dev, and dev into main with or without #11.
- **Overlaps that stack rather than conflict:**
  - #7 and #12 both touch `HANDOFF.md`, `src/auth.ts`, `cron-auth.ts` and `macro-cron.ts`.
  - #11 and #12 both touch `src/Underwriting.tsx`, `src/format.ts`, `lib/gate1/preview.ts` and `lib/gate1/types.ts`.

**Decision pending for the owner: the order of #11 and #12.**

Merging #12 into `main` will very likely **build and publish production automatically**; see 4.2. The current production deploy reports `locked: null`, so auto-publishing does not appear to be locked. Treat a merge to `main` as an immediate production publish.

- **Option A (charts included in the release):**
  1. Mark #11 ready.
  2. Merge it into `dev`. Because #12's head *is* `dev`, #12 picks up the charts with no new PR.
  3. Netlify rebuilds deploy-preview-12. Review it.
  4. Merge #12.
  - Side effect: #11 also brings `AGENT_HANDOFF.md` and `AGENTS.md` into `dev` and then `main`. Keep them or remove them before merging.
- **Option B (release without charts):** merge #12 as it is; the charts ship in a later `dev` → `main` release.
- **Either way, before merging #12,** decide production's environment (4.3). Otherwise production ships **login-free with admin actions open**, and with no persistence if Supabase is not set for production.

### 3.4 The earlier short `AGENT_HANDOFF.md` (replaced)

Commit `becef54` (2026-10-09T14:23Z, author "Claude") added a 199-line `AGENT_HANDOFF.md` at the repo root on the PR #11 branch. It is the previous session's own quick handoff, written for ChatGPT, and the session also sent it to the owner to upload. **This document replaced it in the next commit.** The short one has no Appendix B harnesses, and some of its statements are known to be wrong:
- It says Dev2 "shares dev's database". At runtime Dev2's functions have no Supabase at all (6.2).
- It says one test job was stuck "for over 12 hours". The record shows at least 11 h 40 min (6.1).
- Its next steps for the extraction bug are to read the log and to try the button on the shared dev site. The second is a paid POST to a shared site, which needs owner approval. 6.1 here has the fuller plan.
- Its Dev2 redeploy command is unpinned (`npx netlify-cli deploy …`). Use 7.5.

If you were given the short file, use this one instead.

---

## 4. Deployments

### 4.1 The Netlify sites

The Netlify team id is `69e524e3aa936846af4d2b19`. Functions run in region `cmh`; Blobs live in `us-east-2`.

| | **connected-capital-pilot** (production) | **connected-capital-pilot-dev** | **connected-capital-pilot-dev2** |
|---|---|---|---|
| Site id | `8513251e-aa61-4526-a6b1-aa21bac4724e` | `bf4a440c-0d7a-40f8-97cd-9e010e007e76` | `a292223a-bdcc-4caa-9b12-26b3b9ff5f20` |
| URL | https://connected-capital-pilot.netlify.app | https://connected-capital-pilot-dev.netlify.app | https://connected-capital-pilot-dev2.netlify.app |
| Current deploy | `6a6cd54c2703340008a70c33`, published 2026-07-31 17:04Z | `6aba950009c49c530f798be9`, published 2026-09-28 16:25Z, "dev: underwriting view (PR #10)" | `6abae42aa0c6dfe8e766127c`, published 2026-09-28 22:04Z, "Deploy triggered by upload" (the second of two uploads; 5.5) |
| Code served | `main@54bd114`. No auth layer, no deal history, no Underwriting redesign. 10 functions: no auth-status, users, cron-trigger or extractions-reaper. | `dev@6671bab` (PRs #1–#6, #9, #10), no charts. The metadata says `branch: main`, but the bundle hash matches deploy-preview-12. 14 functions. | The PR #11 charts. The frontend bundles are byte-identical to a local build of `44de4df`; Netlify recorded no commit. 14 functions. |
| How deployed | **GitHub continuous deployment from `main`** (inferred; 4.2). Netlify runs `npm run build` remotely, so every gate runs there. PRs into `main` get deploy previews (#12 and #8 exist; previews for PRs into dev return 404). | **Manual Netlify CLI upload** of a locally built `dist` (`deploy_source: cli`). No remote build gates and no previews. The current deploy carries no commit; whether the site has a linked repo is **[unverified]**. Functions run on **nodejs24.x**; the other sites use nodejs20.x. | **Two source uploads** of the same `44de4df` source through the previous session's Netlify connector (a Claude-only tool), built remotely, so the build gates ran. The current deploy carries no commit; whether the site has a linked repo is **[unverified]**. |
| Supabase at runtime | **Not configured** (`/api/deals` returns 503). | Configured: `/api/deals` returns 200 with 3 deals; config versions 2, 1 and 0 (v2 "Test 1" is active); 7 macro snapshots. | **Not configured** (see 6.2). |
| App auth (`/api/auth/status`) | Endpoint absent; the SPA fallback returns HTML. | `{"enabled":false,"accountsRequired":false}` (login-free) | Same as dev (login-free). |
| Security headers on `/app` | HSTS only. No CSP or X-Frame-Options. | Full set; `/app` CSP is `script-src 'self'`. | Full set. |
| Netlify access control | None | None | None |

**Related sites in the same team (out of scope):**
- `ai-diligence-platform` (site id `90b76167…`): live, on custom domain diligence.mdeanproductions.com, the parent public project.
- `market-predictability-evidence`: the evidence-map site, deployed by `scripts/deploy-evidence-map.sh`.
- `mdean-diligence-demo`: its relation to this project is **[unverified]**.

### 4.2 Evidence that production is GitHub-linked (checked 2026-10-09)

- **Previews for PRs into `main` exist.** This is the strongest evidence. `https://deploy-preview-12--connected-capital-pilot.netlify.app` and `deploy-preview-8--…` both return 200.
  - Netlify recorded deploy-preview-12 with `review_id: 12`, `branch: dev` and commit `6671bab`, and it serves bundles byte-identical to a local build of `6671bab`.
  - Previews 1–7, 9–11 and 13 return 404. The PRs among those all target `dev`.
- **Production's own deploy carries git metadata.** It has `branch: main`, `commit_ref 54bd114`, a `commit_url` on GitHub, committer MDeanH, and its title is the commit message (Dev2's upload has none of these and is titled "Deploy triggered by upload").
  - Two fields do *not* distinguish a git build: `deploy_source` reads `"api"`, the same as Dev2's connector upload, and `manual_deploy: false` is also set on the dev site's CLI deploy and on Dev2. So "production's deploy was git-triggered" is an inference.
- **Publishing is not locked.** The current production deploy reports `locked: null`.
- **Treat any merge or push to `main` as an immediate production release.**

### 4.3 What production will look like after #12 merges

Production's environment contents are **[unverified]**: reading them would expose secret values. At its 2026-07-31 build, production's functions had no Supabase, and the #12 preview also runs without Supabase and with auth off. If nothing is added for the production context, production after #12 will be:

- **Login-free.** `AUTH_ENABLED` is unset, so admin actions are open. With no Supabase, most of them return 503 or `persisted:false`.
- **Without persistence.** No deal history, no saved config versions, no stored macro snapshots; macro is computed live from FRED on each request.
- **Paid extraction:** open to anyone if `ANTHROPIC_API_KEY` is set for production **[unverified]**.
- **Cron:** `/api/cron-run` returns 403 unless `CRON_TRIGGER_SECRET` is set (it fails closed).
- **Security headers:** the CSP and other headers start applying, which is an improvement.

To give production persistence and logins:
1. **Choose the Supabase project (owner decision).** A fresh project keeps production's data separate. Reusing the dev project (`rbodmakhvjhpxobactev`) means production and the shared dev site read and write the same deals, decisions, configs and snapshots.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the production context, with Functions scope.
3. Apply migrations: **0001–0005 in order on a fresh project** (0001 creates every base table and enables RLS), or 0002–0005 only if 0001 is already applied there. Add `seed.sql` if the v1 config is wanted.
4. Set `AUTH_ENABLED=1`, `BOOTSTRAP_ADMIN_EMAIL` **and `REQUIRE_ACCOUNTS=1`**. `REQUIRE_ACCOUNTS=1` is required, not optional: without it, paid extraction and the deal, decision, extraction and macro reads stay open to anonymous users (2.5).
5. Set `CRON_TRIGGER_SECRET`, and point a pg_cron job at production's `/api/cron-run/macro-cron`.
6. Redeploy, because function environment variables are fixed at deploy time.

These are owner decisions (0.3).

---

## 5. What the last session did (PR #11)

### 5.1 Commits (oldest first)

| SHA | Author / time (UTC) | Change |
|---|---|---|
| `d274703` | Michael Harwood, 2026-09-28 17:28 | **WIP.** Adds the chart kit `src/charts/ChartKit.tsx`: palette, `scaleLinear`, `niceTicks`, `useTooltip`, Legend, PostureDot, and ChartCard with a table view. Adds nine charts: CushionChart ("Buffer zone by market posture"), StressChart, HurdleChart, CapRateChart, MarketCharts (Rent, Absorption) and CapitalCharts (Uses/Sources, Financing, Timeline) across Summary, Financials and Market. `PostureScenario` gains `stress` and per-check `value` (display only). It was not checked in a browser. |
| `65a9c3a` | Claude, 20:03 | **Kit fixes.** The tooltip is measured and clamped inside its card, and flips below the mark when there is no room above. The Table/Chart toggle drops `aria-pressed` and gains `aria-describedby`. `niceTicks` no longer loops or repeats on tiny or reversed ranges. Each posture scenario now carries its own `flagPoints` (`lib/gate1/preview.ts`, `types.ts`; display only, verdicts unchanged). Adds shared formatters `fmtMoneyShort`, `fmtPct1` and `fmtSignedPts` in `src/format.ts`. |
| `ee5c0a5` | Claude, 20:53 | **Buffer-zone and capital chart fixes** (CushionChart, CapitalCharts). |
| `e10783a` | Claude, 21:33 | **Market, stress, cap-rate and hurdle chart fixes**, plus Underwriting tiles. The `Info` "i" icon becomes `aria-hidden`. |
| `44de4df` | Claude, 21:33 | **Dev-server-only fix.** The `externalReactPreamble()` plugin in `vite.config.ts` serves React Refresh's preamble as `/@react-preamble.js`, so `/app` is no longer blank under `netlify dev`'s strict CSP. Build output is unchanged. |
| `becef54` | Claude, 2026-10-09 14:23 | Adds the previous session's 199-line `AGENT_HANDOFF.md`, replaced by this document in the next commit (3.4). |

### 5.2 How it was verified

- **Review.** 8 review groups (cushion, stress, capital, hurdle, caprate, market, kit, blank), each with a reviewer and an adversarial skeptic.
  - They produced 35 findings, plus 121 checks that passed (data honesty, layout, interaction, accessibility and resilience).
  - Skeptic verdicts: 23 confirmed, 9 partly confirmed, 3 refuted.
  - Severity after the skeptics: 2 major, 17 minor, 16 nit.
- **Fixes.** 6 fixers worked on separate files. Each captured "before" on `65a9c3a` and "after" on its own patch, then re-ran the Playwright walk at 1400 and 390 px and the tooltip probe at 360 px.
  - Of the 32 confirmed or partly confirmed findings, 27 were fixed. The other 5 predate this branch (6.4).
  - Each fixer's patch matches the committed diff exactly.
- **Harnesses.** Two Playwright scripts, `walk.cjs` and `tipcheck.cjs`; Appendix B has portable copies. They lived in the session scratchpad, not the repo.
- **Results on the combined head:**
  - `npm run build` is green: parity 16/0, gate1 23/0, gate1:macro 23/0, gate:evidence 4/0, both `tsc` passes OK, and `vite build` OK. It was re-run on 2026-10-09 at `44de4df` and at `becef54`.
  - The tooltip probe on 2026-09-28 found **0 problems at 320, 360, 390, 768 and 1400 px**, with 0 page errors. It recorded 184 probes at four widths and 144 at 360. The original code had 18 problems at 360 and 6 at 390.
  - Full walks at 1400 and 390: every tab rendered with 2/3/5/0/0 chart cards. Overlaps, text clipped outside its card, SVG overflow and page errors were all 0. **But** page `scrollWidth` is 1405 at 1400 on every 1400 walk: this is the pre-existing hidden glossary popover (6.4 #2), not the charts. The 390 walks are clean at `scrollWidth` 390.
  - Dev2 serves bundles byte-identical to the local build of `44de4df`.
- **Confirming re-run with the original harness on 2026-10-09** against the local `44de4df` build: tipcheck 184 probes, 0 problems, at all five widths; walks at 1400 and 390 clean apart from the same 1405 overflow at 1400.
- **Re-run of the portable harness copies on 2026-10-09** against a local Vite server of `44de4df`:
  - tipcheck at 390: 168 probes, 0 problems, 0 page errors.
  - walk at 390: 2/3/5/0/0 cards, 0 overlaps, 0 clipped, `scrollWidth` 390.
  - The lower probe count is likely because FRED data was unreachable in that run (all signal values were null), so market-dependent charts had fewer marks.

### 5.3 Main fixes, with the finding they closed

| Finding | Fixed in |
|---|---|
| Tooltips left the card or screen on phones; "13.5%" read as "3.5%". Major. | `65a9c3a` |
| The stressed-exit cap-rate tooltip sat 81 px off-screen (93 px outside its card) at 360. Major. | `65a9c3a` |
| "Double points" shown only in today's column of the cushion table. | `65a9c3a` (engine) + `ee5c0a5` |
| The "thin" label was struck through by the posture line; an older response showed wrong values for yellow and red; an unmeasurable posture was dropped silently; the caption was clipped at 390. | `ee5c0a5` |
| The capital chart invented "LP $0" and a negative co-invest for negative equity; co-invest over 100% gave a wrong total; $0 parts were missing from the legend; the derived LP/sponsor split was not disclosed. | `ee5c0a5` |
| No $B money tier, and "$-500K" formatting. | `65a9c3a`, `ee5c0a5`, `e10783a` |
| Tapping a thin segment showed no tooltip. | `ee5c0a5` |
| 4 glossary terms were lost from the Market tab. | `ee5c0a5` + `e10783a` |
| Hurdle chart and tiles disagreed, and a miss could read "+0.0 pts". | `65a9c3a` + `e10783a` (checked with a 0.01-step sweep from −20% to 40%: 0 disagreements) |
| The severe-line row described today's posture only; the watch price rounded onto the flagged rent; "$10,000K" ticks collided; tooltips were clamped twice; older responses were mislabelled as having "no mini-stress check". | `e10783a` |
| `/app` was blank under `netlify dev`. | `44de4df` |

### 5.4 Refuted findings

All three were artifacts of the sandbox's fallback font. Google Fonts fails TLS in that sandbox, so DejaVu Sans rendered instead of Roboto, and it is wider. With Roboto injected, none of them reproduce:
- stress value label crowding a tick;
- stress tooltip on the top row overflowing its card;
- capital timeline label overhanging the plot.

### 5.5 Caveats in the evidence record

- `tipcheck.cjs` never actually loaded Roboto: every run reports `roboto=false`. All post-fix tooltip results are therefore in the wider fallback font, which makes them a worst case for containment. Roboto was injected only in the pre-fix review (to refute three findings, 5.4) and in one cushion-fixer check at 390.
- One recorded "final" 390 walk file is a timeout failure. The clean run is a separate re-run, and the 2026-10-09 walks confirm the result.
- Dev2 was uploaded twice from the same `44de4df` source. The live Dev2 walks (21:51Z) ran on the first upload, `6abae0bf…` (ready 21:50Z, before the environment variables were set), about 13 minutes before the current deploy `6abae42a…` was published (22:04Z). Bundle identity with the current deploy was confirmed separately on 2026-10-09.
- Evidence files (screenshots, findings JSON, patches) live in the previous session's scratchpad and are **not** available to you unless the owner uploads them.

---

## 6. Open issues, prioritised

### 6.1 Dev2: "Extract with AI" never completes (open bug, highest priority)

**Symptom** (reported by the previous session; not reproduced since):
- `POST /api/extract` returned `200 {status:'running'}`.
- `GET /api/extractions/<id>` then stayed at `{status:'running', submittedAt}`, with **no `startedAt`**, for at least 11 h 40 min (submitted 2026-09-28 22:06Z; last checked 2026-09-29 09:47Z, still the same). The test job was `55ebdc6e-8194-4fd3-bfd7-a7738d1d6930`.
- `POST /api/extract-run` answered 202, so the background function is routed.

**Current state.** That record has expired. GET now returns a bare `{"status":"running"}`, which is what `extractions.ts:58` returns for any missing record. The old job is useless as evidence; you need a **fresh** submission.

**What the code allows.** The record never reached the worker's claim (which would have written `startedAt`), and no error was recorded. In `netlify/functions/extract-run-background.ts`, these paths match that symptom:

| Hypothesis | Where | What the function log would show today |
|---|---|---|
| (a) HMAC mismatch: the worker sees a different or missing `ANTHROPIC_API_KEY` than `extract-submit` | lines 28–33 return 401 | nothing from the worker (the 401 is hidden behind the background 202) |
| (b) `getStore('extractions')` throws, e.g. missing Blobs context in the background function | line 35, **outside** the try/catch | an uncaught exception stack |
| (c) Blobs calls fail inside the try, so the error write also fails | lines 46–68, then the catch at 150–163 | "extract-run-background: extraction failed for <id>" followed by "failed to record error for <id>" |
| (d) The claim is rejected (`claim.modified === false`). Either the etag-conditional write fails, e.g. an etag format mismatch, or the strong read returned null, so the `onlyIfNew` branch ran against the record `extract-submit` had already created | line 68, silent `return` | nothing |
| (e) `startedAt` already present | line 47, silent `return` | nothing (unlikely: the record had no `startedAt`) |

Hypotheses (a), (d) and (e) leave no trace in the log today. A thrown strong-read error alone would produce an `error` record, which does not match.

Related fact: Dev2's functions see `ANTHROPIC_API_KEY` (`/api/extract` returned 200 rather than 500) but not the Supabase variables (6.2). Environment visibility on Dev2 is inconsistent, and (a) cannot be ruled out.

**Exact next diagnostic step:**

1. On a branch off the PR #11 head, add one log line before each early return in `extract-run-background.ts`:
   - lines 14, 20 and 22: bad method, body or id;
   - line 32: HMAC mismatch, logging only `!!secret`, token length and expected length, **never the values**;
   - line 47: already started;
   - line 68: claim not modified, logging `!!existing`, `!!existing?.etag` and which branch ran (`onlyIfMatch`, unconditional, or `onlyIfNew`).
   Also move `getStore` inside the try, or wrap it in its own try/catch with a log.
2. Have that build deployed to **Dev2 only** (7.5). Do not use production or the shared dev site. This is an owner step unless you have been given a Netlify token (0.2).
   - Note that any new deploy re-snapshots the function environment. If the hang disappears after the instrumented deploy, that points to a deploy-time environment cause rather than the code.
3. With the owner's approval (it costs one Anthropic call if the worker gets that far), submit one small extraction on Dev2. Using the UI with a short .txt OM is enough. Dev2 has auth off, so no login is needed. From a shell:
   ```bash
   ID=$(node -e "console.log(crypto.randomUUID())")
   curl -sS -X POST https://connected-capital-pilot-dev2.netlify.app/api/extract \
     -H 'content-type: application/json' \
     -d "{\"extractionId\":\"$ID\",\"omText\":\"Test OM: 10-unit infill development, total cost 2,000,000 USD.\"}"
   # then poll every 10-30 s
   curl -sS https://connected-capital-pilot-dev2.netlify.app/api/extractions/$ID
   ```
   - Expect `startedAt` to appear within seconds if the worker claims the job.
   - If it stays a bare or `submittedAt`-only `running`, the worker exited before calling Anthropic, so no model cost was incurred. Ask the owner for the log lines for that id (step 4).
4. Read the function log: Netlify UI → connected-capital-pilot-dev2 → Logs → Functions → `extract-run-background`, and also `extract-submit`. With netlify-cli 27.10.1, from a folder linked to Dev2 (needs a Netlify login or `NETLIFY_AUTH_TOKEN`, so usually an owner step):
   ```bash
   npx netlify-cli@27.10.1 link --id a292223a-bdcc-4caa-9b12-26b3b9ff5f20
   npx netlify-cli@27.10.1 logs --source functions --function extract-run-background --function extract-submit --since 1h
   ```
   Add `--deploy-id <id>` to target one deploy. The older `logs:function` command is hidden in 27.10.1 and only prints an error pointing to `logs`.
   - If the log is silent, check Blobs in the Netlify UI (store `extractions`, key `<id>`).
5. Fix the cause, keep the logging, and consider having the worker write `{status:'error'}` on every pre-claim failure it can attribute, so the client stops polling.

The dev site has not been tested for this bug. Testing there means a POST to a shared site, which needs owner approval.

### 6.2 Dev2's functions have no Supabase (contradicts the previous session's notes)

The previous session believed Dev2 shares the dev site's database. At runtime it does not:

| Endpoint on Dev2 | Response |
|---|---|
| `/api/deals` | 503 "Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" |
| `/api/config` | version 0 only |
| `/api/macro/history` | `[]` |

**What the previous session set, and when** (from its record; names and settings only):
- On 2026-09-28 at about 21:56:41–46Z it set three variables on Dev2, with values copied from the dev site:
  - `SUPABASE_URL`: not secret, context `all`, scopes `functions` only.
  - `SUPABASE_SERVICE_ROLE_KEY`: secret, context `all`, scopes `functions` and `runtime`.
  - `ANTHROPIC_API_KEY`: secret, context `all`, scopes `functions` and `runtime`.
- The current deploy `6abae42a…` was created at 22:03:22Z, about 6.5 minutes later. That redeploy was made specifically to pick the variables up. So "the variables were added after the deploy" is ruled out.

**Possible cause [unverified].** `ANTHROPIC_API_KEY` is visible to the functions (`/api/extract` answered 200, not 500), but persistence is not. `serviceClient()` needs both Supabase variables. `SUPABASE_SERVICE_ROLE_KEY` has the same settings as the Anthropic key, and `SUPABASE_URL` is the one that differs (functions scope only, not secret). Check `SUPABASE_URL`'s scopes and value first. A plain redeploy is not known to fix this.

**To fix:** Netlify UI → Dev2 → Site configuration → Environment variables. Check the scopes, contexts and values (without pasting values anywhere), then redeploy.

First decide whether Dev2 *should* write into the dev site's database. Review clicks such as RECORD DECISION would land in shared data. If not, remove dev's keys from Dev2 instead (6.5).

### 6.3 PR #11: verification still incomplete

**Closed:** the build gates, the tooltip probe at 5 widths, the walks at 1400 and 390 on the combined head, and Dev2 bundle identity.

**Still open:**
1. **Per-finding edge-case checks on the combined head.** Each was run in full only on its fixer's patch over `65a9c3a`. The patches touch separate files, so the risk is low.
   - A 7-verifier re-verification on the combined build was started on 2026-09-28 and cut short by container restarts before any verifier reported (PR #11's body says so too). Its partial raw output for the cushion and capital charts (for example negative equity and co-invest 150% at 1400, and a 168-probe tooltip run at 390) shows no problems where runs completed; some runs were killed mid-way. Those files are not available to you.
   - Cases you can drive with the portable `walk.cjs --edit key=value` field edits: negative equity; co-invest 150%; huge rents; a watch line half a cent away; IRR 12.96.
   - Cases that need more than `--edit`, with harness variants that are **not** included here:
     - response mutation through Playwright `page.route` (posture-scoped rulebook; stripped older-build responses; an incomplete hurdle stack);
     - touch emulation (`hasTouch`) for a tap on a sliver segment;
     - netlify-cli for `/app` under `netlify dev`.
2. **A tooltip probe with real Roboto loaded.** Every `tipcheck.cjs` run, including all post-fix tooltip probes, used the fallback font. Roboto was injected only in the pre-fix review and one cushion-fixer check.
3. **A screen-reader pass** on the charts (toggle labelling, `aria-hidden` Info icon).
4. **A real touch device.** Only touch emulation has been used.

There is no CI on PR #11. Run `npm run build` locally and walk the UI on Dev2 or a local server.

### 6.4 Follow-ups (pre-existing, not fixed in PR #11)

| # | Issue | File | Suggested fix |
|---|---|---|---|
| 1 | S&P 500 figures are price-only (FRED `SP500`, no dividends) but are presented as the public-market alternative. | `netlify/functions/lib/gate1/macro.ts:29`; shown in `src/Underwriting.tsx`, `src/glossary.ts`, `src/MarketComparison.tsx`, `src/MacroDashboard.tsx` | Label "price return (excl. dividends)", or use a total-return series. Consider dropping the PASS/WATCH pill. |
| 2 | Hidden glossary popovers widen the page: scrollWidth 1405 at 1400, 1345 at 1280, 1115 at 1024. | `src/Info.tsx` (`.infotip-pop`) | `display:none` while closed. |
| 3 | Open glossary popovers are not clamped to the viewport: 13 of 29 cross the edge at 390. | `src/Info.tsx:32` (centred `translateX(-50%)`, no measurement) | Measure and clamp, as `ChartKit` `useTooltip` now does. |
| 4 | At 390 px the "Issues" tab starts off-screen inside the scrolling tab strip. | `src/Underwriting.tsx` (`.uw-tabs`, line ~609) | Smaller padding, wrapping, or scroll the active tab into view. |
| 5 | Keyboard focus can land under the sticky header above 700 px wide. The header is about 156/138/90 px tall at 701/760–800/≥900 px. | global CSS; `useTooltip` in `src/charts/ChartKit.tsx` | `html{scroll-padding-top}` plus a header-aware tooltip flip. |
| 6 | The sample deal's co-invest is quoted as "1.8% of total equity". $200K is about 4.3% of the $4.63M equity, or about 1.8% of total cost. The source OM itself is inconsistent and the recorded extraction quotes it faithfully. | `src/sample-extraction.ts:20` | Add an intake-side reconciliation check, so analysts see the OM's own inconsistency. Do not silently edit the recorded value: it is a faithful record of the OM. The `coinvest_min` kill would hold either way under v0 and v1 (a single `('*','*')` row at 5%, and 4.3% < 5%); only a different active config, such as dev's v2, could change it. |
| 7 | Float error: a rent exactly at the watch line flags (1050 vs comp 1000 at 5% gives 0.050000000000000044 > 0.05). | `netlify/functions/lib/gate1/engine.ts` (~384–390, `rents_vs_comps`) | Add a small tolerance (e.g. `1e-12`) to the comparisons. Run parity, gate1 and gate1:macro, and add a golden boundary case. |
| 8 | `netlify.toml` has no `[dev]` block, so some `netlify dev` invocations misroute Vite files. | `netlify.toml` | Add `[dev]` with `framework = "vite"`. |
| 9 | The `sessionStorage` calls are not wrapped, so blocked storage throws. | `src/main.tsx:12,13,19` | Wrap them in try/catch. |
| 10 | Market-path tilt stops working around 2027-01-25 (270-day staleness guard on `asof` 2026-04-30). | `netlify/functions/lib/compute.ts` (~117–119), `lib/market-path.json` | Re-bake with `research/tsfm_benchmark/bake_market_path.py` before then. |
| 11 | Minor hurdle-chart limits kept on purpose: half-tenth rounding can look off (18.75% → "18.8% · +5.7 pts"); a miss that rounds to zero reads "−0.0 pts"; the empty state says "no macro snapshot" when only the hurdle field is missing. | `src/charts/HurdleChart.tsx` | Optional. |

### 6.5 Security and operations

- **Auth is off everywhere** (2.5). Dev, which has Supabase, is publicly writable, including admin deletes and config saves. Paid extraction is open on any site that has the Anthropic key. Wherever real data lives, set `AUTH_ENABLED=1` **and** `REQUIRE_ACCOUNTS=1` (with `BOOTSTRAP_ADMIN_EMAIL`), or accept the risk explicitly. `AUTH_ENABLED=1` alone closes only the admin actions.
- **Secrets exposed in the previous session's transcript.** On 2026-09-28 the previous session read the dev site's environment variables through its Netlify connector, which returned the secret values in plain text into that session's record. Names affected: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_TRIGGER_SECRET`, plus the unused `GATE_SIGNING_SECRET` and `PILOT_PASSWORD`. It then copied the first two onto Dev2. The owner was told at the time.
  - Recommendation for the owner: rotate `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and `CRON_TRIGGER_SECRET` (updating the pg_cron job with the new key), delete the two unused variables, and remove dev's keys from Dev2 if Dev2 should not share dev's database.
  - Never use any tool or API call that returns environment variable *values*.
- **`scripts/deploy-netlify.sh` (`npm run deploy`)** runs `npm install` (which can rewrite the lockfile), `npm run build`, then `npx --yes netlify-cli@latest deploy --prod --dir=dist` against whatever site the local `.netlify/state.json` links to, with no guard.
  - The previous session's checkout was linked to **Dev2**. `.netlify/` is gitignored, so a fresh clone has no link at all, and the script then runs an interactive `netlify init`.
  - In netlify-cli 27.x, `NETLIFY_SITE_ID` in the environment (or `--site`) overrides the linked site for `deploy`, so checking `state.json` alone is not enough.
  - The script also hard-codes a stale owner path (`/Users/friday/Projects/ai-diligence-tool`) and does not pin netlify-cli.
  - Add a guard that refuses production site id `8513251e-…` (production is git-deployed), and pin the CLI.
- **`scripts/deploy-evidence-map.sh`'s "never deploy here" guard** blocks `ai-diligence-platform` (`90b76167…`), which is a **live** site (diligence.mdeanproductions.com), but not the current pilot sites. Keep that id and add the connected-capital-pilot, -dev and -dev2 ids alongside it; do not replace it.
- **The dev site is deployed by hand from a local build**, so the remote gates do not run there and its functions run on Node 24. Consider git-linking the dev site with `dev` as its production branch, so dev gets remote builds and previews for PRs into dev.

### 6.6 Stale documentation

| Doc | Stale statement | Reality |
|---|---|---|
| `README.md` (~L50) | "Deploys from the `pilot` branch (Netlify, HTTP Basic Auth)" | There is no `pilot` branch and no Basic Auth or edge gate anywhere (`/app` returns 200 unauthenticated on all three sites). Production deploys from `main` through GitHub. |
| `README.md` | "all /api/* served via dev bridges" | Only score, gate1, extract, macro and config are bridged (7.2). |
| `README.md` | "three golden suites" | Four gates plus two `tsc` passes. |
| `CLAUDE.md` (repo root) | `pilot` branch, remote `pilotrepo`, `.claude/rules/project-rules.md`, `configs/`, `.node-local/`. It also points to the owner's local wiki (`~/wiki`), `~/Claude/hub` and `~/Documents` notes, and `/wiki-*` slash commands. | None of the repo paths exist, and `.claude/` is gitignored and empty. The local wiki, notes and commands are on the owner's machine only and are not available to you. Treat this document and the code as the source of truth, and ignore `CLAUDE.md` except its confidentiality rule. |
| `README-NETLIFY.md` | Plotly charts, a DDQ form, "fully client-side scoring" | Describes an older app. Entirely stale. |
| `netlify.toml` comments | "1.4 MB plotly chunk"; "blob-URL web worker" | Neither exists in `src/`. |
| Comments in `extract-submit.ts`, `cron-trigger.ts`, `lib/cron-auth.ts`, `macro-cron.ts`, `gate1.ts`, `lib/auth.ts`, `src/auth.ts` (~L267) | They mention the edge gate (`gate.ts`), the gate cookie or `PUBLIC_EXTRACTION` | The gate is gone; the function-side checks are the only checks. PR #7 fixes some of these. |
| `src/vite-env.d.ts` | Declares `react-plotly.js` | Unused. |
| `netlify/functions/lib/parity.ts` header | "node --experimental-strip-types" | The npm script uses `tsx`. |
| `netlify/functions/lib/compute.ts` | "~895 metros" | `metros.json` has 20,216 keys. |

---

## 7. How to run, test, build and deploy

### 7.1 Setup

- **Node 20** matches the production functions. Node 22 (v22.22.2, npm 10.9.7) was verified to build cleanly.
- Install with `npm ci`. It needs network access to `cdn.sheetjs.com` for the xlsx tarball.
- **Optional Python** (`requirements.txt`) is needed only for data-bake scripts and `tests/test_mc_reference.py`. That test was not run in this environment because numpy was missing.
- **Local secrets.** None are needed for `npm ci`, `npm run build`, the golden suites, or the sample-deal walk under `npm run dev`.
  - Only the dev extraction bridge needs `ANTHROPIC_API_KEY`, exported in the shell that runs `npm run dev`. The bridges read `process.env` directly; `vite.config.ts` has no `loadEnv`, so a `.env` file is **not** read by them. Each call costs money and needs the owner's approval.
  - In a hosted agent sandbox, take the key from the platform's secret store. Never write it to a file in the repo or paste it into chat.
  - `netlify dev` after `netlify link` pulls the linked site's real function secrets, including the Supabase service-role key, into your local process. Link only to Dev2, and only with the owner's consent.

### 7.2 Local development

- **`npm run dev`** starts Vite on http://localhost:5173. The SPA is at `/` (and `/app`); the landing page is `/how-it-works.html`.
- **Dev bridges in `vite.config.ts`.** They load the same server modules the functions use:

| Bridge | Routes | Behaviour under `npm run dev` |
|---|---|---|
| `devScoreApi` | `POST /api/score` | Full `/api/score`. |
| `devGate1Api` | `POST /api/gate1/*` | Decide returns `persisted:false`. There is no batch endpoint (Backtest falls back to row-by-row) and no GET decisions. |
| `devExtractApi` | `POST /api/extract` | Synchronous. Needs `ANTHROPIC_API_KEY` in your shell and costs money per call. |
| `devMacroApi` | `/api/macro/*` | Live FRED. History is `[]`; override returns `persisted:false`. |
| `devConfigApi` | `/api/config/*` | Version 0 only; POST returns 503. |

- **Not bridged:** `/api/deals`, `/api/extractions/:id`, `/api/users`, `/api/auth/status`, `/api/health` and `/api/cron-run/*`. GET and HEAD requests to them return the SPA HTML with status 200 (Vite's HTML fallback, for any `Accept` that allows HTML, including `fetch`'s default `*/*`). Other methods, such as `POST /api/deals`, `PATCH /api/users/:id` or `POST /api/cron-run/*`, get a 404 from Vite. Use `netlify dev` for them.
- **`netlify dev`** runs the real functions locally.
  - Command: `npx netlify-cli@27.10.1 dev --framework vite`. That version was verified by the previous session; the command was not re-run here. Pass `--framework vite` until a `[dev]` block exists.
  - It needs `netlify link` to a **non-production** site to pull function environment variables. That puts the site's real secrets in your local process (7.1), so link only to Dev2 and only with the owner's consent.
  - If those variables include `SUPABASE_*`, writes go to that Supabase project, which is presumably the shared dev database **[unverified]**.
  - `/app` renders under the strict CSP only because of the `externalReactPreamble()` plugin (commit `44de4df`, on PR #11's branch).

### 7.3 Build and gates

`npm run build` runs these in order and stops at the first failure:

| Step | Command | Expected | What it protects |
|---|---|---|---|
| parity | `npm run parity` (`tsx netlify/functions/lib/parity.ts`) | `RESULT: 16 passed, 0 failed` | The TS Monte Carlo engine must match the Python golden reference (`lib/golden.json`, `lib/baselines.json`), plus structural regressions. |
| gate1 | `npm run gate1` (`lib/gate1/golden.ts` + `golden.json`) | `RESULT: 23 passed, 0 failed` | Gate 1 rules. Faithful Trails is the canonical FAIL (kills site_entitled, contingency_min, coinvest_min). Palm Grove passes under green and fails under red. Also boundaries, threshold resolution, adjustments, and byte-identical replay. |
| gate1:macro | `npm run gate1:macro` (`lib/gate1/golden-macro.ts`, synthetic, no network) | `RESULT: 23 passed, 0 failed` | Hard overrides, hysteresis, degraded mode, quadrants, vote bands, posture matrix, hurdle totals (15% in recession, 13% in soft landing), replay. |
| gate:evidence | `npm run gate:evidence` (`scripts/check-evidence-sync.ts`) | `RESULT: 4 passed, 0 failed` (49 families, 198 studies, 222 links) | Three copy checks (the two HTML copies, `public/evidence-network.html` and `sites/evidence-map/public/index.html`, against the reference bake, plus `src/data/evidence-families.json` against `families.json`) and the input-fingerprint check. If it fails, run `python3 reference/market-predictability-evidence/bake_evidence_network.py`. Never hand-edit the copies. |
| typecheck app | `tsc -b` | no output | Strict TS for `src/` and `vite.config.ts`. |
| typecheck functions | `tsc -p tsconfig.functions.json` (`npm run typecheck:functions`) | no output | `netlify/functions/**`. |
| bundle | `vite build` | about 544 modules | Output to `dist/`. Expect a warning about chunks over 500 kB. Only DealIntake (about 575 kB) is over; xlsx (about 500 kB) and the main index chunk (about 496 kB) are just under. |

The full build took about 25 s on 2026-10-09 at `becef54`.

### 7.4 Verifying UI changes

- Use the two Playwright harnesses in Appendix B.
  - Run them against a local `npm run dev` or `vite preview`, or against Dev2.
  - Never run them against production or the shared dev site without the owner's agreement: scoring POSTs to `/api/gate1/preview`. That call is stateless, but it still uses the site.
- Minimum bar for chart or layout changes:
  - walk at 1400 and 390 with 0 overlaps, 0 clipped and 0 SVG overflow (page `scrollWidth` 1405 at 1400 is the known pre-existing popover issue, 6.4 #2; anything wider is new);
  - tipcheck at 320, 360, 390, 768 and 1400 with 0 problems;
  - 0 page errors;
  - screenshots inspected by eye.

### 7.5 Deploying

| Target | How |
|---|---|
| **Production** | Merge a reviewed PR into `main`. Netlify builds and publishes from GitHub. Never push to `main` directly, and never `netlify deploy --prod` to production. |
| **Dev site** | Manual today. A logged-in Netlify CLI user builds locally, then runs `netlify deploy --prod --dir=dist` with the folder linked to `bf4a440c-…` (pass `--site` explicitly rather than trusting the link). Owner only. |
| **Dev2** | The owner, or an agent given a Netlify personal access token through its platform's secret store (never pasted into chat). From a clean checkout of the commit to deploy: `npm ci && npx netlify-cli@27.10.1 deploy --site a292223a-bdcc-4caa-9b12-26b3b9ff5f20 --prod --message "diag: extract-run logging"`, with `NETLIFY_AUTH_TOKEN` taken from the secret store. In CLI 27.x, `deploy` runs `npm run build` (every gate) before uploading by default; add `--no-build` only if `dist/` is already built from the same commit. Use `--draft` instead of `--prod` for a unique URL that leaves Dev2's live deploy alone. Use Dev2 for review builds. |

- The previous session's Dev2 uploads went through a Claude-only Netlify connector; you will not have it. Use the CLI command above, or ask the owner.
- Caveat **[unverified]**: a CLI upload bundles functions locally and may change the functions runtime (the CLI-deployed dev site runs nodejs24.x; the remotely built Dev2 runs nodejs20.x). A redeploy also re-snapshots the environment variables, so note both when comparing against the old Dev2 behaviour.
- **Never use `npm run deploy`.** For any CLI deploy, pass `--site <id>` explicitly, use only Dev2 unless the owner says otherwise, and make sure `NETLIFY_SITE_ID` is not set to production's id `8513251e-…`. `.netlify/state.json` is gitignored, so a fresh clone has none, and `NETLIFY_SITE_ID` overrides it anyway. Production deploys only by merging into `main`.

---

## 8. Rules and conventions the owner relies on

**Product principles (enforced in code and by the golden suites):**
- **Zero hard-coded thresholds.** Every tunable band, weight and stress parameter lives in versioned config: `lib/gate1/default-config.json` is version 0, and Supabase `threshold_configs` holds later versions.
  - The only allowed constants are *definitional* ones with a written justification, as in `lib/gate1/macro.ts`: regime cut points 0.67/1.34, `SAHM_TRIGGER = 0.5`, staleness rules, and the pilot lockup of 5 years.
- **Every decision is replayable.** Each decision is stamped with config version, macro posture, inputs and adjustments, and the unadjusted baseline verdict is always kept.
- **Missing data never passes.** Extraction returns null rather than guessing, and missing fields force REVIEW.
- **Macro moves the bar; it never kills on its own.**
- **Manual control is never silent.** Judgment adjustments and macro overrides need a written reason or note.
- **Honest display.** Derived figures are labelled as derived, nothing is fabricated for missing inputs, and recorded or sample data is labelled. This was the standard the chart review used.

**Repository and process:**
- **Branch flow:** feature branch → PR into `dev` → `dev` → PR into `main`, which is the release. Never push or merge to `main`, or deploy production, without the owner's explicit review.
  - When opening a PR, set the base to `dev` explicitly; GitHub's default base is `main`. Never open a PR into `main` yourself. The only `dev` → `main` PR is #12.
- **Every PR keeps `npm run build` green.** Change golden fixtures only on purpose, with the reason in the commit message.
- **"Verified on real hardware beats the spec."** Verify in a real build and a real browser, and say exactly what was and was not verified.
- **Write commit messages and PR bodies that state the evidence:** what ran, at what widths, with what results.

**Confidentiality and secrets:**
- **`HANDOFF.md` and any `*SETUP-NOTES*` file are confidential** (Connected Capital pilot). Do not open, read or display them, quote them, summarise them into other documents, ingest them into wikis or knowledge bases, or publish them.
  - `HANDOFF.md` is committed on every branch, so it is in your checkout. That does not make it readable for you.
  - This includes its hunks in the PR #7 and PR #12 diffs. When reviewing those diffs, skip that file.
  - When cherry-picking from PR #7, exclude it: `git checkout 49d857e -- README.md netlify/functions/lib/cron-auth.ts netlify/functions/macro-cron.ts src/auth.ts` (pick the files you want), rather than `git cherry-pick`.
- **Secrets live only in Netlify environment variables.** `.env` and `.env.*` are gitignored. The committed `.env.production` holds only the publishable Supabase URL and anon key, by design.
  - Never commit a secret, and never paste environment values into code, PRs, docs or chat.
  - Never print secret values while debugging. Log lengths or booleans instead.
- `sites/evidence-map/` publishes only `public/`; its README names a private upstream.

---

## 9. Recommended next steps (in order)

1. **Get the owner's release decision (3.3, 4.3)** before touching `main`.
   - Option A: finish #11 (step 3), mark it ready, merge into `dev`, review deploy-preview-12, then merge #12.
   - Option B: merge #12 without charts.
   - Agree production's Supabase project and environment variables (Supabase, `AUTH_ENABLED`, `REQUIRE_ACCOUNTS`, `BOOTSTRAP_ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, `EXTRACTION_DAILY_CAP`, `CRON_TRIGGER_SECRET`). `REQUIRE_ACCOUNTS=1` is required alongside `AUTH_ENABLED=1` to close paid extraction and the data reads (2.5).
   - Apply migrations 0001–0005 to a fresh project, or 0002–0005 if 0001 is already applied there (4.3).
   - Update PR #12's truncated body so it states that login is off unless `AUTH_ENABLED=1`, and that the data endpoints stay anonymous unless `REQUIRE_ACCOUNTS=1` too.
2. **Diagnose and fix the Dev2 extraction hang** (6.1), and fix Dev2's missing Supabase environment if Dev2 should persist (6.2).
3. **Close PR #11's remaining verification** (6.3): the edge-case walks on the combined head, a `tipcheck.cjs` run with Roboto actually loaded, and a screen-reader pass. Then mark it ready, after the owner decides whether `AGENT_HANDOFF.md` and `AGENTS.md` ride along into `dev`.
4. **Tidy the PRs and branches:**
   - Close #7 as superseded, or bring over its comment fixes file by file, excluding `HANDOFF.md` (8).
   - Retarget #8 to `dev` or leave it as a draft.
   - Delete `feature/no-login` and `feature/underwriting-view` now, and `feature/underwriting-charts` after #11 merges.
5. **Fix stale docs (6.6):** README deploy and auth lines, the gate list, the dev-bridge claim, `CLAUDE.md`, `README-NETLIFY.md`, and the edge-gate comments.
6. **Harden operations (6.5):**
   - Add a GitHub Actions workflow that runs `npm ci && npm run build` on PRs into `dev` and `main`.
   - Protect `main` (require PR plus that check), and consider making `dev` the default branch so new PRs target it.
   - Add the production-site guard and a pinned CLI version to `scripts/deploy-netlify.sh`, and add the pilot site ids to the guard in `deploy-evidence-map.sh` (keeping the existing one).
   - Add the `[dev]` block to `netlify.toml`.
   - Consider git-linking the dev site.
7. **Work through the follow-ups in 6.4.** Each should be a small PR into `dev` with walk/tipcheck evidence where it touches the UI.
8. **Before about 2027-01-25,** re-bake `lib/market-path.json`, or the market-path tilt silently goes to zero.

---

## Appendix A: Glossary

Product and domain terms. Definitions follow `src/glossary.ts` where the term exists there.

| Term | Meaning |
|---|---|
| **Gate 1** | The first screening rulebook: 10 hard kills and 8 watch flags evaluated against the deal's fields, with thresholds resolved per asset class and posture. |
| **Verdict** | PASS = no kills and at most 1 flag point. CONDITIONAL = 2–3 points. FAIL = any kill or 4 or more points. REVIEW = missing data ("missing never passes"). |
| **Hard kill** | A breach that fails the deal outright; one is enough. |
| **Watch flag** | A non-fatal concern that earns flag points. Today only `rents_vs_comps` has a "severe" line, which earns double points (`engine.ts` ~399). |
| **Fragile pass** | Passes with almost no margin: within `fragile_margin_pct` of a threshold. |
| **Baseline verdict** | The rulebook's output before any judgment adjustment; always kept and shown. |
| **Judgment adjustment** | A per-deal manual change to one threshold, with a required reason; always logged. |
| **Posture** | Green, yellow or red risk stance computed from 8 weighted macro signals. It shifts gate thresholds: the same deal must clear higher bars in yellow, and higher still in red. |
| **Regime** | Macro environment label behind the posture: soft_landing, stagflation or recession. Mapped to a posture per asset class by `postureMatrix`. |
| **Macro quadrant** | Inflation or disinflation crossed with expansion or contraction. |
| **Macro snapshot** | A weekly stored computation of signals, regime and posture (`macro_snapshots`); `source` is auto or manual. |
| **Hysteresis** | The regime changes only after `hysteresisWins` (2) consecutive weekly votes. |
| **Degraded mode** | Too few live signal votes (`minVotes` 4) to trust the computed regime. |
| **Sahm rule** | Recession signal: 3-month average unemployment minus its 12-month low is at least 0.50; a hard override to recession. |
| **Posture scenarios** | The same deal evaluated under green, yellow and red side by side (`scenarios` in the preview response). |
| **Cushion / buffer zone** | Each check's margin to its threshold under each posture ("Buffer zone by market posture" chart). |
| **Mini-stress** | Quick downside test: raise hard costs (funded by equity), widen the exit cap, and add selling costs on untrended NOI. The stressed levered equity multiple must clear a floor that depends on posture. |
| **Hurdle stack** | Required return: anchor 8%, plus illiquidity by lockup (≤3/5/7/longer years: 150/250/325/400 bps), plus complexity (development 250, value_add 150, core_plus 75 bps), plus regime (soft_landing/stagflation/recession: 0/100/200 bps). The pilot uses a fixed 5-year lockup and development strategy, giving 13% in soft landing and 15% in recession. |
| **Hurdle rate** | Return investors must receive before the sponsor shares profits. |
| **Config version** | An append-only rulebook version. 0 = shipped `default-config.json`; 1 = seed; later = saved from THRESHOLDS. |
| **Decision ledger** | Append-only `gate_decisions` rows; replaying one reproduces the verdict byte for byte. |
| **Recorded extraction / sample deal** | `src/sample-extraction.ts`: a labelled recorded AI extraction of example documents (Faithful Trails RV OM and Okeechobee pro forma). |
| **IRR** | Annualised return implied by cash-flow timing; NPV(cash flows, IRR) = 0. |
| **Equity multiple** | Total distributions divided by equity invested. |
| **Cash-on-cash** | (NOI − annual debt service) / equity. |
| **DSCR** | NOI / annual debt service. |
| **LTC** | Loan amount / total project cost. |
| **Yield on cost (YoC)** | Stabilised NOI / total cost. |
| **Exit cap rate** | Cap rate assumed at sale; exit value = NOI / exit cap. |
| **Development spread** | YoC minus market exit cap: the margin for building instead of buying. |
| **Contingency** | Budget buffer for overruns, typically 5–10% of hard costs. |
| **GP co-invest** | The sponsor's own cash in the deal. |
| **Land basis** | Land carried as a share of total cost. |
| **Interest reserve** | Budgeted construction-loan interest before income starts. |
| **Absorption** | How fast the market leases or sells new units. |
| **Rents vs comps** | Projected rents against achieved rents at comparable properties (premium flag and severe line). |
| **Profit margin** | (exit value − total cost) / total cost. |
| **Completion guarantee** | The sponsor's promise to the lender to finish regardless of overruns. |
| **GMP contract** | Guaranteed maximum price construction contract. |
| **Single-exit refi** | A plan that works only if one specific refinancing happens. |
| **Track record** | The sponsor's comparable completed, full-cycle deals. |
| **SOFR** | Secured Overnight Financing Rate, the base for construction-loan pricing. |
| **Financing vs market** | The deal's loan rate against SOFR plus a typical spread, the 10-year and the 30-year mortgage rate. |
| **vs. S&P 500** | The deal's return against public-market returns. Note: FRED `SP500` is price-only (6.4 #1). |
| **P(loss)** | Share of 20,000 Monte Carlo paths with a negative annualised return over the hold. |
| **De-smoothing (Geltner)** | Removes appraisal lag before simulating: r*_t = (r_t − φ·r_{t−1}) / (1 − φ). |
| **DDQ** | Due-diligence questionnaire scorecard. Maps to a mu bias, a sigma multiplier and book correlation in the Monte Carlo (`lib/ddq.ts`). |
| **Market edge / market path tilt** | Small mu tilts from `market-edge.json` (yield edge, at most ±0.30% per year) and `market-path.json` (TSFM forecast for markets that passed the research gate, at most ±2% per year divided by the hold). |
| **Kelly sizing** | Sigma-floor fractional Kelly position: 0.5 fraction, 25% cap. |

---

## Appendix B: Playwright harnesses (portable copies)

These two scripts were the previous session's UI verification tools. They contain no secrets. The copies below differ from the originals in four ways:
- `require('playwright')` replaces a hard-coded sandbox path.
- The browser binary is optional, through `CHROMIUM_PATH`.
- `tipcheck.cjs` accepts `APP_PATH`; the original always opened `/`.
- The Roboto font cache is optional, through `FONT_DIR`.

(The header install comment was also updated to match the Setup below.) Both copies were syntax-checked and run successfully on 2026-10-09 against a local Vite server (5.2).

**Setup.** Keep the harnesses and Playwright **out of the repo**. Playwright is not a project dependency, and `npm i -D playwright` in the repo root would rewrite `package.json` and `package-lock.json`.
```bash
mkdir -p ../cc-harness && cd ../cc-harness
npm init -y && npm i playwright && npx playwright install chromium
# save walk.cjs and tipcheck.cjs here
```
If you must install inside the repo, use `npm i --no-save playwright`, and never commit `package.json` or `package-lock.json` changes from it.

**Run** (from `../cc-harness`, with `npm run dev` running in the repo):
```bash
# app at / under `npm run dev`; use APP_PATH=/app against a Netlify deploy
BASE=http://127.0.0.1:5173 node walk.cjs out-1400 1400
BASE=http://127.0.0.1:5173 node walk.cjs out-390 390 --edit hard_cost_contingency_pct=12
BASE=http://127.0.0.1:5173 node tipcheck.cjs 390
```

- **`--edit key=value`** sets a Review field before scoring. The key comes from `src/deal-types.ts`, and the input is `#ir-<key>`. An empty value clears the field.
- **`walk.cjs` output:** a full-page screenshot per tab, a screenshot per chart card (`.ck-card`), `manifest.json` and `log.txt`. The log lists text-on-text overlaps over 2 px, text clipped outside its card, SVG overflow, page horizontal overflow, console errors and HTTP 4xx/5xx responses.
- **`tipcheck.cjs` output:** `width=… roboto=… probes=… problems=… pageerrors=…`, then one line per problem.
- **`PROXY_CA_SPKI`** in `walk.cjs` was only for the previous sandbox's TLS proxy. Leave it unset.

### B.1 `walk.cjs`

```js
// Drive the app: intake -> sample deal -> review -> results -> each Underwriting tab.
// Per chart card (.ck-card): element screenshot + automatic geometry checks
// (text-vs-text overlap inside the card, text clipped outside the card, page
// horizontal overflow). Writes <out>/manifest.json and <out>/log.txt.
//
// Usage: BASE=<origin> APP_PATH=</ or /app> node walk.cjs <outDir> [width=1400] [--edit key=value ...]
//   Needs: playwright installed in a folder outside the repo (see Setup) + npx playwright install chromium (or CHROMIUM_PATH=<chrome binary>).
//   BASE defaults to http://127.0.0.1:5173 (npm run dev serves the app at /; a Netlify deploy serves it at /app).
//   Scoring POSTs to <BASE>/api/gate1/preview (stateless) - use a local dev server or a review deploy.
//   --edit applies Review-step field edits before scoring, by field key from
//   src/deal-types.ts (the input is #ir-<key>; empty value clears it), e.g.
//   --edit hard_cost_contingency_pct=12 --edit submarket_leaseup_months=9
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const args = process.argv.slice(2)
const OUT = args[0] || path.join(__dirname, 'shots')
const WIDTH = Number(args[1] || 1400)
const edits = []
for (let i = 2; i < args.length; i++) if (args[i] === '--edit') edits.push(args[++i])
const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const APP = process.env.APP_PATH || '/'
fs.mkdirSync(OUT, { recursive: true })

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

;(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    // Trust only the sandbox proxy's CA key (TLS is re-terminated by the proxy); everything else still verifies.
    args: process.env.PROXY_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.PROXY_CA_SPKI}`] : [] })
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: WIDTH < 600 ? 2 : 1 })
  const page = await ctx.newPage()
  const log = []
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text())) log.push(`[console.${m.type()}] ${m.text()}`) })
  page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n${e.stack || ''}`))
  page.on('response', r => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`) })

  await page.goto(BASE + APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + APP, { waitUntil: 'domcontentloaded' })
  await page.getByText('Load the sample deal', { exact: false }).first().click({ timeout: 20000 })
  await page.waitForTimeout(1500)

  for (const e of edits) {
    // field key from src/deal-types.ts ALL_FIELDS; the Review input is #ir-<key>.
    // Empty value clears the field (renders the "missing" state).
    const i = e.indexOf('=')
    const key = e.slice(0, i), value = e.slice(i + 1)
    const input = page.locator(`#ir-${key}`)
    if (await input.count()) {
      const tag = await input.evaluate(el => el.tagName)
      if (tag === 'SELECT') {
        const opts = await input.locator('option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent })))
        const hit = opts.find(o => o.v === value || o.t === value)
        await input.selectOption(hit ? hit.v : value)
      } else { await input.fill(value); await input.press('Tab') }
      log.push(`[edit] ${key} = ${JSON.stringify(value)}`)
    } else log.push(`[edit-miss] ${key} (no #ir-${key})`)
  }
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: /CONFIRM & SCORE/i }).click()
  await page.waitForSelector('.uw-tabs', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const manifest = { width: WIDTH, edits, tabs: {} }
  for (const t of ['Summary', 'Financials', 'Market', 'Sponsor', 'Issues']) {
    const tab = page.getByRole('tab', { name: new RegExp('^' + t) })
    await tab.first().click()
    await page.waitForTimeout(1200)
    if (t === 'Market') {
      const det = page.locator('details summary', { hasText: 'Market risk context' })
      if (await det.count()) {
        await det.first().click()
        await page.waitForFunction(() => !document.body.innerText.includes('simulating…'), null, { timeout: 60000 }).catch(() => log.push('[wait] MC still simulating'))
        await page.waitForTimeout(800)
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, `${slug(t)}-full.png`), fullPage: true })

    const pageOverflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }))
    const cards = page.locator('.ck-card')
    const n = await cards.count()
    const list = []
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i)
      const title = (await card.locator('.ck-title').first().textContent().catch(() => '')) || `card-${i}`
      const file = `${slug(t)}-${i}-${slug(title)}.png`
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: path.join(OUT, file) })
      const geo = await card.evaluate(c => {
        const cr = c.getBoundingClientRect()
        const texts = [...c.querySelectorAll('svg text, .ck-plot [class*=lab], .ck-plot span')]
          .map(el => ({ el, r: el.getBoundingClientRect(), s: (el.textContent || '').trim() }))
          .filter(x => x.s && x.r.width > 0 && x.r.height > 0)
        const overlaps = []
        for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
          const A = texts[a].r, B = texts[b].r
          if (texts[a].el.contains(texts[b].el) || texts[b].el.contains(texts[a].el)) continue
          const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left)
          const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)
          if (ix > 2 && iy > 2) overlaps.push(`"${texts[a].s.slice(0, 40)}" x "${texts[b].s.slice(0, 40)}" (${ix.toFixed(0)}x${iy.toFixed(0)}px)`)
        }
        const clipped = texts.filter(x => x.r.left < cr.left - 1 || x.r.right > cr.right + 1).map(x => `"${x.s.slice(0, 40)}" [${x.r.left.toFixed(0)},${x.r.right.toFixed(0)}] vs card [${cr.left.toFixed(0)},${cr.right.toFixed(0)}]`)
        const svgOverflow = [...c.querySelectorAll('svg')].filter(s => s.getBoundingClientRect().right > cr.right + 1).length
        return { overlaps, clipped, svgOverflow, text: c.innerText.slice(0, 4000) }
      })
      list.push({ title: title.trim(), file, ...geo })
    }
    manifest.tabs[t] = { pageOverflow, cards: list }
    log.push(`[tab] ${t}: ${n} chart cards, scrollW=${pageOverflow.scrollW} innerW=${pageOverflow.innerW}`)
    for (const c of list) {
      if (c.overlaps.length) log.push(`  [overlap] ${c.title}: ${c.overlaps.slice(0, 6).join('; ')}`)
      if (c.clipped.length) log.push(`  [clipped] ${c.title}: ${c.clipped.slice(0, 6).join('; ')}`)
      if (c.svgOverflow) log.push(`  [svg-overflow] ${c.title}`)
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'))
  console.log(log.join('\n'))
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
```

### B.2 `tipcheck.cjs`

```js
// Tooltip containment probe: for every focusable mark in every chart card,
// focus it (the keyboard + touch-tap path) and hover it at its left edge,
// centre and right edge (the mouse path); record any .ck-tip that leaves its
// card or the viewport. Optional: if FONT_DIR contains roboto.css + fonts/,
// Google Fonts requests are served from that local cache (only needed where
// fonts.googleapis.com is unreachable; the fallback font is wider than Roboto).
// The first output line reports roboto=true|false so you know which font ran.
// Usage: BASE=<origin> APP_PATH=</ or /app> node tipcheck.cjs <width> [--edit key=value ...]
//   Needs: playwright installed in a folder outside the repo (see Setup) + npx playwright install chromium (or CHROMIUM_PATH=<chrome binary>).
//   Scoring POSTs to <BASE>/api/gate1/preview (stateless) - use a local dev server or a review deploy.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const WIDTH = Number(args[0] || 390)
const edits = []
for (let i = 1; i < args.length; i++) if (args[i] === '--edit') edits.push(args[++i])
const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const FONTS = process.env.FONT_DIR || path.join(__dirname, 'font-cache')
const APP = process.env.APP_PATH || '/'

;(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 800 } })
  if (fs.existsSync(path.join(FONTS, 'roboto.css'))) {
    await ctx.route(/fonts\.googleapis\.com\/css2/, r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(FONTS, 'roboto.css')) }))
    await ctx.route(/fonts\.gstatic\.com\//, r => {
      const f = path.join(FONTS, 'fonts', new URL(r.request().url()).pathname.replace(/\//g, '_'))
      return fs.existsSync(f) ? r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(f) }) : r.abort()
    })
  }
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(BASE + APP)
  await page.getByText('Load the sample deal', { exact: false }).first().click({ timeout: 20000 })
  await page.waitForTimeout(1200)
  for (const e of edits) {
    const i = e.indexOf('='), key = e.slice(0, i), value = e.slice(i + 1)
    const input = page.locator(`#ir-${key}`)
    if ((await input.evaluate(el => el.tagName)) === 'SELECT') await input.selectOption(value)
    else { await input.fill(value); await input.press('Tab') }
  }
  await page.getByRole('button', { name: /CONFIRM & SCORE/i }).click()
  await page.waitForSelector('.uw-tabs', { timeout: 30000 })
  await page.waitForTimeout(2000)
  const fontOk = await page.evaluate(() => document.fonts.check('12px Roboto'))

  let marks = 0, bad = []
  for (const t of ['Summary', 'Financials', 'Market']) {
    await page.getByRole('tab', { name: new RegExp('^' + t) }).first().click()
    await page.waitForTimeout(1000)
    const cards = page.locator('.ck-card')
    const nc = await cards.count()
    for (let c = 0; c < nc; c++) {
      const card = cards.nth(c)
      const title = ((await card.locator('.ck-title').first().textContent()) || '').trim()
      const ms = card.locator('.ck-plot [tabindex="0"]')
      const nm = await ms.count()
      for (let m = 0; m < nm; m++) {
        const mark = ms.nth(m)
        await mark.scrollIntoViewIfNeeded()
        const box = await mark.boundingBox()
        if (!box) continue
        const probes = [['focus', null]]
        for (const fx of [0.05, 0.5, 0.95]) probes.push(['hover', { x: box.x + box.width * fx, y: box.y + box.height / 2 }])
        for (const [kind, pt] of probes) {
          if (kind === 'focus') await mark.focus()
          else { await page.mouse.move(pt.x, pt.y) }
          await page.waitForTimeout(60)
          const g = await card.evaluate(cd => {
            const tip = cd.querySelector('.ck-tip')
            if (!tip) return null
            const r = tip.getBoundingClientRect(), k = cd.getBoundingClientRect()
            return { l: r.left, r: r.right, t: r.top, b: r.bottom, kl: k.left, kr: k.right, vw: innerWidth, vh: innerHeight, txt: tip.innerText.slice(0, 60).replace(/\n/g, ' | ') }
          })
          marks++
          if (!g) { if (kind === 'focus') bad.push(`${t} / ${title} #${m} ${kind}: NO TOOLTIP`); continue }
          const out = []
          if (g.l < g.kl - 1) out.push(`left ${(g.kl - g.l).toFixed(0)}px outside card`)
          if (g.r > g.kr + 1) out.push(`right ${(g.r - g.kr).toFixed(0)}px outside card`)
          if (g.l < 0 || g.r > g.vw) out.push('OFF-SCREEN (x)')
          if (g.t < 0) out.push(`above viewport by ${(-g.t).toFixed(0)}px`)
          if (out.length) bad.push(`${t} / ${title} #${m} ${kind}${pt ? '@' + Math.round(pt.x) : ''}: ${out.join(', ')}  [${g.txt}]`)
        }
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.activeElement && document.activeElement.blur())
      }
    }
  }
  console.log(`width=${WIDTH} roboto=${fontOk} probes=${marks} problems=${bad.length} pageerrors=${errs.length}`)
  for (const b of bad) console.log('  ' + b)
  for (const e of errs) console.log('  [pageerror] ' + e)
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
```

---

## Appendix C: Unverified items (collected)

- **Production:**
  - whether merging to `main` auto-publishes. It is very likely (deploy previews for PRs into `main`; current deploy `locked: null`), but "git-triggered" is an inference (4.2);
  - its current environment variables, including whether `AUTH_ENABLED`, `REQUIRE_ACCOUNTS` or `ANTHROPIC_API_KEY` are set.
- **Supabase and cron:**
  - which Supabase project each site's function-side `SUPABASE_URL` points at;
  - which migrations are applied on the dev database beyond 0001, 0002 and (inferred) 0004's `decided_by_email` column; whether 0003 and 0005 are applied anywhere;
  - how migrations are applied;
  - the pg_cron job's definition, target and schedule.
- **Dev2 (6.1, 6.2):**
  - whether the extraction hang still reproduces, and its root cause;
  - why its functions lack Supabase (the `SUPABASE_URL` scope is the first lead).
- **Netlify:**
  - whether the dev site and Dev2 have a linked repo (their current deploys carry no commit);
  - whether the rate limits aggregate per IP or per domain;
  - `netlify dev` behaviour on the current head (verified only by the previous session, with netlify-cli 27.10.1);
  - whether a CLI upload to Dev2 changes its functions runtime.
- **Not readable from this environment:**
  - the parent repo `MDeanH/ai-diligence-platform`;
  - GitHub commit statuses and deployments (HTTP 403).
- **Not run:** the Python test `tests/test_mc_reference.py`.
- **Netlify environment variable names on the dev site** (2.6) come from the previous session's 2026-09-28 record and were not re-read, because reading them returns secret values. They may have changed since.
- **ChatGPT/Codex sandbox behaviour** (network during setup, secret stores): not checked.
