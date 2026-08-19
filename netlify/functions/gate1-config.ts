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
import { requireAdmin } from './lib/auth.ts'
import { EXECUTABLE_CHECK_IDS } from './lib/gate1/engine.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Posture, Regime } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

// Runtime mirrors of the Regime/Posture unions (lib/gate1/types.ts). The
// Record types make tsc fail here if the union ever gains or loses a member,
// so the validator can never silently drift from the engine's canonical lists.
const REGIME_KEYS: Record<Regime, true> = { soft_landing: true, stagflation: true, recession: true }
const REGIMES = Object.keys(REGIME_KEYS) as Regime[]
const POSTURE_KEYS: Record<Posture, true> = { green: true, yellow: true, red: true }
const EXECUTABLE_IDS = new Set<string>(EXECUTABLE_CHECK_IDS)

/**
 * A saved config becomes the ACTIVE rulebook for every evaluation — a
 * structurally broken one (empty checks, missing macro) bricks the pilot
 * globally until another version lands. Validate the whole shape, not just
 * that thresholds is an array.
 */
export function configShapeError(c: any): string | null {
  if (!c || typeof c !== 'object') return 'config must be an object'
  if (!Array.isArray(c.checks) || c.checks.length === 0) return 'checks must be a non-empty array'
  const seenCheckIds = new Set<string>()
  for (const ch of c.checks) {
    if (!ch || typeof ch.id !== 'string' || (ch.kind !== 'kill' && ch.kind !== 'flag')) {
      return 'every check needs a string id and kind "kill" or "flag"'
    }
    // The engine executes checks by id (lib/gate1/engine.ts runCheck's switch):
    // an id it doesn't know falls through to the default branch → 'missing' →
    // EVERY deal's verdict becomes REVIEW. Only ids from the engine's canonical
    // registry may activate, and each at most once.
    if (!EXECUTABLE_IDS.has(ch.id)) {
      return `check "${ch.id}" is not an executable check id — the engine knows: ${EXECUTABLE_CHECK_IDS.join(', ')}`
    }
    if (seenCheckIds.has(ch.id)) {
      return `duplicate check id "${ch.id}" — each check may appear at most once`
    }
    seenCheckIds.add(ch.id)
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
  // Weights feed computeMacroSnapshot's weighted mean (score = Σvote·w / Σw):
  // a negative weight inverts a signal's vote, and all-zero live weights make
  // the score 0/0 = NaN, which falls through both regime cutpoints straight to
  // 'recession'. So every weight must be finite and >= 0, and the total must
  // be strictly positive.
  let weightSum = 0
  for (let i = 0; i < m.signals.length; i++) {
    const s = m.signals[i]
    const name = s && typeof s.id === 'string' ? `"${s.id}"` : `#${i}`
    if (!s || typeof s.id !== 'string' || typeof s.label !== 'string') {
      return `macro signal ${name} needs a string id and label`
    }
    if (s.fred !== null && typeof s.fred !== 'string') {
      return `macro signal "${s.id}" fred must be a FRED series id string or null`
    }
    if (!finite(s.weight) || s.weight < 0) {
      return `macro signal "${s.id}" weight must be a finite number >= 0`
    }
    weightSum += s.weight
    if (s.transform !== 'level' && s.transform !== 'yoy') {
      return `macro signal "${s.id}" transform must be "level" or "yoy"`
    }
    if (s.direction !== 'high_is_bad' && s.direction !== 'high_is_good') {
      return `macro signal "${s.id}" direction must be "high_is_bad" or "high_is_good"`
    }
    if (!finite(s.green) || !finite(s.yellow)) {
      return `macro signal "${s.id}" needs finite numeric green and yellow bands`
    }
    // computeVote (lib/gate1/macro.ts) walks the bands green-first:
    //   high_is_bad:  value <= green → green; <= yellow → yellow; else red
    //   high_is_good: value >= green → green; >= yellow → yellow; else red
    // Bands in the wrong order make the yellow branch unreachable — readings
    // jump straight from green to red — so the order is enforced here.
    if (s.direction === 'high_is_bad' ? s.green > s.yellow : s.green < s.yellow) {
      return `macro signal "${s.id}" bands are out of order: ${s.direction} requires green ${
        s.direction === 'high_is_bad' ? '<=' : '>='
      } yellow (got green=${s.green}, yellow=${s.yellow}) — otherwise the yellow band is unreachable`
    }
  }
  if (weightSum <= 0) {
    return 'macro signal weights sum to 0 — at least one signal weight must be positive, or every regime score is 0/0'
  }
  for (const [id, w] of Object.entries(m.signalWeights)) {
    if (!finite(w) || (w as number) < 0) {
      return `macro signalWeights["${id}"] must be a finite number >= 0`
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
  // computeMacroSnapshot spreads postureMatrix[regime] as-is: a missing regime
  // row spreads to an EMPTY posture map (silent green everywhere), and every
  // consumer resolves via postures[asset_class] ?? postures['*']. So the matrix
  // must cover exactly the canonical regimes, every value must be a real
  // posture, and every row needs the '*' fallback.
  for (const regime of REGIMES) {
    if (!(regime in m.postureMatrix)) {
      return `macro postureMatrix is missing regime "${regime}" — it must cover exactly ${REGIMES.join(', ')}`
    }
  }
  for (const [regime, row] of Object.entries(m.postureMatrix)) {
    if (!(regime in REGIME_KEYS)) {
      return `macro postureMatrix has unknown regime "${regime}" — it must cover exactly ${REGIMES.join(', ')}`
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return `macro postureMatrix "${regime}" must map asset classes to posture strings`
    }
    for (const [asset, p] of Object.entries(row)) {
      if (typeof p !== 'string' || !(p in POSTURE_KEYS)) {
        return `macro postureMatrix "${regime}" maps "${asset}" to ${JSON.stringify(p)} — postures must be "green", "yellow" or "red"`
      }
    }
    if (!('*' in row)) {
      return `macro postureMatrix "${regime}" needs a "*" fallback entry — asset classes without their own row would get no posture`
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
    // A saved version becomes the active rulebook for everyone — admin only.
    const gate = await requireAdmin(req)
    if (gate.response) return gate.response
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
      // The verified identity wins authorship over the self-reported body field.
      .insert({ version, config: body.config, note: body.note.trim(), author: gate.identity?.email ?? body.author ?? null })
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
    if (db) {
      // Version 0 included: gate1's decide self-heals a version-0 ROW into the
      // ledger (frozen at the deploy default of the day) so decisions can
      // reference it. That stored row is what historical v0 decisions actually
      // ran under — serving a LATER deploy's baked default here would replay
      // them against different thresholds. A failed query is NOT "no stored
      // row", so it 503s like every other read.
      const { data, error } = await db
        .from('threshold_configs')
        .select('version, config, note, author, created_at')
        .eq('version', version)
        .maybeSingle()
      if (error) return json(503, { error: `Could not load config version ${version} — try again` })
      if (data) return json(200, data)
    }
    // No stored row (or no Supabase at all): only the deploy-baked default can
    // answer for version 0.
    if (version === 0) return json(200, VERSION_ZERO)
    return json(404, { error: `Config version ${version} not found${db ? '' : ' (Supabase not configured)'}` })
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
