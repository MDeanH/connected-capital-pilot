// Supabase service-role client — server-side only. The SPA never talks to
// Supabase directly; every read/write flows through /api functions so each
// decision row is written by the same code that computed it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

/** Returns null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured. */
export function serviceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  return cached
}
