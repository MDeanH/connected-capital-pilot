// Browser-side identity — the SPA half of the inner auth layer. Conditional
// activation mirrors the server: when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are absent at build time (the public demo site) `supabase` is null, no auth
// UI renders, authFetch degrades to plain fetch, and every surface behaves
// exactly as before.
//
// Role is inferred, not stored client-side: one probe of GET /api/users after
// sign-in — 200 means admin, 403 means analyst (signed in, not admin) — cached
// per user for the page's lifetime. The server re-checks every enforced call,
// so this only decides what UI to show.
import { useEffect, useState } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when auth is not configured on this build — the whole feature renders nothing. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export type Role = 'admin' | 'analyst'

/**
 * Admin visibility flag passed down to gated UI: 'auth-off' preserves legacy
 * visibility (auth not configured — render exactly as today), true shows
 * admin controls, false hides them. Gate with `isAdmin !== false`.
 */
export type AdminFlag = boolean | 'auth-off'

export interface IdentityState {
  /** False only while the initial session restore / role probe is in flight. */
  ready: boolean
  /** Signed-in email, or null when signed out (or auth unconfigured). */
  email: string | null
  /** Resolved role; null while signed out, probing, or when the account has no active profile. */
  role: Role | null
}

// One probe per user per page load; only definite verdicts are cached so a
// transient failure (offline, 5xx) retries on the next mount.
const roleCache = new Map<string, Role>()

async function probeRole(token: string): Promise<Role | null> {
  try {
    const r = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
    return r.status === 200 ? 'admin' : r.status === 403 ? 'analyst' : null
  } catch {
    return null
  }
}

/** Session + role, live across sign-in/out. Inert (ready, all-null) when auth is unconfigured. */
export function useIdentity(): IdentityState {
  const [session, setSession] = useState<Session | null>(null)
  const [restored, setRestored] = useState(supabase === null)
  const [role, setRole] = useState<Role | null>(null)
  const [probing, setProbing] = useState(false)

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
      return
    }
    const cached = roleCache.get(userId)
    if (cached !== undefined) {
      setRole(cached)
      return
    }
    let cancelled = false
    setProbing(true)
    probeRole(token).then(resolved => {
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
    email: session?.user?.email ?? null,
    role: userId ? role : null,
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
  await supabase.auth.signOut()
}
