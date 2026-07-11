// Intake = document ingest. The dropzones are the product's front door: the OM
// and pro forma go in, the AI pulls every field out, the analyst verifies.
// There is deliberately no blank-form path — the recorded sample (a captured
// extraction of the client's example documents) exists so the flow can be
// demoed before ANTHROPIC_API_KEY is configured.
import { useRef, useState } from 'react'
import { Kicker } from './cc-ui'
import { workbookToCsvText } from './excel'
import { SAMPLE_EXTRACTION } from './sample-extraction'
import type { ExtractionResult } from '../netlify/functions/lib/gate1/fields'

const MAX_PDF_BYTES = 3_300_000 // base64 inflates ~4/3; keep the body under the 4.5MB guard

interface Props {
  onExtracted: (result: ExtractionResult) => void
}

interface PickedPdf { name: string; base64: string; bytes: number }
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
  const [pdf, setPdf] = useState<PickedPdf | null>(null)
  const [proforma, setProforma] = useState<PickedSheets | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const xlsInput = useRef<HTMLInputElement>(null)

  const takePdf = async (file: File) => {
    setErr(null)
    if (!/\.pdf$/i.test(file.name)) { setErr('The offering memorandum must be a PDF.'); return }
    if (file.size > MAX_PDF_BYTES) {
      setErr(`"${file.name}" is ${(file.size / 1e6).toFixed(1)}MB — compress the OM below ~3MB for sync extraction.`)
      return
    }
    setBusy('Reading offering memorandum…')
    try {
      setPdf({ name: file.name, base64: await fileToBase64(file), bytes: file.size })
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const takeXlsx = async (file: File) => {
    setErr(null)
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) { setErr('The pro forma must be a spreadsheet (.xlsx).'); return }
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

  // Deployed extraction runs as a BACKGROUND function (a full document pass
  // exceeds the sync window): we generate the id, get a bodyless 202, and poll
  // /api/extractions/:id. The local dev bridge answers synchronously with the
  // result inline — both shapes are handled.
  const extract = async () => {
    if (!pdf && !proforma) return
    setBusy('Sending documents…')
    setErr(null)
    try {
      const extractionId = crypto.randomUUID()
      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractionId,
          dealName: pdf?.name ?? proforma?.name,
          pdfBase64: pdf?.base64,
          pdfFilename: pdf?.name,
          sheets: proforma?.sheets,
        }),
      })

      const ct = r.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const data = await r.json()
        if (data.error) throw new Error(data.error)
        if (data.fields) {
          onExtracted(data as ExtractionResult)
          return
        }
      } else if (!r.ok && r.status !== 202) {
        throw new Error(`Extraction endpoint unavailable (HTTP ${r.status})`)
      }

      // 202 (background) — poll for the result.
      const started = Date.now()
      const GIVE_UP_MS = 5 * 60_000
      while (Date.now() - started < GIVE_UP_MS) {
        const secs = Math.round((Date.now() - started) / 1000)
        setBusy(`Deep-reading the documents — extracting ~30 cited fields (${secs}s)…`)
        await new Promise(res => setTimeout(res, 3000))
        const p = await fetch(`/api/extractions/${extractionId}`)
        if (!p.ok) continue
        const data = await p.json()
        if (data.status === 'done') {
          onExtracted(data as ExtractionResult)
          return
        }
        if (data.status === 'error') throw new Error(data.error ?? 'Extraction failed')
      }
      throw new Error('Extraction timed out after 5 minutes — try again or load the recorded sample')
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const zone = (
    kind: 'pdf' | 'xlsx',
    picked: { name: string } | null,
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
        ? <div className="iu-file" title={picked.name}>✓ {picked.name}</div>
        : <div className="iu-drop-note">{note}</div>}
      <input
        ref={input}
        type="file"
        accept={kind === 'pdf' ? '.pdf' : '.xlsx,.xlsm,.xls,.csv'}
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
        {zone('pdf', pdf, 'Offering memorandum — PDF', 'Drop the OM here, or click to browse', pdfInput, takePdf)}
        {zone('xlsx', proforma, 'Pro forma — XLSX', 'Drop the pro forma here, or click to browse (parsed in your browser)', xlsInput, takeXlsx)}
      </div>
      <div className="iu-actions">
        <button onClick={extract} disabled={(!pdf && !proforma) || !!busy}>
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
      <div className="iu-sample">
        <button className="iu-sample-link" onClick={() => onExtracted(SAMPLE_EXTRACTION)}>
          Load sample — recorded extraction of the Faithful Trails example documents
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
.iu-sample{margin-top:1.75rem;border-top:1px solid var(--border,#dcebe7);padding-top:1rem}
button.iu-sample-link{background:transparent;border:none;color:var(--muted,#5c6b67);text-transform:none;letter-spacing:0;font-size:.8rem;text-decoration:underline;padding:.2rem 0}
button.iu-sample-link:hover{background:transparent;color:var(--text,#090e11)}
@media(max-width:900px){.iu-drops{grid-template-columns:1fr}}
`
