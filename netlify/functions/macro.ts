// Macro API — Patel's weekly macro snapshot + prevailing-market context.
//   GET  /api/macro/latest   → newest FRESH stored snapshot, else compute LIVE from FRED
//   GET  /api/macro/history  → stored snapshots (newest first), [] without Supabase
//   POST /api/macro/override → manual regime/signal override (note REQUIRED, never silent)
//
// All regime/vote/hurdle logic lives in lib/gate1/macro.ts (pure) — this file
// is I/O only: FRED fetches, Supabase reads/writes, HTTP shape.

import type { Config, Context } from '@netlify/functions'
import { requireAdmin } from './lib/auth.ts'
import { fetchSeriesMap } from './lib/gate1/fred.ts'
import { buildMarketContext, computeMacroSnapshot, MARKET_SERIES } from './lib/gate1/macro.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Gate1Config, MacroSnapshot, Regime } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const REGIMES: Regime[] = ['soft_landing', 'stagflation', 'recession']

type Db = NonNullable<ReturnType<typeof serviceClient>>

const STORED_UNAVAILABLE = 'Could not load the stored macro snapshot — try again'

// Two missed weekly cron runs. gate1.ts enforces the same bound for decisions separately.
const MAX_SNAPSHOT_AGE_DAYS = 14

// null = the query FAILED (callers 503) — a transient error must not silently
// swap the active rulebook for the baked default. Empty table keeps the baked
// default with version: null — there is no threshold_configs row to point at,
// so a caller stamping config_version must stamp null or violate the FK.
async function activeConfig(
  db: ReturnType<typeof serviceClient>,
): Promise<{ config: Gate1Config; version: number | null } | null> {
  if (!db) return { config: DEFAULT_CONFIG, version: null }
  const { data, error } = await db
    .from('threshold_configs')
    .select('version, config')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  if (!data) return { config: DEFAULT_CONFIG, version: null }
  return { config: data.config as Gate1Config, version: data.version as number }
}

// Configured signals with no FRED feed (fred: null — e.g. ISM PMI) take
// analyst-entered values via POST /override signalValues. A reading alone
// can't distinguish "no feed configured" from "feed down", so the API tells
// the dashboard which ids are manual-entry.
const manualSignalIdsOf = (config: Gate1Config): string[] =>
  (config.macro.signals ?? []).filter((d) => !d.fred).map((d) => d.id)

// Latest stored snapshot. null = the query itself FAILED — same rule as
// gate1.ts: a transient failure must not read as "empty table" and silently
// swap the stored posture for a live compute (which the UI then sends to
// /decide as an explicit override), so callers must 503.
// { stored: null } = genuinely empty table (or no row of the requested source)
// → compute live. `source: 'auto'` restricts to automatic snapshots — used by
// the override path to seed hysteresis (see there).
async function latestStored(
  db: Db,
  opts: { source?: 'auto' | 'manual' } = {},
): Promise<{ stored: { row: any; snapshot: MacroSnapshot } | null } | null> {
  let query = db.from('macro_snapshots').select('*')
  if (opts.source) query = query.eq('source', opts.source)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  if (!data) return { stored: null }
  return { stored: { row: data, snapshot: (data.snapshot ?? data) as MacroSnapshot } }
}

// Shared freshness rule: a stored snapshot still prevails (via /latest) —
// and its manual readings still carry into a new override — only while it is
// at most MAX_SNAPSHOT_AGE_DAYS old.
const isFreshStored = (stored: { row: any; snapshot: MacroSnapshot }): boolean => {
  const recordedAt = Date.parse(stored.row.created_at ?? stored.snapshot.week_of ?? '')
  return Number.isFinite(recordedAt) && Date.now() - recordedAt <= MAX_SNAPSHOT_AGE_DAYS * 86_400_000
}

/** Fetch every configured FRED series (signals + market ids) and compute a snapshot. */
async function computeLive(
  config: Gate1Config,
  opts: {
    previous?: MacroSnapshot | null
    manualValues?: Record<string, number>
    forcedRegime?: Regime
    source?: 'auto' | 'manual'
    note?: string
  } = {},
) {
  const ids: Record<string, string> = { ...MARKET_SERIES }
  for (const def of config.macro.signals ?? []) if (def.fred) ids[def.id] = def.fred
  const series = await fetchSeriesMap(ids)
  const snapshot = computeMacroSnapshot({
    config,
    weekOf: new Date().toISOString().slice(0, 10),
    series,
    manualValues: opts.manualValues,
    previous: opts.previous ?? null,
    forcedRegime: opts.forcedRegime,
    source: opts.source,
    note: opts.note,
  })
  const market = buildMarketContext({
    sofr: series.sofr ?? [],
    mortgage30y: series.mortgage30y ?? [],
    treasury10y: series.treasury10y ?? [],
    sp500: series.sp500 ?? [],
  })
  return { ...snapshot, market }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const path = new URL(req.url).pathname
  const db = serviceClient()

  if (path.endsWith('/override')) {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    // An override becomes the prevailing posture for every decision — admin only.
    const gate = await requireAdmin(req)
    if (gate.response) return gate.response
    let body: any
    try {
      body = JSON.parse((await req.text()) || '{}')
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    if (typeof body.note !== 'string' || !body.note.trim()) {
      return json(400, { error: 'Override requires a note — manual control is never silent' })
    }
    if (body.regime !== undefined && !REGIMES.includes(body.regime)) {
      return json(400, { error: `regime must be one of ${REGIMES.join(', ')}` })
    }
    const active = await activeConfig(db)
    if (!active) return json(503, { error: 'Could not load the active rulebook — try again' })
    const manualSignalIds = manualSignalIdsOf(active.config)
    // Hysteresis predecessor: the newest AUTOMATIC snapshot only — the same
    // rule macro-cron applies when it seeds its weekly compute. Scoring an
    // override against the newest row of ANY source would make each same-week
    // manual save read the previous (manual) save as its predecessor and
    // advance pending_wins once per save — a resubmitted correction could flip
    // the fund-wide regime on one week's evidence. A forcedRegime override is
    // unaffected (it bypasses scoring); signal-only overrides score against
    // the automatic baseline, so manual chains can never stack wins.
    let previous: MacroSnapshot | null = null
    // Manual-reading lifetime rule: a reading entered for a manual-entry
    // signal (fred: null, e.g. ISM) persists across later manual overrides
    // and expires at the next AUTOMATIC snapshot — macro-cron passes no
    // manualValues to its compute, so the weekly auto row stores those
    // signals as null and nothing carries from it (confirmed in
    // macro-cron.ts). Without this carry, a later regime-only override would
    // replace the prevailing snapshot and silently drop previously-entered
    // readings (ISM → NO DATA), contradicting the dashboard's "hold until
    // next Monday's automatic snapshot" copy. Readings carry only from the
    // newest stored snapshot while it is still fresh enough to prevail
    // (isFreshStored — /latest's own bound): a snapshot /latest already
    // refuses to serve must not resurrect its readings. Only ids the ACTIVE
    // config marks manual-entry carry — a manual correction of a live FRED
    // feed stays a one-snapshot judgment.
    const carried: Record<string, number> = {}
    if (db) {
      const latestAuto = await latestStored(db, { source: 'auto' })
      if (!latestAuto) return json(503, { error: STORED_UNAVAILABLE })
      previous = latestAuto.stored?.snapshot ?? null
      // Any-source lookup: the newest row is what /latest serves. If it is an
      // auto row its manual-config signals are already null (see above), so
      // the carry is naturally empty — expiry needs no special case. A failed
      // read 503s: silently skipping the carry would drop readings, which is
      // the exact bug this exists to prevent.
      const latestAny = await latestStored(db)
      if (!latestAny) return json(503, { error: STORED_UNAVAILABLE })
      if (latestAny.stored && isFreshStored(latestAny.stored)) {
        for (const sig of latestAny.stored.snapshot.signals ?? []) {
          if (manualSignalIds.includes(sig.id) && typeof sig.value === 'number' && Number.isFinite(sig.value)) {
            carried[sig.id] = sig.value
          }
        }
      }
    }
    // Request values win over carried ones. Clearing semantics: an explicit
    // null (or non-numeric) entry in signalValues overrides the carried
    // number, computeMacroSnapshot ignores the non-finite value (the signal
    // reads NO DATA), and the persisted snapshot stores it as null — so the
    // cleared reading does not carry into later overrides either.
    const requested: Record<string, unknown> =
      body.signalValues && typeof body.signalValues === 'object' ? body.signalValues : {}
    const snapshot = await computeLive(active.config, {
      previous,
      // computeMacroSnapshot validates per-entry (finite numbers only), which
      // is what makes the null/garbage clearing path above safe to pass through.
      manualValues: { ...carried, ...requested } as Record<string, number>,
      forcedRegime: body.regime as Regime | undefined,
      source: 'manual',
      note: body.note.trim(),
    })
    if (!db) {
      return json(200, { ...snapshot, manualSignalIds, persisted: false, warning: 'Supabase not configured — override computed but NOT recorded' })
    }
    // Attribution rides in the blob too — /history reads only the snapshot
    // jsonb, so a column-only stamp would never surface to the UI.
    const stamped = gate.identity ? { ...snapshot, author_email: gate.identity.email } : snapshot
    const { data: row, error } = await db
      .from('macro_snapshots')
      .insert({
        week_of: snapshot.week_of,
        source: snapshot.source,
        // signals is NOT NULL in the schema — omitting it made every insert
        // fail silently against the real database (nothing ever persisted).
        signals: snapshot.signals,
        regime: snapshot.regime,
        pending_regime: snapshot.pending_regime ?? null,
        degraded: snapshot.degraded,
        postures: snapshot.postures,
        hurdle: snapshot.hurdle ?? null,
        // Provenance: the rulebook this override was computed under. null only
        // while threshold_configs is empty (still on the deploy-baked default):
        // the FK needs an existing row, and inventing one is not this
        // endpoint's job — same rule as macro-cron.
        config_version: active.version,
        note: snapshot.note ?? null,
        author_email: gate.identity?.email ?? null,
        snapshot: stamped,
      })
      .select('id, created_at')
      .single()
    if (error) return json(500, { error: `Failed to record override: ${error.message}` })
    return json(200, { ...stamped, manualSignalIds, persisted: true, id: row.id, createdAt: row.created_at })
  }

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  if (path.endsWith('/history')) {
    if (!db) return json(200, [])
    const { data, error } = await db
      .from('macro_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(52)
    if (error) return json(503, { error: STORED_UNAVAILABLE })
    return json(200, (data ?? []).map((r: any) => ({ ...((r.snapshot ?? r) as MacroSnapshot), id: r.id, createdAt: r.created_at })))
  }

  // /latest — a fresh stored row wins; stale or missing → an honest live
  // compute (not persisted). A stored row so old the weekly cron must be dead
  // must not keep serving as the prevailing posture.
  let staleWeekOf: string | null = null
  if (db) {
    const latest = await latestStored(db)
    if (!latest) return json(503, { error: STORED_UNAVAILABLE })
    const stored = latest.stored
    if (stored) {
      if (isFreshStored(stored)) {
        // manualSignalIds is best-effort here: it rides from the ACTIVE config
        // (the snapshot's readings can't say whether a feed exists), and a
        // failed rulebook read must not 503 a perfectly good stored snapshot —
        // the field is omitted and the override form degrades to regime-only.
        const active = await activeConfig(db)
        return json(200, {
          ...stored.snapshot,
          id: stored.row.id,
          createdAt: stored.row.created_at,
          persisted: true,
          sourceNote: 'stored weekly snapshot',
          ...(active ? { manualSignalIds: manualSignalIdsOf(active.config) } : {}),
        })
      }
      staleWeekOf = stored.snapshot.week_of ?? null
    }
  }
  const active = await activeConfig(db)
  if (!active) return json(503, { error: 'Could not load the active rulebook — try again' })
  const snapshot = await computeLive(active.config)
  return json(200, {
    ...snapshot,
    manualSignalIds: manualSignalIdsOf(active.config),
    live: true,
    persisted: false,
    sourceNote: staleWeekOf
      ? `computed live from FRED — newest stored snapshot (week of ${staleWeekOf}) is older than ${MAX_SNAPSHOT_AGE_DAYS} days`
      : 'computed live from FRED — no stored snapshots yet',
    ...(staleWeekOf
      ? { warning: `Stored macro snapshot (week of ${staleWeekOf}) is more than ${MAX_SNAPSHOT_AGE_DAYS} days old — showing a live compute; check the weekly macro cron` }
      : {}),
  })
}

export const config: Config = {
  path: ['/api/macro/latest', '/api/macro/history', '/api/macro/override'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
