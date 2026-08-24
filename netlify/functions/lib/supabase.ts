// Supabase service-role client — server-side only. The SPA never talks to
// Supabase directly; every read/write flows through /api functions so each
// decision row is written by the same code that computed it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// @supabase/realtime-js (pulled in by supabase-js) eagerly constructs its
// client inside createClient and throws at construction when the runtime has
// no native WebSocket — Netlify functions run nodejs20.x, which has none
// (verified 2026-08-24: the cron-trigger bundle 502'd inside createClient
// with "Node.js detected but native WebSocket not found"). These server
// functions never open a realtime channel, so hand the constructor an inert
// transport: construction succeeds and nothing ever connects. (A Node 22
// runtime has native WebSocket; if the site ever sets
// AWS_LAMBDA_JS_RUNTIME=nodejs22.x this stub becomes redundant but harmless.)
class NoopRealtimeTransport {
  close() {}
}

let cached: SupabaseClient | null | undefined

/** Returns null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured. */
export function serviceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  cached = url && key
    ? createClient(url, key, {
        auth: { persistSession: false },
        realtime: { transport: NoopRealtimeTransport as unknown as any },
      })
    : null
  return cached
}
