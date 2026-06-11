// Pilot access gate — HTTP Basic Auth on every path of this deploy.
// Only the PASSWORD is checked (any username works — requiring an exact
// username turned out to be a login footgun). Password lives in the
// PILOT_PASSWORD env var. The landing page is shareable without credentials;
// the app, APIs and everything else stay behind the gate.

import type { Context, Config } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/" || pathname === "/how-it-works.html") return context.next();

  const password = Netlify.env.get("PILOT_PASSWORD") || "";
  if (!password) {
    return new Response("Gate misconfigured: PILOT_PASSWORD not set", { status: 503 });
  }
  const got = request.headers.get("authorization") || "";
  if (got.startsWith("Basic ")) {
    try {
      const decoded = atob(got.slice(6));
      const suppliedPassword = decoded.slice(decoded.indexOf(":") + 1);
      if (suppliedPassword === password) return context.next();
    } catch { /* malformed header — fall through to the 401 */ }
  }
  return new Response("Password required — Connected Capital pilot. Enter the pilot password (any username).", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Connected Capital Pilot — any username, pilot password", charset="UTF-8"' },
  });
};

export const config: Config = { path: "/*" };
