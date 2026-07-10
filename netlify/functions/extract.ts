// AI document extraction — deal intake is document ingest, not data entry.
//   POST /api/extract            → OM PDF (base64) + pro forma CSVs → ~30 fields
//                                  with confidence + citations + cross-document
//                                  discrepancies (structured outputs, no guessing)
//   GET  /api/extractions/:id    → read a stored extraction row (polling contract
//                                  for the future background path)
import type { Config, Context } from '@netlify/functions'
import { runExtraction, type ExtractRequest } from './lib/gate1/extract-core.ts'
import { serviceClient } from './lib/supabase.ts'

// Netlify sync-function request bodies cap out near 6MB — leave headroom.
const MAX_BODY_BYTES = 4_500_000

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req: Request, context: Context): Promise<Response> => {
  const db = serviceClient()
  const id = (context.params as any)?.id as string | undefined

  if (req.method === 'GET' && id) {
    if (!db) return json(503, { error: 'Persistence not configured' })
    const { data, error } = await db.from('extractions').select('*').eq('id', id).maybeSingle()
    if (error) return json(500, { error: error.message })
    return data ? json(200, data) : json(404, { error: 'Extraction not found' })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return json(413, {
      error: 'Documents too large for sync extraction — compress the OM PDF below ~3MB (background extraction lands in a later milestone)',
    })
  }
  let body: ExtractRequest
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  let rowId: string | null = null
  if (db) {
    const { data } = await db
      .from('extractions')
      .insert({
        status: 'running',
        input_docs: {
          pdf: body.pdfFilename ?? (body.pdfBase64 ? 'uploaded.pdf' : null),
          sheets: (body.sheets ?? []).map(s => s.name),
        },
      })
      .select('id')
      .single()
    rowId = data?.id ?? null
  }

  try {
    const result = await runExtraction(body)
    if (db && rowId) {
      await db
        .from('extractions')
        .update({
          status: 'done',
          model: result.model,
          fields: result.fields,
          discrepancies: result.discrepancies,
          completed_at: new Date().toISOString(),
        })
        .eq('id', rowId)
    }
    return json(200, { extractionId: rowId, ...result })
  } catch (e: any) {
    if (db && rowId) {
      await db.from('extractions').update({ status: 'error', error: String(e?.message ?? e) }).eq('id', rowId)
    }
    return json(e?.status ?? 500, { error: e?.message ?? 'Extraction failed' })
  }
}

export const config: Config = {
  path: ['/api/extract', '/api/extractions/:id'],
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: 'ip' },
}
