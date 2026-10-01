// Shared authentication for the scheduled functions' EXTERNAL trigger path.
//
// Why an external path exists at all: the Netlify platform scheduler has never
// fired on this site. Its deploys are API/CLI uploads ("Deploy triggered by
// upload"), and across every Monday (macro-cron) and every day
// (extractions-reaper) since the schedules shipped, zero invocations reached
// the functions — macro_snapshots held zero rows ever, with no matching
// database traffic at any scheduled slot (verified 2026-08-24 against the
// Supabase tables and request logs). The weekly snapshot chain therefore runs
// off an external scheduler (Supabase pg_cron → net.http_post) that calls the
// functions' public paths with the shared CRON_TRIGGER_SECRET. The platform
// schedule config on each function is kept: if Netlify's scheduler ever does
// fire, macro-cron's same-week duplicate guard and the reaper's idempotent
// sweep make a double-run harmless.
//
// Contract: this module is the authentication for the external trigger path —
// a request is admitted ONLY when it presents the correct x-cron-key. (The
// pilot-password edge gate that used to pre-filter these paths was removed
// when the site went public; this function-side check now stands alone.)
// Fail-closed: no secret configured, or no header presented, is NOT
// authenticated.

import { timingSafeEqual } from 'node:crypto'

export const CRON_KEY_HEADER = 'x-cron-key'

export function cronKeyAuthenticated(req: Request): boolean {
  const secret = process.env.CRON_TRIGGER_SECRET ?? ''
  const presented = req.headers.get(CRON_KEY_HEADER) ?? ''
  if (!secret || !presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(secret)
  // Length checked first: timingSafeEqual throws on unequal-length inputs.
  // The length comparison leaks only the secret's length, not its content.
  return a.length === b.length && timingSafeEqual(a, b)
}
