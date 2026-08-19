// Macro API — Patel's weekly macro snapshot + prevailing-market context.
//   GET  /api/macro/latest   → newest stored snapshot, else compute LIVE from FRED
//   GET  /api/macro/history  → stored snapshots (newest first), [] without Supabase
//   POST /api/macro/override → manual regime/signal override (note REQUIRED, never silent)
//
// All regime/vote/hurdle logic lives in lib/gate1/macro.ts (pure) — this file
// is I/O only: FRED fetches, Supabase reads/writes, HTTP shape.

import type { Config, Context } from '@netlify/functions'
import { fetchSeriesMap } from './lib/gate1/fred.ts'
import { buildMarketContext, computeMacroSnapshot, MARKET_SERIES } from './lib/gate1/macro.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Gate1Config, MacroSnapshot, Regime } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const REGIMES: Regime[] = ['soft_landing', 'stagflation', 'recession']

async function activeConfig(db: ReturnType<typeof serviceClient>): Promise<Gate1Config> {
  if (!db) return DEFAULT_CONFIG
  const { data } = await db
    .from('threshold_configs')
    .select('config')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.config as Gate1Config) ?? DEFAULT_CONFIG
}

async function latestStored(db: ReturnType<typeof serviceClient>): Promise<{ row: any; snapshot: MacroSnapshot } | null> {
  if (!db) return null
  const { data } = await db
    .from('macro_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { row: data, snapshot: (data.snapshot ?? data) as MacroSnapshot }
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
    const config = await activeConfig(db)
    const previous = (await latestStored(db))?.snapshot ?? null
    const snapshot = await computeLive(config, {
      previous,
      manualValues: body.signalValues && typeof body.signalValues === 'object' ? body.signalValues : undefined,
      forcedRegime: body.regime as Regime | undefined,
      source: 'manual',
      note: body.note.trim(),
    })
    if (!db) {
      return json(200, { ...snapshot, persisted: false, warning: 'Supabase not configured — override computed but NOT recorded' })
    }
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
        note: snapshot.note ?? null,
        snapshot,
      })
      .select('id, created_at')
      .single()
    if (error) return json(500, { error: `Failed to record override: ${error.message}` })
    return json(200, { ...snapshot, persisted: true, id: row.id, createdAt: row.created_at })
  }

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  if (path.endsWith('/history')) {
    if (!db) return json(200, [])
    const { data, error } = await db
      .from('macro_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(52)
    if (error) return json(500, { error: error.message })
    return json(200, (data ?? []).map((r: any) => ({ ...((r.snapshot ?? r) as MacroSnapshot), id: r.id, createdAt: r.created_at })))
  }

  // /latest — stored row wins; otherwise an honest live compute (not persisted).
  const stored = await latestStored(db)
  if (stored) {
    return json(200, {
      ...stored.snapshot,
      id: stored.row.id,
      createdAt: stored.row.created_at,
      persisted: true,
      sourceNote: 'stored weekly snapshot',
    })
  }
  const config = await activeConfig(db)
  const snapshot = await computeLive(config)
  return json(200, { ...snapshot, live: true, persisted: false, sourceNote: 'computed live from FRED — no stored snapshots yet' })
}

export const config: Config = {
  path: ['/api/macro/latest', '/api/macro/history', '/api/macro/override'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
