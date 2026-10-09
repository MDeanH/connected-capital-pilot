// Intake = document ingest. The dropzones are the product's front door: the OM
// and pro forma go in, the AI pulls every field out, the analyst verifies.
// There is deliberately no blank-form path — the recorded sample (a captured
// extraction of the client's example documents) exists so the flow can be
// demoed before ANTHROPIC_API_KEY is configured.
import { useEffect, useRef, useState } from 'react'
import { authFetch, PENDING_EXTRACTION_KEY, supabase, useIdentity } from './auth'
import { Kicker } from './cc-ui'
import { docToText } from './docx'
import { workbookToCsvText } from './excel'
import { SAMPLE_EXTRACTION } from './sample-extraction'
import type { ExtractionResult } from '../netlify/functions/lib/gate1/fields'

const MAX_PDF_BYTES = 3_300_000 // base64 inflates ~4/3; keep the body under the 4.5MB guard
// The background worker legitimately runs up to 15 minutes on a full document
// pass — the client must poll at least that long, or a live job gets reported
// dead and a resubmit burns a second model call on the same documents.
const POLL_DEADLINE_MS = 15.5 * 60_000

// The pending extraction id also lives in localStorage, not just component
// state: a tab navigation or refresh mid-job would otherwise strand a
// still-running 15-minute extraction into a paid resubmit. The id itself
// contains no deal data — but polling it returns the extracted fields, so the
// record is OWNER-STAMPED like the intake payload (the key is origin-wide
// localStorage on a possibly shared browser): a record stamped by a different
// account — or an owned record read while signed out — is discarded on load,
// and signOut clears the key outright. Legacy/unstamped records read as
// anonymous (owner null), so auth-off deployments restore exactly as before.
// A stored record stays resumable for the SERVER's result-retention window, not
// just the worker's 15-minute runtime: a job that finishes near its limit (or
// after brief queueing) writes a PAID terminal result that Blobs keeps for
// RETENTION_DAYS (extractions.ts), so a reload any time inside that window must
// still be able to CHECK AGAIN and fetch it — a ~16-minute cutoff would instead
// discard the id and force an expensive resubmit of the same documents. Past
// the window the server has deleted the record (a later GET just reports
// 'running' forever), so there is nothing left to resume. Keep aligned with
// RETENTION_MS in extractions.ts — it can't be imported here without pulling
// server-only Blobs deps into the client bundle (the reaper imports it directly).
const PENDING_RESTORE_WINDOW_MS = 7 * 24 * 60 * 60_000 // == RETENTION_MS (extractions.ts)

function readStoredPendingId(owner: string | null): string | null {
  try {
    const raw = localStorage.getItem(PENDING_EXTRACTION_KEY)
    if (raw) {
      const rec = JSON.parse(raw) as { id?: unknown; submittedAt?: unknown; owner?: unknown }
      const recOwner: string | null = typeof rec?.owner === 'string' ? rec.owner : null
      const age = Date.now() - Date.parse(String(rec?.submittedAt ?? ''))
      if (
        recOwner === owner &&
        typeof rec?.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(rec.id) &&
        Number.isFinite(age) && age >= 0 && age < PENDING_RESTORE_WINDOW_MS
      ) {
        return rec.id
      }
      localStorage.removeItem(PENDING_EXTRACTION_KEY) // stale, malformed, or another identity's — discard
    }
  } catch { /* localStorage unavailable (private mode etc.) — resume degrades to in-memory */ }
  return null
}

function writeStoredPending(id: string | null, owner: string | null) {
  try {
    if (id) localStorage.setItem(PENDING_EXTRACTION_KEY, JSON.stringify({ id, owner, submittedAt: new Date().toISOString() }))
    else localStorage.removeItem(PENDING_EXTRACTION_KEY)
  } catch { /* storage unavailable — component state still covers this tab */ }
}

// Anonymous → signed-in re-stamp (mirrors the intake payload): same id and
// same submittedAt — re-dating would wrongly extend the restore window — only
// the owner changes, so the same human's job survives a reload signed in.
function restampStoredPending(owner: string | null) {
  try {
    const raw = localStorage.getItem(PENDING_EXTRACTION_KEY)
    if (!raw) return
    const rec = JSON.parse(raw) as { id?: unknown; submittedAt?: unknown }
    localStorage.setItem(PENDING_EXTRACTION_KEY, JSON.stringify({ id: rec?.id, owner, submittedAt: rec?.submittedAt }))
  } catch { /* storage unavailable — component state still covers this tab */ }
}

interface Props {
  onExtracted: (result: ExtractionResult) => void
}

type PickedOm =
  | { kind: 'pdf'; name: string; base64: string; bytes: number }
  | { kind: 'text'; name: string; text: string }
interface PickedSheets { name: string; sheets: Array<{ name: string; csv: string }> }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Could not read the file'))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

export default function IntakeUpload({ onExtracted }: Props) {
  const [om, setOm] = useState<PickedOm | null>(null)
  const [proforma, setProforma] = useState<PickedSheets | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Extraction id of the accepted background job. Set the moment the server
  // accepts the submission and cleared ONLY on a terminal result (done/error
  // from the API) — so neither the poll deadline nor a thrown poll failure can
  // strand a live job. CHECK AGAIN resumes polling this id instead of paying
  // for a resubmit. Restored from localStorage (owner-checked) so a refresh or
  // tab navigation mid-job restores the affordance instead of stranding the
  // job. Auth-off builds (no Supabase client) resolve identity synchronously —
  // always anonymous — so the record restores right here in the initializer,
  // exactly as it always has; auth-capable builds start empty (the owner isn't
  // known until the async session restore settles) and hydrate in the
  // identity-gated effect below.
  const [pendingId, setPendingId] = useState<string | null>(() => (supabase === null ? readStoredPendingId(null) : null))
  // True while pendingId came from storage (a previous page load) rather than
  // this session's own submission — drives honest resume copy: the job MAY
  // still be running, or may have finished/failed while we weren't watching.
  const [pendingRestored, setPendingRestored] = useState<boolean>(() => pendingId !== null)
  // Terminal outcomes clear both state and storage — the one place that
  // decides "nothing left to resume".
  const clearPending = () => {
    setPendingId(null)
    setPendingRestored(false)
    writeStoredPending(null, null)
  }
  const omInput = useRef<HTMLInputElement>(null)
  const xlsInput = useRef<HTMLInputElement>(null)

  // --- Owner-gated hydration of the pending record (mirrors DealIntake) ----
  // hydratedRef: true once the owner-checked restore has run (immediately on
  // auth-off builds, where the initializer restored synchronously). ownerRef:
  // the identity the CURRENT in-memory pending job belongs to — writes stamp
  // this (never the live identity) so a job can't be re-labelled inside a
  // sign-in/out transition tick.
  const identity = useIdentity()
  const hydratedRef = useRef(supabase === null)
  const ownerRef = useRef<string | null>(null)

  useEffect(() => {
    if (!identity.sessionReady) return // owner unknown — do not touch storage yet
    const owner = identity.userId
    if (!hydratedRef.current) {
      // First hydration on an auth-capable build, now that the session
      // restore settled and the owner is definitive.
      hydratedRef.current = true
      ownerRef.current = owner
      const stored = readStoredPendingId(owner)
      if (stored) {
        setPendingId(stored)
        setPendingRestored(true)
      }
      return
    }
    if (owner === ownerRef.current) return
    const prev = ownerRef.current
    ownerRef.current = owner
    if (prev === null) {
      // Anonymous work, then sign-in: the same human at the keyboard — keep
      // the resumable job and re-stamp the stored record as theirs so it
      // survives a reload under the signed-in identity.
      if (pendingId) restampStoredPending(owner)
      return
    }
    // Signed out (or the account changed): the pending job belongs to the
    // previous account — drop the affordance. signOut already cleared the
    // stored record; the owner check above discards any straggler on load.
    setPendingId(null)
    setPendingRestored(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingId is read only behind the owner guard; re-running on it would be a no-op
  }, [identity.sessionReady, identity.userId])

  // PDFs go up as base64 (the API reads them natively, citations get page
  // numbers); .docx/.txt convert to plain text in the browser, so their
  // citations degrade to quote-only — same as pro forma CSVs.
  const takeOm = async (file: File) => {
    setErr(null)
    const isPdf = /\.pdf$/i.test(file.name)
    if (!isPdf && !/\.(docx|txt)$/i.test(file.name)) {
      setErr('The offering memorandum must be a PDF, Word (.docx) or text (.txt) file.')
      return
    }
    if (isPdf && file.size > MAX_PDF_BYTES) {
      setErr(`"${file.name}" is ${(file.size / 1e6).toFixed(1)}MB — compress the OM below ~3MB — larger files exceed the submission limit.`)
      return
    }
    setBusy(isPdf ? 'Reading offering memorandum…' : 'Converting offering memorandum to text in your browser…')
    try {
      setOm(isPdf
        ? { kind: 'pdf', name: file.name, base64: await fileToBase64(file), bytes: file.size }
        : { kind: 'text', name: file.name, text: await docToText(file) })
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const takeXlsx = async (file: File) => {
    setErr(null)
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) { setErr('The pro forma must be an Excel or CSV file (.xlsx, .xlsm, .xls, .csv).'); return }
    setBusy('Parsing pro forma in your browser…')
    try {
      const { sheets } = await workbookToCsvText(await file.arrayBuffer())
      if (!sheets.length) throw new Error('No data found in the workbook')
      setProforma({ name: file.name, sheets })
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  // Polls /api/extractions/:id until done, error, or the deadline. The cadence
  // backs off as time passes — a ten-minute extraction has no use for a 3s
  // loop. Only a terminal API status (done/error) settles the job: a transient
  // poll failure (network blip, non-ok status, malformed body) is caught INSIDE
  // the loop and retried until the deadline — the worker is unaffected by our
  // failure to ask about it. Hitting the deadline is NOT a failure either: the
  // id stays resumable.
  const pollExtraction = async (extractionId: string) => {
    // The job is bound to the identity it was submitted/restored under. If a
    // signed-in owner changes mid-poll (sign-out, different account), the
    // extracted fields must not be delivered into the new identity's UI —
    // anonymous → signed-in is the same human (see the hydration effect) and
    // stays deliverable.
    const jobOwner = ownerRef.current
    const started = Date.now()
    while (Date.now() - started < POLL_DEADLINE_MS) {
      const elapsed = Date.now() - started
      const secs = Math.round(elapsed / 1000)
      const clock = secs < 90 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
      setBusy(`Deep-reading the documents — extracting ~30 cited fields (${clock})…`)
      const wait = elapsed < 60_000 ? 3000 : elapsed < 5 * 60_000 ? 6000 : 12_000
      await new Promise(res => setTimeout(res, wait))
      let data: any = null
      let expired = false
      try {
        const p = await authFetch(`/api/extractions/${extractionId}`)
        expired = p.status === 410
        if (!p.ok && !expired) continue // transient server-side hiccup — keep polling
        data = await p.json().catch(() => null)
        if (data === null && !expired) continue // body wasn't JSON — transient, keep polling
      } catch {
        continue // fetch rejected — transient, keep polling
      }
      if (expired) {
        // The server expired this record (results are retained 7 days; a stuck
        // job's stub 1 day) — terminal: there is nothing left to watch, so
        // don't keep offering CHECK AGAIN for it.
        clearPending()
        throw new Error(data?.error ?? 'Extraction result expired')
      }
      if (data.status === 'done') {
        if (jobOwner !== null && ownerRef.current !== jobOwner) {
          // Identity changed while we were polling: the transition effect
          // already dropped the pending state and signOut cleared the stored
          // record — stop silently, never hand the result to whoever is at
          // the keyboard now.
          return
        }
        clearPending()
        // Carry the extraction id into app state: the decide call needs it to
        // link the persisted extractions row (whose PK is this id) to the deal.
        onExtracted({ ...(data as ExtractionResult), extractionId })
        return
      }
      if (data.status === 'error') {
        clearPending()
        throw new Error(data.error ?? 'Extraction failed')
      }
    }
    // A mid-poll identity change severs the job here too — re-instating the
    // id would hand the previous account's resumable job to the new identity.
    if (jobOwner !== null && ownerRef.current !== jobOwner) return
    // Deadline lapse is non-terminal: keep the id resumable in state. Storage
    // already holds it from the 202 acceptance (with the true submittedAt), so
    // no re-write here — re-stamping would wrongly extend the restore window.
    setPendingId(extractionId)
    throw new Error('No result yet after 15 minutes — the extraction may still be running in the background. CHECK AGAIN below keeps watching the same job; resubmitting would start a new extraction from scratch.')
  }

  // Deployed extraction runs as a BACKGROUND function (a full document pass
  // exceeds the sync window): we generate the id, get a bodyless 202, and poll
  // /api/extractions/:id. The local dev bridge answers synchronously with the
  // result inline — both shapes are handled.
  const extract = async () => {
    if (!om && !proforma) return
    setBusy('Sending documents…')
    setErr(null)
    clearPending() // a fresh submission supersedes any resumable job (state AND storage)
    try {
      const extractionId = crypto.randomUUID()
      const r = await authFetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractionId,
          dealName: om?.name ?? proforma?.name,
          pdfBase64: om?.kind === 'pdf' ? om.base64 : undefined,
          pdfFilename: om?.kind === 'pdf' ? om.name : undefined,
          omText: om?.kind === 'text' ? om.text : undefined,
          omFilename: om?.kind === 'text' ? om.name : undefined,
          sheets: proforma?.sheets,
        }),
      })

      const ct = r.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const data = await r.json()
        if (data.error) throw new Error(data.error)
        if (data.fields) {
          // Synchronous dev-bridge answer: attach the same client-minted id the
          // background path carries, so the decide call can link either way.
          onExtracted({ ...(data as ExtractionResult), extractionId })
          return
        }
      } else if (!r.ok && r.status !== 202) {
        throw new Error(`Extraction endpoint unavailable (HTTP ${r.status})`)
      }

      // 202 (background) — the submission is accepted and the worker is
      // running, so the id becomes resumable NOW, before the first poll:
      // whatever non-terminal way the polling below exits (deadline, or an
      // unexpected throw), CHECK AGAIN can pick this job back up — including
      // from a fresh page load, via the localStorage record written here. Only
      // a terminal done/error from the API clears it.
      setPendingId(extractionId)
      setPendingRestored(false)
      // Stamped with the owning identity (ownerRef — see hydration above):
      // null until the session restore settles or on auth-off builds, where
      // the record reads back exactly as before auth existed.
      writeStoredPending(extractionId, ownerRef.current)
      await pollExtraction(extractionId)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  // RESUME path: restart polling for the deadline-lapsed job — same id, no
  // second model call.
  const checkAgain = async (id: string) => {
    setErr(null)
    setBusy('Checking the extraction…')
    try {
      await pollExtraction(id)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const zone = (
    kind: 'om' | 'xlsx',
    picked: { name: string; detail?: string } | null,
    title: string,
    note: string,
    input: React.RefObject<HTMLInputElement>,
    take: (f: File) => void,
  ) => (
    <div
      className={`iu-drop${picked ? ' iu-picked' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={e => e.key === 'Enter' && input.current?.click()}
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('iu-over') }}
      onDragLeave={e => e.currentTarget.classList.remove('iu-over')}
      onDrop={e => {
        e.preventDefault()
        e.currentTarget.classList.remove('iu-over')
        const f = e.dataTransfer.files?.[0]
        if (f) take(f)
      }}
    >
      <div className="iu-drop-title">{title}</div>
      {picked
        ? <div className="iu-file" title={picked.detail ? `${picked.name} — ${picked.detail}` : picked.name}>✓ {picked.name}{picked.detail ? ` — ${picked.detail}` : ''}</div>
        : <div className="iu-drop-note">{note}</div>}
      <input
        ref={input}
        type="file"
        accept={kind === 'om' ? '.pdf,.docx,.txt' : '.xlsx,.xlsm,.xls,.csv'}
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) take(f); e.target.value = '' }}
      />
    </div>
  )

  return (
    <div className="card iu-hero">
      <style>{CSS}</style>
      <Kicker>CONNECTED CAPITAL — DEAL INTAKE</Kicker>
      <h1>Drop in the deal documents</h1>
      <p className="iu-lede">
        Upload the sponsor's offering memorandum and pro forma. Every screening field is
        extracted with a confidence score and a citation back to the document — you verify,
        the rulebook decides.
      </p>
      <div className="iu-drops">
        {zone(
          'om',
          om && { name: om.name, detail: om.kind === 'text' ? 'converted to text' : undefined },
          'Offering memorandum — PDF, Word or text',
          'Drop the OM here (.pdf, .docx, .txt), or click to browse',
          omInput,
          takeOm,
        )}
        {zone('xlsx', proforma, 'Pro forma — Excel or CSV', 'Drop the pro forma here, or click to browse (parsed in your browser)', xlsInput, takeXlsx)}
      </div>
      <div className="iu-actions">
        <button onClick={extract} disabled={(!om && !proforma) || !!busy}>
          {busy ? 'WORKING…' : 'EXTRACT WITH AI'}
        </button>
        {busy && <span className="iu-busy" role="status">{busy}</span>}
      </div>
      {err && (
        <div className="iu-err" role="alert">
          {err}
          {/not configured|ANTHROPIC/i.test(err) && (
            <> — or load the recorded sample below.</>
          )}
        </div>
      )}
      {pendingId && !busy && (
        <div className="iu-resume">
          <button className="secondary" onClick={() => checkAgain(pendingId)}>CHECK AGAIN</button>
          <span className="iu-resume-note">
            {pendingRestored
              ? 'an extraction submitted earlier from this browser may still be running — or may have already finished. CHECK AGAIN picks it back up instead of starting (and paying for) a new one'
              : 'keeps watching the submitted extraction — does not start a new one'}
          </span>
        </div>
      )}
      <div className="iu-sample">
        <button className="iu-sample-btn" onClick={() => onExtracted(SAMPLE_EXTRACTION)}>
          <span className="iu-sample-big">New here? Load the sample deal →</span>
          <span className="iu-sample-sub">
            One click walks you through the whole flow — a recorded extraction of the
            Faithful Trails example documents, no upload needed
          </span>
        </button>
      </div>
    </div>
  )
}

const CSS = `
.iu-hero{padding:2.5rem}
.iu-hero h1{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:2.2rem;margin:.5rem 0 .4rem;letter-spacing:-.01em}
.iu-lede{color:var(--muted,#5c6b67);font-size:.92rem;max-width:600px;line-height:1.6;margin:0 0 2rem}
.iu-drops{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
.iu-drop{border:2px dashed #bcded3;border-radius:14px;padding:2.5rem 1.5rem;text-align:center;color:var(--muted,#5c6b67);background:rgba(99,205,169,.05);cursor:pointer;transition:border-color .15s,background .15s}
.iu-drop:hover,.iu-drop.iu-over{border-color:#63cda9;background:rgba(99,205,169,.12)}
.iu-drop.iu-picked{border-style:solid;border-color:#3f7d69;background:rgba(63,125,105,.07)}
.iu-drop-title{font-weight:600;font-size:.92rem;color:var(--text,#090e11)}
.iu-drop-note{font-size:.78rem;margin-top:.5rem;letter-spacing:.02em}
.iu-file{font-size:.82rem;margin-top:.5rem;color:#3f7d69;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iu-actions{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.iu-actions button{letter-spacing:.08em;font-size:12.5px}
.iu-busy{font-size:.82rem;color:#3f7d69}
.iu-err{margin-top:1.25rem;background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:.9rem 1.1rem;font-size:.85rem;line-height:1.5}
.iu-resume{margin-top:1rem;display:flex;align-items:center;gap:.9rem;flex-wrap:wrap}
.iu-resume button{letter-spacing:.08em;font-size:12px}
.iu-resume-note{font-size:.78rem;color:var(--muted,#5c6b67)}
.iu-sample{margin-top:1.75rem;border-top:1px solid var(--border,#dcebe7);padding-top:1.25rem}
button.iu-sample-btn{display:block;width:100%;background:#63cda9;border:2px solid #63cda9;border-radius:12px;padding:1.1rem 1.5rem;text-align:center;box-shadow:0 6px 18px rgba(99,205,169,.35);transition:transform .15s ease,box-shadow .15s ease,background .15s,border-color .15s,color .15s}
button.iu-sample-btn:hover{background:#090e11;border-color:#090e11;transform:translateY(-1px);box-shadow:0 9px 24px rgba(9,14,17,.25)}
button.iu-sample-btn:hover .iu-sample-big,button.iu-sample-btn:hover .iu-sample-sub{color:#fff}
.iu-sample-big{display:block;font-size:1.08rem;font-weight:700;letter-spacing:.06em;color:#090e11}
.iu-sample-sub{display:block;margin-top:.4rem;font-size:.8rem;font-weight:500;text-transform:none;letter-spacing:0;line-height:1.5;color:#123a2d}
@media(max-width:900px){.iu-drops{grid-template-columns:1fr}}
`
