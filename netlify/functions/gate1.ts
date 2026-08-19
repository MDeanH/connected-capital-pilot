// Gate 1 API — the engine's only public surface.
//   POST /api/gate1/preview    → stateless evaluate (live UI)
//   POST /api/gate1/decide     → evaluate + persist an append-only, replayable decision row
//   GET  /api/gate1/decisions  → the recorded ledger, newest first (deal history)
//
// Every decision is stamped with the threshold-config version and macro snapshot
// so it can be replayed exactly. Judgment adjustments require a reason (enforced
// in resolveThresholds); `decide` stores BOTH the baseline result (config +
// posture only) and the adjusted result — manual control is never silent.
//
// decide takes no posture override: it resolves posture and config server-side
// and 409s when either differs from what the analyst last previewed under
// (expectedPosture / expectedConfigVersion — the record handshake). preview and
// preview-batch keep body.posture as a what-if override.

import type { Config, Context } from '@netlify/functions'
import { identityFromRequest, requireAdmin } from './lib/auth.ts'
import { computeGate1, DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { DealFields, Gate1Config, JudgmentAdjustment, Posture } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

type Db = NonNullable<ReturnType<typeof serviceClient>>

// The supported asset-class registry — mirrors ASSET_CLASSES in
// src/deal-types.ts and the asset_class extraction hint in lib/gate1/fields.ts
// (keep all three in sync). An unknown or misspelled class (e.g.
// 'rv_speciality') must 400, never silently score: resolveThresholds falls
// back to the '*' wildcard rows for any class it doesn't recognize, so a typo
// would grade a deal under generic thresholds without anyone noticing.
const SUPPORTED_ASSET_CLASSES = ['rv_specialty', 'multifamily', 'industrial', 'retail', 'office']

const assetClassError = (v: unknown): string | null =>
  SUPPORTED_ASSET_CLASSES.includes(String(v))
    ? null
    : `asset_class must be one of: ${SUPPORTED_ASSET_CLASSES.join(', ')}`

// Amount/rate/count fields that must be finite and >= 0 when present — a
// negative construction loan flips LTC negative (sailing past the leverage
// kill) and inflates the mini-stress. stabilized_noi_untrended is deliberately
// absent: bad economics should score badly, not 400.
const NON_NEGATIVE_FIELDS: Array<keyof DealFields> = [
  'total_project_cost', 'hard_costs', 'land_cost', 'construction_loan', 'total_equity',
  'guarantor_net_worth', 'assumed_rent_monthly', 'market_comp_rent_monthly',
  'interest_reserve_months', 'construction_duration_months', 'lease_up_months_assumed',
  'submarket_leaseup_months', 'sponsor_completed_comparables', 'exit_cap_rate',
  'market_cap_rate_today', 'loan_interest_rate', 'sponsor_coinvest_pct',
  'hard_cost_contingency_pct',
]

/**
 * Error message for the first invalid field, or null when every present value
 * is a finite, non-negative number. ANY present non-null value that is not a
 * finite number rejects — strings included: a custom client sending
 * construction_loan: "-7000000" used to skip the old typeof-number gate and
 * coerce to a negative inside the engine's arithmetic (`loan / cost`).
 */
function invalidField(fields: DealFields): string | null {
  for (const key of NON_NEGATIVE_FIELDS) {
    const v = fields[key]
    if (v === null || v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${key} must be a number`
    if (v < 0) return `${key} must be a non-negative number`
  }
  return null
}

const isPosture = (v: unknown): v is Posture => v === 'green' || v === 'yellow' || v === 'red'

// Matches the client-minted crypto.randomUUID() extraction ids — the uuid PK
// of the extractions row (see extract-run-background.ts).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RULEBOOK_UNAVAILABLE = 'Could not load the active rulebook — try again'

// Active config: highest Supabase version, else the shipped default (version 0).
// null = the query itself FAILED — callers must 503, never score (let alone
// record) under the baked default while a saved rulebook may exist.
async function loadActiveConfig(db: Db): Promise<{ config: Gate1Config; version: number } | null> {
  const { data, error } = await db
    .from('threshold_configs')
    .select('version, config')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data ? { config: data.config as Gate1Config, version: data.version } : { config: DEFAULT_CONFIG, version: 0 }
}

const MACRO_UNAVAILABLE = 'Could not load the macro posture — try again'
const MACRO_STALE = 'Macro posture is stale — refresh the weekly snapshot and retry'

// Two missed weekly cron runs. Past this the stored posture is a zombie, not a
// signal — it must stop silently moving the bar.
const MAX_SNAPSHOT_AGE_DAYS = 14

type SnapshotRef = { id: string; postures: Record<string, Posture>; createdAt: string }

// NaN compares false, so an unparsable created_at reads stale (fail closed).
const snapshotIsStale = (s: SnapshotRef): boolean =>
  !(Date.now() - new Date(s.createdAt).getTime() <= MAX_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000)

// Latest macro snapshot. null = the query itself FAILED — same rule as the
// config load: a transient failure must not read as "no snapshots" and score
// (let alone record) under default green while the stored posture may be red,
// so callers must 503. { snapshot: null } = genuinely empty table → defaults.
async function loadLatestSnapshot(db: Db): Promise<{ snapshot: SnapshotRef | null } | null> {
  const { data, error } = await db
    .from('macro_snapshots')
    .select('id, postures, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return {
    snapshot: data
      ? { id: data.id as string, postures: data.postures as Record<string, Posture>, createdAt: data.created_at as string }
      : null,
  }
}

// POST /api/gate1/preview-batch — the Backtest path: a whole book in one
// request, so N deals × 3 postures never fans out against the per-IP rate
// limit. Config, macro snapshot and posture resolve ONCE; each row then runs
// the same compute as /preview minus judgment adjustments (a backtest grades
// the rulebook, not per-deal overrides). An invalid row becomes a per-row
// { error } entry rather than sinking the whole batch.
const BATCH_MAX_ROWS = 100

async function previewBatch(body: any): Promise<Response> {
  const rows = body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return json(400, { error: 'rows must be a non-empty array of deal fields' })
  }
  if (rows.length > BATCH_MAX_ROWS) {
    return json(400, { error: `Batch is capped at ${BATCH_MAX_ROWS} rows — split the book and run again` })
  }

  const db = serviceClient()
  let config: Gate1Config = DEFAULT_CONFIG
  let configVersion = 0
  let snapshot: SnapshotRef | null = null
  if (db) {
    const active = await loadActiveConfig(db)
    if (!active) return json(503, { error: RULEBOOK_UNAVAILABLE })
    config = active.config
    configVersion = active.version
    const snap = await loadLatestSnapshot(db)
    if (!snap) return json(503, { error: MACRO_UNAVAILABLE })
    snapshot = snap.snapshot
    if (snapshot && snapshotIsStale(snapshot)) {
      // A dead weekly cron must not keep applying a months-old posture; an
      // explicit request posture still works — the analyst sees what they chose.
      if (!body.posture) return json(503, { error: MACRO_STALE })
      snapshot = null // never default from — or stamp — a stale snapshot
    }
  }

  const requested: Posture | undefined = body.posture || undefined
  const results = rows.map((raw: unknown) => {
    const fields = raw as DealFields
    if (!fields || typeof fields !== 'object' || !fields.asset_class) {
      return { error: 'Missing deal fields (asset_class required)' }
    }
    const classError = assetClassError(fields.asset_class)
    if (classError) return { error: classError }
    const fieldError = invalidField(fields)
    if (fieldError) return { error: fieldError }
    const snapPosture = snapshot ? snapshot.postures[fields.asset_class] ?? snapshot.postures['*'] : undefined
    const posture: Posture = requested ?? snapPosture ?? 'green'
    const postureSource = requested ? 'request' : snapPosture ? 'macro_snapshot' : 'default'
    const macroSnapshotId = snapshot && (!requested || requested === snapPosture) ? snapshot.id : null
    try {
      return computeGate1({ fields }, config, configVersion, posture, postureSource, macroSnapshotId)
    } catch (e: any) {
      return { error: e?.message ?? 'Evaluation failed' }
    }
  })
  return json(200, { results })
}

async function listDecisions(url: URL): Promise<Response> {
  const db = serviceClient()
  if (!db) return json(503, { error: 'Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' })
  // Cursor pagination: ?limit=<n> (default 100, hard cap 200) and
  // ?before=<ISO timestamp> (strictly created_at < before). The raw `before`
  // string goes to the query untouched so sub-millisecond precision survives.
  const limitParam = url.searchParams.get('limit')
  let limit = 100
  if (limitParam !== null) {
    const n = Number(limitParam)
    if (!Number.isInteger(n) || n < 1) return json(400, { error: 'limit must be a positive integer' })
    limit = Math.min(n, 200)
  }
  const before = url.searchParams.get('before')
  if (before !== null && Number.isNaN(new Date(before).getTime())) {
    return json(400, { error: 'before must be an ISO timestamp' })
  }
  let query = db
    .from('gate_decisions')
    .select(
      'id, created_at, deal_id, verdict, baseline_verdict, threshold_config_version, overrides, ' +
        'kills:result->kills, flag_pts:result->flagPoints, posture:result->>posture, ' +
        'input_name:inputs->>deal_name, deals(name)',
    )
  if (before) query = query.lt('created_at', before)
  // Fetch one row past the limit so hasMore is exact, then slice it off.
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit + 1)
  if (error) return json(500, { error: error.message })
  const hasMore = (data ?? []).length > limit
  const decisions = (data ?? []).slice(0, limit).map((r: any) => ({
    id: r.id,
    decided_at: r.created_at,
    deal_id: r.deal_id,
    // Joined deals.name when linked; the name captured in the decision's own
    // inputs stands in for legacy/orphaned rows.
    deal_name: r.deals?.name ?? r.input_name ?? null,
    verdict: r.verdict,
    baseline_verdict: r.baseline_verdict,
    posture: r.posture ?? null, // rows predating the posture stamp read null
    threshold_config_version: r.threshold_config_version,
    kills: Array.isArray(r.kills) ? r.kills : [],
    flag_pts: typeof r.flag_pts === 'number' ? r.flag_pts : null,
    overrides_count: Array.isArray(r.overrides) ? r.overrides.length : 0,
  }))
  return json(200, { decisions, hasMore })
}

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url)
  const decisionId = (context.params as any)?.id as string | undefined
  if (decisionId) {
    // DELETE /api/gate1/decisions/:id — removes ONE recorded decision. A
    // deliberate, gated admin action (the UI confirms first); deal-level
    // deletion (a deal plus all its decisions) lives on DELETE /api/deals/:id.
    if (req.method !== 'DELETE') return new Response('Method not allowed', { status: 405 })
    const gate = await requireAdmin(req)
    if (gate.response) return gate.response
    const db = serviceClient()
    if (!db) return json(503, { error: 'Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' })
    const { error, count } = await db.from('gate_decisions').delete({ count: 'exact' }).eq('id', decisionId)
    if (error) return json(500, { error: error.message })
    return count ? json(200, { ok: true }) : json(404, { error: 'Decision not found' })
  }
  if (url.pathname.endsWith('/decisions')) {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    return listDecisions(url)
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: any
  try {
    body = JSON.parse((await req.text()) || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (url.pathname.endsWith('/preview-batch')) return previewBatch(body)
  const action = url.pathname.endsWith('/decide') ? 'decide' : 'preview'

  const fields = body.fields as DealFields | undefined
  if (!fields || typeof fields !== 'object' || !fields.asset_class) {
    return json(400, { error: 'Missing deal fields (asset_class required)' })
  }
  const classError = assetClassError(fields.asset_class)
  if (classError) return json(400, { error: classError })
  const fieldError = invalidField(fields)
  if (fieldError) return json(400, { error: fieldError })
  const adjustments: JudgmentAdjustment[] = Array.isArray(body.adjustments) ? body.adjustments : []

  // The record handshake (decide only): what the analyst last PREVIEWED under,
  // read straight off the last preview response (its `posture` and
  // `configVersion` fields). decide re-resolves posture and config server-side
  // and refuses (409) to record when either moved since that preview — the
  // ledger must never hold a verdict the analyst did not see. preview ignores
  // both fields. Clients predating the handshake send neither; their decides
  // record under the server-resolved state without the 409 guard.
  const expectedPosture: Posture | undefined = isPosture(body.expectedPosture) ? body.expectedPosture : undefined
  const expectedConfigVersion: number | undefined =
    typeof body.expectedConfigVersion === 'number' && Number.isFinite(body.expectedConfigVersion)
      ? body.expectedConfigVersion
      : undefined

  const db = serviceClient()

  // Active config: highest Supabase version, else the shipped default (version 0).
  let config: Gate1Config = DEFAULT_CONFIG
  let configVersion = 0
  if (db) {
    const active = await loadActiveConfig(db)
    // A FAILED query is not an empty table — scoring (or recording) under the
    // baked version-0 default while a saved rulebook may exist would be silent
    // rule drift, so refuse previews and decides alike.
    if (!active) return json(503, { error: RULEBOOK_UNAVAILABLE })
    config = active.config
    configVersion = active.version
  }

  // Posture:
  //  - preview: body.posture is a what-if override; else snapshot; else green.
  //  - decide: NO override — body.posture is ignored and posture resolves from
  //    the macro snapshot exactly as if none were supplied, so a client-cached
  //    posture can never be recorded over a fresher snapshot. The handshake
  //    below turns a mismatch with the reviewed posture into a 409 instead.
  //  - decide with no db: nothing records (persisted:false, no ledger) and
  //    there is no snapshot to resolve, so the analyst's reviewed posture
  //    keeps the computed verdict identical to the preview they saw — the
  //    legacy public-demo behavior (body.posture accepted for older clients).
  const postureOverride: Posture | undefined =
    action === 'decide'
      ? db
        ? undefined
        : expectedPosture ?? (isPosture(body.posture) ? body.posture : undefined)
      : (body.posture as Posture) || undefined
  let posture: Posture = postureOverride ?? 'green'
  let macroSnapshotId: string | null = null
  let postureSource = postureOverride ? 'request' : 'default'
  if (db) {
    const snap = await loadLatestSnapshot(db)
    if (!snap) return json(503, { error: MACRO_UNAVAILABLE })
    let snapshot = snap.snapshot
    if (snapshot && snapshotIsStale(snapshot)) {
      // A dead weekly cron must not keep applying a months-old posture; an
      // explicit request posture still keeps PREVIEWS working — the analyst
      // sees what they chose. decide never has an override, so recording
      // stays blocked (503) until the snapshot is refreshed.
      if (!postureOverride) return json(503, { error: MACRO_STALE })
      snapshot = null // never default from — or stamp — a stale snapshot
    }
    if (snapshot) {
      const p = snapshot.postures[fields.asset_class] ?? snapshot.postures['*']
      if (p && !postureOverride) {
        posture = p
        postureSource = 'macro_snapshot'
      }
      // Link the snapshot only when the effective posture IS the snapshot's
      // answer for this asset class — a manual what-if posture must not
      // record a snapshot reference it didn't use (audit/replay integrity).
      // decide always links here (no override), restoring the snapshot link
      // the old client-sent posture override used to break.
      if (!postureOverride || postureOverride === p) macroSnapshotId = snapshot.id
    }
  }

  // Draft configs (thresholds editor) apply to PREVIEWS only — a recorded
  // decision must reference a saved, replayable config version.
  if (body.configOverride && action === 'decide') {
    return json(400, { error: 'Draft configs cannot be recorded — save the config as a new version first' })
  }

  // The record handshake: refuse to write a ledger row the analyst never saw.
  // A config save between preview and record, or a macro cron/override moving
  // the posture mid-session, must surface as a 409 (naming both sides), never
  // silently record a different verdict than the one reviewed.
  if (action === 'decide' && db) {
    if (expectedConfigVersion !== undefined && expectedConfigVersion !== configVersion) {
      return json(409, {
        error: `The rulebook changed since this preview (reviewed under v${expectedConfigVersion}, active is v${configVersion}) — refresh and re-review before recording`,
      })
    }
    if (expectedPosture !== undefined && expectedPosture !== posture) {
      return json(409, {
        error: `The macro posture changed since this preview (reviewed under ${expectedPosture}, now ${posture}) — refresh and re-review before recording`,
      })
    }
  }

  const effectiveConfig: Gate1Config = body.configOverride ?? config
  const effectiveVersion = body.configOverride ? -1 : configVersion

  let payload: ReturnType<typeof computeGate1>
  try {
    payload = computeGate1(body, effectiveConfig, effectiveVersion, posture, postureSource, macroSnapshotId)
  } catch (e: any) {
    return json(400, { error: e?.message ?? 'Evaluation failed' })
  }
  const { baselineFull, result } = payload
  const baseline = baselineFull

  if (action === 'preview') return json(200, payload)

  // decide: persist the replayable ledger row.
  if (!db) {
    return json(200, { ...payload, persisted: false, warning: 'Supabase not configured — decision computed but NOT recorded' })
  }

  // Attribution only, never a gate: decide stays open to anonymous gate-cookie
  // users (no Bearer token → null, exactly the pre-auth rows) until Michael
  // flips the pilot fully to accounts.
  const identity = await identityFromRequest(req)

  // The ledger FK requires the stamped config version to exist as a ROW, but
  // version 0 is deploy-baked and never saved. Self-heal: on a fresh database
  // (no saved configs yet) insert version 0 so the first decision can record.
  if (configVersion === 0) {
    await db
      .from('threshold_configs')
      .upsert(
        { version: 0, author: 'system', note: 'deploy-baked default (auto-inserted so decisions can reference it)', config: DEFAULT_CONFIG },
        { onConflict: 'version', ignoreDuplicates: true },
      )
  }

  // Link (or create) the deal row so decisions build a browsable history.
  // Identity is EXPLICIT: the client passes back the dealId a prior decide
  // returned. A bare dealName always creates a NEW deals row — two distinct
  // projects may legally share a name, so cross-session accretion happens only
  // via the explicit id, never by name adoption.
  // Best-effort: a failed link never blocks the ledger write — the decision
  // still records, just orphaned (deal_id null), exactly as before.
  let dealId: string | null = null
  let linkable = true
  const requestedDealId = typeof body.dealId === 'string' ? body.dealId : null
  const dealName = typeof body.dealName === 'string' ? body.dealName.trim().slice(0, 200) : ''
  if (requestedDealId) {
    // Verify the row still exists — writing the ledger row against a deleted
    // deal would fail its FK and block the write.
    const { data: existing, error: lookupError } = await db
      .from('deals')
      .select('id')
      .eq('id', requestedDealId)
      .maybeSingle()
    if (lookupError) {
      // A failed lookup is NOT "gone" — creating a fresh deal here would
      // duplicate it on a transient blip. Skip linking; record orphaned.
      linkable = false
    } else if (existing) {
      dealId = existing.id
      // Link only — never overwrite an existing deal's identity or fields
      // from a decision; its inputs are already stored on the ledger row.
      await db.from('deals').update({ updated_at: new Date().toISOString() }).eq('id', dealId)
    }
    // else: the deal was deleted since the client stored its id — fall through
    // and create a fresh row, same as arriving with no id.
  }
  if (linkable && !dealId && dealName) {
    const location = typeof fields.location === 'string' && fields.location ? fields.location.slice(0, 200) : null
    const sponsor = typeof fields.sponsor_name === 'string' && fields.sponsor_name ? fields.sponsor_name.slice(0, 200) : null
    const { data: created } = await db
      .from('deals')
      .insert({ name: dealName, asset_class: String(fields.asset_class).slice(0, 50), location, sponsor, fields })
      .select('id')
      .single()
    dealId = created?.id ?? null
  }

  const { data: row, error } = await db
    .from('gate_decisions')
    .insert({
      deal_id: dealId,
      threshold_config_version: configVersion,
      macro_snapshot_id: macroSnapshotId,
      inputs: fields,
      overrides: adjustments,
      baseline_result: baseline,
      baseline_verdict: baseline.verdict,
      // Posture is stamped into the stored jsonb so the history list can show
      // it without a schema change (older rows simply read null).
      result: { ...result, posture },
      verdict: result.verdict,
      decided_by_email: identity?.email ?? null,
    })
    .select('id, created_at')
    .single()
  if (error) return json(500, { error: `Failed to record decision: ${error.message}` })

  // Wave-A follow-through: the client minted extractionId at upload time (the
  // uuid PK of the persisted extractions row — see extract-run-background.ts)
  // and passes it back on decide. Now that the decision resolved a deal, stamp
  // that row's deal_id so the stored fields/citations stay traceable to the
  // deal after browser state is gone. Best-effort BY CONTRACT: the ledger row
  // above is already written, and an absent id (the recorded sample carries
  // none), a non-UUID id (never persisted under its own PK), a deleted row, or
  // a failed update must never fail the decide response.
  const extractionId =
    typeof body.extractionId === 'string' && UUID_RE.test(body.extractionId) ? body.extractionId : null
  if (dealId && extractionId) {
    try {
      await db.from('extractions').update({ deal_id: dealId }).eq('id', extractionId)
    } catch { /* best effort — never blocks the ledger write */ }
  }

  // dealId goes back to the client, which stores it and passes it on the next
  // decide — the explicit identity that keeps a deal's history on one row.
  return json(200, { ...payload, persisted: true, decisionId: row.id, decidedAt: row.created_at, dealId })
}

export const config: Config = {
  path: ['/api/gate1/preview', '/api/gate1/preview-batch', '/api/gate1/decide', '/api/gate1/decisions', '/api/gate1/decisions/:id'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
