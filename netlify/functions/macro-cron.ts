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
    const { data: cfgRow } = await db
      .from('threshold_configs')
      .select('config')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cfgRow) cfg = cfgRow.config as Gate1Config
    const { data: prevRow } = await db
      .from('macro_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
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
