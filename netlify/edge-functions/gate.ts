// Pilot access gate — password login page on every path of this deploy.
//
// OPT-IN BY ENV: when PILOT_PASSWORD is not set, pages are served ungated —
// the public client site (no Supabase, no password) stays fully open. But the
// privileged state fails CLOSED: if a site has SUPABASE_SERVICE_ROLE_KEY and
// no PILOT_PASSWORD, every /api/* path returns 503 until the password is set,
// so deletes, rulebook writes, macro overrides and the deal ledger can never
// be publicly reachable. Operator order: set PILOT_PASSWORD on a site BEFORE
// giving that site Supabase credentials; if you see the 503, set it now.
//
// Why a login PAGE and not HTTP Basic Auth: many environments (in-app
// browsers, webviews, some Edge/Windows setups) never show the native Basic
// Auth dialog and render the 401 body instead — a dead end for a client who
// was simply handed the URL and a password. The form works everywhere.
// Basic Auth is STILL accepted as a header (curl/automation compatibility).
//
// Session: a correct login sets an HttpOnly cookie holding an HMAC of a
// fixed string keyed by the password itself — stateless, no extra secret,
// and every cookie auto-invalidates the moment the password changes.
// The landing page stays shareable without credentials.

import type { Context, Config } from "@netlify/edge-functions";

const COOKIE = "cc_gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function sessionToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("cc-gate-ok-v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function loginPage(wrongPassword: boolean): Response {
  const err = wrongPassword
    ? '<p class="err">That password didn&rsquo;t match &mdash; check for typos and try again.</p>'
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pilot access — Connected Capital</title>
<style>
:root{--bg:#eff9f9;--surface:#fff;--accent:#3f7d69;--mint:#63cda9;--text:#090e11;--muted:#5c6b67;--border:#dcebe7;--bad:#c2384a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:34px 32px;max-width:380px;width:100%;box-shadow:0 8px 30px rgba(9,14,17,.07)}
h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
h1 span{color:var(--accent)}
p{margin:0 0 18px;color:var(--muted);font-size:13.5px;line-height:1.55}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase}
input[type=password]{width:100%;font-size:16px;padding:11px 13px;border:1px solid var(--border);border-radius:9px;outline:none}
input[type=password]:focus{border-color:var(--accent)}
button{width:100%;margin-top:14px;background:var(--mint);color:var(--text);font-weight:700;font-size:15px;padding:12px;border:0;border-radius:9px;cursor:pointer}
button:hover{background:var(--text);color:#fff}
.err{color:var(--bad);font-size:13px;margin:12px 0 0}
.foot{margin-top:18px;font-size:12px;color:var(--muted)}
.foot a{color:var(--accent)}
</style>
</head>
<body>
<main class="card">
<h1>Connected <span>Capital</span> — pilot access</h1>
<p>This is a private pilot. Enter the access password you were given.</p>
<form method="POST" autocomplete="off">
<input type="hidden" name="__cc_gate" value="1">
<label for="pw">Password</label>
<input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
<button type="submit">Enter</button>
${err}
</form>
<p class="foot">No password? Ask the person who sent you this link. <a href="/">About the platform&nbsp;&rarr;</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async (request: Request, context: Context) => {
  const password = Netlify.env.get("PILOT_PASSWORD") || "";
  const { pathname } = new URL(request.url);

  if (!password) {
    // Fail closed on the privileged state only: Supabase credentials without a
    // password must not leave the API (deletes, rulebook writes, macro
    // overrides, the ledger) publicly reachable. Pages stay served, and the
    // public client site (no Supabase either) stays fully open.
    if (Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") && pathname.startsWith("/api/")) {
      return new Response(
        JSON.stringify({
          error:
            "API disabled: privileged integrations require PILOT_PASSWORD — this site has SUPABASE_SERVICE_ROLE_KEY configured but no gate password. Set PILOT_PASSWORD on this site to re-enable the API.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    return context.next();
  }
  if (pathname === "/" || pathname === "/how-it-works.html") return context.next();

  const want = await sessionToken(password);

  // 1) Session cookie from a previous login.
  const cookies = request.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)cc_gate=([a-f0-9]{64})/);
  if (m && m[1] === want) return context.next();

  // 2) Basic Auth header (curl / automation; any username, password checked).
  const got = request.headers.get("authorization") || "";
  if (got.startsWith("Basic ")) {
    try {
      const decoded = atob(got.slice(6));
      if (decoded.slice(decoded.indexOf(":") + 1) === password) return context.next();
    } catch { /* malformed header — fall through */ }
  }

  // 3) Unauthenticated API calls get JSON, never an HTML page.
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Password required (Connected Capital pilot)" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  // 4) Login form submission — only a POST that carries our marker field;
  //    everything else must not have its body consumed.
  if (request.method === "POST" && (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded")) {
    const form = await request.formData().catch(() => null);
    if (form && form.get("__cc_gate") === "1") {
      if (String(form.get("password") ?? "") === password) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: pathname,
            "Set-Cookie": `${COOKIE}=${want}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      return loginPage(true);
    }
    return loginPage(false);
  }

  // 5) Anything else unauthenticated: the login page.
  return loginPage(false);
};

export const config: Config = { path: "/*" };
