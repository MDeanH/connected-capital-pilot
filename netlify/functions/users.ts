// Users API — admin-only account management (Supabase Auth + profiles roles).
//   GET   /api/users      → list profiles
//   POST  /api/users      → create { email, password, role } (auth user + profile, atomic-ish)
//   PATCH /api/users/:id  → update { role?, disabled? } with lockout guards
//
// No DELETE by design: audit trails (gate_decisions.decided_by_email,
// threshold_configs.author, macro_snapshots.author_email) reference emails —
// disable an account instead. There is no self-signup; this API is the only
// way users are created (plus the BOOTSTRAP_ADMIN_EMAIL first admin).

import type { Config, Context } from '@netlify/functions'
import { requireAdmin } from './lib/auth.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const ROLES = ['admin', 'analyst'] as const
type Role = (typeof ROLES)[number]

// Only rejects obvious non-addresses — Supabase Auth is the real arbiter.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10

export default async (req: Request, context: Context): Promise<Response> => {
  // EVERY method is admin-only. With auth unconfigured (public demo) the gate
  // waves through and the db check answers 503 — same as every persistence API.
  const gate = await requireAdmin(req)
  if (gate.response) return gate.response
  const db = serviceClient()
  if (!db) return json(503, { error: 'Persistence not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' })

  const id = (context.params as any)?.id as string | undefined

  if (req.method === 'GET' && !id) {
    const { data, error } = await db
      .from('profiles')
      .select('id, email, role, disabled, created_at')
      .order('created_at', { ascending: true })
    return error ? json(500, { error: error.message }) : json(200, { users: data })
  }

  let body: any = {}
  try {
    body = JSON.parse((await req.text()) || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (req.method === 'POST' && !id) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_SHAPE.test(email)) return json(400, { error: 'A valid email is required' })
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
      return json(400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
    }
    if (!ROLES.includes(body.role)) return json(400, { error: `role must be one of ${ROLES.join(', ')}` })
    const role: Role = body.role

    // email_confirm: the admin vouches for the address — there is no signup
    // flow to deliver a confirmation link through.
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    })
    if (createError || !created?.user) {
      // Supabase answers 422 for an already-registered email — pass its status
      // through rather than flattening a caller mistake into a server fault.
      const status = createError?.status && createError.status >= 400 ? createError.status : 500
      return json(status, { error: createError?.message ?? 'Failed to create auth user' })
    }
    const { error: profileError } = await db.from('profiles').insert({ id: created.user.id, email, role })
    if (profileError) {
      // No orphans: an auth user without a profile could never sign in usefully
      // yet would block re-creating the email — best-effort roll back.
      await db.auth.admin.deleteUser(created.user.id).catch(() => {})
      return json(500, { error: `Failed to create profile: ${profileError.message}` })
    }
    return json(201, { id: created.user.id, email, role, disabled: false })
  }

  if (req.method === 'PATCH' && id) {
    const patch: { role?: Role; disabled?: boolean } = {}
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) return json(400, { error: `role must be one of ${ROLES.join(', ')}` })
      patch.role = body.role
    }
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') return json(400, { error: 'disabled must be a boolean' })
      patch.disabled = body.disabled
    }
    if (patch.role === undefined && patch.disabled === undefined) {
      return json(400, { error: 'Nothing to update — pass role and/or disabled' })
    }

    // Lockout guards live in the database (update_profile_guarded, migration
    // 0005): one transaction locks the profiles rows, re-checks the guards
    // under the lock, then applies the update — so two admins concurrently
    // demoting/disabling each other can no longer both pass a stale count and
    // leave zero enabled admins.
    const { error } = await db.rpc('update_profile_guarded', {
      p_id: id,
      p_actor: gate.identity?.id ?? null,
      p_role: patch.role ?? null,
      p_disabled: patch.disabled ?? null,
    })
    if (error) {
      // Errcodes raised by the function — same convention as delete_deal (0003).
      if (error.code === 'P0002') return json(404, { error: 'User not found' })
      if (error.code === 'AD001') {
        return json(409, { error: 'You cannot disable or demote your own account — ask another admin' })
      }
      if (error.code === 'AD002') {
        return json(409, { error: 'This is the only enabled admin — promote another admin first' })
      }
      return json(500, { error: error.message })
    }
    return json(200, { ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: ['/api/users', '/api/users/:id'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
