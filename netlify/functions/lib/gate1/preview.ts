// Shared compute step for /api/gate1/* — used by the Netlify function AND the
// vite dev bridge, so local dev runs the identical engine path.
//
// The config is IMPORTED (not readFileSync) so esbuild inlines it into the
// serverless bundle — a runtime file read breaks on Netlify (/var/task ships
// only the bundled .mjs, not sibling JSON files).
import defaultConfigJson from './default-config.json'
import { evaluateGate1 } from './engine.ts'
import { resolveThresholds } from './thresholds.ts'
import type { DealFields, Gate1Config, GateResult, JudgmentAdjustment, Posture, PostureScenario } from './types.ts'

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

  // The same deal, same rulebook, same judgment adjustments, scored under each
  // macro posture — the side-by-side "what if the market turns" view. Display
  // only: the verdict of record is `result` (the scenario for `posture` IS it).
  const scenarios = {} as Record<Posture, PostureScenario>
  for (const p of POSTURES) {
    const r = p === posture ? result : evaluateGate1(fields, resolveThresholds(config, fields.asset_class, p, adjustments), config)
    scenarios[p] = toScenario(p, r)
  }

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
    scenarios,
  }
}

const POSTURES: Posture[] = ['green', 'yellow', 'red']

function toScenario(posture: Posture, r: GateResult): PostureScenario {
  return {
    posture,
    verdict: r.verdict,
    kills: r.kills,
    flagPoints: r.flagPoints,
    ...(r.stress ? { stress: r.stress } : {}),
    checks: r.checks.map(c => ({
      id: c.id,
      status: c.status,
      value: c.value,
      margin: c.margin,
      fragile: c.fragile,
      threshold: c.threshold?.effective ?? null,
    })),
  }
}
