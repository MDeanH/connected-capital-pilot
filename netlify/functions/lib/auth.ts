// Identity + role enforcement — the inner auth layer behind the shared-password
// edge gate. Conditional activation: when Supabase is not configured (the
// public demo site) there is no identity and no enforcement — the require*
// gates return { identity: null } and callers proceed exactly as before.
//
// The Authorization header is shared with the edge gate: the gate acts only on
// "Basic ..." credentials while the SPA sends "Bearer <supabase jwt>", so
// anything that is not a Bearer token is silently ignored here, never an error.
import { serviceClient } from './supabase.ts'

export interface Identity {
  id: string
  email: string
  role: 'admin' | 'analyst'
}

/** One arm always empty: a gate either yields an identity or a ready-to-return error Response. */
export type AuthGate =
  | { identity: Identity | null; response?: never }
  | { identity?: never; response: Response }

export function authConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * The verified identity behind the request's Bearer JWT, or null — null covers
 * auth not configured, a missing/non-Bearer Authorization header, an invalid
 * or expired token, a disabled profile, and a missing profile. The one
 * self-healing case: a verified user with no profile whose email matches
 * BOOTSTRAP_ADMIN_EMAIL becomes the first admin. Never throws on bad input.
 */
export async function identityFromRequest(req: Request): Promise<Identity | null> {
  const db = serviceClient()
  if (!db) return null
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  let userId: string
  let email: string
  try {
    const { data, error } = await db.auth.getUser(token)
    // A verified user without an email can never match a profile — treat as anonymous.
    if (error || !data.user?.email) return null
    userId = data.user.id
    email = data.user.email
  } catch {
    return null
  }

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, role, disabled')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) return null
  if (profile) {
    if (profile.disabled) return null
    return { id: profile.id, email: profile.email, role: profile.role }
  }

  const bootstrap = process.env.BOOTSTRAP_ADMIN_EMAIL
  if (!bootstrap || bootstrap.trim().toLowerCase() !== email.toLowerCase()) return null
  const { data: created, error: insertError } = await db
    .from('profiles')
    .insert({ id: userId, email, role: 'admin' })
    .select('id, email, role')
    .single()
  if (insertError || !created) {
    // A concurrent first request can win the insert (duplicate key) — re-read
    // rather than lock the bootstrap admin out of their first click.
    const { data: raced } = await db
      .from('profiles')
      .select('id, email, role, disabled')
      .eq('id', userId)
      .maybeSingle()
    if (!raced || raced.disabled) return null
    return { id: raced.id, email: raced.email, role: raced.role }
  }
  return { id: created.id, email: created.email, role: created.role }
}

/** Sign-in gate. With auth unconfigured it waves everything through as { identity: null }. */
export async function requireIdentity(req: Request): Promise<AuthGate> {
  if (!authConfigured()) return { identity: null }
  const identity = await identityFromRequest(req)
  if (!identity) return { response: json(401, { error: 'Sign in required' }) }
  return { identity }
}

/** Admin gate — requireIdentity plus role === 'admin' (or auth unconfigured). */
export async function requireAdmin(req: Request): Promise<AuthGate> {
  const gate = await requireIdentity(req)
  if (gate.response || gate.identity === null) return gate
  if (gate.identity.role !== 'admin') {
    return { response: json(403, { error: 'Admin access required' }) }
  }
  return gate
}
