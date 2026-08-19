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

type Step = 'intake' | 'review' | 'results' | 'thresholds' | 'macro' | 'backtest' | 'evidence' | 'deals'
const STEP_IDS: Step[] = ['intake', 'review', 'results', 'thresholds', 'macro', 'backtest', 'evidence', 'deals']

const LS_KEY = 'cc_deal_intake_v1'
const LS_DRAFT_KEY = 'cc_config_draft_v1'

/** The live macro payload: snapshot plus market context + persistence honesty flags. */
type MacroPayload = MacroSnapshot & { persisted?: boolean; live?: boolean; warning?: string }

function loadDraftConfig(): Gate1Config | null {
  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Gate1Config) : null
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

function loadSaved(): { fields: IntakeFormValues; adjustments: JudgmentAdjustment[]; step: Step; extraction: ExtractionResult | null } | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      fields: p.fields && typeof p.fields === 'object' ? p.fields : {},
      adjustments: Array.isArray(p.adjustments) ? p.adjustments : [],
      step: STEP_IDS.includes(p.step) ? p.step : 'intake',
      extraction: p.extraction && typeof p.extraction === 'object' ? p.extraction : null,
    }
  } catch {
    return null
  }
}

export default function DealIntake() {
  const [saved] = useState(loadSaved)
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
  const previewSeqRef = useRef(0)
  const [scoreErr, setScoreErr] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decision, setDecision] = useState<Pick<Gate1Response, 'persisted' | 'warning' | 'decisionId'> | null>(null)
  const [prefill, setPrefill] = useState<{ key: string; value: number } | null>(null)
  const judgmentRef = useRef<HTMLDivElement>(null)

  // Weekly macro snapshot + market context (live-computed when nothing is persisted).
  const [macro, setMacro] = useState<MacroPayload | null>(null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroErr, setMacroErr] = useState<string | null>(null)
  // Active threshold config version + the analyst's local draft (previews only).
  const [activeConfig, setActiveConfig] = useState<{ version: number; config: Gate1Config } | null>(null)
  const [draftConfig, setDraftConfig] = useState<Gate1Config | null>(loadDraftConfig)

  const fetchMacro = useCallback(async () => {
    setMacroLoading(true)
    setMacroErr(null)
    try {
      const r = await fetch('/api/macro/latest')
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setMacro(data as MacroPayload)
    } catch (e) {
      setMacroErr(String((e as Error)?.message || e))
    } finally {
      setMacroLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMacro()
    fetch('/api/config/active')
      .then(r => r.json())
      .then(d => { if (d?.config) setActiveConfig({ version: d.version ?? 0, config: d.config }) })
      .catch(() => { /* config panel shows its own empty state */ })
  }, [fetchMacro])

  const handleDraftChange = (cfg: Gate1Config | null) => {
    setDraftConfig(cfg)
    try {
      cfg ? localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(cfg)) : localStorage.removeItem(LS_DRAFT_KEY)
    } catch { /* non-fatal */ }
  }

  const handleSaveConfig = async (cfg: Gate1Config, note: string) => {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, note, baseVersion: activeConfig?.version ?? 0 }),
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
    const r = await fetch('/api/macro/override', {
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

  // Persist the working state so a refresh never loses the analyst's inputs.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ fields, adjustments, step, extraction }))
    } catch { /* storage full/blocked — non-fatal */ }
  }, [fields, adjustments, step, extraction])

  const coerced = useMemo(() => coerceFields(fields), [fields])
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
  }, [coerced, adjustments, step, canScore, livePosture, draftConfig])

  const recordDecision = async () => {
    if (!canScore || !hasDealName || deciding || draftConfig || previewStale || scoring) return
    setDeciding(true)
    setDecision(null)
    try {
      // dealName lets the server link (or create) the deals row so the
      // decision lands in the browsable history instead of being orphaned.
      const dealName = typeof coerced.deal_name === 'string' && coerced.deal_name.trim() ? coerced.deal_name.trim() : undefined
      const r = await fetch('/api/gate1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: coerced, adjustments, posture: livePosture, dealName }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
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
    setPrefill(null)
    setStep('review')
  }

  // A correction must not wear the model's provenance: when the analyst's value
  // no longer matches the originally extracted one, flag that field's metadata
  // `edited` (IntakeReview then swaps the confidence chip for "analyst-edited"
  // and drops the citation); restoring the original value clears the flag.
  const handleFieldChange = (key: keyof DealFields, rawValue: string) => {
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
  }

  return (
    <div className="cc-theme di-root">
      <style>{CSS}</style>

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
        {(['thresholds', 'macro', 'backtest', 'evidence', 'deals'] as Step[]).map((s, i) => (
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
              <MacroStrip snapshot={macro} />
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
                  <KpiScorecard fields={coerced} response={lastResponse} benchmarks={benchmarks ?? undefined} />
                  <MarketComparison fields={coerced} market={macro?.market ?? null} benchmarks={benchmarks} />
                  <MarketPathCard location={typeof coerced.location === 'string' ? coerced.location : null} />
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
        />
      )}

      {/* BACKTEST — run past deals through the current rulebook */}
      {step === 'backtest' && <Backtest parIrr={benchmarks?.irr ?? 0.12} />}

      {/* EVIDENCE — the predictability evidence map behind the engine's design */}
      {step === 'evidence' && <EvidencePanel />}

      {/* DEALS — the append-only history of recorded decisions */}
      {step === 'deals' && <DealHistory />}
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
