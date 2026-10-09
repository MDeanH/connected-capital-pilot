// Auth mode probe — GET /api/auth/status → { enabled, accountsRequired }.
//
// The SPA cannot infer the server's auth mode from its own build: the VITE_
// Supabase keys are committed, so every build constructs a client, but a
// deployment without SUPABASE_SERVICE_ROLE_KEY (the public demo) runs with
// the inner auth layer off. This endpoint reports that server-side truth so
// the client activates its auth UI only when BOTH halves are on. Deliberately
// no secrets and no identity work — just the same authConfigured() switch the
// require* gates key off.
//
// accountsRequired mirrors accountsRequired() (REQUIRE_ACCOUNTS=1): when true
// the SPA raises a sign-in wall — no signed-in identity, no app. The wall is
// client-side courtesy only; the require* gates on every data endpoint remain
// the enforcement boundary.

import type { Config } from '@netlify/functions'
import { accountsRequired, authConfigured } from './lib/auth.ts'

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  return new Response(JSON.stringify({ enabled: authConfigured(), accountsRequired: accountsRequired() }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config: Config = {
  path: '/api/auth/status',
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
