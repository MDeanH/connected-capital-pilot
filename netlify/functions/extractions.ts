// Extraction result polling — reads what extract-background wrote to Blobs.
//   GET /api/extractions/:id → { status: 'running' | 'done' | 'error', ... }
//   or 410 { error } once the record has aged out (see lazy expiry below).
// An id with no blob yet reports 'running' (the background function may not
// have started); the client owns the give-up timeout.
import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

// EXPIRY — privacy rationale. Terminal result blobs hold extracted deal
// fields, verbatim citation quotes from the sponsor's documents, and
// discrepancy notes — confidential deal content, sitting in the Blobs store of
// every deploy INCLUDING the public client site — and Netlify Blobs has no
// native TTL. Enforcement has two arms sharing the bounds below (exported so
// they cannot drift): this GET deletes lazily on read — any terminal
// (done/error) record older than RETENTION_DAYS is deleted and answered with
// 410 — and the daily extractions-reaper.ts cron sweeps what nobody ever
// polls again (an abandoned result must not outlive the window either). A
// week is ample for the analyst flow (poll → verify → decide happens within
// minutes; the id is also persisted to Supabase for provenance on
// db-configured deploys), and it bounds how long extracted deal content can
// sit in Blobs on ANY deploy.
const RETENTION_DAYS = 7
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000
// Choice: stuck 'running' records are ALSO reaped, after 1 day. A live job is
// bounded by the worker's 15-minute limit, so a day-old 'running' record can
// only be a stub whose worker died before writing a terminal record (or whose
// trigger never fired). It holds no extracted content — just status and
// timestamps — but it would otherwise sit forever; 410 tells a (very late)
// polling client honestly that there is nothing left to watch. Records that
// are genuinely mid-run are never expired here: they are minutes old.
export const STUCK_RUNNING_MS = 24 * 60 * 60 * 1000

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const expired = () =>
  json(410, { error: `Extraction result expired — results are retained for ${RETENTION_DAYS} days` })

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const id = String((context.params as any)?.id ?? '').trim()
  // Ids are Blobs keys; require the canonical v4 UUID the client mints so a
  // request can never read a reserved 'payload-<id>' staged-document blob (the
  // full base64 OM) by asking for it here as a status record.
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return json(400, { error: 'Invalid extraction id' })
  }
  const store = getStore('extractions')
  const data = (await store.get(id, { type: 'json' })) as Record<string, any> | null
  if (!data) return json(200, { status: 'running' })

  const now = Date.now()
  if (data.status === 'done' || data.status === 'error') {
    // Terminal timestamp: 'done' records carry completedAt (written by
    // extract-run-background); 'error' records are written WITHOUT any
    // timestamp (all three error writers), and legacy 'done' records may
    // predate completedAt. Fallback for undated terminal records: stamp
    // retainedSince the first time this endpoint observes one, so its
    // retention window starts at first sight instead of never starting.
    let terminalAt = Date.parse(String(data.completedAt ?? data.retainedSince ?? ''))
    if (!Number.isFinite(terminalAt)) {
      const stamp = new Date().toISOString()
      try {
        await store.setJSON(id, { ...data, retainedSince: stamp })
      } catch { /* best effort — an unstamped record just gets re-stamped on the next read */ }
      terminalAt = Date.parse(stamp)
    }
    if (now - terminalAt > RETENTION_MS) {
      try { await store.delete(id) } catch { /* still answer 410; the delete retries on the next read */ }
      return expired()
    }
  } else {
    // Non-terminal: never expired inside the worker's window (the 15-minute
    // bound governs live jobs) — only a record stuck 'running' for over a day
    // is deleted. Undatable running records (no startedAt/submittedAt — no
    // current writer produces these) are conservatively served as-is.
    const runningSince = Date.parse(String(data.startedAt ?? data.submittedAt ?? ''))
    if (Number.isFinite(runningSince) && now - runningSince > STUCK_RUNNING_MS) {
      try { await store.delete(id) } catch { /* still answer 410; the delete retries on the next read */ }
      return expired()
    }
  }
  return json(200, data)
}

export const config: Config = {
  path: '/api/extractions/:id',
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
