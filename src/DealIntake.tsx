// Deal Intake tab — upload/enter → review → Gate 1 results, with judgment
// adjustments and a persisted decision ledger. Owns all intake state; the
// step components are pure. Debounced live scoring mirrors DealScore.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import IntakeUpload from './IntakeUpload'
import IntakeReview from './IntakeReview'
import DealSnapshot from './DealSnapshot'
import GateResults from './GateResults'
import FinancialSummary from './FinancialSummary'
import KpiScorecard from './KpiScorecard'
import JudgmentPanel from './JudgmentPanel'
import ConsistencyPanel from './ConsistencyPanel'
import MarketComparison from './MarketComparison'
import MacroDashboard, { MacroStrip } from './MacroDashboard'
import ThresholdConfig from './ThresholdConfig'
import Backtest from './Backtest'
import EvidencePanel from './EvidencePanel'
import DealHistory from './DealHistory'
import MarketPathCard from './MarketPathCard'
import McProbabilityCard from './McProbabilityCard'
import LocationIntelCard from './LocationIntelCard'
import { buildCrossChecks } from './marketCrossChecks'
import { useMarketContext } from './useMarketContext'
import LoginCard from './LoginCard'
import UsersPanel from './UsersPanel'
import { authFetch, supabase, useIdentity, INTAKE_STATE_KEY, CONFIG_DRAFT_KEY, type AdminFlag } from './auth'
import type { AvailableKey } from './JudgmentPanel'
import type { ExtractionResult } from '../netlify/functions/lib/gate1/fields'
import type { Gate1Config, MacroSnapshot, Regime } from '../netlify/functions/lib/gate1/types'
import { ALL_FIELDS, ASSET_CLASSES, REQUIRED_FIELD_KEYS } from './deal-types'
import type {
  DealFields,
  FieldKind,
  Gate1Response,
  IntakeFormValues,
  JudgmentAdjustment,
  Posture,
} from './deal-types'

type Step = 'intake' | 'review' | 'results' | 'thresholds' | 'macro' | 'backtest' | 'evidence' | 'deals' | 'users'
const STEP_IDS: Step[] = ['intake', 'review', 'results', 'thresholds', 'macro', 'backtest', 'evidence', 'deals', 'users']

// Working-state storage keys live in auth.ts (one definition — signOut clears
// them there); local aliases keep the call sites readable.
const LS_KEY = INTAKE_STATE_KEY
const LS_DRAFT_KEY = CONFIG_DRAFT_KEY

// Matches the crypto.randomUUID() extraction ids IntakeUpload mints — only a
// UUID-shaped id ever became the extractions row's PK server-side, so only
// those are worth sending on decide (the recorded sample carries none).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The live macro payload: snapshot plus market context + persistence honesty flags. */
type MacroPayload = MacroSnapshot & { persisted?: boolean; live?: boolean; warning?: string }

/**
 * Draft rulebook + provenance. baseVersion is the ACTIVE version at the moment
 * the draft OPENED (first edit) — never the version fetched at save time — so a
 * draft edited from v3 still 409s against a later v4 even after a reload
 * refetched v4 as active. Legacy drafts stored the bare config; they map to
 * baseVersion 0 so the save fails closed into the server's 409 flow instead of
 * silently discarding intervening versions.
 */
type DraftState = { config: Gate1Config; baseVersion: number }

/**
 * Restore the persisted rulebook draft — but only for the identity that saved
 * it, mirroring loadSaved. The payload is origin-wide localStorage, so on a
 * shared browser an unstamped draft would otherwise let user B (or a signed-out
 * visitor) open Thresholds and score previews under user A's draft. A draft
 * stamped with a different owner — or an owned draft read while signed out — is
 * DISCARDED outright (removed, never re-stamped). Legacy drafts without a stamp
 * read as anonymous (owner null), so auth-off deployments restore as before.
 */
function loadDraft(owner: string | null): DraftState | null {
  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object') return null
    const savedOwner: string | null = typeof p.owner === 'string' ? p.owner : null
    if (savedOwner !== owner) {
      localStorage.removeItem(LS_DRAFT_KEY)
      return null
    }
    if ('config' in p) {
      return p.config && typeof p.config === 'object'
        ? { config: p.config as Gate1Config, baseVersion: typeof p.baseVersion === 'number' ? p.baseVersion : 0 }
        : null
    }
    return { config: p as Gate1Config, baseVersion: 0 } // legacy bare-config shape
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Coercion: raw form values (typed sample values OR input strings) → DealFields.
// Rules: '' → null; numeric strings → numbers; pct entered as "5" → 0.05
// (already-decimal numbers from the sample pass through); bool 'yes'/'no'/''.
// ---------------------------------------------------------------------------
function coerceValue(kind: FieldKind, v: string | number | boolean | null | undefined): string | number | boolean | null {
  if (v === undefined || v === null || v === '') return kind === 'text' ? '' : null
  if (kind === 'bool') {
    if (typeof v === 'boolean') return v
    return v === 'yes' ? true : v === 'no' ? false : null
  }
  if (kind === 'text') return String(v)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return kind === 'pct' ? n / 100 : n
}

function coerceFields(form: IntakeFormValues): DealFields {
  const out: Record<string, unknown> = {}
  for (const f of ALL_FIELDS) out[f.key] = coerceValue(f.kind, form[f.key])
  return out as unknown as DealFields
}

function isFilled(form: IntakeFormValues, key: keyof DealFields): boolean {
  const f = ALL_FIELDS.find(d => d.key === key)
  if (!f) return false
  const v = coerceValue(f.kind, form[key])
  return v !== null && v !== ''
}

/**
 * Does the analyst's raw review value still equal the ORIGINALLY extracted one?
 * Both sides run through coerceValue; pct compares at the input's 4-decimal
 * display precision because a retyped percent round-trips one ulp off the
 * extracted decimal ("1.8" → 0.018000000000000002 vs 0.018) and a plain ===
 * would brand a restored value as edited.
 */
function matchesExtracted(
  kind: FieldKind,
  raw: string | number | boolean | null | undefined,
  extracted: string | number | boolean | null,
): boolean {
  const a = coerceValue(kind, raw)
  const b = coerceValue(kind, extracted)
  if (kind === 'pct' && typeof a === 'number' && typeof b === 'number') {
    return Number((a * 100).toFixed(4)) === Number((b * 100).toFixed(4))
  }
  return a === b
}

type SavedIntake = { fields: IntakeFormValues; adjustments: JudgmentAdjustment[]; step: Step; extraction: ExtractionResult | null; dealId: string | null }

/**
 * Restore the persisted working state — but only for the identity that saved
 * it. The payload is origin-wide localStorage, so on a shared browser it would
 * otherwise hand the previous analyst's confidential deal (fields, citations,
 * dealId) to whoever signs in next. A payload stamped with a different owner —
 * or an owned payload read while signed out — is DISCARDED outright (removed,
 * never re-stamped). Legacy payloads without a stamp read as anonymous
 * (owner null), so auth-off deployments restore exactly as before.
 */
function loadSaved(owner: string | null): SavedIntake | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    const savedOwner: string | null = typeof p.owner === 'string' ? p.owner : null
    if (savedOwner !== owner) {
      localStorage.removeItem(LS_KEY)
      return null
    }
    return {
      fields: p.fields && typeof p.fields === 'object' ? p.fields : {},
      adjustments: Array.isArray(p.adjustments) ? p.adjustments : [],
      step: STEP_IDS.includes(p.step) ? p.step : 'intake',
      extraction: p.extraction && typeof p.extraction === 'object' ? p.extraction : null,
      dealId: typeof p.dealId === 'string' ? p.dealId : null,
    }
  } catch {
    return null
  }
}

export default function DealIntake() {
  // Auth-off builds (no Supabase client) resolve identity synchronously —
  // always anonymous — so the saved state restores right here in the
  // initializers, exactly as it always has. Auth-capable builds start empty:
  // the owner isn't known until the async session restore settles, and
  // restoring before then would flash (and re-stamp) the previous analyst's
  // confidential deal. They hydrate in the identity-gated effect below.
  const [saved] = useState(() => (supabase === null ? loadSaved(null) : null))
  const [fields, setFields] = useState<IntakeFormValues>(() => saved?.fields ?? {})
  const [adjustments, setAdjustments] = useState<JudgmentAdjustment[]>(() => saved?.adjustments ?? [])
  const [step, setStep] = useState<Step>(() => saved?.step ?? 'intake')
  const [extraction, setExtraction] = useState<ExtractionResult | null>(() => saved?.extraction ?? null)
  const [lastResponse, setLastResponse] = useState<Gate1Response | null>(null)
  const [scoring, setScoring] = useState(false)
  // True from the moment a change schedules a re-preview until that preview's
  // response lands — the displayed verdict no longer matches the inputs, so
  // recording is blocked meanwhile.
  const [previewStale, setPreviewStale] = useState(false)
  // Bumped when a decide 409s (rulebook/posture moved since the preview) to
  // force a fresh preview even though no input changed — the analyst must
  // re-review under the new server state before recording again.
  const [reviewNonce, setReviewNonce] = useState(0)
  const previewSeqRef = useRef(0)
  const [scoreErr, setScoreErr] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decision, setDecision] = useState<Pick<Gate1Response, 'persisted' | 'warning' | 'decisionId'> | null>(null)
  // The working deal's server identity — returned by decide, sent back on the
  // next decide so history accretes onto the SAME deals row across sessions.
  // Cleared whenever the deal identity changes (new extraction/sample, rename).
  const [dealId, setDealId] = useState<string | null>(() => saved?.dealId ?? null)
  const [prefill, setPrefill] = useState<{ key: string; value: number } | null>(null)
  const judgmentRef = useRef<HTMLDivElement>(null)

  // Weekly macro snapshot + market context (live-computed when nothing is persisted).
  const [macro, setMacro] = useState<MacroPayload | null>(null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroErr, setMacroErr] = useState<string | null>(null)
  // Active threshold config version + the analyst's local draft (previews only).
  const [activeConfig, setActiveConfig] = useState<{ version: number; config: Gate1Config } | null>(null)
  // Auth-off builds resolve identity synchronously (always anonymous), so the
  // owner-stamped draft restores here in the initializer, as before. Auth-capable
  // builds start empty and hydrate the draft only after the session restore
  // settles (the owner-gated effect below) — restoring beforehand could show the
  // previous analyst's draft to whoever is at the keyboard.
  const [draft, setDraft] = useState<DraftState | null>(() => (supabase === null ? loadDraft(null) : null))
  const draftConfig = draft?.config ?? null

  // Inner auth layer. Auth is ACTIVE only when the build has client keys AND
  // the server reports its auth layer on (identity.authEnabled) — the VITE_
  // keys are committed, so a build alone proves nothing about the deployment.
  // Anything else (public demo, status probe still in flight) keeps 'auth-off'
  // legacy visibility: every gated control renders exactly as before auth.
  const identity = useIdentity()
  const isAdmin: AdminFlag = identity.authEnabled === true ? identity.role === 'admin' : 'auth-off'

  // If admin access disappears while the USERS step is open — the admin signs
  // out, or reloads after a server-side demotion — the USERS chip is already
  // gone (toolSteps) but the step state would strand the view on the admin-only
  // panel. Move off it so UsersPanel unmounts and its cached roster + email
  // addresses drop (the render is ALSO gated on isAdmin === true below). A live
  // admin (isAdmin === true) is never touched, so normal admin usage is
  // unchanged; anything else — analyst, signed-out, or auth-off — resets.
  useEffect(() => {
    if (isAdmin !== true) setStep(s => (s === 'users' ? 'intake' : s))
  }, [isAdmin])

  // --- Owner-gated hydration of the persisted working state ----------------
  // hydratedRef: true once the owner-checked restore has run (immediately on
  // auth-off builds, where the initializers restored synchronously). The save
  // effect is gated on it so an empty pre-hydration render can never clobber
  // the stored payload. ownerRef: the identity the CURRENT in-memory state
  // belongs to — saves stamp this (never the live identity) so another
  // account's data can't be re-labelled inside a sign-in/out transition tick.
  const hydratedRef = useRef(supabase === null)
  const ownerRef = useRef<string | null>(null)

  const applyLoaded = (s: SavedIntake | null) => {
    setFields(s?.fields ?? {})
    setAdjustments(s?.adjustments ?? [])
    setStep(s?.step ?? 'intake')
    setExtraction(s?.extraction ?? null)
    setDealId(s?.dealId ?? null)
    // Derived per-deal state must not survive an identity reset either.
    setLastResponse(null)
    setDecision(null)
    setPrefill(null)
  }

  useEffect(() => {
    if (!identity.sessionReady) return // owner unknown — do not touch storage yet
    const owner = identity.userId
    if (!hydratedRef.current) {
      // First hydration on an auth-capable build, now that the session
      // restore settled and the owner is definitive.
      hydratedRef.current = true
      ownerRef.current = owner
      const s = loadSaved(owner)
      if (s) applyLoaded(s)
      // The rulebook draft is owner-gated the same way: load only what this
      // identity owns (loadDraft discards a mismatched draft outright).
      const d = loadDraft(owner)
      if (d) setDraft(d)
      return
    }
    if (owner === ownerRef.current) return
    const prev = ownerRef.current
    ownerRef.current = owner
    if (prev === null) {
      // Anonymous work, then sign-in: the same human at the keyboard — keep
      // the in-memory state and re-stamp the stored payloads as theirs now, so
      // they survive a reload under the signed-in identity.
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ owner, fields, adjustments, step, extraction, dealId }))
        if (draft) localStorage.setItem(LS_DRAFT_KEY, JSON.stringify({ owner, ...draft }))
      } catch { /* storage full/blocked — non-fatal */ }
      return
    }
    // Signed out (or the account changed): the on-screen state belongs to the
    // previous account — reset it and restore whatever the new identity owns
    // (sign-out already cleared the keys; expiry leaves a payload loadSaved
    // now discards). The config draft re-loads the same owner-gated way.
    applyLoaded(loadSaved(owner))
    setDraft(loadDraft(owner))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state reads are the render's own; re-running on them would be a no-op behind the owner guard
  }, [identity.sessionReady, identity.userId])

  const fetchMacro = useCallback(async () => {
    setMacroLoading(true)
    setMacroErr(null)
    try {
      // GET /api/macro/latest is identity-gated (requireAccount) when accounts
      // are on, so this goes through authFetch; it degrades to plain fetch when
      // signed-out/unconfigured, unchanged in auth-off builds.
      const r = await authFetch('/api/macro/latest')
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setMacro(data as MacroPayload)
    } catch (e) {
      setMacroErr(String((e as Error)?.message || e))
    } finally {
      setMacroLoading(false)
    }
  }, [])

  const fetchActiveConfig = useCallback(() => {
    fetch('/api/config/active')
      .then(r => r.json())
      .then(d => { if (d?.config) setActiveConfig({ version: d.version ?? 0, config: d.config }) })
      .catch(() => { /* config panel shows its own empty state */ })
  }, [])

  // Macro is identity-gated (requireAccount) when accounts are on: fetch on
  // mount AND refetch when the signed-in identity changes, so a user who signs
  // in after the initial anonymous (401'd) request recovers the dashboard
  // without a reload. fetchMacro is stable, so identity.userId is the trigger;
  // it stays null in auth-off builds, so this fires exactly once there.
  useEffect(() => {
    fetchMacro()
  }, [fetchMacro, identity.userId])

  // The active config read is not identity-gated — fetch it once on mount.
  useEffect(() => {
    fetchActiveConfig()
  }, [fetchActiveConfig])

  const handleDraftChange = (cfg: Gate1Config | null) => {
    // The first edit OPENS the draft — stamp what it was edited from right
    // then; later edits keep that stamp (see DraftState).
    const next = cfg ? { config: cfg, baseVersion: draft?.baseVersion ?? activeConfig?.version ?? 0 } : null
    setDraft(next)
    try {
      // Stamp the owning identity (ownerRef — see hydration above) so a shared
      // browser never hands this draft to the next account; loadDraft discards
      // a mismatched stamp on restore.
      next ? localStorage.setItem(LS_DRAFT_KEY, JSON.stringify({ owner: ownerRef.current, ...next })) : localStorage.removeItem(LS_DRAFT_KEY)
    } catch { /* non-fatal */ }
  }

  const handleSaveConfig = async (cfg: Gate1Config, note: string) => {
    const r = await authFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The draft's STORED provenance, not the currently fetched active — a
      // version published since the draft opened must 409, never be discarded.
      body: JSON.stringify({ config: cfg, note, baseVersion: draft?.baseVersion ?? activeConfig?.version ?? 0 }),
    })
    const data = await r.json()
    if (r.ok && data.version) {
      setActiveConfig({ version: data.version, config: cfg })
      handleDraftChange(null)
      return { persisted: true, version: data.version }
    }
    return { persisted: false, warning: data.error ?? 'Save failed' }
  }

  const handleOverride = async (o: { regime?: Regime; note: string }) => {
    const r = await authFetch('/api/macro/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    setMacro(data as MacroPayload)
  }

  // Config-sourced return benchmarks ('*','*' rows) for KPI captions + comparisons.
  const benchmarks = useMemo(() => {
    const cfg = draftConfig ?? activeConfig?.config
    if (!cfg) return null
    const find = (key: string) => cfg.thresholds.find(t => t.key === key && t.asset_class === '*' && t.posture === '*')?.value
    const coc = find('coc_benchmark')
    const irr = find('irr_benchmark')
    const em = find('equity_multiple_benchmark')
    const spread = find('financing_spread_typical_bps')
    if (coc == null || irr == null || em == null || spread == null) return null
    return { coc, irr, equityMultiple: em, financingSpreadTypicalBps: spread }
  }, [activeConfig, draftConfig])

  // --- Rulebook drift between the preview and the cached active config ------
  // A rulebook published after page load makes the next preview score under
  // the NEW active version (the response reports it), while `activeConfig` —
  // the source of the KPI benchmark captions and market comparisons above —
  // still holds the version fetched at mount. The record handshake can't
  // catch it: the preview already matches the CURRENT active version, so a
  // v4 verdict would record beside v3 benchmarks without a 409. So when the
  // previewed version is a REAL version (a draft previews as -1 and its
  // benchmarks derive from the draft itself — in sync by construction) that
  // differs from the cached one, refetch the active config; the benchmarks
  // memo recomputes. Until the versions agree the comparisons are SUPPRESSED,
  // never shown stale (displayBenchmarks below).
  const previewedVersion = lastResponse?.configVersion
  const benchmarkVersionDrift =
    previewedVersion !== undefined && previewedVersion >= 0 && previewedVersion !== activeConfig?.version
  const [benchmarkSync, setBenchmarkSync] = useState<'idle' | 'refetching' | 'failed'>('idle')

  useEffect(() => {
    if (!benchmarkVersionDrift) {
      setBenchmarkSync('idle')
      return
    }
    let cancelled = false
    setBenchmarkSync('refetching')
    fetch('/api/config/active')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (!d?.config) {
          setBenchmarkSync('failed') // 503 etc. — comparisons stay hidden, honestly labelled
          return
        }
        // A same-version result keeps the previous object: if the active moved
        // PAST the previewed version (published twice), drift persists and a
        // fresh object here would change nothing but re-render; the next
        // preview (scored under the newer version) clears it.
        setActiveConfig(prev =>
          prev && prev.version === (d.version ?? 0) ? prev : { version: d.version ?? 0, config: d.config })
        setBenchmarkSync('idle')
      })
      .catch(() => { if (!cancelled) setBenchmarkSync('failed') })
    return () => { cancelled = true }
    // Keyed on the drift verdict + the preview response that produced it: one
    // refetch per drifted preview, nothing this effect sets re-triggers it
    // (a same-version refetch preserves the activeConfig reference), and a
    // failed refetch retries on the next preview — never in a loop.
  }, [benchmarkVersionDrift, lastResponse])

  // What the benchmark-consuming panels may DISPLAY: withheld entirely while
  // the versions disagree — both panels already render an honest
  // benchmarks-unavailable state (the same one shown before the config first
  // loads), which beats a comparison against thresholds the verdict never
  // ran under.
  const displayBenchmarks = benchmarkVersionDrift ? null : benchmarks

  // Backtest par comes from the ACTIVE config only — backtest rows are scored
  // server-side under the active rulebook (no configOverride is sent), so a
  // draft-aware par would grade verdicts against thresholds they never ran under.
  const activeParIrr = useMemo(() => {
    const cfg = activeConfig?.config
    return cfg?.thresholds.find(t => t.key === 'irr_benchmark' && t.asset_class === '*' && t.posture === '*')?.value ?? 0.12
  }, [activeConfig])

  // Persist the working state so a refresh never loses the analyst's inputs.
  // Stamped with the owning identity (ownerRef — see hydration above) and
  // gated until the owner-checked restore has run, so a pre-hydration render
  // never clobbers the stored payload with an empty one.
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ owner: ownerRef.current, fields, adjustments, step, extraction, dealId }))
    } catch { /* storage full/blocked — non-fatal */ }
  }, [fields, adjustments, step, extraction, dealId])

  const coerced = useMemo(() => coerceFields(fields), [fields])
  // Independent market context for the Review step (Items 2–3): one neutral
  // /api/score call per location value, shared by the cross-check annotations
  // and the LocationIntelCard. Only fetched once a deal is in flight (the
  // review step is reachable), never on the tool tabs.
  const marketCtx = useMarketContext(
    step === 'review' || step === 'results'
      ? (typeof coerced.location === 'string' ? coerced.location : '')
      : null,
  )
  // Annotations are suppressed while market data loads or fails (belt and
  // braces with the hook's per-cycle reset): a stale metro's figures must
  // never sit under another location's fields as "independent context".
  const crossChecks = useMemo(
    () => (marketCtx.loading || marketCtx.err ? {} : buildCrossChecks(marketCtx.data, coerced)),
    [marketCtx.loading, marketCtx.err, marketCtx.data, coerced],
  )
  // Membership, not truthiness: an asset class outside the registry must never
  // reach the engine, where it would silently score under '*' fallback thresholds.
  const canScore = typeof coerced.asset_class === 'string' && ASSET_CLASSES.includes(coerced.asset_class)
  // Recording (not previewing) also needs a deal name — an unnamed ledger row
  // could never be linked back to a deal.
  const hasDealName = typeof coerced.deal_name === 'string' && !!coerced.deal_name.trim()

  // The live macro posture for this deal's asset class ('*' fallback) — macro
  // moves the bar automatically; Patel can override it on the Macro page.
  const livePosture: Posture | undefined = useMemo(() => {
    if (!macro?.postures || !coerced.asset_class) return undefined
    return macro.postures[coerced.asset_class] ?? macro.postures['*']
  }, [macro, coerced.asset_class])

  // Live scoring: debounce 400ms, POST /api/gate1/preview (DealScore pattern).
  // Draft configs from the thresholds editor apply here (and only here).
  useEffect(() => {
    if (step !== 'results' || !canScore) return
    // Each scheduled preview takes a sequence number; only the latest one may
    // touch state, so an out-of-order response can't clobber a newer verdict.
    const seq = ++previewSeqRef.current
    setPreviewStale(true)
    // The change that scheduled this re-preview also invalidates any recorded
    // badge: that ledger row described the OLD inputs, so "Recorded" must never
    // sit beside a verdict it doesn't cover. Recording again re-sets it. Keep
    // non-persisted warnings — the 409 path sets one and bumps reviewNonce
    // (re-running this effect), so clearing those here would wipe the server's
    // message before the analyst ever saw it.
    setDecision(d => (d?.persisted ? null : d))
    const t = setTimeout(async () => {
      setScoring(true)
      setScoreErr(null)
      try {
        const r = await fetch('/api/gate1/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: coerced,
            adjustments,
            posture: livePosture,
            configOverride: draftConfig ?? undefined,
          }),
        })
        if (previewSeqRef.current !== seq) return
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('application/json'))
          throw new Error('Gate 1 engine offline — run `vite` (dev middleware) or `netlify dev`.')
        const data = await r.json()
        if (previewSeqRef.current !== seq) return
        if (data.error) throw new Error(data.error)
        setLastResponse(data as Gate1Response)
        setPreviewStale(false)
      } catch (e: unknown) {
        if (previewSeqRef.current !== seq) return
        setScoreErr(String((e as Error)?.message || e))
      } finally {
        if (previewSeqRef.current === seq) setScoring(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [coerced, adjustments, step, canScore, livePosture, draftConfig, reviewNonce])

  const recordDecision = async () => {
    if (!canScore || !hasDealName || !lastResponse || deciding || draftConfig || previewStale || scoring) return
    setDeciding(true)
    setDecision(null)
    try {
      // dealName lets the server link (or create) the deals row so the
      // decision lands in the browsable history instead of being orphaned;
      // dealId (from a prior decide of this working deal) pins WHICH row —
      // a bare name always opens a new deal server-side.
      const dealName = typeof coerced.deal_name === 'string' && coerced.deal_name.trim() ? coerced.deal_name.trim() : undefined
      // The uuid the client minted at upload — the extractions row's PK. Sent
      // so the server can stamp that row's deal_id once the decision resolves
      // a deal (best-effort server-side; the recorded sample carries no id).
      const extractionId =
        extraction?.extractionId && UUID_RE.test(extraction.extractionId) ? extraction.extractionId : undefined
      // authFetch so a signed-in analyst's decision carries their identity
      // (decided_by_email attribution); signed out it is a plain fetch.
      const r = await authFetch('/api/gate1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No posture override: the server resolves posture + config itself
        // (snapshot-derived) and compares them against what THIS preview ran
        // under — expectedPosture / expectedConfigVersion, read off the last
        // preview response. A mismatch 409s instead of silently recording a
        // verdict nobody reviewed.
        body: JSON.stringify({
          fields: coerced,
          adjustments,
          expectedPosture: lastResponse.posture,
          expectedConfigVersion: lastResponse.configVersion,
          dealName,
          dealId: dealId ?? undefined,
          extractionId,
        }),
      })
      const data = await r.json()
      if (r.status === 409) {
        // The rulebook or macro posture moved between preview and record.
        // Surface the server's message through the warning slot and mark the
        // preview stale: the nonce bump forces a fresh preview (inputs are
        // unchanged) while macro + active config refetch so the analyst
        // re-reviews under the new state before recording again.
        setPreviewStale(true)
        setReviewNonce(n => n + 1)
        fetchMacro()
        fetchActiveConfig()
        setDecision({
          persisted: false,
          warning: typeof data?.error === 'string' ? data.error : 'The review is out of date — re-review and record again',
        })
        return
      }
      if (data.error) throw new Error(data.error)
      if (typeof data.dealId === 'string') setDealId(data.dealId)
      setLastResponse(data as Gate1Response)
      setDecision({ persisted: data.persisted, warning: data.warning, decisionId: data.decisionId })
    } catch (e: unknown) {
      setDecision({ persisted: false, warning: String((e as Error)?.message || e) })
    } finally {
      setDeciding(false)
    }
  }

  const missingKeys = REQUIRED_FIELD_KEYS.filter(k => !isFilled(fields, k))
  const filledCount = ALL_FIELDS.filter(f => isFilled(fields, f.key)).length

  // Threshold keys the JudgmentPanel can adjust — from the BASELINE result so
  // `effective` is the pre-judgment (base) value even when adjustments exist.
  const availableKeys: AvailableKey[] = useMemo(() => {
    if (!lastResponse) return []
    const seen = new Map<string, AvailableKey>()
    for (const c of lastResponse.baselineFull.checks) {
      if (c.threshold && !seen.has(c.threshold.key)) {
        seen.set(c.threshold.key, { key: c.threshold.key, label: c.label, effective: c.threshold.effective })
      }
    }
    return [...seen.values()]
  }, [lastResponse])

  // Document ingest: an extraction result (live or recorded) becomes the review
  // form's starting state. Extraction never guesses — nulls stay empty and land
  // in the "needs attention" strip for the analyst.
  const handleExtracted = (result: ExtractionResult) => {
    const values: IntakeFormValues = {}
    for (const f of ALL_FIELDS) {
      const ex = result.fields[f.key]
      if (ex && ex.value !== null && ex.value !== undefined) values[f.key] = ex.value as never
    }
    // An extracted class outside the registry (e.g. "hotel") would render the
    // select unselected while still counting as filled — clear it so the
    // required-field strip flags it and the analyst must pick a supported one.
    if (typeof values.asset_class === 'string' && !ASSET_CLASSES.includes(values.asset_class)) {
      values.asset_class = ''
    }
    setFields(values)
    setExtraction(result)
    setAdjustments([])
    setLastResponse(null)
    setDecision(null)
    setDealId(null) // a fresh extraction (or the sample) is a new deal identity
    setPrefill(null)
    setStep('review')
  }

  // A correction must not wear the model's provenance: when the analyst's value
  // no longer matches the originally extracted one, flag that field's metadata
  // `edited` (IntakeReview then swaps the confidence chip for "analyst-edited"
  // and drops the citation); restoring the original value clears the flag.
  const handleFieldChange = (key: keyof DealFields, rawValue: string) => {
    if (key === 'deal_name') {
      // A different name is a different deal — drop the stored server identity
      // so the next decide opens a fresh deals row instead of accreting onto
      // the renamed one's history.
      const cur = fields.deal_name
      const curName = typeof cur === 'string' ? cur.trim() : cur == null ? '' : String(cur).trim()
      if (rawValue.trim() !== curName) setDealId(null)
    }
    setFields(prev => ({ ...prev, [key]: rawValue }))
    const def = ALL_FIELDS.find(f => f.key === key)
    setExtraction(prev => {
      const ex = prev?.fields[key]
      if (!prev || !ex || ex.value === null || !def) return prev
      const edited = !matchesExtracted(def.kind, rawValue, ex.value)
      if (edited === !!ex.edited) return prev
      return { ...prev, fields: { ...prev.fields, [key]: { ...ex, edited } } }
    })
  }

  const handleAdjust = (thresholdKey: string, currentEffective: number) => {
    setPrefill({ key: thresholdKey, value: currentEffective })
    judgmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const stepLabel: Record<Step, string> = {
    intake: '① INTAKE',
    review: '② REVIEW',
    results: '③ RESULTS',
    thresholds: 'THRESHOLDS',
    macro: 'MACRO',
    backtest: 'BACKTEST',
    evidence: 'EVIDENCE',
    deals: 'DEALS',
    users: 'USERS',
  }

  // The USERS chip appears only for a signed-in admin — never in auth-off
  // mode, where there are no accounts to manage.
  const toolSteps: Step[] = isAdmin === true
    ? ['thresholds', 'macro', 'backtest', 'evidence', 'deals', 'users']
    : ['thresholds', 'macro', 'backtest', 'evidence', 'deals']

  // Sign-in wall — on a REQUIRE_ACCOUNTS deployment (server-declared via
  // /api/auth/status) a signed-out visitor gets the sign-in card and nothing
  // else. Gated on sessionReady so a reload never flashes the wall at an
  // already-signed-in user, and on the definitive true/true pair so the public
  // demo (accountsRequired false) and the probe's in-flight window (null)
  // render the app exactly as before. Client-side courtesy only — the require*
  // gates on every data endpoint remain the enforcement boundary.
  if (identity.authEnabled === true && identity.accountsRequired === true && identity.sessionReady && !identity.email) {
    return (
      <div className="cc-theme di-root">
        <style>{CSS}</style>
        <LoginCard identity={identity} />
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sign in required</h2>
          <p style={{ color: 'var(--muted)', maxWidth: '48rem' }}>
            This pilot workspace is restricted to issued accounts. Sign in above with the
            credentials your administrator provided — there is no self-signup.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="cc-theme di-root">
      <style>{CSS}</style>

      {/* Sign-in card / signed-in chip — only once the server has confirmed
          auth is active (authEnabled true, never while null/loading), so the
          public demo and the probe's in-flight window never flash it */}
      {identity.authEnabled === true && <LoginCard identity={identity} />}

      {/* Sub-nav stepper */}
      <nav className="di-nav" aria-label="Deal intake steps">
        {(['intake', 'review', 'results'] as Step[]).map((s, i) => (
          <span key={s} className="di-nav-step">
            {i > 0 && <span className="di-nav-arrow">→</span>}
            <button
              className={`di-nav-item${step === s ? ' di-active' : ''}`}
              onClick={() => setStep(s)}
              disabled={s === 'results' && !canScore}
            >
              {stepLabel[s]}
            </button>
          </span>
        ))}
        <span className="di-nav-sep">|</span>
        {toolSteps.map((s, i) => (
          <span key={s} className="di-nav-step">
            {i > 0 && <span className="di-nav-arrow">·</span>}
            <button
              className={`di-nav-item${step === s ? ' di-active' : ''}`}
              onClick={() => setStep(s)}
            >
              {stepLabel[s]}
            </button>
          </span>
        ))}
      </nav>

      {/* ① INTAKE — document ingest is the only way in */}
      {step === 'intake' && <IntakeUpload onExtracted={handleExtracted} />}

      {/* ② REVIEW — verify what was extracted */}
      {step === 'review' && (
        <>
          {extraction?.recorded && (
            <div className="di-recorded-note" role="note">
              Showing a recorded extraction of the sample deal documents (Faithful Trails OM v2 +
              Okeechobee pro forma v18) — upload your own documents on the Intake step to run the
              same extraction pipeline live.
            </div>
          )}
          <IntakeReview
            fields={fields}
            onChange={handleFieldChange}
            missingKeys={missingKeys}
            meta={extraction?.fields}
            provenance={extraction?.provenance}
            crossChecks={crossChecks}
          />
          <LocationIntelCard
            location={typeof coerced.location === 'string' ? coerced.location : null}
            context={marketCtx}
          />
          <div className="di-stickybar">
            <span className="di-muted">{filledCount} of {ALL_FIELDS.length} fields confirmed</span>
            <button
              onClick={() => setStep('results')}
              disabled={!canScore}
              title={canScore ? undefined : 'Pick an asset class (Deal & Sponsor) to score this deal'}
            >
              CONFIRM &amp; SCORE
            </button>
          </div>
        </>
      )}

      {/* ③ RESULTS */}
      {step === 'results' && (
        <div className="di-results">
          {scoreErr && <div className="di-err" role="alert">{scoreErr}</div>}
          {scoring && <div className="di-updating">scoring…</div>}
          {!canScore && <div className="card di-muted">Pick an asset class on the review step to score this deal.</div>}
          {canScore && (
            <>
              {/* Same posture the gates score under: this deal's asset class,
                  '*' fallback — never the '*' posture beside a class-specific
                  verdict (canScore guarantees asset_class is a valid string). */}
              <MacroStrip
                snapshot={macro}
                assetClass={typeof coerced.asset_class === 'string' ? coerced.asset_class : undefined}
              />
              {draftConfig && (
                <div className="di-draft-note" role="note">
                  Scoring against your DRAFT thresholds (v{activeConfig?.version ?? 0} + edits) — decisions can't
                  be recorded until the draft is saved or cleared on the Thresholds page.
                </div>
              )}
              <DealSnapshot fields={coerced} response={lastResponse} />
              {lastResponse && (
                <>
                  <GateResults response={lastResponse} onAdjust={handleAdjust} />
                  {extraction && <ConsistencyPanel discrepancies={extraction.discrepancies ?? []} />}
                  <FinancialSummary fields={coerced} />
                  {/* Benchmark panels are version-locked to the verdict: while
                      the previewed rulebook version and the cached active
                      config disagree, the comparisons are hidden (never shown
                      stale) and this line says why. */}
                  {benchmarkVersionDrift && (
                    benchmarkSync === 'refetching' ? (
                      <div className="di-updating" role="status">the rulebook changed — refreshing benchmarks…</div>
                    ) : (
                      <div className="di-warning" role="status">
                        {benchmarkSync === 'failed'
                          ? 'Could not refresh the changed rulebook — benchmark comparisons are hidden rather than shown stale (retries on the next re-score).'
                          : 'The rulebook moved again while refreshing — benchmark comparisons are hidden until the next re-score.'}
                      </div>
                    )
                  )}
                  <KpiScorecard fields={coerced} response={lastResponse} benchmarks={displayBenchmarks ?? undefined} />
                  <MarketComparison fields={coerced} market={macro?.market ?? null} benchmarks={displayBenchmarks} />
                  <MarketPathCard location={typeof coerced.location === 'string' ? coerced.location : null} />
                  {/* Monte Carlo probabilities from /api/score — keyed off the
                      deal's location (resolved server-side, national fallback
                      labeled) and the ACTIVE rulebook's par IRR, same source
                      as the Backtest par. Degrades to a note on API failure. */}
                  <McProbabilityCard
                    location={typeof coerced.location === 'string' ? coerced.location : null}
                    parIrr={activeParIrr}
                    dealName={typeof coerced.deal_name === 'string' && coerced.deal_name.trim() ? coerced.deal_name.trim() : undefined}
                  />
                  <div ref={judgmentRef}>
                    <JudgmentPanel
                      adjustments={adjustments}
                      onChange={setAdjustments}
                      availableKeys={availableKeys}
                      prefill={prefill}
                    />
                  </div>
                  <div className="di-decide">
                    <button className="secondary" onClick={() => setStep('review')}>BACK TO REVIEW</button>
                    {/* A draft rulebook previews live but can never be recorded —
                        the server would silently re-score under the ACTIVE config,
                        putting a different verdict in the ledger than the one shown. */}
                    <button
                      onClick={recordDecision}
                      disabled={deciding || !!draftConfig || !hasDealName || previewStale || scoring}
                      title={draftConfig
                        ? 'Draft thresholds are active — save the rulebook as a new version (or clear the draft) before recording'
                        : !hasDealName
                          ? 'Enter a deal name on the review step — an unnamed decision cannot be linked to a deal'
                          : previewStale || scoring
                            ? 'Preview updating…'
                            : undefined}
                    >
                      {deciding
                        ? 'RECORDING…'
                        : draftConfig
                          ? 'SAVE OR CLEAR DRAFT TO RECORD'
                          : hasDealName
                            ? 'RECORD DECISION'
                            : 'NAME THE DEAL TO RECORD'}
                    </button>
                    {decision && (
                      <span className={decision.persisted ? 'di-recorded' : 'di-warning'} role="status">
                        {decision.persisted
                          ? `Recorded — decision ${decision.decisionId ?? ''}`
                          : decision.warning ?? 'Decision not recorded'}
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* THRESHOLDS — Patel's control panel: every knob editable, nothing hardcoded */}
      {step === 'thresholds' && (
        <ThresholdConfig
          active={activeConfig}
          draft={draftConfig}
          onDraftChange={handleDraftChange}
          onSave={handleSaveConfig}
          isAdmin={isAdmin}
        />
      )}

      {/* MACRO — the weekly snapshot that moves the bar */}
      {step === 'macro' && (
        <MacroDashboard
          snapshot={macro}
          loading={macroLoading}
          error={macroErr}
          onOverride={handleOverride}
          onRefresh={fetchMacro}
          isAdmin={isAdmin}
        />
      )}

      {/* BACKTEST — run past deals through the current rulebook */}
      {step === 'backtest' && <Backtest parIrr={activeParIrr} />}

      {/* EVIDENCE — the predictability evidence map behind the engine's design */}
      {step === 'evidence' && <EvidencePanel />}

      {/* DEALS — the append-only history of recorded decisions */}
      {step === 'deals' && <DealHistory isAdmin={isAdmin} />}

      {/* USERS — admin-only account management. Gated on isAdmin === true (same
          condition as its nav chip) so the panel — and the roster + emails it
          caches — unmounts the instant admin access is lost (a sign-out, or a
          reload after demotion), not merely when navigated away from. The
          isAdmin effect above then moves the stranded step off 'users'. The
          panel still shows an honest 401/403 if the server rejects a mutation. */}
      {step === 'users' && isAdmin === true && <UsersPanel />}
    </div>
  )
}

const CSS = `
.di-root{max-width:1180px;margin:0 auto}
.di-muted{color:#5c6b67;font-size:.85rem}
.di-nav{display:flex;align-items:center;gap:.35rem;margin:0 0 2rem;flex-wrap:nowrap;overflow-x:auto}
.di-nav-step{display:flex;align-items:center;gap:.35rem;flex:0 0 auto}
.di-nav-arrow,.di-nav-sep{color:#9c9c9c;font-size:12px}
.di-nav-sep{margin:0 .5rem}
button.di-nav-item{background:transparent;color:#5c6b67;border:none;box-shadow:none;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:.45rem .5rem;border-bottom:2px solid transparent;border-radius:0}
button.di-nav-item:hover{color:#090e11;background:transparent}
button.di-nav-item.di-active{color:#090e11;border-bottom-color:#63cda9}
button.di-nav-item:disabled{opacity:.45}
.di-hero{padding:2.5rem;text-align:left}
.di-hero h1{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:2.2rem;margin:.5rem 0 .4rem;letter-spacing:-.01em}
.di-lede{color:#5c6b67;font-size:.92rem;max-width:560px;line-height:1.6;margin:0 0 2rem}
.di-drops{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
.di-drop{border:2px dashed #dcebe7;border-radius:14px;padding:2.25rem 1.5rem;text-align:center;color:#5c6b67;background:rgba(99,205,169,.04);opacity:.75;cursor:not-allowed}
.di-drop-title{font-weight:600;font-size:.92rem;color:#090e11}
.di-drop-note{font-size:.76rem;margin-top:.45rem;letter-spacing:.04em}
.di-actions{display:flex;gap:1rem;flex-wrap:wrap}
.di-actions button{letter-spacing:.08em;font-size:12.5px}
.di-stickybar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:1rem;background:rgba(255,255,255,.95);backdrop-filter:blur(4px);border:1px solid #dcebe7;border-radius:14px;padding:.8rem 1.25rem;margin-top:1.5rem;box-shadow:0 -4px 18px rgba(9,14,17,.06)}
.di-stickybar button{letter-spacing:.08em;font-size:12.5px}
.di-results{display:flex;flex-direction:column;gap:2rem}
.di-err{background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:1rem 1.25rem;font-size:.85rem}
.di-updating{color:#3f7d69;font-size:.78rem;letter-spacing:.06em}
.di-decide{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.di-decide button{letter-spacing:.08em;font-size:12.5px}
.di-recorded{font-size:.8rem;color:#3f7d69}
.di-warning{font-size:.8rem;color:#b8860b}
.di-recorded-note{background:#e4f5ee;border:1px solid #bcded3;color:#2c574a;border-radius:10px;padding:.8rem 1.1rem;font-size:.8rem;line-height:1.5;margin-bottom:1.25rem}
.di-draft-note{background:#fbf3df;border:1px solid #f0e0b0;color:#5b4a16;border-radius:10px;padding:.8rem 1.1rem;font-size:.8rem;line-height:1.5}
.di-placeholder{padding:2.5rem;text-align:center}
.di-placeholder h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .5rem}
@media(max-width:900px){.di-drops{grid-template-columns:1fr}}
@media(max-width:700px){.di-nav{overflow-x:auto;padding-bottom:.4rem}}
`
