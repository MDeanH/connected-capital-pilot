// Shared compute step for /api/gate1/* — used by the Netlify function AND the
// vite dev bridge, so local dev runs the identical engine path.
//
// The config is IMPORTED (not readFileSync) so esbuild inlines it into the
// serverless bundle — a runtime file read breaks on Netlify (/var/task ships
// only the bundled .mjs, not sibling JSON files).
import defaultConfigJson from './default-config.json'
import { evaluateGate1 } from './engine.ts'
import { resolveThresholds } from './thresholds.ts'
import type { DealFields, Gate1Config, JudgmentAdjustment, Posture } from './types.ts'

export const DEFAULT_CONFIG: Gate1Config = defaultConfigJson as unknown as Gate1Config

export interface Gate1Request {
  fields: DealFields
  adjustments?: JudgmentAdjustment[]
  posture?: Posture
  /** Draft config from the thresholds editor — previews only, never recordable. */
  configOverride?: Gate1Config
}

export function computeGate1(
  body: Gate1Request,
  config: Gate1Config = body.configOverride ?? DEFAULT_CONFIG,
  configVersion = body.configOverride ? -1 : 0,
  posture: Posture = body.posture ?? 'green',
  postureSource = body.posture ? 'request' : 'default',
  macroSnapshotId: string | null = null,
) {
  const fields = body.fields
  if (!fields || typeof fields !== 'object' || !fields.asset_class) {
    throw new Error('Missing deal fields (asset_class required)')
  }
  const adjustments = Array.isArray(body.adjustments) ? body.adjustments : []

  const resolved = resolveThresholds(config, fields.asset_class, posture, adjustments)
  const result = evaluateGate1(fields, resolved, config)
  const baseline = adjustments.length
    ? evaluateGate1(fields, resolveThresholds(config, fields.asset_class, posture), config)
    : result

  return {
    result,
    baseline: { verdict: baseline.verdict, kills: baseline.kills, flagPoints: baseline.flagPoints },
    baselineFull: baseline,
    adjustments,
    posture,
    postureSource,
    configVersion,
    macroSnapshotId,
    checksMeta: config.checks,
  }
}
