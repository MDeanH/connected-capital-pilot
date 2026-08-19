// Weekly macro snapshot cron — Mondays 13:00 UTC (pre-US-open). Thin by
// design: fetch FRED, load the previous snapshot (hysteresis), run the same
// pure compute as /api/macro, persist. All logic lives in lib/gate1/macro.ts.

import type { Config } from '@netlify/functions'
import { fetchSeriesMap } from './lib/gate1/fred.ts'
import { buildMarketContext, computeMacroSnapshot, MARKET_SERIES } from './lib/gate1/macro.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Gate1Config, MacroSnapshot } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

export default async (): Promise<Response> => {
  const db = serviceClient()

  let cfg: Gate1Config = DEFAULT_CONFIG
  let previous: MacroSnapshot | null = null
  if (db) {
    const { data: cfgRow, error: cfgError } = await db
      .from('threshold_configs')
      .select('config')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cfgError) {
      // Same rule as the snapshot lookup below: a failed read must not pass
      // for "no saved config" — computing under stale default thresholds is
      // worse than skipping the week.
      console.error(`macro-cron: config lookup failed — ${cfgError.message}`)
      return new Response(`config lookup failed: ${cfgError.message}`, { status: 500 })
    }
    if (cfgRow) cfg = cfgRow.config as Gate1Config
    const { data: prevRow, error: prevError } = await db
      .from('macro_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (prevError) {
      // A failed lookup must not pass for "no history": computing without the
      // previous snapshot bypasses hysteresis and can persist an immediate
      // regime flip. Skip the week instead — that is recoverable.
      console.error(`macro-cron: previous-snapshot lookup failed — ${prevError.message}`)
      return new Response(`previous-snapshot lookup failed: ${prevError.message}`, { status: 500 })
    }
    if (prevRow) previous = (prevRow.snapshot ?? prevRow) as MacroSnapshot
  }

  const ids: Record<string, string> = { ...MARKET_SERIES }
  for (const def of cfg.macro.signals ?? []) if (def.fred) ids[def.id] = def.fred
  const series = await fetchSeriesMap(ids)

  const snapshot = computeMacroSnapshot({
    config: cfg,
    weekOf: new Date().toISOString().slice(0, 10),
    series,
    previous,
  })
  const market = buildMarketContext({
    sofr: series.sofr ?? [],
    mortgage30y: series.mortgage30y ?? [],
    treasury10y: series.treasury10y ?? [],
    sp500: series.sp500 ?? [],
  })
  const full = { ...snapshot, market }

  if (!db) {
    console.log(`macro-cron: Supabase not configured — computed ${full.regime} (degraded=${full.degraded}) but NOT persisted`)
    return new Response('skipped — no Supabase', { status: 200 })
  }
  const { error } = await db.from('macro_snapshots').insert({
    week_of: full.week_of,
    source: full.source,
    // signals is NOT NULL in the schema — see macro.ts; same fix here.
    signals: full.signals,
    regime: full.regime,
    pending_regime: full.pending_regime ?? null,
    degraded: full.degraded,
    postures: full.postures,
    hurdle: full.hurdle ?? null,
    note: full.note ?? null,
    snapshot: full,
  })
  if (error) {
    console.error(`macro-cron: insert failed — ${error.message}`)
    return new Response(`insert failed: ${error.message}`, { status: 500 })
  }
  console.log(`macro-cron: persisted ${full.week_of} regime=${full.regime} degraded=${full.degraded}`)
  return new Response('ok', { status: 200 })
}

export const config: Config = {
  schedule: '0 13 * * 1',
}
