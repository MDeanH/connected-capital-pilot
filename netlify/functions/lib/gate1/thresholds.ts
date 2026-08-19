import type {
  Gate1Config,
  JudgmentAdjustment,
  Posture,
  ResolvedThreshold,
  ThresholdRow,
} from './types'

/**
 * Resolve every threshold key for (assetClass, posture), most-specific row wins:
 *   (ac, p) → ('*', p) → (ac, '*') → ('*', '*')
 * then overlay per-deal judgment adjustments (reason required and value must be a finite
 * number — validated at the API layer, re-checked here so the engine can never apply a
 * silent override).
 */
export function resolveThresholds(
  config: Gate1Config,
  assetClass: string,
  posture: Posture,
  adjustments: JudgmentAdjustment[] = [],
): Record<string, ResolvedThreshold> {
  const out: Record<string, ResolvedThreshold> = {}
  const keys = new Set(config.thresholds.map(r => r.key))

  for (const key of keys) {
    const row = pickRow(config.thresholds, assetClass, posture, key)
    if (!row) continue
    out[key] = {
      key,
      base: row.value,
      source: { asset_class: row.asset_class, posture: String(row.posture) },
      effective: row.value,
    }
  }

  for (const adj of adjustments) {
    if (!adj.reason || !adj.reason.trim()) {
      throw new Error(`Judgment adjustment for "${adj.key}" requires a reason`)
    }
    if (typeof adj.value !== 'number' || !Number.isFinite(adj.value)) {
      // Applied unvalidated, a { value: null } adjustment would coerce to 0 in
      // the engine's numeric comparisons AND be recorded as the effective
      // threshold — same rule as the reason guard: never a silent override.
      throw new Error(`Judgment adjustment for "${adj.key}" requires a finite numeric value`)
    }
    const existing = out[adj.key]
    if (!existing) {
      throw new Error(`Judgment adjustment targets unknown threshold "${adj.key}"`)
    }
    existing.adjustment = adj
    existing.effective = adj.value
  }

  return out
}

function pickRow(
  rows: ThresholdRow[],
  assetClass: string,
  posture: Posture,
  key: string,
): ThresholdRow | undefined {
  const candidates = rows.filter(r => r.key === key)
  return (
    candidates.find(r => r.asset_class === assetClass && r.posture === posture) ??
    candidates.find(r => r.asset_class === '*' && r.posture === posture) ??
    candidates.find(r => r.asset_class === assetClass && r.posture === '*') ??
    candidates.find(r => r.asset_class === '*' && r.posture === '*')
  )
}

/** Human-readable provenance, shown in tooltips and the IC memo. */
export function provenance(t: ResolvedThreshold): string {
  const base = `${t.base} (${t.source.asset_class === '*' ? 'all classes' : t.source.asset_class}, ${
    t.source.posture === '*' ? 'all postures' : `${t.source.posture} posture`
  })`
  if (!t.adjustment) return base
  return `${base} · judgment: ${t.adjustment.value} — "${t.adjustment.reason}"`
}
