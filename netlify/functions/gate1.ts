// Gate 1 API — the engine's only public surface.
//   POST /api/gate1/preview  → stateless evaluate (live UI)
//   POST /api/gate1/decide   → evaluate + persist an append-only, replayable decision row
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

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const url = new URL(req.url)
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
      macroSnapshotId = data.id
    }
  }

  let payload: ReturnType<typeof computeGate1>
  try {
    payload = computeGate1(body, config, configVersion, posture, postureSource, macroSnapshotId)
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
  const { data: row, error } = await db
    .from('gate_decisions')
    .insert({
      deal_id: body.dealId ?? null,
      threshold_config_version: configVersion,
      macro_snapshot_id: macroSnapshotId,
      inputs: fields,
      overrides: adjustments,
      baseline_result: baseline,
      baseline_verdict: baseline.verdict,
      result,
      verdict: result.verdict,
    })
    .select('id, created_at')
    .single()
  if (error) return json(500, { error: `Failed to record decision: ${error.message}` })
  return json(200, { ...payload, persisted: true, decisionId: row.id, decidedAt: row.created_at })
}

export const config: Config = {
  path: ['/api/gate1/preview', '/api/gate1/decide'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
