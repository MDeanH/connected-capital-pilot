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
import { CHECK_KINDS, CHECK_THRESHOLD_KEYS, EXECUTABLE_CHECK_IDS } from './lib/gate1/engine.ts'
import { DEFAULT_CONFIG } from './lib/gate1/preview.ts'
import type { Posture, Regime } from './lib/gate1/types.ts'
import { serviceClient } from './lib/supabase.ts'

// Runtime mirrors of the Regime/Posture unions (lib/gate1/types.ts). The
// Record types make tsc fail here if the union ever gains or loses a member,
// so the validator can never silently drift from the engine's canonical lists.
const REGIME_KEYS: Record<Regime, true> = { soft_landing: true, stagflation: true, recession: true }
const REGIMES = Object.keys(REGIME_KEYS) as Regime[]
const POSTURE_KEYS: Record<Posture, true> = { green: true, yellow: true, red: true }
const POSTURES = Object.keys(POSTURE_KEYS) as Posture[]
const EXECUTABLE_IDS = new Set<string>(EXECUTABLE_CHECK_IDS)

// The supported asset-class registry — mirrors SUPPORTED_ASSET_CLASSES in
// netlify/functions/gate1.ts, ASSET_CLASSES in src/deal-types.ts, and the
// asset_class extraction hint in lib/gate1/fields.ts (keep all four in sync;
// asset classes are plain strings in types.ts, so unlike Regime/Posture there
// is no union type for tsc to pin this mirror against). Threshold rows scoped
// to a class outside this list can never match a real deal — gate1.ts 400s any
// asset_class not in this registry — so such a row is dead weight at best and,
// combined with the resolvability rule below, evidence of a typo'd config.
const SUPPORTED_ASSET_CLASSES = ['rv_specialty', 'multifamily', 'industrial', 'retail', 'office']

// Macro-only posture classes: asset classes that can never head a deal
// (gate1.ts 400s them at intake, and no threshold row may scope to them) but
// legitimately carry postures in the macro postureMatrix. They exist because
// the macro dashboard renders EVERY entry of the active regime's posture row
// as a posture chip (src/MacroDashboard.tsx maps Object.entries(
// snapshot.postures)) — the shipped default's recession row keeps
// 'private_credit' and 'secondaries' at yellow purely as macro-overview
// postures for those strategies, and golden-macro.ts pins private_credit
// staying yellow in a recession. Every other non-deal key is rejected as a
// typo below: a misspelled deal class (e.g. 'multifamly') would otherwise
// activate fine while every consumer (postures[asset_class] ??
// postures['*']) silently falls back to '*' for the class the author meant
// to scope.
const MACRO_ONLY_POSTURE_CLASSES = ['private_credit', 'secondaries']

// The pilot fund's lockup term — mirrors PILOT_LOCKUP_YEARS in
// lib/gate1/macro.ts (a module-private constant there; keep in sync like the
// asset-class mirror above). computeMacroSnapshot reads the fund's
// illiquidity premium as the smallest hurdleStack band with
// PILOT_LOCKUP_YEARS <= maxYears, falling back to `?? 0` when no band
// matches — so the validator must guarantee at least one band covers it.
const PILOT_LOCKUP_YEARS = 5

// Posture-tightening DIRECTION per canonical threshold key, for the keys
// whose direction is fixed by their MEANING in the engine
// (lib/gate1/engine.ts runCheck) and the pilot spec:
//   'up'   — floors and stress severities: a worse posture demands MORE.
//            dev_spread_min_bps is a >= kill line the spec says "tightens as
//            macro posture worsens"; stress_em_floor is the mini-stress >=
//            floor the spec says "rises as posture worsens"; and
//            stress_hard_cost_bump / stress_exit_cap_bump_bps set how hard
//            mini_stress hits, so a worse posture stresses harder. Resolved
//            green <= yellow <= red required.
//   'down' — caps: a worse posture allows LESS. ltc_max and land_basis_max
//            are <= caps, so tightening means a LOWER value: resolved
//            green >= yellow >= red required IF a config posture-varies them
//            (a single ('*','*') row resolves equal across postures and
//            passes trivially).
// Keys NOT in this map carry no posture-order constraint: the spec pins no
// posture behavior for them (the shipped default never posture-varies them),
// so a config that posture-scopes e.g. yoc_min or contingency_min expresses
// analyst judgment the server has no canonical direction to enforce — the
// ThresholdConfig UI's soft warning is the right tier there, and inventing a
// server-side direction would block legitimate configs.
const POSTURE_TIGHTENING_DIRECTION: Record<string, 'up' | 'down'> = {
  dev_spread_min_bps: 'up',
  stress_hard_cost_bump: 'up',
  stress_exit_cap_bump_bps: 'up',
  stress_em_floor: 'up',
  ltc_max: 'down',
  land_basis_max: 'down',
}

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
    // A check's kill/flag KIND is pilot spec, not an editable knob: the engine
    // executes either kind generically (runCheck derives failStatus from
    // def.kind; evaluateGate1 rolls only kind === 'kill' failures up to an
    // unconditional FAIL), so a config re-kinding e.g. sponsor_integrity as
    // 'flag' would validate and activate — silently downgrading a hard kill to
    // a few flag points. The canonical kind per id lives in the engine's
    // registry (CHECK_KINDS, lib/gate1/engine.ts) and must match exactly.
    const canonicalKind = CHECK_KINDS[ch.id as keyof typeof CHECK_KINDS]
    if (ch.kind !== canonicalKind) {
      return `check "${ch.id}" is canonically a ${canonicalKind} (CHECK_KINDS in lib/gate1/engine.ts) but is configured as a ${ch.kind} — a check's kill/flag kind is pinned by the pilot spec, not configurable`
    }
    // The engine dereferences label and thresholdKeys on every check (see
    // lib/gate1/engine.ts runCheck) — a check without them crashes evaluation.
    if (typeof ch.label !== 'string' ||
        !Array.isArray(ch.thresholdKeys) || !ch.thresholdKeys.every((k: any) => typeof k === 'string')) {
      return `check "${ch.id}" needs a string label and a thresholdKeys array of strings`
    }
    // runCheck reads its thresholds by FIXED keys (its t('...') calls), not
    // from the declared thresholdKeys — the declared list only drives the
    // row-presence rule below and the displayed threshold (thresholdKeys[0]).
    // A declaration that diverges from the engine (e.g. ltc_max with
    // thresholdKeys: []) would let a config validate WITHOUT the rows the
    // engine actually reads, turning the check 'missing' for every deal — a
    // kill silently downgraded to REVIEW globally. So the declared list must
    // equal the engine's canonical set (order-insensitive, no duplicates).
    const canonicalKeys = CHECK_THRESHOLD_KEYS[ch.id as keyof typeof CHECK_THRESHOLD_KEYS]
    const declaredSorted = [...(ch.thresholdKeys as string[])].sort()
    const canonicalSorted = [...canonicalKeys].sort()
    if (declaredSorted.length !== canonicalSorted.length ||
        declaredSorted.some((k, i) => k !== canonicalSorted[i])) {
      return `check "${ch.id}" declares thresholdKeys [${(ch.thresholdKeys as string[]).join(', ')}] but its engine case consumes exactly [${canonicalKeys.join(', ')}] — the declared list must match`
    }
    // flagPoints only means anything on a flag: the engine zeroes a kill's
    // flagPoints unconditionally (runCheck: kind === 'flag' ? flagPoints ?? 1
    // : 0), so a kill carrying flagPoints is dead config the editor would
    // still display as though the kill scored points. Rule: flagPoints may be
    // supplied only on 'flag' checks (where it must be a positive finite
    // number; omitted, the engine defaults it to 1); on a 'kill' any supplied
    // flagPoints is rejected. The shipped default passes mechanically: its
    // kills carry no flagPoints and its flags all carry flagPoints: 1.
    if (ch.kind === 'kill' && ch.flagPoints !== undefined) {
      return `check "${ch.id}" is a kill but supplies flagPoints — kills contribute no flag points (the engine zeroes them unconditionally), so flagPoints is only accepted on 'flag' checks`
    }
    if (ch.flagPoints !== undefined &&
        (typeof ch.flagPoints !== 'number' || !Number.isFinite(ch.flagPoints) || ch.flagPoints <= 0)) {
      return `check "${ch.id}" flagPoints must be a positive finite number`
    }
    if (ch.tip !== undefined && typeof ch.tip !== 'string') {
      return `check "${ch.id}" tip must be a string`
    }
  }
  // The registry must be covered COMPLETELY, not just exclusively. The rules
  // above stop unknown and duplicate ids, but a config that simply OMITS a
  // canonical check would still validate — and the engine only runs the checks
  // the config lists (evaluateGate1 maps over config.checks), so the omitted
  // check doesn't fail or warn, it silently stops being asked: e.g. dropping
  // sponsor_integrity removes a hard kill from every evaluation with nothing
  // in any verdict to show for it. Disabling a check is NOT a supported knob —
  // if it ever becomes one, the feature is an explicit per-check toggle the
  // engine honors and the verdict surfaces, never omission from the array. So
  // the configured id set must EQUAL the executable registry: every id present
  // exactly once (uniqueness enforced above, completeness here).
  const missingCheckIds = EXECUTABLE_CHECK_IDS.filter((id) => !seenCheckIds.has(id))
  if (missingCheckIds.length > 0) {
    return `checks is missing canonical check id${missingCheckIds.length > 1 ? 's' : ''} ${missingCheckIds
      .map((id) => `"${id}"`)
      .join(', ')} — every executable check must be configured (an omitted check silently vanishes from every evaluation; disabling a check would be an explicit toggle, which does not exist, not omission)`
  }
  if (!Array.isArray(c.thresholds)) return 'thresholds must be an array'
  const seenRowScopes = new Set<string>()
  for (const r of c.thresholds) {
    if (!r || typeof r.asset_class !== 'string' || typeof r.posture !== 'string' ||
        typeof r.key !== 'string' || typeof r.value !== 'number' || !Number.isFinite(r.value)) {
      return 'every threshold row needs asset_class, posture, key and a finite numeric value'
    }
    // pickRow (lib/gate1/thresholds.ts) selects the FIRST row matching each
    // step of its fallback chain — with two rows on the same (key,
    // asset_class, posture) only the first in the array ever affects scoring,
    // while the editor shows both and nothing surfaces which one is live. The
    // tuple must be unique. (JSON.stringify as the set key: the fields are
    // arbitrary strings, so no join character is collision-safe.)
    const scope = JSON.stringify([r.key, r.asset_class, r.posture])
    if (seenRowScopes.has(scope)) {
      return `duplicate threshold row: key "${r.key}" scoped (${r.asset_class}, ${r.posture}) appears more than once — only the first row in the array would ever affect scoring while the editor shows both, so each (key, asset_class, posture) may appear at most once`
    }
    seenRowScopes.add(scope)
    // Row scope must be resolvable: pickRow (lib/gate1/thresholds.ts) matches
    // asset_class/posture by string equality, so a row scoped to an unknown
    // class or a misspelled posture (e.g. 'gren') exists in the config — and
    // satisfies a bare presence check — yet can never be selected for any real
    // deal. Reject the row itself, naming its scope.
    if (r.asset_class !== '*' && !SUPPORTED_ASSET_CLASSES.includes(r.asset_class)) {
      return `threshold row for "${r.key}" is scoped to unknown asset class "${r.asset_class}" — asset_class must be '*' or one of: ${SUPPORTED_ASSET_CLASSES.join(', ')}`
    }
    if (r.posture !== '*' && !(r.posture in POSTURE_KEYS)) {
      return `threshold row for "${r.key}" is scoped to unknown posture "${r.posture}" — posture must be '*' or one of: ${POSTURES.join(', ')}`
    }
  }
  // Row presence keys off the engine's CANONICAL key set (what runCheck's
  // t('...') calls actually dereference), not the declared thresholdKeys —
  // the two are equal by the rule above, but the canonical set is the ground
  // truth for what evaluation will read.
  const rowKeys = new Set<string>(c.thresholds.map((r: any) => r.key))
  // Presence somewhere is NOT resolvability: resolveThresholds (pickRow in
  // lib/gate1/thresholds.ts) resolves each key per (asset_class, posture)
  // through the chain (class, posture) → ('*', posture) → (class, '*') →
  // ('*', '*'). A key supplied only for, say, (rv_specialty, green) passes a
  // bare presence check, yet every other class/posture combination resolves
  // nothing — runCheck then reads a null threshold, the check goes 'missing',
  // and complete deals in those combinations verdict REVIEW. So mirror the
  // chain here for every canonical key × every supported class × every
  // posture and reject any hole. The shipped default passes mechanically:
  // each canonical key has a ('*','*') row or ('*',posture) rows covering
  // all three postures.
  const pickRowMirror = (key: string, assetClass: string, posture: string): any => {
    const candidates = (c.thresholds as any[]).filter((r) => r.key === key)
    return (
      candidates.find((r) => r.asset_class === assetClass && r.posture === posture) ??
      candidates.find((r) => r.asset_class === '*' && r.posture === posture) ??
      candidates.find((r) => r.asset_class === assetClass && r.posture === '*') ??
      candidates.find((r) => r.asset_class === '*' && r.posture === '*')
    )
  }
  const resolves = (key: string, assetClass: string, posture: Posture): boolean =>
    Boolean(pickRowMirror(key, assetClass, posture))
  for (const ch of c.checks) {
    for (const key of CHECK_THRESHOLD_KEYS[ch.id as keyof typeof CHECK_THRESHOLD_KEYS]) {
      if (!rowKeys.has(key)) {
        return `check "${ch.id}" needs threshold key "${key}" (its engine case reads it) but thresholds has no row for it`
      }
      for (const assetClass of SUPPORTED_ASSET_CLASSES) {
        for (const posture of POSTURES) {
          if (!resolves(key, assetClass, posture)) {
            return `check "${ch.id}" threshold key "${key}" resolves no row for (${assetClass}, ${posture}) — the engine's fallback chain (class, posture) → ('*', posture) → (class, '*') → ('*', '*') finds nothing, so complete deals in that combination would verdict REVIEW; add a row covering it (an ('*', '*') row covers everything)`
          }
        }
      }
    }
  }
  // One more engine-consumed key the per-check loop above can never cover,
  // because it belongs to no check: evaluateGate1 itself (lib/gate1/engine.ts)
  // reads 'fragile_margin_pct' to label passing checks fragile, as
  // resolved['fragile_margin_pct']?.effective ?? 0.1. The fallback means a
  // config without the key still activates — but the rulebook then no longer
  // contains the tunable in use: the engine silently applies the hard-coded
  // 0.1 while the editor has no row to show or change. So the key must
  // resolve through the same fallback chain for every supported context,
  // exactly like the check-consumed keys. The shipped default and the seeded
  // v1 pass mechanically: each carries a ('*', '*') fragile_margin_pct row.
  if (!rowKeys.has('fragile_margin_pct')) {
    return `thresholds needs a "fragile_margin_pct" row — evaluateGate1 (lib/gate1/engine.ts) reads it to label passing checks fragile and silently substitutes a hard-coded 0.1 when it resolves nothing, so without a row the editor can neither show nor change the value actually in use`
  }
  for (const assetClass of SUPPORTED_ASSET_CLASSES) {
    for (const posture of POSTURES) {
      if (!resolves('fragile_margin_pct', assetClass, posture)) {
        return `threshold key "fragile_margin_pct" resolves no row for (${assetClass}, ${posture}) — the engine's fallback chain (class, posture) → ('*', posture) → (class, '*') → ('*', '*') finds nothing, so evaluateGate1 would silently label fragility with its hard-coded 0.1 instead of a configured value in that context; add a row covering it (an ('*', '*') row covers everything)`
      }
    }
  }
  // rents_vs_comps (lib/gate1/engine.ts) trips on rentPremium > flag and
  // DOUBLES the flag points when it also exceeds severe (tripped && severe).
  // If the RESOLVED severe sits below the RESOLVED flag in some context, every
  // deal past the flag line is automatically past the severe line too — every
  // ordinarily-flagged deal is double-flagged, and the intended single-flag
  // band between the two disappears. The two keys resolve independently per
  // (asset_class, posture) — e.g. a class-scoped severe row can undercut a
  // global flag row — so the ordering must hold for the resolved PAIR in every
  // supported context, not merely row-by-row.
  for (const assetClass of SUPPORTED_ASSET_CLASSES) {
    for (const posture of POSTURES) {
      const flagRow = pickRowMirror('rent_premium_flag', assetClass, posture)
      const severeRow = pickRowMirror('rent_premium_severe', assetClass, posture)
      if (flagRow && severeRow && severeRow.value < flagRow.value) {
        return `rent_premium_severe resolves to ${severeRow.value}, below rent_premium_flag ${flagRow.value}, for (${assetClass}, ${posture}) — the engine doubles flag points when a deal exceeds BOTH thresholds, so a severe threshold below the flag threshold double-flags every ordinarily-flagged deal in that context; the resolved severe must be >= the resolved flag`
      }
    }
  }
  // Posture ordering for the direction-mapped keys, enforced over RESOLVED
  // values: the two adjacent posture pairs must never invert (red laxer than
  // green means the rulebook LOOSENS as macro conditions worsen — the exact
  // opposite of what a posture is for, and the ThresholdConfig UI only warns
  // softly about it). Like the rent-premium rule above, each posture resolves
  // independently per (asset_class, posture) — a class-scoped red row can
  // undercut a global green row — so the ordering must hold for the resolved
  // values in every supported context, not merely row-by-row.
  for (const [key, direction] of Object.entries(POSTURE_TIGHTENING_DIRECTION)) {
    for (const assetClass of SUPPORTED_ASSET_CLASSES) {
      const green = pickRowMirror(key, assetClass, 'green')
      const yellow = pickRowMirror(key, assetClass, 'yellow')
      const red = pickRowMirror(key, assetClass, 'red')
      // Adjacent pairs [laxer posture, tighter posture]; a missing side is
      // already rejected by the resolvability rule above for engine-consumed
      // keys, so the guard is purely defensive.
      const pairs: Array<[string, any, string, any]> = [
        ['green', green, 'yellow', yellow],
        ['yellow', yellow, 'red', red],
      ]
      for (const [laxName, laxRow, tightName, tightRow] of pairs) {
        if (!laxRow || !tightRow) continue
        const inverted = direction === 'up' ? tightRow.value < laxRow.value : tightRow.value > laxRow.value
        if (inverted) {
          return `threshold "${key}" inverts across postures for (${assetClass}): resolved ${tightName} ${tightRow.value} is laxer than resolved ${laxName} ${laxRow.value} — ${key} tightens ${
            direction === 'up'
              ? 'UPWARD (a worse posture demands more, so resolved green <= yellow <= red)'
              : 'DOWNWARD (a worse posture allows less, so resolved green >= yellow >= red)'
          }`
        }
      }
    }
  }
  // Back-testing (src/Backtest.tsx fetchParForVersion) and the intake par
  // display (src/DealIntake.tsx) read this version's par IRR as the literal
  // ('*', '*') irr_benchmark row — NOT through the pickRow fallback chain —
  // so per-context coverage cannot substitute for the global row. An active
  // config without it makes every backtest run refuse to grade ("rulebook vN
  // has no '*','*' irr_benchmark row"). The shipped default carries exactly
  // this row.
  if (!(c.thresholds as any[]).some(
    (r) => r.key === 'irr_benchmark' && r.asset_class === '*' && r.posture === '*',
  )) {
    return `thresholds needs an irr_benchmark row scoped ('*', '*') — backtest grading reads exactly that row as this version's par IRR (it does not fall back through scoped rows), so an active config without it makes back-testing refuse to grade every run`
  }
  const vb = c.verdictBands
  if (!vb || typeof vb.passMaxFlagPts !== 'number' || !Number.isFinite(vb.passMaxFlagPts) ||
      typeof vb.conditionalMaxFlagPts !== 'number' || !Number.isFinite(vb.conditionalMaxFlagPts)) {
    return 'verdictBands needs finite numeric passMaxFlagPts and conditionalMaxFlagPts'
  }
  if (vb.passMaxFlagPts < 0 || vb.conditionalMaxFlagPts < 0) {
    return `verdictBands must be >= 0 (got passMaxFlagPts=${vb.passMaxFlagPts}, conditionalMaxFlagPts=${vb.conditionalMaxFlagPts}) — flag points are never negative, so a negative band can never PASS or CONDITIONAL any deal`
  }
  // evaluateGate1 (lib/gate1/engine.ts) walks the bands PASS-first:
  //   flagPoints <= passMaxFlagPts → PASS; <= conditionalMaxFlagPts → CONDITIONAL; else FAIL.
  // With conditionalMaxFlagPts below passMaxFlagPts, everything at or under
  // the conditional band is already <= the pass band, so the CONDITIONAL
  // verdict becomes unreachable and deals between the bands read as clean
  // PASSes. Enforce the order here.
  if (vb.passMaxFlagPts > vb.conditionalMaxFlagPts) {
    return `verdictBands are inverted: passMaxFlagPts (${vb.passMaxFlagPts}) must be <= conditionalMaxFlagPts (${vb.conditionalMaxFlagPts}) — otherwise the CONDITIONAL verdict is unreachable`
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
  const seenSignalIds = new Set<string>()
  for (let i = 0; i < m.signals.length; i++) {
    const s = m.signals[i]
    const name = s && typeof s.id === 'string' ? `"${s.id}"` : `#${i}`
    if (!s || typeof s.id !== 'string' || typeof s.label !== 'string') {
      return `macro signal ${name} needs a string id and label`
    }
    if (!s.id.trim()) {
      return `macro signal #${i} id must be a non-empty string`
    }
    // computeMacroSnapshot (lib/gate1/macro.ts) keys the series record and
    // manual values by signal id: two signals sharing an id read the SAME
    // observation and each cast a vote, so one data point could satisfy
    // minVotes by duplication (and double its weight in the regime score).
    if (seenSignalIds.has(s.id)) {
      return `duplicate macro signal id "${s.id}" — signal ids key the series record, so a duplicate lets one observation vote more than once`
    }
    seenSignalIds.add(s.id)
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
  // computeMacroSnapshot (lib/gate1/macro.ts) hard-codes three signal ROLES by
  // exact id — they are engine-consumed, not free-form config:
  //   'sahm'     → the hard recession override compares its VALUE as a level
  //                against the published 0.5 Sahm trigger (transform 'level',
  //                direction 'high_is_bad': a rising Sahm reading marks a
  //                recession start);
  //   'gdp'      → the quadrant reads its value as yoy real-GDP growth, and
  //                its raw series drives the technical-recession override
  //                (transform 'yoy', direction 'high_is_good': faster growth
  //                is the benign vote);
  //   'core_pce' → the quadrant reads its value as yoy inflation
  //                (transform 'yoy', direction 'high_is_bad': hotter inflation
  //                is the adverse vote).
  // Renaming one of these ids silently DISABLES the override / blanks the
  // quadrant to 'unknown' (find() by id just misses), and flipping a transform
  // feeds the wrong units into those hard-coded comparisons — e.g. sahm-as-yoy
  // breaks the 0.5pp trigger, gdp-as-level misclassifies the quadrant. Flipping
  // a DIRECTION is the same class of silent break one layer on: computeVote
  // (lib/gate1/macro.ts) reads direction to turn a value into a posture vote,
  // and that vote feeds the weighted regime score. A config that sets gdp to
  // 'high_is_bad' while ordering its bands for the new direction validates every
  // other rule here, yet makes strong growth vote red and weak growth vote green
  // — inverting the regime score and every fund-wide posture derived from it,
  // exactly the axis the transform pin above does NOT cover. So each canonical
  // signal's direction is pinned to its meaning here alongside its transform.
  const ENGINE_SIGNAL_ROLES = [
    { id: 'sahm', transform: 'level', direction: 'high_is_bad', role: 'the Sahm-rule hard recession override compares its value, as a level, against the published 0.5 trigger' },
    { id: 'gdp', transform: 'yoy', direction: 'high_is_good', role: 'the quadrant reads its value as yoy real-GDP growth (and its raw series drives the technical-recession override)' },
    { id: 'core_pce', transform: 'yoy', direction: 'high_is_bad', role: 'the quadrant reads its value as yoy inflation' },
  ] as const
  for (const need of ENGINE_SIGNAL_ROLES) {
    const s = m.signals.find((x: any) => x && x.id === need.id)
    if (!s) {
      return `macro signals must include id "${need.id}" — the macro engine (lib/gate1/macro.ts) consumes that exact id: ${need.role}. Without it that engine behavior is silently disabled`
    }
    if (s.transform !== need.transform) {
      return `macro signal "${need.id}" must have transform "${need.transform}" (got ${JSON.stringify(s.transform)}) — the macro engine consumes it by role: ${need.role}, so any other transform feeds the wrong units into that hard-coded comparison`
    }
    if (s.direction !== need.direction) {
      return `macro signal "${need.id}" must have direction "${need.direction}" (got ${JSON.stringify(s.direction)}) — the macro engine consumes it by role: ${need.role}, so this signal's tightening direction is fixed by its meaning; a flipped direction (even with bands reordered to match) inverts its vote in the weighted regime score`
    }
  }
  for (const [id, w] of Object.entries(m.signalWeights)) {
    if (!finite(w) || (w as number) < 0) {
      return `macro signalWeights["${id}"] must be a finite number >= 0`
    }
  }
  // computeMacroSnapshot (lib/gate1/macro.ts) flags a snapshot degraded when
  // voted.length < minVotes, and voted.length can never exceed the configured
  // signal count — so a minVotes above m.signals.length permanently degrades
  // every future snapshot. Cap it at the signal count (and require an integer:
  // it is compared against a count).
  if (!Number.isInteger(m.minVotes) || m.minVotes < 1 || m.minVotes > m.signals.length) {
    return `macro minVotes must be an integer between 1 and ${m.signals.length} (the configured signal count) — got ${JSON.stringify(m.minVotes)}; a minVotes above the signal count can never be met, so every future snapshot would be degraded`
  }
  // computeMacroSnapshot (lib/gate1/macro.ts) compares an INTEGER
  // consecutive-win count against hysteresisWins (wins >= macro.hysteresisWins)
  // — a fractional value like 1.5 can never be equaled by a count, so it
  // silently behaves as the next integer up (2): a tightening nobody asked
  // for and nothing displays. Require the integer the engine compares against.
  if (!Number.isInteger(m.hysteresisWins) || m.hysteresisWins < 1) {
    return `macro hysteresisWins must be an integer >= 1 — got ${JSON.stringify(m.hysteresisWins)}; the engine compares it against an integer count of consecutive wins, so a fractional value silently behaves as the next integer up`
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
      // Keys are consumed by string equality (postures[asset_class] ??
      // postures['*'] in gate1.ts, DealIntake.tsx, MacroDashboard.tsx), so a
      // misspelled key never errors — it just never matches, and the class it
      // was meant to scope silently takes the '*' posture instead. Only three
      // kinds of key can ever be read on purpose: the '*' fallback, a
      // supported deal asset class, and the documented macro-only posture
      // classes above. Reject anything else by name.
      if (asset !== '*' &&
          !SUPPORTED_ASSET_CLASSES.includes(asset) &&
          !MACRO_ONLY_POSTURE_CLASSES.includes(asset)) {
        return `macro postureMatrix "${regime}" has unknown asset class key "${asset}" — keys must be '*', a supported deal asset class (${SUPPORTED_ASSET_CLASSES.join(', ')}), or a macro-only posture class (${MACRO_ONLY_POSTURE_CLASSES.join(', ')}); a misspelled key activates fine but every consumer falls back to the '*' posture for the class it was meant to scope`
      }
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
  // A non-empty, well-typed table can still fail to cover the one lockup the
  // engine actually looks up: computeMacroSnapshot matches the first band with
  // PILOT_LOCKUP_YEARS <= maxYears and falls back to `?? 0`, so a table whose
  // bands ALL end below the pilot's lockup matches nothing and silently drops
  // the whole illiquidity premium from every hurdle. Require coverage of the
  // pilot term (PILOT_LOCKUP_YEARS, mirrored above from lib/gate1/macro.ts).
  const maxYearsCovered = Math.max(...hs.illiquidityBpsByLockupYears.map((t: any) => t.maxYears))
  if (maxYearsCovered < PILOT_LOCKUP_YEARS) {
    return `macro hurdleStack illiquidityBpsByLockupYears tops out at maxYears=${maxYearsCovered}, below the pilot fund's ${PILOT_LOCKUP_YEARS}-year lockup (PILOT_LOCKUP_YEARS in lib/gate1/macro.ts) — the engine would match no band and silently drop the whole illiquidity premium from the hurdle; at least one band needs maxYears >= ${PILOT_LOCKUP_YEARS}`
  }
  for (const key of ['complexityBpsByStrategy', 'regimeBps']) {
    const rec = hs[key]
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) ||
        !Object.values(rec).every((v) => finite(v))) {
      return `macro hurdleStack ${key} must be an object of finite numbers`
    }
  }
  // The every-over-finite check above passes vacuously on {} — but
  // computeMacroSnapshot (lib/gate1/macro.ts) reads the pilot fund's hurdle
  // as complexityBpsByStrategy['development'] ?? 0 and regimeBps[regime] ?? 0:
  // a missing entry never fails, it silently contributes 0 bps and UNDERSTATES
  // the hurdle every deal is judged against. So the engine-consumed entries
  // are required: the 'development' strategy (the pilot fund's hard-coded
  // strategy) and every canonical regime.
  if (!('development' in hs.complexityBpsByStrategy)) {
    return `macro hurdleStack complexityBpsByStrategy needs a "development" entry — the macro engine reads the pilot fund's complexity premium from exactly that key (complexityBpsByStrategy['development'] ?? 0), so without it the hurdle is silently understated by the whole complexity premium`
  }
  for (const regime of REGIMES) {
    if (!(regime in hs.regimeBps)) {
      return `macro hurdleStack regimeBps is missing regime "${regime}" — the macro engine reads regimeBps[activeRegime] ?? 0, so a missing regime silently contributes 0 bps and understates the hurdle whenever that regime is active; it must cover exactly ${REGIMES.join(', ')}`
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
