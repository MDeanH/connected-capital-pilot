// Config versions API — append-only threshold_configs ledger.
//   GET  /api/config/active    → highest version (or the shipped default as version 0)
//   GET  /api/config           → version list (metadata only)
//   GET  /api/config/:version  → one full versioned config (version 0 = shipped default)
//   POST /api/config           → append a new version { config, note, author? } (note required)
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
function configShapeError(c: any): string | null {
  if (!c || typeof c !== 'object') return 'config must be an object'
  if (!Array.isArray(c.checks) || c.checks.length === 0) return 'checks must be a non-empty array'
  for (const ch of c.checks) {
    if (!ch || typeof ch.id !== 'string' || (ch.kind !== 'kill' && ch.kind !== 'flag')) {
      return 'every check needs a string id and kind "kill" or "flag"'
    }
  }
  if (!Array.isArray(c.thresholds)) return 'thresholds must be an array'
  for (const r of c.thresholds) {
    if (!r || typeof r.asset_class !== 'string' || typeof r.posture !== 'string' ||
        typeof r.key !== 'string' || typeof r.value !== 'number' || !Number.isFinite(r.value)) {
      return 'every threshold row needs asset_class, posture, key and a finite numeric value'
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
    if (!db) return json(503, { error: 'Config versions need Supabase — export the draft instead' })
    const { data: maxRow } = await db
      .from('threshold_configs')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const version = (maxRow?.version ?? 0) + 1
    const { data: row, error } = await db
      .from('threshold_configs')
      .insert({ version, config: body.config, note: body.note.trim(), author: body.author ?? null })
      .select('version, created_at')
      .single()
    if (error) return json(500, { error: `Failed to save config version: ${error.message}` })
    return json(200, { version: row.version, createdAt: row.created_at, persisted: true })
  }

  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })

  if (path.endsWith('/active')) {
    if (db) {
      const { data } = await db
        .from('threshold_configs')
        .select('version, config, note, author, created_at')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) return json(200, data)
    }
    return json(200, VERSION_ZERO)
  }

  const versionMatch = path.match(/\/api\/config\/(\d+)$/)
  if (versionMatch) {
    const version = Number(versionMatch[1])
    if (version === 0) return json(200, VERSION_ZERO)
    if (!db) return json(404, { error: `Config version ${version} not found (Supabase not configured)` })
    const { data } = await db
      .from('threshold_configs')
      .select('version, config, note, author, created_at')
      .eq('version', version)
      .maybeSingle()
    if (!data) return json(404, { error: `Config version ${version} not found` })
    return json(200, data)
  }

  // bare /api/config → version list (metadata only, version 0 always present)
  let rows: any[] = []
  if (db) {
    const { data } = await db
      .from('threshold_configs')
      .select('version, note, author, created_at')
      .order('version', { ascending: false })
    rows = data ?? []
  }
  return json(200, [...rows, { version: 0, note: VERSION_ZERO.note, author: null }])
}

export const config: Config = {
  path: ['/api/config/active', '/api/config', '/api/config/:version'],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
}
