// Browser-side identity — the SPA half of the inner auth layer. Conditional
// activation mirrors the server: when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are absent at build time (the public demo site) `supabase` is null, no auth
// UI renders, authFetch degrades to plain fetch, and every surface behaves
// exactly as before.
//
// Role is inferred, not stored client-side: one probe of GET /api/users after
// sign-in — 200 means admin, 403 means analyst (signed in, not admin) — cached
// per user for the page's lifetime. Transient probe failures (network error,
// 5xx) get a bounded retry before settling. The server re-checks every
// enforced call, so this only decides what UI to show.
import { useEffect, useState } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when auth is not configured on this build — the whole feature renders nothing. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

// The build keys alone do not prove the SERVER runs its auth layer: the VITE_
// keys are committed, so even the public demo build (whose server has no
// SUPABASE_SERVICE_ROLE_KEY and waves every gate through) constructs a client.
// One probe of GET /api/auth/status per page load resolves the server's side.
//
// Only a real 200 settles the verdict (enabled true/false). A transport failure
// or a transient non-OK must NEVER latch a definitive false — that would hide
// the sign-in card on an auth-enabled deploy until a full reload. Those retry
// with bounded backoff (the same idiom as the role probe below) and, once the
// budget is spent with no 200, resolve to null (INDETERMINATE — authEnabled
// stays null and the auth UI stays hidden rather than wrongly settled) without
// caching, so the next mount probes afresh. A clean 200 saying disabled still
// resolves false, preserving the auth-unconfigured happy path.
let serverAuthPromise: Promise<boolean | null> | null = null

// Up to 3 attempts total — mirrors the role probe's PROBE_RETRY_DELAYS_MS.
const STATUS_RETRY_DELAYS_MS = [1_000, 4_000]

async function statusProbeOnce(): Promise<{ enabled: boolean | null; definitive: boolean }> {
  try {
    const r = await fetch('/api/auth/status')
    if (!r.ok) return { enabled: null, definitive: false } // transient non-OK — retry
    const d = (await r.json()) as { enabled?: unknown }
    return { enabled: d.enabled === true, definitive: true }
  } catch {
    return { enabled: null, definitive: false } // network error — transient
  }
}

function serverAuthEnabled(): Promise<boolean | null> {
  if (!serverAuthPromise) {
    serverAuthPromise = (async () => {
      for (let attempt = 0; ; attempt++) {
        const { enabled, definitive } = await statusProbeOnce()
        if (definitive) return enabled
        if (attempt >= STATUS_RETRY_DELAYS_MS.length) {
          // No definitive answer within the retry budget — do not cache a
          // verdict; drop the memo so the next mount retries from scratch.
          serverAuthPromise = null
          return null
        }
        await sleep(STATUS_RETRY_DELAYS_MS[attempt])
      }
    })()
  }
  return serverAuthPromise
}

export type Role = 'admin' | 'analyst'

/**
 * Admin visibility flag passed down to gated UI: 'auth-off' preserves legacy
 * visibility (auth not configured — render exactly as today), true shows
 * admin controls, false hides them. Gate with `isAdmin !== false`.
 */
export type AdminFlag = boolean | 'auth-off'

/**
 * localStorage keys holding an analyst's confidential working state (deal
 * intake draft, rulebook draft) and the pending-extraction record (an
 * extraction id which, polled, returns the extracted fields). Owned here so
 * signOut can clear them and the intake surfaces can stamp/gate them from one
 * definition — the payloads are origin-wide, so on a shared browser they must
 * never outlive the account that wrote them.
 */
export const INTAKE_STATE_KEY = 'cc_deal_intake_v1'
export const CONFIG_DRAFT_KEY = 'cc_config_draft_v1'
export const PENDING_EXTRACTION_KEY = 'cc_pending_extraction_v1'

export interface IdentityState {
  /** False only while the initial session restore / role probe is in flight. */
  ready: boolean
  /**
   * True once the initial session restore settled (immediately when auth is
   * unconfigured) — the earliest point at which userId is definitive. Unlike
   * `ready` it does NOT wait for the role probe (a network call), so state
   * keyed to the user's identity can hydrate without that extra round trip.
   */
  sessionReady: boolean
  /** Signed-in email, or null when signed out (or auth unconfigured). */
  email: string | null
  /** Signed-in Supabase user id, or null when signed out (or auth unconfigured). */
  userId: string | null
  /** Resolved role; null while signed out, probing, or when the account has no active profile. */
  role: Role | null
  /**
   * Combined auth activation: true only when this build has Supabase keys AND
   * the server reports its auth layer enabled (GET /api/auth/status) — the
   * committed VITE_ keys alone must never activate auth UI on a deployment
   * whose server runs auth-off. False when either half is off; null while the
   * status probe is in flight (hide auth UI until known — never flash it).
   */
  authEnabled: boolean | null
}

// One probe per user per page load; only definite verdicts are cached so a
// transient failure (offline, 5xx) retries on the next mount.
const roleCache = new Map<string, Role>()

// A transient blip (network error, 5xx) must not settle the identity as
// NO ACCESS for the rest of the page's life, so the probe retries those with
// bounded backoff. Definitive server answers (200 admin, 403 analyst, and any
// other <500 status — e.g. 401 no active profile) settle immediately.
const PROBE_RETRY_DELAYS_MS = [1_000, 4_000] // up to 3 attempts total

async function probeRoleOnce(token: string): Promise<{ verdict: Role | null; definitive: boolean }> {
  try {
    const r = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
    return r.status === 200 ? { verdict: 'admin', definitive: true }
      : r.status === 403 ? { verdict: 'analyst', definitive: true }
      : { verdict: null, definitive: r.status < 500 }
  } catch {
    return { verdict: null, definitive: false } // network error — transient
  }
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))

/**
 * Probe with bounded retry: transient failures retry after 1s then 4s; once
 * the delays are exhausted the null verdict settles exactly as a single failed
 * probe always did. `isCancelled` is checked between steps so a sign-out (or
 * token change) mid-retry stops the loop instead of probing with a dead token —
 * the caller's .then additionally ignores any late resolution.
 */
async function probeRole(token: string, isCancelled: () => boolean): Promise<Role | null> {
  for (let attempt = 0; ; attempt++) {
    const { verdict, definitive } = await probeRoleOnce(token)
    if (definitive || attempt >= PROBE_RETRY_DELAYS_MS.length || isCancelled()) return verdict
    await sleep(PROBE_RETRY_DELAYS_MS[attempt])
    if (isCancelled()) return verdict
  }
}

/** Session + role, live across sign-in/out. Inert (ready, all-null) when auth is unconfigured. */
export function useIdentity(): IdentityState {
  const [session, setSession] = useState<Session | null>(null)
  const [restored, setRestored] = useState(supabase === null)
  const [role, setRole] = useState<Role | null>(null)
  const [probing, setProbing] = useState(false)
  // Without client keys auth can never be active — settle false with no probe.
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(supabase === null ? false : null)

  useEffect(() => {
    if (!supabase) return
    let cancelledStatus = false
    serverAuthEnabled().then(enabled => {
      if (!cancelledStatus) setAuthEnabled(enabled)
    })
    return () => {
      cancelledStatus = true
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setRestored(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setRestored(true)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null
  const token = session?.access_token ?? null

  useEffect(() => {
    if (!userId || !token) {
      setRole(null)
      // A sign-out can land while the role probe is still in flight: the
      // probe's .then is cancelled and never resets the flag, so reset it
      // here too — otherwise `ready` stays false forever and the sign-in
      // form (gated on ready) never renders again until a reload.
      setProbing(false)
      return
    }
    const cached = roleCache.get(userId)
    if (cached !== undefined) {
      setRole(cached)
      // Defensive: the role for this identity is settled, so never leave a
      // stale in-flight flag behind this early return either.
      setProbing(false)
      return
    }
    let cancelled = false
    setProbing(true)
    probeRole(token, () => cancelled).then(resolved => {
      if (cancelled) return
      if (resolved !== null) roleCache.set(userId, resolved)
      setRole(resolved)
      setProbing(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, token])

  return {
    ready: restored && !probing,
    sessionReady: restored,
    email: session?.user?.email ?? null,
    userId,
    role: userId ? role : null,
    authEnabled,
  }
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(raw, window.location.origin)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/**
 * fetch that carries the signed-in session's Bearer token on same-origin /api/
 * requests — the edge gate ignores non-Basic Authorization values, so the JWT
 * passes through cleanly. Signed out (or auth unconfigured) it is plain fetch,
 * byte-for-byte the request the app sent before auth existed.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (supabase && isSameOriginApi(input)) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    }
  }
  return fetch(input, init)
}

/** Email/password sign-in. Returns null on success, a display-ready message on failure. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Auth is not configured on this build'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ? error.message : null
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  // Roles can change between sessions (promotion, disable) — never carry a
  // verdict across a sign-out.
  roleCache.clear()
  // The intake draft, config draft and pending-extraction record are this
  // analyst's confidential working state — clear them outright so the next
  // account (or a signed-out visitor) on a shared browser never sees the
  // deal, appends decisions to it, or polls the extraction's fields.
  for (const k of [INTAKE_STATE_KEY, CONFIG_DRAFT_KEY, PENDING_EXTRACTION_KEY]) {
    try {
      localStorage.removeItem(k)
    } catch { /* storage blocked — non-fatal */ }
  }
  await supabase.auth.signOut()
}
