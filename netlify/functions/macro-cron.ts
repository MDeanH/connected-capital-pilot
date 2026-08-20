// Weekly macro snapshot cron — Mondays 13:00 UTC (pre-US-open). Thin by
// design: fetch FRED, load the previous snapshot (hysteresis), run the same
// pure compute as /api/macro, persist. All logic lives in lib/gate1/macro.ts.

import type { Config } from '@netlify/functions'
import { fetchSeriesMap } from './lib/gate1/fred.ts'
import { buildMarketContext, computeMacroSnapshot, MARKET_SERIES, utcWeekStart } from './lib/gate1/macro.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Gate1Config, MacroSnapshot } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

// Two missed weekly cron runs. Keep in sync with MAX_SNAPSHOT_AGE_DAYS in
// macro.ts (/latest + override) and gate1.ts — each function file mirrors the
// constant locally; none exports it.
const MAX_SNAPSHOT_AGE_DAYS = 14

export default async (req: Request): Promise<Response> => {
  // Defense-in-depth scheduled-shape check — NOT authentication.
  //
  // PRIMARY protection is at the edge: netlify/edge-functions/gate.ts hard-blocks
  // this function's public HTTP path (/.netlify/functions/macro-cron) with 403
  // for EVERY external request, ahead of any auth or exemption. The genuine
  // weekly run is driven by Netlify's platform scheduler, which invokes this
  // function INTERNALLY and does not traverse the edge — so the edge block stops
  // every external caller while leaving the 13:00-UTC Monday run intact.
  //
  // Why this run must never be externally triggerable: it persists the week's
  // macro posture, and the same-week duplicate guard below means the FIRST run of
  // a week wins — an early manual hit by any pilot-cookie holder (an analyst,
  // when REQUIRE_ACCOUNTS is on) would stamp that week's posture and make the
  // legitimate Monday run skip as a duplicate.
  //
  // The check below is a SECOND layer, should a request ever reach this handler
  // (edge misconfiguration, an internal replay, a future routing change). It
  // verifies only the scheduled-invocation SHAPE: a Netlify v2 scheduled call
  // carries a JSON body with a `next_run` ISO-8601 string (the documented
  // `const { next_run } = await req.json()` pattern) that an ordinary browser
  // navigation lacks. It is NOT proof of authenticity — `next_run` is a plain
  // body field any caller can forge — so it is kept only as a cheap sanity gate
  // behind the edge block, never relied on as the security boundary. Rejecting on
  // a missing/unparseable body is safe because `next_run` is part of every
  // genuine scheduled call, so this cannot reject a real weekly run.
  let scheduled = false
  try {
    const body = await req.json()
    scheduled = body != null && typeof body.next_run === 'string' && body.next_run.length > 0
  } catch {
    // No body, or one that is not JSON — not a scheduled-shaped invocation.
    scheduled = false
  }
  if (!scheduled) {
    return new Response('Forbidden: macro-cron runs only on the Netlify schedule', { status: 403 })
  }

  const db = serviceClient()

  // The date this run's snapshot would carry (computeMacroSnapshot stamps it
  // verbatim): the UTC week start, never the run date, so a manual retry later
  // in the same week stamps — and the duplicate guard below compares — the
  // same week as Monday's scheduled run. Computed once so the guard and the
  // compute agree.
  const weekOf = utcWeekStart(new Date())

  let cfg: Gate1Config = DEFAULT_CONFIG
  // null = empty threshold_configs table (still on the deploy-baked default).
  let cfgVersion: number | null = null
  let previous: MacroSnapshot | null = null
  if (db) {
    const { data: cfgRow, error: cfgError } = await db
      .from('threshold_configs')
      .select('version, config')
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
    if (cfgRow) {
      cfg = cfgRow.config as Gate1Config
      cfgVersion = cfgRow.version as number
    }
    // Hysteresis predecessor: the newest AUTOMATIC snapshot only. A manual
    // override is a stated judgment, not measured evidence — seeding hysteresis
    // from it would extend a forced regime a full extra hysteresis cycle (a
    // forced green would hold against next Monday's honest red candidate).
    // Expiry semantics: manual rows stay in history and keep prevailing via
    // /latest (newest row wins) only until this run inserts a newer auto row —
    // that insert is exactly when an override expires. Manual rows never seed
    // automatic hysteresis, degraded fallback, or the pending_wins streak.
    const { data: prevRow, error: prevError } = await db
      .from('macro_snapshots')
      .select('*')
      .eq('source', 'auto')
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
    // Freshness bound — the same MAX_SNAPSHOT_AGE_DAYS rule macro.ts applies
    // on /latest and the override path (isFreshStored). Resuming after a
    // >14-day outage must not carry the obsolete regime through hysteresis and
    // the degraded fallback into a FRESH row that would then prevail
    // fund-wide, when /latest and the override path already refuse the same
    // stale predecessor. A broken weekly chain restarts from current evidence:
    // previous = null. Fails closed like isFreshStored — an unparsable
    // created_at reads stale. The same-week duplicate guard below is
    // unaffected: it checks prevRow directly, and a stale row can never be
    // same-week anyway (its created_at is >14 days old — more than a full
    // week before this run's week stamp).
    if (prevRow) {
      const recordedAt = Date.parse(prevRow.created_at ?? prevRow.week_of ?? '')
      const fresh =
        Number.isFinite(recordedAt) && Date.now() - recordedAt <= MAX_SNAPSHOT_AGE_DAYS * 86_400_000
      if (fresh) {
        previous = (prevRow.snapshot ?? prevRow) as MacroSnapshot
      } else {
        console.log(
          `macro-cron: newest auto snapshot (week of ${prevRow.week_of}) is older than ${MAX_SNAPSHOT_AGE_DAYS} days — restarting hysteresis from current evidence`,
        )
      }
    }
    // Duplicate-run guard: a second auto run in the same week would insert a
    // second snapshot and read the first as "previous", double-advancing
    // pending_wins — a two-week hysteresis could flip on one week's evidence.
    // The stored week_of is normalized too: rows written before week-start
    // stamping carry raw run dates, and a Tuesday retry must still recognize
    // Monday's row as this week's snapshot. The lookup above is auto-only, so
    // a manual override can neither block the weekly run nor mask an auto row
    // recorded earlier this week.
    if (prevRow && utcWeekStart(prevRow.week_of ?? '') === weekOf) {
      console.log(`macro-cron: already recorded for week ${weekOf} — skipping duplicate run`)
      return new Response(`already recorded for week ${weekOf}`, { status: 200 })
    }
  }

  const ids: Record<string, string> = { ...MARKET_SERIES }
  for (const def of cfg.macro.signals ?? []) if (def.fred) ids[def.id] = def.fred
  const series = await fetchSeriesMap(ids)

  const snapshot = computeMacroSnapshot({
    config: cfg,
    weekOf,
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
    // null only when threshold_configs is empty: the FK needs an existing row,
    // and gate1's decide self-heals v0 — the cron must not invent rows.
    config_version: cfgVersion,
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
