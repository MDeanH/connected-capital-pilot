// Deal CRUD — thin persistence layer over Supabase (service key, server-only).
//   GET  /api/deals        → list (newest first)
//   POST /api/deals        → create { name, asset_class, location?, sponsor?, fields }
//   GET  /api/deals/:id    → one deal
//   PATCH /api/deals/:id   → update fields/status
import type { Config, Context } from '@netlify/functions'
import { requireAccount, requireAdmin } from './lib/auth.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

// Postgres error strings name tables/columns/constraints — never surface them.
// Log the raw message server-side; hand the client a generic, operation-scoped
// one. PostgREST resolves errors as { error }, so `error` here never threw.
const dbFail = (clientMsg: string, error: { message?: string }, where: string): Response => {
  console.error(`deals: ${where} failed — ${error?.message ?? 'unknown error'}`)
  return json(500, { error: clientMsg })
}

export default async (req: Request, context: Context): Promise<Response> => {
  const db = serviceClient()
  if (!db) return json(503, { error: 'Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' })

  // Data-surface identity gate. A no-op unless accounts are switched on
  // (REQUIRE_ACCOUNTS=1 with Supabase configured — Michael's call); then every
  // deal read/write demands a valid, non-disabled identity, so disabling a user
  // revokes their access. DELETE re-checks via requireAdmin below (stricter).
  const access = await requireAccount(req)
  if (access.response) return access.response

  const id = (context.params as any)?.id as string | undefined

  if (req.method === 'GET' && !id) {
    const { data, error } = await db
      .from('deals')
      .select('id, name, asset_class, location, sponsor, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200)
    return error ? dbFail('Could not load deals — try again', error, 'GET list') : json(200, { deals: data })
  }

  if (req.method === 'GET' && id) {
    const { data, error } = await db.from('deals').select('*').eq('id', id).maybeSingle()
    if (error) return dbFail('Could not load the deal — try again', error, 'GET by id')
    return data ? json(200, data) : json(404, { error: 'Deal not found' })
  }

  if (req.method === 'DELETE' && id) {
    const gate = await requireAdmin(req)
    if (gate.response) return gate.response
    // Deleting a deal removes its recorded decisions with it — a deliberate,
    // gated admin action (the UI double-confirms). Extraction telemetry keeps
    // its rows but drops the link; staged documents rows go with the deal.
    // One transaction (delete_deal RPC, migration 0003) — a partial failure
    // can never strand the deal after its ledger rows are gone.
    const { data: decisions, error } = await db.rpc('delete_deal', { p_deal_id: id })
    if (error) {
      // P0002 = the function's "deal not found" raise
      return error.code === 'P0002' ? json(404, { error: 'Deal not found' }) : dbFail('Could not delete the deal — try again', error, 'DELETE')
    }
    return json(200, { ok: true, decisionsDeleted: decisions ?? 0 })
  }

  let body: any = {}
  try {
    body = JSON.parse((await req.text()) || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (req.method === 'POST' && !id) {
    if (!body.name || !body.asset_class) return json(400, { error: 'name and asset_class required' })
    const { data, error } = await db
      .from('deals')
      .insert({
        name: String(body.name).slice(0, 200),
        asset_class: String(body.asset_class).slice(0, 50),
        location: body.location ? String(body.location).slice(0, 200) : null,
        sponsor: body.sponsor ? String(body.sponsor).slice(0, 200) : null,
        fields: body.fields ?? {},
      })
      .select('id')
      .single()
    return error ? dbFail('Could not create the deal — try again', error, 'POST') : json(201, { id: data.id })
  }

  if (req.method === 'PATCH' && id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.fields !== undefined) patch.fields = body.fields
    if (body.status !== undefined) patch.status = String(body.status).slice(0, 40)
    if (body.name !== undefined) patch.name = String(body.name).slice(0, 200)
    // Ask for the matched row back: Supabase's update matches zero rows
    // WITHOUT error, so a valid-but-nonexistent id (e.g. a concurrently
    // deleted deal) used to return ok:true and the client believed the edit
    // persisted. No row back → 404, same shape as GET /deals/:id.
    const { data, error } = await db.from('deals').update(patch).eq('id', id).select('id').maybeSingle()
    if (error) return dbFail('Could not update the deal — try again', error, 'PATCH')
    return data ? json(200, { ok: true }) : json(404, { error: 'Deal not found' })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: ['/api/deals', '/api/deals/:id'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
