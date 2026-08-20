// AI document extraction — SUBMIT step (sync, fast).
//
//   POST /api/extract { extractionId, pdfBase64?, omText?, sheets?, … } → { extractionId, status: 'running' }
//
// Receives the full documents (sync functions accept ~6MB — receiving is fast;
// it was the PROCESSING that blew the sync window), stages them in Netlify
// Blobs, and triggers the background worker with a tiny body. The client polls
// GET /api/extractions/:id exactly as before.
import { createHmac } from 'node:crypto'
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { requireAccount } from './lib/auth.ts'
import type { ExtractRequest } from './lib/gate1/extract-core.ts'

const MAX_BODY_BYTES = 4_500_000

// Server-enforced bounds on the pro-forma sheets — twins of the browser's
// src/excel.ts workbookToCsvText caps (the client caps are UX only). A custom
// client can send any body, so a truthy `sheets` with a `.length` is not
// enough: without these, sheet text could smuggle ~4.4MB past the per-sheet
// browser cap and the adjacent omText ceiling straight to the paid model.
const MAX_SHEETS = 50
// Mirrors excel.ts MAX_SHEET_CHARS (60_000) with slack for the '…[truncated]'
// marker the client appends to a capped sheet.
const MAX_SHEET_CHARS = 64_000
// Aggregate sheet text shares the omText 200,000-char ceiling below.
const MAX_SHEETS_TOTAL_CHARS = 200_000

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

// crypto.randomUUID() (what the client mints in every mode) is always a v4
// UUID; accept exactly that shape. Beyond validating input, this keeps ids out
// of the reserved 'payload-<id>' key space, so a request can never address a
// staged-document blob (the full base64 OM) as if it were a status record, nor
// overwrite one — a looser [a-z0-9-] id could name 'payload-<victim>'.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Global daily budget cap for paid extraction runs — a best-effort cost-DoS
// backstop. The per-IP rateLimit (config below) does NOT bound total spend
// under IP rotation on PUBLIC_EXTRACTION=allow, so this counts paid runs
// started per UTC day across ALL callers and refuses new work past the cap.
// Env-overridable; conservative default. Netlify Blobs has no atomic
// increment, so the counter is a read-modify-write under onlyIfMatch:
// concurrent submits can race and slightly overrun the cap — an accepted
// limitation. Kept in its OWN store so it never enters the 'extractions'
// record/payload key space the reaper classifies over.
const DEFAULT_EXTRACTION_DAILY_CAP = 200
const utcDayKey = () => `submits-${new Date().toISOString().slice(0, 10)}`
const dailyCap = () => {
  const n = Number(process.env.EXTRACTION_DAILY_CAP)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_EXTRACTION_DAILY_CAP
}

const budgetStore = () => getStore('extraction-budget')

async function dailyCountAtOrOverCap(): Promise<boolean> {
  const rec = (await budgetStore().get(utcDayKey(), { type: 'json' })) as { count?: number } | null
  return Number(rec?.count ?? 0) >= dailyCap()
}

async function bumpDailyCount(): Promise<void> {
  const store = budgetStore()
  const key = utcDayKey()
  // Read-modify-write, a few attempts then give up: a lost increment only
  // undercounts, which fails safe toward availability, never toward blocking a
  // legitimate day. set() — not setJSON() — because @netlify/blobs 10.7.9
  // silently drops conditional flags passed to setJSON().
  for (let i = 0; i < 3; i++) {
    const existing = await store.getWithMetadata(key, { type: 'json' })
    const count = Number((existing?.data as { count?: number } | null)?.count ?? 0)
    const next = JSON.stringify({ date: key, count: count + 1 })
    const res = !existing
      ? await store.set(key, next, { onlyIfNew: true })
      : existing.etag
        ? await store.set(key, next, { onlyIfMatch: existing.etag })
        // The local dev blobs server serves no etag — write unconditionally.
        : await store.set(key, next)
    if (res.modified) return
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Data-surface identity gate — a no-op ({ identity: null }, today's behavior)
  // unless accounts are switched on (REQUIRE_ACCOUNTS=1 with Supabase
  // configured); then submitting a PAID extraction demands a valid,
  // non-disabled identity, matching the deals / macro / decisions surfaces so
  // disabling a user revokes their extraction access. The recorded-sample demo
  // never hits this endpoint, so that flow is unaffected. The worker trigger
  // (/api/extract-run) is HMAC-authenticated, not gated here.
  const access = await requireAccount(req)
  if (access.response) return access.response

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return json(413, { error: 'Documents too large — compress the OM PDF below ~3MB' })
  }
  let body: ExtractRequest & { extractionId?: string }
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const id = String(body.extractionId ?? '').trim()
  if (!id || !UUID_V4_RE.test(id)) return json(400, { error: 'extractionId must be a valid UUID' })
  if (body.pdfBase64 && body.omText) {
    return json(400, { error: 'Provide the offering memorandum as either a PDF or extracted text, not both — one OM per deal' })
  }
  // Server-enforced twin of src/docx.ts MAX_OM_TEXT_CHARS — the client cap is
  // UX only; without this, ~4.4MB of raw text could reach the paid model call.
  if (body.omText !== undefined && typeof body.omText !== 'string') {
    return json(400, { error: 'omText must be a string' })
  }
  if (body.omText && body.omText.length > 200_000) {
    return json(413, { error: 'OM text too large — 200,000 characters max' })
  }
  // Validate the pro-forma sheets — twin of excel.ts's per-sheet and aggregate
  // caps. A truthy `sheets.length` is not enough: reject non-arrays and
  // malformed entries, cap the count, cap each csv, and cap the aggregate, so a
  // custom client can't pack near the whole 4.5MB body into sheet text bound
  // for the paid model.
  if (body.sheets !== undefined) {
    if (!Array.isArray(body.sheets)) {
      return json(400, { error: 'sheets must be an array of { name, csv } objects' })
    }
    if (body.sheets.length > MAX_SHEETS) {
      return json(413, { error: `Too many pro forma sheets — ${MAX_SHEETS} max` })
    }
    let sheetsTotal = 0
    for (const sheet of body.sheets) {
      if (!sheet || typeof sheet !== 'object' || typeof sheet.name !== 'string' || typeof sheet.csv !== 'string') {
        return json(400, { error: 'Each pro forma sheet must be a { name: string, csv: string } object' })
      }
      if (sheet.csv.length > MAX_SHEET_CHARS) {
        return json(413, { error: `A pro forma sheet is too large — ${MAX_SHEET_CHARS} characters max per sheet` })
      }
      sheetsTotal += sheet.csv.length
    }
    if (sheetsTotal > MAX_SHEETS_TOTAL_CHARS) {
      return json(413, { error: `Pro forma sheets too large — ${MAX_SHEETS_TOTAL_CHARS} characters max total` })
    }
  }
  if (!body.pdfBase64 && !body.omText && !(body.sheets && body.sheets.length)) {
    return json(400, { error: 'Provide an offering memorandum (PDF, Word or text) and/or pro forma sheets' })
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return json(500, { error: 'AI extraction is not configured (ANTHROPIC_API_KEY missing)' })
  }

  const store = getStore('extractions')

  // Global daily budget cap (best-effort) — refuse new paid runs once the UTC
  // day is at cap, BEFORE any blob is written or worker triggered. Infra errors
  // here fail open: the edge gate + per-IP rateLimit remain the primary
  // controls; this is a backstop against IP-rotation cost-DoS, not the gate.
  try {
    if (await dailyCountAtOrOverCap()) {
      return json(429, { error: 'Daily extraction limit reached — please try again tomorrow' })
    }
  } catch (e) {
    console.error('extract-submit: daily-cap check failed (allowing):', (e as Error)?.message ?? e)
  }

  // Claim the id with a conditional create. A second submit that reuses a live
  // or terminal id must not overwrite that record or re-trigger the paid model,
  // so a duplicate id is refused (409) rather than overwritten. setJSON()
  // silently drops conditional flags in @netlify/blobs 10.7.9, so the claim
  // goes through set()+JSON.stringify (the worker's own claim does the same).
  const claim = await store.set(
    id,
    JSON.stringify({ status: 'running', submittedAt: new Date().toISOString() }),
    { onlyIfNew: true },
  )
  if (!claim.modified) {
    return json(409, { error: 'An extraction with this id is already in progress or complete' })
  }
  // Count this accepted run toward the daily cap (best-effort; see bump notes).
  try {
    await bumpDailyCount()
  } catch (e) {
    console.error('extract-submit: daily-cap bump failed (ignored):', (e as Error)?.message ?? e)
  }

  // Only now stage the documents — a refused duplicate above never writes a
  // payload blob, and the claim guarantees exactly one submit owns this id.
  await store.setJSON(`payload-${id}`, body)

  // Trigger the background worker on this same deploy; its 202 returns immediately.
  const origin = new URL(req.url).origin
  // The edge gate protects /api/* — pass the caller's credentials through so
  // the internal worker trigger isn't rejected with 401 on gated deploys.
  const passthrough: Record<string, string> = { 'Content-Type': 'application/json' }
  // Internal trigger token: /api/extract-run is publicly reachable on open
  // deploys, so the worker only accepts triggers that prove they came from
  // this function — an HMAC over the extractionId keyed by the shared secret.
  passthrough['x-cc-worker-token'] = createHmac('sha256', anthropicKey).update(id).digest('hex')
  const auth = req.headers.get('authorization')
  if (auth) passthrough['authorization'] = auth
  const cookie = req.headers.get('cookie')
  if (cookie) passthrough['cookie'] = cookie
  let failure: string | null = null
  try {
    const trigger = await fetch(`${origin}/api/extract-run`, {
      method: 'POST',
      headers: passthrough,
      body: JSON.stringify({ extractionId: id }),
    })
    if (trigger.status >= 400) failure = `Could not start the extraction worker (HTTP ${trigger.status})`
  } catch (e) {
    failure = `Could not start the extraction worker (${(e as Error)?.message ?? e})`
  }
  if (failure) {
    // No worker will ever run to consume the staged documents — delete them
    // here, or the full base64 OM sits in the store forever.
    try { await store.delete(`payload-${id}`) } catch { /* best effort */ }
    await store.setJSON(id, { status: 'error', error: failure })
    return json(502, { error: failure })
  }

  return json(200, { extractionId: id, status: 'running' })
}

export const config: Config = {
  path: '/api/extract',
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: 'ip' },
}
