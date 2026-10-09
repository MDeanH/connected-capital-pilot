// Scheduled retention reaper for the 'extractions' Blobs store — daily cron.
//
// extractions.ts promises 7-day retention but can only enforce it lazily, on
// GET — a result nobody polls again (the analyst closes the page) would live
// forever, and Netlify Blobs has no native TTL (@netlify/blobs 10.7.9:
// SetOptions carries only metadata + conditional-write flags). This cron is
// the active arm of the same promise. It lists the store, reads each record
// (listings carry only key + etag — no timestamps), and applies the SAME
// bounds the lazy path uses, imported from extractions.ts so the two arms can
// never drift:
//   - terminal (done/error) records older than RETENTION_MS → deleted
//   - 'running' records stuck longer than STUCK_RUNNING_MS → deleted
//   - undated terminal records → stamped retainedSince (exactly as the lazy
//     GET does), so their window starts now and a later run deletes them
// plus one bound of its own for the staged documents:
//   - payload-* blobs older than PAYLOAD_MAX_AGE_MS → deleted. Both writers
//     delete the payload at claim/finish (extract-run-background) or on
//     trigger failure (extract-submit), so any survivor is a leak from a
//     crashed worker or a failed delete. It holds the full base64 OM — the
//     most sensitive content in the store — and must never outlive its run.
//
// db-null deploys (the public client site) run this too: extraction works
// without Supabase, so the store exists — and holds deal content — wherever
// extraction ever ran. On a deploy where it never ran, the listing is simply
// empty and the sweep is a no-op.

import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { cronKeyAuthenticated } from './lib/cron-auth.ts'
import { RETENTION_MS, STUCK_RUNNING_MS } from './extractions.ts'

// A staged payload is minutes old in any legitimate life (submit → trigger →
// worker claim deletes it); a day is generous slack, and matches the bound the
// finding states: a payload must never outlive its run by more than a day.
const PAYLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PAYLOAD_PREFIX = 'payload-'
// Scheduled functions run under the synchronous execution limit — stop with a
// partial pass rather than time out; the daily cadence catches up, and every
// decision below is idempotent.
const TIME_BUDGET_MS = 8_000
// Reserve wall-clock for the payload pass so the record pass can never starve
// it. Both passes share the budget, but the record pass runs FIRST (the payload
// pass dates payloads off the records it reads), so on a populated store (up to
// ~200 submits/day × 7 days of status records) the record loop could consume
// the whole budget — leaving the payload loop to break on its first iteration
// EVERY run and let full base64 OMs + sheet text, the most sensitive content in
// the store, accrue unbounded. Capping the record pass short guarantees payload
// cleanup time each run; a record pass truncated by the cap only defers some
// payloads to the next run (the onlyIfNew stamp below already tolerates an
// incomplete records map).
const PAYLOAD_RESERVE_MS = 3_000
const RECORD_PASS_BUDGET_MS = TIME_BUDGET_MS - PAYLOAD_RESERVE_MS

const parseFirstDate = (...candidates: unknown[]): number => {
  for (const c of candidates) {
    const t = Date.parse(String(c ?? ''))
    if (Number.isFinite(t)) return t
  }
  return NaN
}

export default async (req: Request): Promise<Response> => {
  // Same dual invoker contract as macro-cron (see the comment there and
  // lib/cron-auth.ts): the external pg_cron trigger authenticates with
  // x-cron-key; a genuine Netlify scheduled call carries a next_run body and
  // never traverses the edge. Everything else is refused — the sweep deletes
  // data, so an unauthenticated hit must stay a no-op even if the edge block
  // were ever misconfigured.
  let scheduled = cronKeyAuthenticated(req)
  if (!scheduled) {
    try {
      const body = await req.json()
      scheduled = body != null && typeof body.next_run === 'string' && body.next_run.length > 0
    } catch {
      scheduled = false
    }
  }
  if (!scheduled) {
    return new Response('Forbidden: extractions-reaper runs only on a schedule', { status: 403 })
  }

  const started = Date.now()
  const store = getStore('extractions')

  let scanned = 0
  let deletedRecords = 0
  let deletedPayloads = 0
  let stamped = 0
  let failures = 0
  let partial = false

  try {
    // One listing up front, split into records and payloads, so payload
    // decisions can use record data captured BEFORE any record deletion below.
    const recordKeys: string[] = []
    const payloadKeys: string[] = []
    for await (const page of store.list({ paginate: true })) {
      for (const { key } of page.blobs) {
        // 'payload-' uniquely marks a staged-document blob: extract-submit and
        // the extractions GET both require a v4-UUID id, which can never begin
        // with 'payload-', so a status record can no longer collide into the
        // payload key space (or a payload into the record space).
        if (key.startsWith(PAYLOAD_PREFIX)) payloadKeys.push(key)
        else recordKeys.push(key)
      }
    }
    scanned = recordKeys.length + payloadKeys.length

    const records = new Map<string, Record<string, any>>()
    for (const id of recordKeys) {
      // Capped short of the full budget: the payload pass below MUST get time
      // this run (its content is the most sensitive in the store).
      if (Date.now() - started > RECORD_PASS_BUDGET_MS) { partial = true; break }
      try {
        const data = (await store.get(id, { type: 'json' })) as Record<string, any> | null
        if (!data || typeof data !== 'object') continue // deleted since listing, or not a record
        records.set(id, data)
        const now = Date.now()
        if (data.status === 'done' || data.status === 'error') {
          // Same dating as the lazy GET: completedAt, else the retainedSince
          // stamped when an undated terminal record was first observed.
          const terminalAt = parseFirstDate(data.completedAt, data.retainedSince)
          if (!Number.isFinite(terminalAt)) {
            await store.setJSON(id, { ...data, retainedSince: new Date().toISOString() })
            stamped++
          } else if (now - terminalAt > RETENTION_MS) {
            await store.delete(id)
            deletedRecords++
          }
        } else {
          // Non-terminal: only a record stuck 'running' beyond the stuck bound
          // is dead (live jobs are bounded by the worker's 15-minute limit).
          // Undatable running records are conservatively left, as on GET.
          const runningSince = parseFirstDate(data.startedAt, data.submittedAt)
          if (Number.isFinite(runningSince) && now - runningSince > STUCK_RUNNING_MS) {
            await store.delete(id)
            deletedRecords++
          }
        }
      } catch {
        failures++ // one bad key must not abort the sweep
      }
    }

    for (const key of payloadKeys) {
      if (Date.now() - started > TIME_BUDGET_MS) { partial = true; break }
      const id = key.slice(PAYLOAD_PREFIX.length)
      try {
        const record = records.get(id)
        if (record) {
          // Dated by its run. submittedAt is written in the same breath as the
          // payload; the worker's claim write replaces it with startedAt, and
          // terminal/stamped records carry completedAt/retainedSince — every
          // later stamp only tightens the bound. A payload whose record dates
          // under the bound is (or may be) a live run: never deleted here.
          const bornAt = parseFirstDate(record.submittedAt, record.startedAt, record.completedAt, record.retainedSince)
          if (Number.isFinite(bornAt) && Date.now() - bornAt > PAYLOAD_MAX_AGE_MS) {
            await store.delete(key)
            deletedPayloads++
          }
        } else {
          // No status record: either submit crashed between its two writes
          // (nothing will ever consume this payload) or the record was reaped
          // while the payload delete failed. Undatable either way — so stamp a
          // dated terminal record and let the NEXT run delete the payload
          // under the normal bound, instead of deleting blind. The stamp must
          // lose every race: an in-flight submit (or worker) writing the real
          // record must never be clobbered — including the case where the
          // record exists but its read failed above, and a budget-truncated
          // record pass (records is then incomplete). It goes through set() +
          // onlyIfNew, NOT setJSON(): @netlify/blobs 10.7.9 silently drops the
          // conditional flag on setJSON(), making the write unconditional and
          // able to overwrite a concurrent running/done record with this error,
          // stranding a paid result. Count it only when the stamp actually won.
          const stamp = await store.set(
            id,
            JSON.stringify({ status: 'error', error: 'Extraction never started — resubmit', retainedSince: new Date().toISOString() }),
            { onlyIfNew: true },
          )
          if (stamp.modified) stamped++
        }
      } catch {
        failures++
      }
    }
  } catch (e: any) {
    // Listing failed (or another non-per-key error) — log and surface non-200
    // so a broken sweep is visible in the function logs, not silently green.
    console.error(`extractions-reaper: sweep failed — ${String(e?.message ?? e)}`)
    return new Response(`sweep failed: ${String(e?.message ?? e)}`, { status: 500 })
  }

  console.log(
    `extractions-reaper: scanned=${scanned} deleted=${deletedRecords + deletedPayloads} (records=${deletedRecords} payloads=${deletedPayloads}) stamped=${stamped} failures=${failures}${partial ? ' partial=1 (time budget)' : ''}`,
  )
  return new Response('ok', { status: 200 })
}

export const config: Config = {
  // Daily, off-peak UTC. The bounds are measured in days, so daily granularity
  // enforces them within one cadence; each run is idempotent and safe to miss.
  schedule: '30 3 * * *',
}
