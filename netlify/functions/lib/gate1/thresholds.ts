import type {
  Gate1Config,
  JudgmentAdjustment,
  Posture,
  ResolvedThreshold,
  ThresholdRow,
} from './types'

// Key-specific value domains for the mini_stress severities — a LOCAL MIRROR of
// STRESS_SEVERITY_DOMAINS in netlify/functions/gate1-config.ts, which the config
// validator (configShapeError) enforces on every SAVED rulebook row. A per-deal
// judgment adjustment is a threshold override too, so it must clear the SAME
// domain: a severity on the wrong side makes the stressed (hard-kill) case MORE
// favorable than baseline, so a deal that should FAIL the stress would pass. The
// four canonical bounds must stay byte-for-byte in step with the config's copy.
//   stress_hard_cost_bump    >= 0   (negative shrinks stressed equity)
//   stress_exit_cap_bump_bps >= 0   (negative lowers the cap, raises exit value)
//   stress_selling_costs     [0, 1) (< 0 inflates proceeds, >= 1 zeroes/negates)
//   stress_em_floor          > 0    (<= 0 lets any nonnegative multiple pass)
const STRESS_SEVERITY_DOMAINS: Record<string, (v: number) => boolean> = {
  stress_hard_cost_bump: v => v >= 0,
  stress_exit_cap_bump_bps: v => v >= 0,
  stress_selling_costs: v => v >= 0 && v < 1,
  stress_em_floor: v => v > 0,
}

/**
 * True when a judgment-adjustment value is an out-of-domain stress severity.
 * Mirrors both layers of the config validator: the four keyed domains above, and
 * its catch-all that any future `_bump` severity is negative-favorable (< 0 bad).
 */
function stressSeverityOutOfDomain(key: string, value: number): boolean {
  const ok = STRESS_SEVERITY_DOMAINS[key]
  if (ok) return !ok(value)
  return /_bump/.test(key) && value < 0
}

/**
 * Resolve every threshold key for (assetClass, posture), most-specific row wins:
 *   (ac, p) → ('*', p) → (ac, '*') → ('*', '*')
 * then overlay per-deal judgment adjustments (reason required and value must be a finite
 * number — validated at the API layer, re-checked here so the engine can never apply a
 * silent override). An out-of-domain mini_stress severity additionally THROWS here — the
 * same 400-surfacing rejection as the reason / finite / unknown-threshold guards — so an
 * adjustment can't weaken a hard-kill stress past its domain (dropping it would leave the
 * original adjustment recorded in the ledger's overrides while the score never used it).
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
    if (stressSeverityOutOfDomain(adj.key, adj.value)) {
      // THROW (not drop): an out-of-domain stress severity is invalid by
      // definition — it would move a hard-kill threshold in the deal-favorable
      // direction beyond its domain (the same value a SAVED rulebook row is
      // rejected for). Dropping it silently is worse than wrong: gate1.ts stores
      // the ORIGINAL adjustment in gate_decisions.overrides, so a scored preview
      // that quietly used the base would still record a phantom override the
      // ledger claims was applied. Throw exactly like the reason / finite /
      // unknown-threshold guards above, so preview and decide surface a 400 and
      // the analyst must correct the value before previewing or recording.
      // In-domain adjustments (all non-stress keys included) are untouched.
      throw new Error(`Judgment adjustment for "${adj.key}" is an out-of-domain mini_stress severity (${adj.value}) — a stress severity outside its domain would make the stressed hard-kill case more favorable than baseline`)
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
