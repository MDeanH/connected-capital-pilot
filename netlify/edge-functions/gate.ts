// Pilot access gate — HTTP Basic Auth on every path of this deploy.
// This file exists ONLY on the pilot branch: production (main) has no gate.
// Credentials: user "pilot", password from the PILOT_PASSWORD env var.

import type { Context, Config } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  // The landing page is shareable without credentials (per client request);
  // the app, APIs and everything else stay behind the gate.
  const { pathname } = new URL(request.url);
  if (pathname === "/" || pathname === "/how-it-works.html") return context.next();

  const password = Netlify.env.get("PILOT_PASSWORD") || "";
  if (!password) {
    return new Response("Gate misconfigured: PILOT_PASSWORD not set", { status: 503 });
  }
  const expected = "Basic " + btoa(`pilot:${password}`);
  const got = request.headers.get("authorization") || "";
  if (got === expected) return context.next();
  return new Response("Authentication required — Connected Capital pilot.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Connected Capital Pilot", charset="UTF-8"' },
  });
};

export const config: Config = { path: "/*" };
