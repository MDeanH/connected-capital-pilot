// Pilot access gate — HTTP Basic Auth on every path of this deploy.
// Reinstated (was deleted in 0809d77 when the pilot went public) because the
// deal ledger endpoints (/api/deals, /api/gate1/decisions, decide's deal
// linking) expose and accept real pipeline-deal data once Supabase is
// configured — an open site must not carry a live ledger (HANDOFF caution).
//
// OPT-IN BY ENV: when PILOT_PASSWORD is not set, the gate does nothing — so
// this code is inert on the public client site and on any site until the
// password is explicitly configured. Set PILOT_PASSWORD on a site BEFORE
// giving that site Supabase credentials.
//
// Only the PASSWORD is checked (any username works — requiring an exact
// username turned out to be a login footgun). The landing page stays
// shareable without credentials; the app, APIs and everything else gate.

import type { Context, Config } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  const password = Netlify.env.get("PILOT_PASSWORD") || "";
  if (!password) return context.next();

  const { pathname } = new URL(request.url);
  if (pathname === "/" || pathname === "/how-it-works.html") return context.next();

  const got = request.headers.get("authorization") || "";
  if (got.startsWith("Basic ")) {
    try {
      const decoded = atob(got.slice(6));
      const suppliedPassword = decoded.slice(decoded.indexOf(":") + 1);
      if (suppliedPassword === password) return context.next();
    } catch { /* malformed header — fall through to the 401 */ }
  }
  return new Response("Password required - Connected Capital pilot. Enter the pilot password (any username).", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Connected Capital Pilot - any username, pilot password", charset="UTF-8"' },
  });
};

export const config: Config = { path: "/*" };
