// AI document extraction — BACKGROUND worker (15-minute limit).
//
// Background functions cap request bodies at ~256KB, so the documents never
// come through this request: extract-submit.ts stages the full payload in
// Netlify Blobs and triggers this worker with just { extractionId }. Results
// land back in Blobs for GET /api/extractions/:id (extractions.ts).
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { runExtraction, type ExtractRequest } from './lib/gate1/extract-core.ts'
import { serviceClient } from './lib/supabase.ts'

export default async (req: Request): Promise<void> => {
  if (req.method !== 'POST') return
  const store = getStore('extractions')
  let id = ''
  try {
    const body = JSON.parse((await req.text()) || '{}')
    id = String(body?.extractionId ?? '').trim()
    if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) return // nowhere to report

    const payload = (await store.get(`payload-${id}`, { type: 'json' })) as ExtractRequest | null
    if (!payload) {
      await store.setJSON(id, { status: 'error', error: 'Staged documents not found — resubmit the extraction' })
      return
    }
    await store.setJSON(id, { status: 'running', startedAt: new Date().toISOString() })

    const result = await runExtraction(payload)
    await store.setJSON(id, { status: 'done', ...result, completedAt: new Date().toISOString() })

    const db = serviceClient()
    if (db) {
      await db.from('extractions').insert({
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
