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

async function listDecisions(): Promise<Response> {
  const db = serviceClient()
  if (!db) return json(503, { error: 'Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' })
  const { data, error } = await db
    .from('gate_decisions')
    .select(
      'id, created_at, deal_id, verdict, baseline_verdict, threshold_config_version, overrides, ' +
        'kills:result->kills, flag_pts:result->flagPoints, posture:result->>posture, ' +
        'input_name:inputs->>deal_name, deals(name)',
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return json(500, { error: error.message })
  const decisions = (data ?? []).map((r: any) => ({
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
  return json(200, { decisions })
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
    return listDecisions()
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const action = url.pathname.endsWith('/decide') ? 'decide' : 'preview'

  let body: any
  try {
    body = JSON.parse((await req.text()) || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const fields = body.fields as DealFields | undefined
  if (!fields || typeof fields !== 'object' || !fields.asset_class) {
    return json(400, { error: 'Missing deal fields (asset_class required)' })
  }
  const adjustments: JudgmentAdjustment[] = Array.isArray(body.adjustments) ? body.adjustments : []

  const db = serviceClient()

  // Active config: highest Supabase version, else the shipped default (version 0).
  let config: Gate1Config = DEFAULT_CONFIG
  let configVersion = 0
  if (db) {
    const { data } = await db
      .from('threshold_configs')
      .select('version, config')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      config = data.config as Gate1Config
      configVersion = data.version
    }
  }

  // Posture: latest macro snapshot for this asset class; request override; else green.
  let posture: Posture = (body.posture as Posture) || 'green'
  let macroSnapshotId: string | null = null
  let postureSource = body.posture ? 'request' : 'default'
  if (db) {
    const { data } = await db
      .from('macro_snapshots')
      .select('id, postures')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      const p = (data.postures as Record<string, Posture>)[fields.asset_class] ?? (data.postures as any)['*']
      if (p && !body.posture) {
        posture = p
        postureSource = 'macro_snapshot'
      }
      // Link the snapshot only when the effective posture IS the snapshot's
      // answer for this asset class — a manual what-if posture must not
      // record a snapshot reference it didn't use (audit/replay integrity).
      if (!body.posture || body.posture === p) macroSnapshotId = data.id
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
  path: ['/api/gate1/preview', '/api/gate1/decide', '/api/gate1/decisions', '/api/gate1/decisions/:id'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
