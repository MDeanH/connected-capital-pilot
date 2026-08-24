// External cron dispatcher — POST /api/cron-run/:fn with x-cron-key.
//
// Why this function exists: the scheduled functions (macro-cron,
// extractions-reaper) cannot be reached over HTTP at all — Netlify's function
// router refuses HTTP invocation of any function that declares a schedule
// (verified 2026-08-24: a request the edge had already admitted came back 403,
// empty-bodied, fwd-status=403 from the platform layer). And the platform
// scheduler that is supposed to drive them has never fired on this
// API-deployed site (see lib/cron-auth.ts for that evidence). So the real
// scheduler is external (Supabase pg_cron → net.http_post), and it needs an
// HTTP-invocable door: this dispatcher.
//
// Auth: the edge gate admits a POST to /api/cron-run/* only with the correct
// x-cron-key (constant-time, fail-closed); this function re-verifies the same
// secret, and then each target handler verifies it a third time via the
// forwarded request's header — the dispatcher never manufactures authority,
// it only routes. The body is never read here, so the target sees the
// original request intact.
//
// The targets keep their schedule configs: if Netlify's scheduler ever fires,
// macro-cron's same-week duplicate guard and the reaper's idempotent sweep
// make a double-run harmless.

import type { Config } from '@netlify/functions'
import { cronKeyAuthenticated } from './lib/cron-auth.ts'
import runExtractionsReaper from './extractions-reaper.ts'
import runMacroCron from './macro-cron.ts'

export default async (req: Request): Promise<Response> => {
  if (!cronKeyAuthenticated(req)) {
    return new Response('Forbidden: cron trigger requires the shared key', { status: 403 })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  }
  const fn = new URL(req.url).pathname.split('/').filter(Boolean).pop()
  if (fn === 'macro-cron') return runMacroCron(req)
  if (fn === 'extractions-reaper') return runExtractionsReaper(req)
  return new Response('Unknown cron target', { status: 404 })
}

export const config: Config = {
  path: '/api/cron-run/:fn',
}
