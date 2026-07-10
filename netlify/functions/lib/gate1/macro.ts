// Weekly macro snapshot — PURE logic. No network, no Supabase, no Date.now():
// `weekOf` is passed in, series are passed in, so the golden suite and the
// replay path exercise the exact production code.
//
// Every threshold/band/weight comes from Gate1Config. The only numeric
// constants in this file are definitional, not tunable — each is documented
// where it appears.
import { annualizedReturn, downsampleMonthly, latest, yoyChange, type FredPoint } from './fred.ts'
import type {
  Gate1Config,
  MacroQuadrant,
  MacroSignalDef,
  MacroSignalReading,
  MacroSnapshot,
  MarketContext,
  Posture,
  Regime,
} from './types.ts'

/**
 * FRED ids for the prevailing-market panel. These are series IDENTITIES
 * (which instrument is "SOFR"), not tunables — hence module constants, unlike
 * the per-signal ids which live in config.macro.signals[].fred.
 */
export const MARKET_SERIES = {
  sofr: 'SOFR',
  mortgage30y: 'MORTGAGE30US',
  treasury10y: 'DGS10',
  sp500: 'SP500',
} as const

/**
 * Vote-to-score mapping and regime cutpoints. The score is the weighted mean
 * of votes on a 0(green)–2(red) scale; the cutpoints 0.67 / 1.34 are the
 * (rounded) tercile boundaries that map that 3-level vote scale back onto the
 * 3 regimes — they define what "the average vote is yellow-ish / red-ish"
 * MEANS, structurally. Risk appetite is tuned in config (per-signal bands and
 * weights), never here; that is why these two numbers are code constants and
 * everything else reads from config.
 */
const VOTE_SCORE: Record<Posture, number> = { green: 0, yellow: 1, red: 2 }
const REGIME_CUT_SOFT_LANDING = 0.67
const REGIME_CUT_STAGFLATION = 1.34

/**
 * The Sahm rule's published trigger: a 0.5pp rise of the 3-month-average
 * unemployment rate above its 12-month low marks a recession start. The 0.5
 * is the DEFINITION of the indicator (what SAHMREALTIME measures against),
 * not a band we tune — the tunable early-warning bands for sahm live in
 * config.macro.signals.
 */
const SAHM_TRIGGER = 0.5

/**
 * Pilot fund terms used for the hurdle stack: 5-year lockup, development
 * strategy. These identify WHICH config rows apply to this fund — deal
 * identities for the pilot underwriter, not macro tunables. The bps values
 * themselves all come from config.macro.hurdleStack.
 */
const PILOT_LOCKUP_YEARS = 5
const PILOT_STRATEGY = 'development'

/** ~5 years of monthly points for dashboard sparklines. */
const HISTORY_MONTHS = 60

/**
 * Map a signal value to a posture vote using the def's direction + bands.
 * high_is_bad:  value <= green → green; <= yellow → yellow; else red.
 * high_is_good: value >= green → green; >= yellow → yellow; else red.
 * Bounds are inclusive on the better side. null value → null vote (unavailable).
 */
export function computeVote(def: MacroSignalDef, value: number | null): Posture | null {
  if (value === null || !Number.isFinite(value)) return null
  if (def.direction === 'high_is_bad') {
    return value <= def.green ? 'green' : value <= def.yellow ? 'yellow' : 'red'
  }
  return value >= def.green ? 'green' : value >= def.yellow ? 'yellow' : 'red'
}

export interface MacroComputeInput {
  config: Gate1Config
  /** ISO date the snapshot is "as of" — passed in, never Date.now(). */
  weekOf: string
  /** RAW series keyed by signal id (transform applied here, per def). */
  series: Record<string, FredPoint[]>
  /** Manual signal values (e.g. ISM PMI, or an analyst override of a feed). */
  manualValues?: Record<string, number>
  /** Previous snapshot, for hysteresis + degraded fallback. */
  previous?: MacroSnapshot | null
  /** Manual regime override (override endpoint) — bypasses scoring entirely. */
  forcedRegime?: Regime
  source?: 'auto' | 'manual'
  note?: string
}

export function computeMacroSnapshot(input: MacroComputeInput): MacroSnapshot {
  const { config, weekOf, previous } = input
  const macro = config.macro
  const defs = macro.signals ?? []

  // 1) Per-signal readings: apply the def's transform to the RAW series,
  //    honor manual values, vote via the def's bands.
  const signals: MacroSignalReading[] = defs.map((def) => {
    const raw = input.series[def.id] ?? []
    const manual = input.manualValues?.[def.id]
    let value: number | null
    let asof: string | undefined
    if (manual !== undefined && manual !== null && Number.isFinite(manual)) {
      value = manual
      asof = weekOf // a manual value is as-of the week it was entered
    } else if (def.transform === 'yoy') {
      value = yoyChange(raw)
      asof = latest(raw)?.date
    } else {
      const last = latest(raw)
      value = last?.value ?? null
      asof = last?.date
    }
    const history = downsampleMonthly(raw).slice(-HISTORY_MONTHS)
    return {
      id: def.id,
      label: def.label,
      value,
      ...(asof ? { asof } : {}),
      vote: computeVote(def, value),
      weight: def.weight,
      ...(history.length ? { history } : {}),
    }
  })

  const voted = signals.filter((s) => s.vote !== null)
  const degraded = voted.length < macro.minVotes

  // 2) Hard overrides (from spec) — definitional recession triggers that no
  //    weighted average can outvote.
  const sahmValue = signals.find((s) => s.id === 'sahm')?.value ?? null
  const sahmTriggered = sahmValue !== null && sahmValue >= SAHM_TRIGGER
  const gdpRaw = input.series['gdp'] ?? []
  const n = gdpRaw.length
  const technicalRecession =
    n >= 3 && gdpRaw[n - 1].value < gdpRaw[n - 2].value && gdpRaw[n - 2].value < gdpRaw[n - 3].value

  // 3) Regime resolution: overrides beat degraded beats scored-candidate.
  let regime: Regime
  let pending: Regime | null = null
  if (sahmTriggered || technicalRecession) {
    // "regardless" per spec: overrides also bypass hysteresis.
    regime = 'recession'
  } else if (degraded) {
    // Too few live votes to re-score honestly: hold the last known regime
    // (or the neutral soft_landing start), and say so via degraded=true.
    regime = previous?.regime ?? 'soft_landing'
  } else {
    const totalWeight = voted.reduce((s, v) => s + v.weight, 0)
    const score = voted.reduce((s, v) => s + VOTE_SCORE[v.vote as Posture] * v.weight, 0) / totalWeight
    const candidate: Regime =
      score < REGIME_CUT_SOFT_LANDING ? 'soft_landing' : score < REGIME_CUT_STAGFLATION ? 'stagflation' : 'recession'
    if (!previous) {
      regime = candidate // no history → adopt directly
    } else if (candidate === previous.regime) {
      regime = candidate // no change, clear any pending flip
    } else if (macro.hysteresisWins <= 1 || candidate === previous.pending_regime) {
      // The candidate has now persisted the required consecutive snapshots → flip.
      // (pending_regime carries "one prior win"; with hysteresisWins=2 — the
      // shipped default — this is exact. Larger values would need a win
      // counter persisted on the snapshot.)
      regime = candidate
    } else {
      regime = previous.regime
      pending = candidate
    }
  }

  if (input.forcedRegime) {
    regime = input.forcedRegime
    pending = null
  }

  // 4) Quadrant: core PCE yoy (inflation) × real GDP yoy (growth) vs config bands.
  const inflationYoy = signals.find((s) => s.id === 'core_pce')?.value ?? null
  const growthYoy = signals.find((s) => s.id === 'gdp')?.value ?? null
  const bands = macro.quadrantBands
  let label: MacroQuadrant['label'] = 'unknown'
  if (bands && inflationYoy !== null && growthYoy !== null) {
    const hot = inflationYoy > bands.inflationHotYoy
    label =
      growthYoy > bands.growthRecessionYoy
        ? hot
          ? 'inflationary_expansion'
          : 'disinflationary_expansion'
        : hot
          ? 'stagflation'
          : 'deflationary_contraction'
  }
  const quadrant: MacroQuadrant = { inflationYoy, growthYoy, label }

  // 5) Hurdle stack for the pilot fund's terms (5y lockup, development).
  const hs = macro.hurdleStack
  const illiquidityBps =
    [...hs.illiquidityBpsByLockupYears].sort((a, b) => a.maxYears - b.maxYears).find((b) => PILOT_LOCKUP_YEARS <= b.maxYears)
      ?.bps ?? 0
  const complexityBps = hs.complexityBpsByStrategy[PILOT_STRATEGY] ?? 0
  const regimeBps = hs.regimeBps[regime] ?? 0
  const hurdle = {
    anchorPct: hs.anchorPct,
    illiquidityBps,
    complexityBps,
    regimeBps,
    totalPct: hs.anchorPct + (illiquidityBps + complexityBps + regimeBps) / 10_000,
  }

  return {
    week_of: weekOf,
    source: input.source ?? 'auto',
    signals,
    regime,
    pending_regime: pending,
    degraded,
    // Matrix row returned as-is ('*' fallback resolved by callers per asset class).
    postures: { ...macro.postureMatrix[regime] },
    quadrant,
    hurdle,
    ...(input.note ? { note: input.note } : {}),
  }
}

/** Prevailing-market panel: latest financing rates + S&P 500 annualized returns. */
export function buildMarketContext(series: {
  sofr: FredPoint[]
  mortgage30y: FredPoint[]
  treasury10y: FredPoint[]
  sp500: FredPoint[]
}): MarketContext {
  const asof =
    [series.sofr, series.mortgage30y, series.treasury10y, series.sp500]
      .map((s) => latest(s)?.date)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? ''
  return {
    asof,
    sofr: latest(series.sofr)?.value ?? null,
    mortgage30y: latest(series.mortgage30y)?.value ?? null,
    treasury10y: latest(series.treasury10y)?.value ?? null,
    sp500: {
      level: latest(series.sp500)?.value ?? null,
      ret1y: annualizedReturn(series.sp500, 1),
      ret3y: annualizedReturn(series.sp500, 3),
      ret5y: annualizedReturn(series.sp500, 5),
    },
  }
}
