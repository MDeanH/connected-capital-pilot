// AI document extraction — BACKGROUND worker (15-minute limit).
//
// Background functions cap request bodies at ~256KB, so the documents never
// come through this request: extract-submit.ts stages the full payload in
// Netlify Blobs and triggers this worker with just { extractionId }. Results
// land back in Blobs for GET /api/extractions/:id (extractions.ts).
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { runExtraction, type ExtractRequest } from './lib/gate1/extract-core.ts'
import { serviceClient } from './lib/supabase.ts'

export default async (req: Request): Promise<Response | void> => {
  if (req.method !== 'POST') return
  let id = ''
  try {
    const body = JSON.parse((await req.text()) || '{}')
    id = String(body?.extractionId ?? '').trim()
  } catch {
    return
  }
  if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) return // nowhere to report

  // /api/extract-run is publicly reachable on open deploys — accept only
  // triggers bearing extract-submit's HMAC over the extractionId (keyed by
  // the shared secret), and reject before touching the store so outsiders
  // can neither replay a run nor scribble on its status record.
  const secret = process.env.ANTHROPIC_API_KEY
  const token = Buffer.from(req.headers.get('x-cc-worker-token') ?? '')
  const expected = secret ? Buffer.from(createHmac('sha256', secret).update(id).digest('hex')) : Buffer.alloc(0)
  if (!secret || token.length !== expected.length || !timingSafeEqual(token, expected)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const store = getStore('extractions')
  try {
    // startedAt on the status record means a worker already claimed this id.
    const status = (await store.get(id, { type: 'json' })) as { startedAt?: string } | null
    if (status?.startedAt) return

    const payload = (await store.get(`payload-${id}`, { type: 'json' })) as ExtractRequest | null
    if (!payload) {
      await store.setJSON(id, { status: 'error', error: 'Staged documents not found — resubmit the extraction' })
      return
    }
    // Claim-on-read: the payload is in memory, so delete it NOW — a raced
    // duplicate worker finds nothing and exits above without calling the
    // model. The finally-delete below remains as a backstop.
    try { await store.delete(`payload-${id}`) } catch { /* best effort */ }
    const startedAt = new Date().toISOString()
    await store.setJSON(id, { status: 'running', startedAt })

    const result = await runExtraction(payload)
    await store.setJSON(id, { status: 'done', ...result, startedAt, completedAt: new Date().toISOString() })

    const db = serviceClient()
    if (db) {
      // The client mints extractionId with crypto.randomUUID(), so a UUID-shaped
      // id becomes the row's PK — that is what lets the decide call attach a
      // deal_id to THIS row later and keeps stored fields/citations traceable
      // after browser state is gone. The trigger regex above is looser than
      // UUID ([a-z0-9-]{8,64}); a non-UUID id would be rejected by the uuid PK
      // column and fail the whole insert, so those rows keep the generated PK
      // (persisted but unlinkable) instead.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      await db.from('extractions').insert({
        ...(isUuid ? { id } : {}),
        status: 'done',
        model: result.model,
        input_docs: {
          pdf: payload.pdfFilename ?? null,
          om_text: payload.omText ? payload.omFilename ?? null : null,
          sheets: (payload.sheets ?? []).map(s => s.name),
        },
        fields: result.fields,
        discrepancies: result.discrepancies,
        completed_at: new Date().toISOString(),
      })
    }
  } catch (e: any) {
    try {
      await store.setJSON(id || 'unknown', { status: 'error', error: String(e?.message ?? e) })
    } catch {
      console.error('extract-run-background: failed to record error for', id, e)
    }
  } finally {
    // The staged payload holds the full base64 OM and sheet text — sensitive
    // deal documents must never outlive the one run, success OR failure.
    if (id) {
      try { await store.delete(`payload-${id}`) } catch { /* best effort */ }
    }
  }
}

export const config: Config = {
  path: '/api/extract-run',
}
