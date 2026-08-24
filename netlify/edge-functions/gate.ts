// Pilot access gate — password login page on every path of this deploy.
//
// OPT-IN BY ENV: when PILOT_PASSWORD is not set, pages are served ungated —
// the public client site (no Supabase, no password) stays fully open. But the
// privileged state fails CLOSED: if a site has SUPABASE_SERVICE_ROLE_KEY and
// no PILOT_PASSWORD, every privileged path returns 503 until the password is
// set — both the public /api/* routes AND the internal /.netlify/functions/*
// namespace Netlify also exposes each function at — so deletes, rulebook writes,
// macro overrides and the deal ledger can never be publicly reachable (a check
// on /api/* alone would leave the identical function reachable at its internal
// path). Likewise for paid model spend: ANTHROPIC_API_KEY on
// an open site 503s the extraction paths (/api/extract, /api/extract-run,
// /api/extractions/*) unless the operator explicitly opts in by setting
// PUBLIC_EXTRACTION=allow (the public client site's rate-limited demo runs
// with that opt-in). Operator order: set PILOT_PASSWORD on a site BEFORE
// giving that site Supabase credentials; if you see either 503, set
// PILOT_PASSWORD now — or, for a deliberately public extraction demo,
// set PUBLIC_EXTRACTION=allow.
//
// Why a login PAGE and not HTTP Basic Auth: many environments (in-app
// browsers, webviews, some Edge/Windows setups) never show the native Basic
// Auth dialog and render the 401 body instead — a dead end for a client who
// was simply handed the URL and a password. The form works everywhere.
// Basic Auth is STILL accepted as a header (curl/automation compatibility).
//
// Session: a correct login sets an HttpOnly cookie carrying an issued-at and
// an expiry, signed (HMAC-SHA-256) with GATE_SIGNING_SECRET — an independent,
// high-entropy secret that is REQUIRED whenever the gate is active. The key is
// never derived from the password: a password-derived key would turn a captured
// cookie into an offline password oracle (guess password -> derive key ->
// recompute MAC). If GATE_SIGNING_SECRET is unset the gate fails closed (503 on
// gated paths, no cookie issued) rather than fall back to the password. The
// server also rejects the cookie once its 30-day expiry passes. (Changing
// GATE_SIGNING_SECRET invalidates outstanding cookies.) The landing page stays
// shareable without credentials.
//
// Brute-force throttle: FAILED password attempts (wrong form POST, wrong or
// malformed Basic Auth header) are counted per client IP in a Netlify Blobs
// store ("gate-throttle"), fixed 15-minute window, max 10 failures — beyond
// that the IP gets 429 + Retry-After until the window rolls over. Every failed
// attempt also eats a constant ~400 ms delay. Successful auths bypass or reset
// the counter, and cookie-valid requests never touch the store, so the hot
// path pays zero extra latency.

import type { Context, Config } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

const COOKIE = "cc_gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ---- failed-attempt throttle -----------------------------------------------
const THROTTLE_STORE = "gate-throttle";
const THROTTLE_WINDOW_MS = 15 * 60 * 1000; // fixed window: 15 minutes
const THROTTLE_MAX_FAILURES = 10; // failed attempts allowed per window per IP
const FAIL_DELAY_MS = 400; // constant delay on every failed attempt

type ThrottleRecord = { windowStart: number; failures: number };
type ThrottleState = { throttled: boolean; retryAfterSec: number };

// context.ip is Netlify's connecting-client IP; the x-nf-client-connection-ip
// header is the same value as Netlify's proxy injects it (belt and braces).
function clientIp(request: Request, context: Context): string {
  return context.ip || request.headers.get("x-nf-client-connection-ip") || "unknown";
}

// Count one FAILED attempt against this IP and report whether it is now over
// the limit. Runs concurrently with the constant delay (see throttleFailed).
//
// TRADE-OFF — fail open on Blobs errors: if the throttle store is down we fall
// back to delay-only behavior (the 400 ms tax still applies, the counter and
// 429 do not). A store outage locking every legitimate user out of the pilot
// would be worse than briefly losing the attempt cap; the shared password plus
// the constant delay remain the floor. The read-modify-write below is also not
// atomic — racing failures may undercount slightly — acceptable for a
// brute-force damper, not an accounting system.
async function recordFailure(ip: string): Promise<ThrottleState> {
  try {
    const store = getStore(THROTTLE_STORE);
    const now = Date.now();
    const rec = (await store.get(ip, { type: "json" })) as Partial<ThrottleRecord> | null;
    // Shape-check the stored record: a missing or corrupt blob starts a fresh
    // window rather than NaN-poisoning the counter (which would never throttle).
    const inWindow =
      rec != null &&
      typeof rec.windowStart === "number" &&
      now - rec.windowStart < THROTTLE_WINDOW_MS;
    const next: ThrottleRecord = inWindow
      ? { windowStart: rec.windowStart as number, failures: (Number(rec.failures) || 0) + 1 }
      : { windowStart: now, failures: 1 };
    await store.setJSON(ip, next);
    if (next.failures > THROTTLE_MAX_FAILURES) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((next.windowStart + THROTTLE_WINDOW_MS - now) / 1000),
      );
      return { throttled: true, retryAfterSec };
    }
  } catch {
    // Fail open (see trade-off note above): behave as if under the limit.
  }
  return { throttled: false, retryAfterSec: 0 };
}

// Constant ~400 ms tax on every failed attempt (cheap bot slowdown). The blob
// round-trip runs inside the same wait, so total added latency is
// max(400 ms, store RTT) — near-constant, not additive.
async function throttleFailed(ip: string): Promise<ThrottleState> {
  const delay = new Promise<void>((resolve) => setTimeout(resolve, FAIL_DELAY_MS));
  const state = await recordFailure(ip);
  await delay;
  return state;
}

// Successful form login resets the counter so a legit user's earlier typos
// don't linger. Best-effort: a Blobs error here must never block a login.
async function clearThrottle(ip: string): Promise<void> {
  try {
    await getStore(THROTTLE_STORE).delete(ip);
  } catch {
    // Fail open — a stale counter only affects future FAILED attempts.
  }
}

function tooManyAttempts(retryAfterSec: number, asJson: boolean): Response {
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  if (asJson) {
    return new Response(
      JSON.stringify({
        error: `Too many failed password attempts from your network address. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
        retryAfterSeconds: retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSec),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Too many attempts — Connected Capital</title>
<style>
:root{--bg:#eff9f9;--surface:#fff;--accent:#3f7d69;--text:#090e11;--muted:#5c6b67;--border:#dcebe7;--bad:#c2384a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:34px 32px;max-width:380px;width:100%;box-shadow:0 8px 30px rgba(9,14,17,.07)}
h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em;color:var(--bad)}
p{margin:0 0 12px;color:var(--muted);font-size:13.5px;line-height:1.55}
</style>
</head>
<body>
<main class="card">
<h1>Too many attempts</h1>
<p>There have been too many failed password attempts from your network address, so sign-in is paused for about ${mins} minute${mins === 1 ? "" : "s"}.</p>
<p>If you have the correct password, wait and try again. If you don&rsquo;t, ask the person who sent you this link.</p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(retryAfterSec),
      "Cache-Control": "no-store",
    },
  });
}
// ---- end throttle ----------------------------------------------------------

// ---- session cookie: signed, expiring, and NOT a password oracle -----------
// The cookie is a stateless token of the form base64url(payload).hex(hmac).
// The payload carries an issued-at and an expiry; the HMAC is keyed on the
// dedicated GATE_SIGNING_SECRET, which is independent of the pilot password.
// Because the key is not derived from the password, a captured cookie is never
// an offline oracle for PILOT_PASSWORD; the gate refuses to operate (503 on
// gated paths) when GATE_SIGNING_SECRET is unset rather than fall back to a
// password-derived key.

// The HMAC key material is GATE_SIGNING_SECRET — an independent, high-entropy
// value that is REQUIRED whenever the gate is active. There is NO password-
// derived fallback: deriving the key from PILOT_PASSWORD would make a captured
// cookie an offline password oracle (guess password -> derive key -> recompute
// MAC -> compare, with the brute-force throttle never in the loop). The handler
// returns 503 on gated paths when GATE_SIGNING_SECRET is unset, so by the time
// a cookie is minted or verified the secret is guaranteed present.
async function signingKey(secret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Length-checked, non-short-circuiting comparison over encoded bytes — used for
// the cookie MAC and the password so neither leaks its content through timing.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Mint a fresh cookie value for a successful login. The 30-day lifetime is
// baked into the signed payload; COOKIE_MAX_AGE keeps the browser Max-Age in
// step with the server-checked expiry.
async function mintCookie(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + COOKIE_MAX_AGE;
  const b64 = base64url(enc.encode(`${iat}.${exp}`));
  const key = await signingKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(b64)));
  return `${b64}.${toHex(sig)}`;
}

// Verify a cookie value: recompute the MAC over the payload, constant-time
// compare, then reject once the baked-in expiry has passed. A tampered or
// expired cookie fails closed (returns false -> the request is re-challenged).
async function verifyCookie(value: string, secret: string): Promise<boolean> {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const b64 = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const enc = new TextEncoder();
  const key = await signingKey(secret);
  const expected = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(b64))));
  if (!constantTimeEqual(mac, expected)) return false;
  // MAC verified: the payload is authentic, so its expiry can be trusted.
  let payload: string;
  try {
    payload = new TextDecoder().decode(fromBase64url(b64));
  } catch {
    return false;
  }
  const exp = Number(payload.split(".")[1]);
  if (!Number.isFinite(exp)) return false;
  return Math.floor(Date.now() / 1000) < exp;
}
// ---- end session cookie ----------------------------------------------------

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

// A "privileged" (non-public) path is anything on the /api/* surface OR the
// internal /.netlify/functions/<name> namespace that Netlify also exposes each
// function at. A fail-closed check that only matched /api/* would leave the
// identical function reachable, unauthenticated, at its internal path. The
// exempt PUBLIC set (/, /how-it-works.html, /evidence-network.html, static
// assets) matches neither prefix, so this predicate is false for them.
function isPrivilegedPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/.netlify/functions/");
}

// The SCHEDULED functions: macro-cron (weekly) and extractions-reaper (daily).
// The Netlify platform scheduler — which would invoke these internally,
// without traversing this edge — has never actually fired on the API-deployed
// sites (macro_snapshots: zero rows ever, no scheduled-slot traffic; verified
// 2026-08-24 — an earlier revision of this comment claimed the opposite
// without evidence). The runs that DO happen come from an external scheduler
// (Supabase pg_cron → net.http_post) hitting these public paths with the
// shared CRON_TRIGGER_SECRET in an x-cron-key header.
//
// So the rule at the edge is: admit a POST to these paths ONLY when it
// presents the correct x-cron-key (constant-time compare; fail-closed to an
// unconditional 403 when the secret is unset) and refuse everything else. A
// caller-forgeable body field (e.g. macro-cron's next_run) still cannot
// authenticate anything, and each function re-verifies the same secret itself
// (defense in depth). Subpaths are matched too: Netlify routes
// /.netlify/functions/<name>/<extra> to the same function.
function isScheduledFunctionPath(pathname: string): boolean {
  return (
    pathname === "/.netlify/functions/macro-cron" ||
    pathname.startsWith("/.netlify/functions/macro-cron/") ||
    pathname === "/.netlify/functions/extractions-reaper" ||
    pathname.startsWith("/.netlify/functions/extractions-reaper/")
  );
}

// The paid-extraction surface, in BOTH namespaces. Public routes and the
// internal function paths they map to:
//   /api/extract       <- extract-submit
//   /api/extract-run   <- extract-run-background
//   /api/extractions/* <- extractions
// (extractions-reaper is a Supabase-only cron with no Anthropic spend; it needs
// no Anthropic fail-closed and is already covered by isPrivilegedPath — and, as
// a scheduled function, is hard-blocked at the edge by isScheduledFunctionPath.)
function isExtractionPath(pathname: string): boolean {
  return (
    pathname === "/api/extract" ||
    pathname === "/api/extract-run" ||
    pathname.startsWith("/api/extractions") ||
    pathname === "/.netlify/functions/extract-submit" ||
    pathname === "/.netlify/functions/extract-run-background" ||
    pathname === "/.netlify/functions/extractions" ||
    pathname.startsWith("/.netlify/functions/extractions/")
  );
}

export default async (request: Request, context: Context) => {
  const password = Netlify.env.get("PILOT_PASSWORD") || "";
  const { pathname } = new URL(request.url);

  // FIRST, ahead of auth, the exempt-public set, and the no-password
  // fail-closed matrix below: the scheduled-function paths. The ONLY external
  // caller with a legitimate reason to hit them is the pg_cron trigger, which
  // authenticates with the shared CRON_TRIGGER_SECRET (see the comment on
  // isScheduledFunctionPath). Everything else — including a scheduled-shaped
  // body, which is caller-forgeable — is refused with 403. This edge check is
  // the PRIMARY protection; each handler re-verifies the same secret as
  // defense-in-depth. A genuine platform-scheduler run (should one ever fire)
  // is invoked internally and never reaches this code.
  if (isScheduledFunctionPath(pathname)) {
    const cronKey = Netlify.env.get("CRON_TRIGGER_SECRET") || "";
    const presented = request.headers.get("x-cron-key") || "";
    if (
      cronKey &&
      presented &&
      request.method === "POST" &&
      constantTimeEqual(presented, cronKey)
    ) {
      return context.next();
    }
    return new Response(
      JSON.stringify({ error: "Forbidden: scheduled function; runs only on a schedule" }),
      { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }

  if (!password) {
    // Fail closed on the privileged state only: Supabase credentials without a
    // password must not leave the API (deletes, rulebook writes, macro
    // overrides, the ledger) publicly reachable — at either the /api/* route or
    // the internal /.netlify/functions/* path. Pages stay served, and the
    // public client site (no Supabase either) stays fully open.
    if (Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") && isPrivilegedPath(pathname)) {
      return new Response(
        JSON.stringify({
          error:
            "API disabled: privileged integrations require PILOT_PASSWORD — this site has SUPABASE_SERVICE_ROLE_KEY configured but no gate password. Set PILOT_PASSWORD on this site to re-enable the API.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    // Same fail-closed default for paid model spend: an Anthropic key on an
    // open site must not leave extraction publicly invocable by accident, at
    // either the /api/* route or the internal /.netlify/functions/* path.
    // PUBLIC_EXTRACTION=allow is the explicit opt-in for a public demo.
    if (
      Netlify.env.get("ANTHROPIC_API_KEY") &&
      Netlify.env.get("PUBLIC_EXTRACTION") !== "allow" &&
      isExtractionPath(pathname)
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Extraction disabled: paid extraction on an open site requires PILOT_PASSWORD — this site has ANTHROPIC_API_KEY configured but no gate password. Set PILOT_PASSWORD, or set PUBLIC_EXTRACTION=allow to deliberately run extraction publicly.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    return context.next();
  }
  if (
    pathname === "/" ||
    pathname === "/how-it-works.html" ||
    // Shareable research exhibit (published-study metadata only), linked from the open landing page.
    pathname === "/evidence-network.html"
  ) return context.next();

  // The cookie scheme REQUIRES an independent, high-entropy GATE_SIGNING_SECRET.
  // Without it the gate cannot mint or verify a session cookie safely — a
  // password-derived key would make a captured cookie an offline password
  // oracle — so every gated path fails closed here (no cookie can be issued).
  // The exempt PUBLIC pages above already returned, so they stay reachable even
  // in this misconfigured state.
  const signingSecret = Netlify.env.get("GATE_SIGNING_SECRET");
  if (!signingSecret) {
    return new Response(
      JSON.stringify({
        error:
          "Gate misconfigured: this site has PILOT_PASSWORD set but no GATE_SIGNING_SECRET. Set a high-entropy GATE_SIGNING_SECRET to enable sign-in — the gate will not fall back to a password-derived signing key.",
      }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }

  // 1) Session cookie from a previous login (signed + expiry-checked).
  const cookies = request.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)cc_gate=([A-Za-z0-9._-]+)/);
  if (m && await verifyCookie(m[1], signingSecret)) return context.next();

  // 2) Basic Auth header (curl / automation; any username, password checked).
  //    Valid credentials bypass the throttle store entirely (zero added
  //    latency for automation); a wrong or malformed header is a FAILED
  //    attempt — counted, delayed, and 429'd over the limit.
  const got = request.headers.get("authorization") || "";
  if (got.startsWith("Basic ")) {
    let ok = false;
    try {
      const decoded = atob(got.slice(6));
      ok = constantTimeEqual(decoded.slice(decoded.indexOf(":") + 1), password);
    } catch { /* malformed header — counts as a failed attempt */ }
    if (ok) return context.next();
    const { throttled, retryAfterSec } = await throttleFailed(clientIp(request, context));
    if (throttled) return tooManyAttempts(retryAfterSec, pathname.startsWith("/api/"));
    // Under the limit: fall through to the normal 401 (JSON for /api, login page otherwise).
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
      const ip = clientIp(request, context);
      if (constantTimeEqual(String(form.get("password") ?? ""), password)) {
        await clearThrottle(ip); // success resets the failure counter
        const cookie = await mintCookie(signingSecret);
        return new Response(null, {
          status: 303,
          headers: {
            Location: pathname,
            "Set-Cookie": `${COOKIE}=${cookie}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      // Wrong password on the form: a FAILED attempt — counted, delayed,
      // and 429'd (HTML — this is a browser flow) over the limit.
      const { throttled, retryAfterSec } = await throttleFailed(ip);
      if (throttled) return tooManyAttempts(retryAfterSec, false);
      return loginPage(true);
    }
    // POST without our marker field: not a password attempt — never counted.
    return loginPage(false);
  }

  // 5) Anything else unauthenticated: the login page.
  return loginPage(false);
};

export const config: Config = { path: "/*" };
