// Identity + role enforcement. Conditional activation: unless AUTH_ENABLED=1
// with Supabase configured (see authConfigured) there is no identity and no
// enforcement — the require* gates return { identity: null } and callers
// proceed exactly as before.
//
// Only "Bearer <supabase jwt>" Authorization values are acted on; anything
// else is silently ignored here, never an error.
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

/**
 * Login is OPT-IN: the whole identity layer (sign-in, account wall, admin-only
 * actions) is active only when AUTH_ENABLED=1 AND Supabase is configured.
 * Without AUTH_ENABLED the app runs login-free — every gate waves through as
 * { identity: null } and the SPA shows all controls (the 'auth-off' mode) —
 * while persistence still uses Supabase through serviceClient(), which keys
 * off its own env vars, not this switch. Turned off for the client prototype
 * (2026-09-28, Michael: "remove all login requirements").
 */
export function authConfigured(): boolean {
  return process.env.AUTH_ENABLED === '1'
    && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Three-state resolution of the request's Bearer JWT — the shape the require*
 * gates need to tell a transient failure apart from a genuine absence:
 *
 *  - { identity }        a verified, enabled identity (incl. the bootstrapped
 *                        first admin).
 *  - { identity: null }  genuinely anonymous / no enforcement: auth not
 *                        configured, a missing/non-Bearer header, an invalid or
 *                        expired token, a disabled profile, or a genuinely
 *                        absent profile (no row).
 *  - { indeterminate }   a TRANSIENT backend failure: the profiles read errored
 *                        while the JWT itself is valid. The caller must answer
 *                        5xx (503) so the client's bounded retry re-attempts —
 *                        answering 401 here would flash a valid admin as "no
 *                        access", because probeRoleOnce (src/auth.ts) treats any
 *                        <500 status as a DEFINITIVE verdict and does not retry.
 *
 * The one self-healing case: a verified user with no profile whose email matches
 * BOOTSTRAP_ADMIN_EMAIL becomes the first admin. Never throws on bad input.
 */
type ResolvedIdentity =
  | { identity: Identity | null; indeterminate?: never }
  | { indeterminate: true; identity?: never }

/**
 * Tell a TRANSIENT getUser() failure (retry) apart from a genuine token verdict
 * (sign in again). supabase-js resolves both as a returned { error }: an
 * AuthError whose `status` is the HTTP status of the auth backend's response, or
 * 0/undefined when the request never reached it (a network failure — see
 * AuthRetryableFetchError, constructed with status 0). A 5xx or a zero/absent
 * status is transport failure → retryable; a 4xx (401/403/400 — the
 * invalid/expired/malformed-token verdicts) is definitive → not retryable.
 */
const getUserErrorIsRetryable = (error: { status?: number } | null | undefined): boolean => {
  const status = error?.status
  return typeof status !== 'number' || status === 0 || status >= 500
}

async function resolveIdentity(req: Request): Promise<ResolvedIdentity> {
  const db = serviceClient()
  if (!db) return { identity: null }
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return { identity: null }
  const token = header.slice('Bearer '.length).trim()
  if (!token) return { identity: null }

  let userId: string
  let email: string
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error) {
      // Mirror the profiles-read handling: a RETRYABLE getUser failure (network
      // / auth backend 5xx) is a transient transport error, not a token verdict.
      // Surface it as indeterminate so the gate answers 503 and the client's
      // bounded retry re-attempts, instead of flashing a valid session as
      // "sign in required" (a false 401). A genuine invalid/expired JWT (4xx)
      // stays a definitive absence → { identity: null } → 401.
      if (getUserErrorIsRetryable(error)) return { indeterminate: true }
      return { identity: null }
    }
    // A verified user without an email can never match a profile — treat as anonymous.
    if (!data.user?.email) return { identity: null }
    userId = data.user.id
    email = data.user.email
  } catch {
    // supabase-js normally resolves { error }, but a DNS/socket failure can still
    // throw — a transport failure, not a token verdict, so indeterminate (503 →
    // retry), never a false 401.
    return { indeterminate: true }
  }

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, role, disabled')
    .eq('id', userId)
    .maybeSingle()
  // TRANSIENT failure, not a verdict: the JWT is valid but the profiles read
  // errored (PostgREST resolves { data, error } — it never throws). Surface it
  // as indeterminate so the gate answers 503 and the client retries, instead of
  // flattening a DB hiccup into a false 401 that locks a valid admin out until
  // reload. A genuinely absent profile is { data: null, error: null } and falls
  // through to the bootstrap check below.
  if (profileError) return { indeterminate: true }
  if (profile) {
    if (profile.disabled) return { identity: null }
    return { identity: { id: profile.id, email: profile.email, role: profile.role } }
  }

  const bootstrap = process.env.BOOTSTRAP_ADMIN_EMAIL
  if (!bootstrap || bootstrap.trim().toLowerCase() !== email.toLowerCase()) return { identity: null }
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
    if (!raced || raced.disabled) return { identity: null }
    return { identity: { id: raced.id, email: raced.email, role: raced.role } }
  }
  return { identity: { id: created.id, email: created.email, role: created.role } }
}

/**
 * The verified identity behind the request's Bearer JWT, or null. This is the
 * attribution-only view (stamping who decided/authored a row): a transient
 * profiles-query failure is flattened to null here, exactly as before — a failed
 * read just yields an unattributed row, never a blocked write. The require*
 * GATES call resolveIdentity directly instead, so they can answer 503 (retry)
 * rather than 401 (sign in) on that transient case. Never throws on bad input.
 */
export async function identityFromRequest(req: Request): Promise<Identity | null> {
  const resolved = await resolveIdentity(req)
  return resolved.indeterminate ? null : resolved.identity
}

/** Sign-in gate. With auth unconfigured it waves everything through as { identity: null }. */
export async function requireIdentity(req: Request): Promise<AuthGate> {
  if (!authConfigured()) return { identity: null }
  const resolved = await resolveIdentity(req)
  // A transient backend failure is answered 503 (indeterminate → the client's
  // bounded retry re-attempts); a genuine absence of identity is 401. Both are
  // distinct from the auth-unconfigured no-op handled above.
  if (resolved.indeterminate) {
    return { response: json(503, { error: 'Sign-in check temporarily unavailable' }) }
  }
  if (!resolved.identity) return { response: json(401, { error: 'Sign in required' }) }
  return { identity: resolved.identity }
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

/**
 * Whether per-identity enforcement is switched on for the shared data surface.
 * Both conditions are required: Supabase must be configured (so identities
 * exist at all) AND REQUIRE_ACCOUNTS must be '1'.
 *
 * Turning this ON is Michael's decision and PRESUPPOSES a working sign-in path:
 * with it on, every gated data endpoint 401s without a valid Bearer JWT. With
 * it OFF (the default) the pilot stays open to anonymous gate-cookie holders
 * and the public db-null build is untouched.
 */
export function accountsRequired(): boolean {
  return authConfigured() && process.env.REQUIRE_ACCOUNTS === '1'
}

/**
 * Data-surface identity gate. A no-op — { identity: null }, exact legacy
 * behavior — unless accounts are switched on (accountsRequired()); then it
 * demands a valid, non-disabled identity. Because identityFromRequest rejects
 * a disabled profile, enabling accounts makes "disable a user" immediately
 * revoke that user's read/write access. Shared by the deals CRUD, the macro
 * reads, and the gate1 decisions/decide surface — the one place the flag is
 * consulted, so all three stay in lockstep.
 */
export async function requireAccount(req: Request): Promise<AuthGate> {
  if (!accountsRequired()) return { identity: null }
  return requireIdentity(req)
}
