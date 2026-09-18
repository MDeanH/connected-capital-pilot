# Jev (TypeSafe AI) in the Connected Capital deal product — integration assessment

Status: **unverified on hardware.** Jev is in early access behind a waitlist
(launched 2026-09-15) and its API/docs hosts are unreachable from the sandbox
this was written in, so nothing below has been run. Facts are sourced; the
design is a proposal. Re-confirm every version-dependent detail against
https://docs.typesafe.ai before writing code.

## What Jev is (verified from sources, not run)

Jev is TypeSafe AI's first "System One" model. It does not generate text. It
takes an application **state** (JSON or text) plus one or more **typed
questions** and returns, in one forward pass, a typed answer with a probability
distribution. Three primitives, quoted from the official skill file:

| Primitive | Returns | Official distinction |
| --- | --- | --- |
| Choice | `choice`, `probabilities`, `confidence` | "Picks one option; its distribution compares competing options" |
| Noul | `noul` (0–1) | "Probability of yes; no separate confidence; use one per label when several may apply" |
| Score | `score`, `probabilities`, `confidence` | "Probability-weighted position on ordered levels" |

Questions in one request "run in parallel and cannot see one another's
answers." TypeSafe's own guidance is the same as this repo's spine: "Keep known
rules, calculations, exact lookups, and execution in code." Jev supplies the
semantic judgment; code owns the policy.

Concrete call shape, as used by two public integrations (jev-trader,
LegalForecastBench), via the Vercel AI SDK:

```ts
import { experimental_evaluate } from 'ai'
import { typeSafeAi } from '@ai-sdk/typesafe-ai'

const r = await experimental_evaluate({
  model: typeSafeAi.evaluationModel('jev'),   // model id: check docs; gateway route 'typesafe-ai/jev'
  state,                                        // JSON object; reference paths as `a.b[0].c`
  questions: {
    supported: {
      type: 'noul',
      instructions: { question: 'Does `quote` state the value in `extracted.value` for `field.label`?' },
    },
  },
})
r.answers.supported.noul   // 0..1
```

Raw HTTP is `POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`.
Listed price (OpenRouter, secondary source): $0.042 per 1M input tokens, $0
output. One integration reports ~80 ms per decision. Treat both as claims.

## Where it fits this product

The product already separates *extraction* (Claude Opus, `extract-core.ts`),
*verification* (the analyst, `IntakeReview.tsx`) and *decision* (the pure Gate 1
engine, `engine.ts`). Jev belongs in the seam between extraction and the
analyst: a cheap, calibrated second opinion on what the extractor produced,
so the analyst's attention goes to the fields most likely to be wrong. It does
**not** belong in the engine, the thresholds, the macro layer, or the verdict.

Ranked by value and fit:

### 1. Calibrated per-field support scores (highest value)

Today `ExtractedField.confidence` is the extractor's self-report. A generating
model grading its own answer is the weakest confidence signal available, and
the UI bands it at fixed 0.8 / 0.5 cut-offs (`IntakeReview.tsx:confidenceLevel`).

Proposed: after `runExtraction`, for every non-empty field ask one Noul over
`{ field: {key,label,kind,hint}, extracted: {value, doc, page}, quote, passage }`:
"Does the passage state this value for this field?" Store the probability as
`verification.fields[key].supported`. This is TypeSafe's own "citation check"
pattern. The ConfidenceTag then shows a calibrated number, and the high/med/low
bands get set from the client's own reviewed deals (see Verification plan),
not hard-coded.

Gap to close first: Jev takes text state, while the extractor receives the PDF
as a document block. The verify step needs page text, so add server-side PDF
text extraction (per page) to the background worker. Until then, `quote` alone
is a weaker but usable state.

### 2. False-null detection (protects the "missing never passes" rule)

An empty extraction for a required field forces `REVIEW`. If the document
actually answers it, that is analyst churn, not safety. For each empty required
field ask Noul "Is this field stated anywhere in the supplied passages?" over the
candidate pages (keyword-selected in code). A high probability flags the field
"likely present — re-check" in the review screen. Never auto-fills; the field
stays null until the analyst enters it.

### 3. The five semantic kill booleans

`sponsor_integrity_clear`, `site_fully_entitled`, `exit_dependent_single_refi`,
`has_gmp_or_bonded_gc`, `has_completion_guarantee` are judgments over prose, and
three of them are hard kills. One Noul each over the relevant passages, with a
three-way policy in code, evaluated on the backtest:

    p >= hi  -> true      p <= lo -> false      otherwise -> null (MISSING -> REVIEW)

That keeps the spine intact: uncertainty degrades to REVIEW, never to PASS.
Show the probability next to the boolean so the analyst sees why it is flagged.

### 4. Discrepancy triage

Opus reports discrepancies with a `minor | material` severity. Ask a Choice
over `{ topic, om_value, proforma_value, note, fields_affected }` with criteria
`material | minor | not_a_discrepancy` (the third option catches re-statements
of the same number). Store the distribution; `ConsistencyPanel` sorts by
P(material) and greys out likely non-issues instead of dropping them.

### 5. Asset-class selection (trivial, cheap)

`asset_class` drives threshold-row resolution. A Choice over the five classes
from the OM summary is exactly "select instead of generate." Low value on its
own; include because it costs one question in the same request.

### Explicitly not a fit

- Gate 1 checks, thresholds, verdict roll-up, mini-stress: deterministic,
  versioned, replayable. Keep in code.
- Macro posture: numeric FRED signals with configured bands. Keep in code.
- Judgment-adjustment reasons: a "does this reason justify the change?" Noul is
  possible but second-guesses the analyst; park it unless the client asks.
- Anything that needs a citation or an explanation: Jev returns probabilities
  only. Opus stays the extractor and the source of quotes.

## Proposed shape in the codebase

- `netlify/functions/lib/gate1/verify-core.ts` — pure builder for state +
  questions from an `ExtractionResult`, plus a thin client. Mirrors
  `extract-core.ts` so the vite bridge and the Netlify function share it.
- `extract-run-background.ts` — after `runExtraction`, run verification when
  `TYPESAFE_API_KEY` is set; otherwise skip and label the result
  `verification: { status: 'not_run' }` (same honesty pattern as "NOT recorded").
- `fields.ts` — extend `ExtractionResult` with an optional `verification`
  block: `{ model, fields: Record<key,{supported,present?}>, discrepancies:
  Array<{material,minor,not_a_discrepancy}>, ms, inputTokens }`.
- `supabase/migrations/0002_verification.sql` — `extractions.verification
  jsonb`; the ledger must carry the model id and raw probabilities so any
  review can be replayed, matching the `gate_decisions` discipline.
- UI: `ConfidenceTag` reads `verification` when present; `IntakeReview` sorts
  or highlights low-support and likely-present fields; `ConsistencyPanel`
  orders by P(material).
- Golden suite: a recorded fixture of Jev answers for the Faithful Trails
  sample, so `npm run build` stays offline and deterministic. The live path is
  exercised only with a key, like extraction today.
- Env: `TYPESAFE_API_KEY` (server-only, as with `ANTHROPIC_API_KEY`).

Cost envelope at the listed price: ~30 fields plus discrepancies, roughly
1–2 KB of state each, is on the order of 50k input tokens per deal, i.e. well
under one cent. Latency is parallel per request, so sub-second is plausible.
Both numbers need measuring.

## Verification plan (verified-on-hardware beats spec)

1. Get API access (waitlist). Read the live `api.md`, `primitives/noul.md`,
   `confidence.md`, and the `citation_check` and `sde_cascade` cookbooks.
2. Run the verify step on the recorded Faithful Trails extraction and on any
   live extraction the team has already reviewed. Ground truth = the fields the
   analyst changed in Review. Measure whether `supported` separates changed
   from unchanged fields (AUC, and calibration by decile).
3. Set the tag bands from that data. Do the same for the three-way boolean
   policy using the backtest rows, checking no path turns a REVIEW into a PASS.
4. Measure tokens, cost and end-to-end latency per deal.
5. Only then wire the UI. Ship behind the key so absence changes nothing.

## Open questions

- Exact model id, state size limit and context window (docs unreachable here).
- Whether the JS SDK is `@ai-sdk/typesafe-ai` via `ai`, a first-party
  `@typesafe-ai/sdk`, or both; which one is supported long-term.
- Data handling: OM passages would go to a second third-party processor. No
  live client data is in the build today (HANDOFF), but this needs the
  client's sign-off before real pipeline deals flow through it.
- Whether calibration holds on real-estate offering documents; the vendor
  claim is domain-general.

## Research log

- Start 2026-09-18T16:43Z, end 2026-09-18T16:48Z (about 5 min).
- Sources: TypeSafe official skill file (github.com/typesafe-ai/skills,
  SKILL.md, fetched raw); awesome-jev lists (github.com/yibie/awesome-jev,
  github.com/AnotiaWang/awesome-jev); jev-trader `src/model.ts` and README
  (github.com/jarrodwatts/jev-trader); LegalForecastBench
  `integrations/jev/evaluate.mjs` (github.com/johnhughes3/LegalForecastBench);
  open-alternative-jev README (github.com/ikermoel/open-alternative-jev);
  search-result snippets for openrouter.ai/typesafe/jev-1.13 and
  docs.typesafe.ai (pages themselves blocked by the sandbox proxy).
- Conclusion: strong fit as a calibrated verification layer between extraction
  and analyst review; no fit inside the engine. Cannot be validated until API
  access exists.
- Not appended to `~/Documents/AI_Backup_Analysis/RESEARCH_LOG.md` — that path
  is not in this repo or sandbox.
