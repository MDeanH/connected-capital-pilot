// AI document extraction — SUBMIT step (sync, fast).
//
//   POST /api/extract { extractionId, pdfBase64?, omText?, sheets?, … } → { extractionId, status: 'running' }
//
// Receives the full documents (sync functions accept ~6MB — receiving is fast;
// it was the PROCESSING that blew the sync window), stages them in Netlify
// Blobs, and triggers the background worker with a tiny body. The client polls
// GET /api/extractions/:id exactly as before.
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import type { ExtractRequest } from './lib/gate1/extract-core.ts'

const MAX_BODY_BYTES = 4_500_000

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

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
  if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) return json(400, { error: 'extractionId required' })
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
  if (!body.pdfBase64 && !body.omText && !(body.sheets && body.sheets.length)) {
    return json(400, { error: 'Provide an offering memorandum (PDF, Word or text) and/or pro forma sheets' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: 'AI extraction is not configured (ANTHROPIC_API_KEY missing)' })
  }

  const store = getStore('extractions')
  await store.setJSON(`payload-${id}`, body)
  await store.setJSON(id, { status: 'running', submittedAt: new Date().toISOString() })

  // Trigger the background worker on this same deploy; its 202 returns immediately.
  const origin = new URL(req.url).origin
  const trigger = await fetch(`${origin}/api/extract-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extractionId: id }),
  })
  if (trigger.status >= 400) {
    await store.setJSON(id, { status: 'error', error: `Could not start the extraction worker (HTTP ${trigger.status})` })
    return json(502, { error: `Could not start the extraction worker (HTTP ${trigger.status})` })
  }

  return json(200, { extractionId: id, status: 'running' })
}

export const config: Config = {
  path: '/api/extract',
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: 'ip' },
}
