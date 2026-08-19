// Gate 1 API — the engine's only public surface.
//   POST /api/gate1/preview    → stateless evaluate (live UI)
//   POST /api/gate1/decide     → evaluate + persist an append-only, replayable decision row
//   GET  /api/gate1/decisions  → the recorded ledger, newest first (deal history)
//
// Every decision is stamped with the threshold-config version and macro snapshot
// so it can be replayed exactly. Judgment adjustments require a reason (enforced
// in resolveThresholds); `decide` stores BOTH the baseline result (config +
// posture only) and the adjusted result — manual control is never silent.

import type { Config, Context } from '@netlify/functions'
import { computeGate1, DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { DealFields, Gate1Config, JudgmentAdjustment, Posture } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

type Db = NonNullable<ReturnType<typeof serviceClient>>

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

/** First invalid field name, or null when every present numeric is finite and >= 0. */
function invalidField(fields: DealFields): string | null {
  for (const key of NON_NEGATIVE_FIELDS) {
    const v = fields[key]
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) return key
  }
  return null
}

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

/** Latest macro snapshot — best-effort: null on error or an empty table. */
async function loadLatestSnapshot(db: Db): Promise<{ id: string; postures: Record<string, Posture> } | null> {
  const { data } = await db
    .from('macro_snapshots')
    .select('id, postures')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { id: data.id as string, postures: data.postures as Record<string, Posture> } : null
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
  let snapshot: Awaited<ReturnType<typeof loadLatestSnapshot>> = null
  if (db) {
    const active = await loadActiveConfig(db)
    if (!active) return json(503, { error: RULEBOOK_UNAVAILABLE })
    config = active.config
    configVersion = active.version
    snapshot = await loadLatestSnapshot(db)
  }

  const requested: Posture | undefined = body.posture || undefined
  const results = rows.map((raw: unknown) => {
    const fields = raw as DealFields
    if (!fields || typeof fields !== 'object' || !fields.asset_class) {
      return { error: 'Missing deal fields (asset_class required)' }
    }
    const badField = invalidField(fields)
    if (badField) return { error: `${badField} must be a non-negative number` }
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
  const badField = invalidField(fields)
  if (badField) return json(400, { error: `${badField} must be a non-negative number` })
  const adjustments: JudgmentAdjustment[] = Array.isArray(body.adjustments) ? body.adjustments : []

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

  // Posture: latest macro snapshot for this asset class; request override; else green.
  let posture: Posture = (body.posture as Posture) || 'green'
  let macroSnapshotId: string | null = null
  let postureSource = body.posture ? 'request' : 'default'
  if (db) {
    const snapshot = await loadLatestSnapshot(db)
    if (snapshot) {
      const p = snapshot.postures[fields.asset_class] ?? snapshot.postures['*']
      if (p && !body.posture) {
        posture = p
        postureSource = 'macro_snapshot'
      }
      // Link the snapshot only when the effective posture IS the snapshot's
      // answer for this asset class — a manual what-if posture must not
      // record a snapshot reference it didn't use (audit/replay integrity).
      if (!body.posture || body.posture === p) macroSnapshotId = snapshot.id
    }
  }

  // Draft configs (thresholds editor) apply to PREVIEWS only — a recorded
  // decision must reference a saved, replayable config version.
  if (body.configOverride && action === 'decide') {
    return json(400, { error: 'Draft configs cannot be recorded — save the config as a new version first' })
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
  // Best-effort: a failed link never blocks the ledger write — the decision
  // still records, just orphaned (deal_id null), exactly as before.
  let dealId: string | null = typeof body.dealId === 'string' ? body.dealId : null
  const dealName = typeof body.dealName === 'string' ? body.dealName.trim().slice(0, 200) : ''
  if (!dealId && dealName) {
    const location = typeof fields.location === 'string' && fields.location ? fields.location.slice(0, 200) : null
    const sponsor = typeof fields.sponsor_name === 'string' && fields.sponsor_name ? fields.sponsor_name.slice(0, 200) : null
    const { data: existing, error: lookupError } = await db
      .from('deals')
      .select('id')
      .eq('name', dealName)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (lookupError) {
      // A failed lookup is NOT "not found" — inserting here would duplicate the
      // deal on a transient blip. Skip linking; the decision records orphaned.
    } else if (existing) {
      dealId = existing.id
      // Link only — never overwrite an existing deal's identity or fields
      // from a decision. Two distinct deals can legally share a name, and the
      // decision's own inputs are already stored on the ledger row.
      await db.from('deals').update({ updated_at: new Date().toISOString() }).eq('id', dealId)
    } else {
      const { data: created } = await db
        .from('deals')
        .insert({ name: dealName, asset_class: String(fields.asset_class).slice(0, 50), location, sponsor, fields })
        .select('id')
        .single()
      dealId = created?.id ?? null
    }
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
    })
    .select('id, created_at')
    .single()
  if (error) return json(500, { error: `Failed to record decision: ${error.message}` })
  return json(200, { ...payload, persisted: true, decisionId: row.id, decidedAt: row.created_at })
}

export const config: Config = {
  path: ['/api/gate1/preview', '/api/gate1/preview-batch', '/api/gate1/decide', '/api/gate1/decisions', '/api/gate1/decisions/:id'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
