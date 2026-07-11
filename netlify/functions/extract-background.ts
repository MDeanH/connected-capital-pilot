// AI document extraction — BACKGROUND function (the sync path 504s: a full
// OM + pro forma pass exceeds Netlify's ~26s sync window; background functions
// get 15 minutes and return 202 immediately).
//
//   POST /api/extract  { extractionId, dealName?, pdfBase64?, sheets? } → 202
//
// The client GENERATES extractionId (the 202 carries no body) and polls
// GET /api/extractions/:id (extractions.ts), which reads the result from
// Netlify Blobs — no external persistence required.
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { runExtraction, type ExtractRequest } from './lib/gate1/extract-core.ts'
import { serviceClient } from './lib/supabase.ts'

// Netlify request bodies cap out near 6MB — leave headroom.
const MAX_BODY_BYTES = 4_500_000

export default async (req: Request): Promise<void> => {
  if (req.method !== 'POST') return

  const raw = await req.text()
  const store = getStore('extractions')

  let body: (ExtractRequest & { extractionId?: string }) | null = null
  let id = 'unknown'
  try {
    body = JSON.parse(raw || '{}')
    id = String(body?.extractionId ?? '').trim()
    if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) return // no id → nowhere to report
    if (raw.length > MAX_BODY_BYTES) {
      await store.setJSON(id, {
        status: 'error',
        error: 'Documents too large — compress the OM PDF below ~3MB',
      })
      return
    }
    await store.setJSON(id, { status: 'running', startedAt: new Date().toISOString() })
    const result = await runExtraction(body!)
    await store.setJSON(id, { status: 'done', ...result, completedAt: new Date().toISOString() })

    const db = serviceClient()
    if (db) {
      await db.from('extractions').insert({
        status: 'done',
        model: result.model,
        input_docs: { pdf: body?.pdfFilename ?? null, sheets: (body?.sheets ?? []).map(s => s.name) },
        fields: result.fields,
        discrepancies: result.discrepancies,
        completed_at: new Date().toISOString(),
      })
    }
  } catch (e: any) {
    try {
      await store.setJSON(id, { status: 'error', error: String(e?.message ?? e) })
    } catch {
      console.error('extract-background: failed to record error for', id, e)
    }
  }
}

export const config: Config = {
  path: '/api/extract',
}
