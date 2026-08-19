// Config versions API — append-only threshold_configs ledger.
//   GET  /api/config/active    → highest version (or the shipped default as version 0)
//   GET  /api/config           → version list (metadata only)
//   GET  /api/config/:version  → one full versioned config (version 0 = shipped default)
//   POST /api/config           → append a new version { config, note, baseVersion, author? }
//                                 (note required; baseVersion = the version the draft was edited
//                                 from — a mismatch with the current max returns 409, so a stale
//                                 draft can never silently discard intervening versions)
//
// Version 0 is always the default-config.json baked into the deploy, so every
// environment has a well-defined active config even without Supabase.

import type { Config, Context } from '@netlify/functions'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import { serviceClient } from './lib/supabase.ts'

/**
 * A saved config becomes the ACTIVE rulebook for every evaluation — a
 * structurally broken one (empty checks, missing macro) bricks the pilot
 * globally until another version lands. Validate the whole shape, not just
 * that thresholds is an array.
 */
export function configShapeError(c: any): string | null {
  if (!c || typeof c !== 'object') return 'config must be an object'
  if (!Array.isArray(c.checks) || c.checks.length === 0) return 'checks must be a non-empty array'
  for (const ch of c.checks) {
    if (!ch || typeof ch.id !== 'string' || (ch.kind !== 'kill' && ch.kind !== 'flag')) {
      return 'every check needs a string id and kind "kill" or "flag"'
    }
    // The engine dereferences label and thresholdKeys on every check (see
    // lib/gate1/engine.ts runCheck) — a check without them crashes evaluation.
    if (typeof ch.label !== 'string' ||
        !Array.isArray(ch.thresholdKeys) || !ch.thresholdKeys.every((k: any) => typeof k === 'string')) {
      return `check "${ch.id}" needs a string label and a thresholdKeys array of strings`
    }
    if (ch.flagPoints !== undefined &&
        (typeof ch.flagPoints !== 'number' || !Number.isFinite(ch.flagPoints) || ch.flagPoints <= 0)) {
      return `check "${ch.id}" flagPoints must be a positive finite number`
    }
    if (ch.tip !== undefined && typeof ch.tip !== 'string') {
      return `check "${ch.id}" tip must be a string`
    }
  }
  if (!Array.isArray(c.thresholds)) return 'thresholds must be an array'
  for (const r of c.thresholds) {
    if (!r || typeof r.asset_class !== 'string' || typeof r.posture !== 'string' ||
        typeof r.key !== 'string' || typeof r.value !== 'number' || !Number.isFinite(r.value)) {
      return 'every threshold row needs asset_class, posture, key and a finite numeric value'
    }
  }
  const rowKeys = new Set<string>(c.thresholds.map((r: any) => r.key))
  for (const ch of c.checks) {
    for (const key of ch.thresholdKeys as string[]) {
      if (!rowKeys.has(key)) {
        return `check "${ch.id}" references threshold key "${key}" but thresholds has no row for it`
      }
    }
  }
  const vb = c.verdictBands
  if (!vb || typeof vb.passMaxFlagPts !== 'number' || typeof vb.conditionalMaxFlagPts !== 'number') {
    return 'verdictBands needs numeric passMaxFlagPts and conditionalMaxFlagPts'
  }
  const m = c.macro
  if (!m || typeof m !== 'object' || !Array.isArray(m.signals) || m.signals.length === 0 ||
      !m.signalWeights || typeof m.signalWeights !== 'object' ||
      !m.postureMatrix || typeof m.postureMatrix !== 'object') {
    return 'macro needs non-empty signals plus signalWeights and postureMatrix'
  }
  // computeMacroSnapshot (lib/gate1/macro.ts) dereferences every field below on
  // every snapshot — a config saved without them makes the macro API and the
  // weekly cron throw until another version lands, so the full executable
  // MacroConfig shape is validated here, not just the top-level keys.
  const finite = (v: any) => typeof v === 'number' && Number.isFinite(v)
  for (let i = 0; i < m.signals.length; i++) {
    const s = m.signals[i]
    const name = s && typeof s.id === 'string' ? `"${s.id}"` : `#${i}`
    if (!s || typeof s.id !== 'string' || typeof s.label !== 'string') {
      return `macro signal ${name} needs a string id and label`
    }
    if (s.fred !== null && typeof s.fred !== 'string') {
      return `macro signal "${s.id}" fred must be a FRED series id string or null`
    }
    if (!finite(s.weight)) return `macro signal "${s.id}" weight must be a finite number`
    if (s.transform !== 'level' && s.transform !== 'yoy') {
      return `macro signal "${s.id}" transform must be "level" or "yoy"`
    }
    if (s.direction !== 'high_is_bad' && s.direction !== 'high_is_good') {
      return `macro signal "${s.id}" direction must be "high_is_bad" or "high_is_good"`
    }
    if (!finite(s.green) || !finite(s.yellow)) {
      return `macro signal "${s.id}" needs finite numeric green and yellow bands`
    }
  }
  if (!finite(m.minVotes) || m.minVotes < 1) return 'macro minVotes must be a finite number >= 1'
  if (!finite(m.hysteresisWins) || m.hysteresisWins < 1) {
    return 'macro hysteresisWins must be a finite number >= 1'
  }
  const qb = m.quadrantBands
  if (!qb || typeof qb !== 'object' || !finite(qb.inflationHotYoy) || !finite(qb.growthRecessionYoy)) {
    return 'macro quadrantBands needs finite numeric inflationHotYoy and growthRecessionYoy'
  }
  for (const [regime, row] of Object.entries(m.postureMatrix)) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        !Object.values(row).every((p) => typeof p === 'string')) {
      return `macro postureMatrix "${regime}" must map asset classes to posture strings`
    }
  }
  const hs = m.hurdleStack
  if (!hs || typeof hs !== 'object') return 'macro needs a hurdleStack object'
  if (!finite(hs.anchorPct)) return 'macro hurdleStack anchorPct must be a finite number'
  if (!Array.isArray(hs.illiquidityBpsByLockupYears) || hs.illiquidityBpsByLockupYears.length === 0 ||
      !hs.illiquidityBpsByLockupYears.every((t: any) => t && finite(t.maxYears) && finite(t.bps))) {
    return 'macro hurdleStack illiquidityBpsByLockupYears must be a non-empty array of { maxYears, bps } finite numbers'
  }
  for (const key of ['complexityBpsByStrategy', 'regimeBps']) {
    const rec = hs[key]
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) ||
        !Object.values(rec).every((v) => finite(v))) {
      return `macro hurdleStack ${key} must be an object of finite numbers`
    }
  }
  return null
}

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const VERSION_ZERO = { version: 0, note: 'shipped default (default-config.json)', author: null, config: DEFAULT_CONFIG }

export default async (req: Request, _context: Context): Promise<Response> => {
  const path = new URL(req.url).pathname
  const db = serviceClient()

  if (req.method === 'POST') {
    let body: any
    try {
      body = JSON.parse((await req.text()) || '{}')
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    const shapeError = configShapeError(body.config)
    if (shapeError) {
      return json(400, { error: `Config rejected: ${shapeError}` })
    }
    if (typeof body.note !== 'string' || !body.note.trim()) {
      return json(400, { error: 'A note is required — config changes are never silent' })
    }
    if (typeof body.baseVersion !== 'number' || !Number.isFinite(body.baseVersion)) {
      return json(400, { error: 'baseVersion (number) is required — the version this draft was edited from' })
    }
    if (!db) return json(503, { error: 'Config versions need Supabase — export the draft instead' })
    const { data: maxRow, error: maxError } = await db
      .from('threshold_configs')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxError) return json(503, { error: 'Could not load the active rulebook — try again' })
    const currentMax = maxRow?.version ?? 0
    const staleDraft = (active: number) => json(409, {
      error: `The rulebook changed while you edited — active is now v${active} but your draft is based on v${body.baseVersion}. Refresh, re-apply your changes, and save again.`,
    })
    if (body.baseVersion !== currentMax) return staleDraft(currentMax)
    const version = currentMax + 1
    const { data: row, error } = await db
      .from('threshold_configs')
      .insert({ version, config: body.config, note: body.note.trim(), author: body.author ?? null })
      .select('version, created_at')
      .single()
    if (error) {
      // version is the PRIMARY KEY, so a concurrent save between our max read and
      // this insert surfaces as duplicate-key (23505) — that's a stale draft, not
      // a server fault.
      if (error.code === '23505') return staleDraft(version)
      return json(500, { error: `Failed to save config version: ${error.message}` })
    }
    return json(200, { version: row.version, createdAt: row.created_at, persisted: true })
  }

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  if (path.endsWith('/active')) {
    if (db) {
      const { data, error } = await db
        .from('threshold_configs')
        .select('version, config, note, author, created_at')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      // A failed query is NOT "no versions yet" — serving v0 here would mislabel
      // it active and let a save from it revert the real rulebook.
      if (error) return json(503, { error: 'Could not load the active rulebook — try again' })
      if (data) return json(200, data)
    }
    return json(200, VERSION_ZERO)
  }

  const versionMatch = path.match(/\/api\/config\/(\d+)$/)
  if (versionMatch) {
    const version = Number(versionMatch[1])
    if (version === 0) return json(200, VERSION_ZERO)
    if (!db) return json(404, { error: `Config version ${version} not found (Supabase not configured)` })
    const { data, error } = await db
      .from('threshold_configs')
      .select('version, config, note, author, created_at')
      .eq('version', version)
      .maybeSingle()
    if (error) return json(503, { error: `Could not load config version ${version} — try again` })
    if (!data) return json(404, { error: `Config version ${version} not found` })
    return json(200, data)
  }

  // bare /api/config → version list (metadata only, version 0 always present)
  let rows: any[] = []
  if (db) {
    const { data, error } = await db
      .from('threshold_configs')
      .select('version, note, author, created_at')
      .order('version', { ascending: false })
    if (error) return json(503, { error: 'Could not load the config version list — try again' })
    rows = data ?? []
  }
  return json(200, [...rows, { version: 0, note: VERSION_ZERO.note, author: null }])
}

export const config: Config = {
  path: ['/api/config/active', '/api/config', '/api/config/:version'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
