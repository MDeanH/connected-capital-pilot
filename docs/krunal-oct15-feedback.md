# October 15 macro trend feedback

## Baseline and scope

Repository: `MDeanH/connected-capital-pilot`; baseline `ac1a26f` on
`milosz/cornell-ux`. Feedback branch: `milosz/krunal-macro-trends-oct15`.
There is no `pilot` branch in this repository. `main` remains the older build.
The separate `miloszmenceldocs-tech/CCCprototype` repo contains an incomplete
scaffold, not the deployed application source.

`cccprototype.vercel.app` was a CLI deployment (deployment
`dpl_CqFt3xXQT2oW3b5Zoizee9mUPWTb`), without Git commit metadata.
Deployed raw file hashes exactly match baseline DealIntake, ThresholdConfig,
PerformanceTrends, sample-performance and vite.config.ts. Branding and the
Vercel adapter were outside Git. This branch retains CCCPrototype branding
and checks in the existing deployment pattern: one bundled function calling
the same engines as Vite, with explicitly unpersisted results. The adapter is
for previews only, and does not use Supabase or replace uploaded documents
with sample values. Original Netlify functions and calculation modules are unchanged.

## Implemented

- Replaced the individual-deal trend with a macro trend dashboard.
- Seven exact client parameters are in `src/macro-trends/config.json`;
  they do not change the screening rulebook.
- Pure normalization/clamping, group weighting, exact dated 13-week speed,
  room/ETA, valid posture transitions, and recovery confirmation.
- Fictional dated release fixtures and weekly snapshots. GDP and PCE carry
  the last published reading forward. No trend data API or persistence.
- Scenario controls cover inflation pressure, recession risk, confirmed and
  unconfirmed recovery, holding and absent 13-week history.
- Blank manual deal entry; immediate result invalidation and late-response
  rejection prevent another deal's data from appearing as new results.

## Explicit specification interpretations

1. GDP values 0.02% / 0.005% are used literally, in percent units. Their
   economic magnitude looks unusual; client confirmation is still useful.
2. Claims uses YoY +5% / +25%. The parenthetical 260,000 / 320,000 levels
   do not describe an equivalent fixed baseline and are not alternative cutoffs.
3. PCE 2.70% scores 0.20; 2.95% scores 0.45. The formula takes precedence
   over inconsistent example scores.
4. Three consecutive monthly releases easing means three declines, requiring
   four consecutive monthly readings. Repeated weekly carried values do not
   count as new monthly releases.
5. Return from Stagflation to Soft Landing requires BOTH groups below Yellow:
   the later crossing controls the estimate. This necessary condition takes
   precedence over the generic instruction to choose the shortest ETA.
6. Recession recovery goes through Stagflation; the trend never alters the
   current weekly posture or the deal's score. If a boundary is already met
   before weekly evaluation, the UI says evaluation is pending instead of
   pretending a forecast changed the current posture.
7. Bands are Green <0, Yellow [0,1), Red >=1. The client's directional
   status at score 0 when improving is `Green, improving`, although its
   current band is still Yellow at equality. Both are exposed as specified.
8. Missing data never causes silent reweighting or invented speed/ETA.
   Zero speed holds. Tiny nonzero speed is retained; extremely long
   extrapolations are labeled more than 1,000 weeks instead of rounded to zero.
9. Improving/worsening counts compare underlying readings in each signal's
   worse direction, so clamping cannot hide an observed improvement.

## Validation commands

- `npm run build`: existing 66 golden/evidence checks, strict TypeScript, Vite.
- `node --import tsx scripts/check-macro-trends.ts`: focused deterministic tests.
- `node scripts/check-threshold-grid.mjs`: existing threshold grid regression tests.
- `node scripts/bundle-vercel-api.mjs` then `node scripts/check-preview-adapter.mjs`:
  preview adapter, both canonical deals, blank new deal, overrides and unpersisted behavior.
- `npm run dev -- --host 127.0.0.1 --port 5173`: local development.
- `npm test` is not defined; the existing suites run within `npm run build`.

This sandbox requires a temporary script-shell wrapper that substitutes
`node --import tsx` for the four tsx CLI commands because CLI IPC sockets
are restricted. The project scripts and lockfile are unchanged.

Real browser verification is performed against the separate feedback preview;
this sandbox's localhost cannot be reached from the connected cloud browser.
No existing production/preview alias is promoted or replaced.
