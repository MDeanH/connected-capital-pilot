// Extraction result polling — reads what extract-background wrote to Blobs.
//   GET /api/extractions/:id → { status: 'running' | 'done' | 'error', ... }
// An id with no blob yet reports 'running' (the background function may not
// have started); the client owns the give-up timeout.
import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const id = String((context.params as any)?.id ?? '').trim()
  if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) return json(400, { error: 'Invalid extraction id' })
  const store = getStore('extractions')
  const data = await store.get(id, { type: 'json' })
  return json(200, data ?? { status: 'running' })
}

export const config: Config = {
  path: '/api/extractions/:id',
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
