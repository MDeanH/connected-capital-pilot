import { useRef, useState } from 'react'
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, Target, BarChart3, Settings, MessageSquare, ArrowRight, Gamepad2 } from 'lucide-react'
import { parseWorkbook, downloadTemplate } from './excel'
import type { ParseResult } from './excel'
import DataStatus from './DataStatus'

interface HomeProps {
  pastDealsCount: number
  oppsCount: number
  uploadedFileName: string | null
  onDataLoaded: (result: ParseResult, fileName: string) => void
  goTo: (tab: string) => void
}

interface UploadStatus {
  fileName: string
  pastDeals: number
  opportunities: number
  warnings: string[]
  error?: string
}

const HOW_TO_STEPS = [
  {
    tab: 'home', icon: FileSpreadsheet, title: '1. Upload your data',
    body: 'Start here: load your past deals (realized IRRs) and current pipeline from an Excel file. Your own track record is what de-biases the model — until you upload, the app runs on sample data.',
  },
  {
    tab: 'score', icon: Target, title: '2. Score a deal',
    body: 'Deal Score runs the engine-backed Monte Carlo on a single deal: probability of hitting your target IRR, median outcome, VaR/CVaR and suggested sizing.',
  },
  {
    tab: 'usmarket', icon: BarChart3, title: '3. Check the US market',
    body: 'US Market shows national real-estate base rates across 895 metros and cross-asset correlations, so you can sanity-check a deal against the market backdrop.',
  },
  {
    tab: 'dashboard', icon: BarChart3, title: '4. Compare your pipeline',
    body: 'Client Dashboard ranks every uploaded opportunity by probability of hitting target. Click a row for full risk detail and the simulated return distribution.',
  },
  {
    tab: 'ddq', icon: Upload, title: '5. Add deals via DDQ',
    body: 'DDQ Intake adds a new opportunity through a short questionnaire (sponsor exits, LTV, execution risk) and scores it immediately.',
  },
  {
    tab: 'model', icon: Settings, title: '6. Tune the model',
    body: 'Analyst Model Studio exposes the feature weights (sponsor, market, structure, macro, qual). Move a slider and every score recomputes live.',
  },
  {
    tab: 'market3d', icon: Gamepad2, title: 'Bonus: Market Quest 3D',
    body: 'Fly a scout drone through a 3D city built from real market data — scan metro towers, assemble a portfolio, and run a correlated Monte Carlo on it. Or flip to Analysis Orbit for a serious 3D data view.',
  },
  {
    tab: 'copilot', icon: MessageSquare, title: 'Anytime: ask the Copilot',
    body: 'The Diligence Copilot lives in the bar at the top of every page. It sees your live scores and model settings — ask it why a deal scores low or what would change the answer.',
  },
]

export default function Home({ pastDealsCount, oppsCount, uploadedFileName, onDataLoaded, goTo }: HomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<UploadStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const result = parseWorkbook(buf)
      setStatus({
        fileName: file.name,
        pastDeals: result.pastDeals.length,
        opportunities: result.opportunities.length,
        warnings: result.warnings,
      })
      if (result.pastDeals.length > 0 || result.opportunities.length > 0) {
        onDataLoaded(result, file.name)
      }
    } catch (err: any) {
      setStatus({ fileName: file.name, pastDeals: 0, opportunities: 0, warnings: [], error: `Could not read the file: ${err.message}` })
    }
  }

  const loadedSomething = status && (status.pastDeals > 0 || status.opportunities > 0)

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="card home-hero">
        <h2 style={{ marginTop: 0 }}>Welcome to the AI Diligence Platform</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
          Upload your deal history, then get a de-biased, Monte-Carlo-backed probability that each
          opportunity hits your target return — with transparent drivers and risk sizing.
        </p>
      </div>

      {/* STEP 1 — UPLOAD */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}><FileSpreadsheet size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Step 1 — Upload your data (Excel)</h3>
        <div
          className={`dropzone ${dragOver ? 'dragover' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
        >
          <Upload size={28} style={{ color: 'var(--accent)' }} />
          <div style={{ fontWeight: 600 }}>Drop your spreadsheet here, or click to browse</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>.xlsx, .xls or .csv — past deals and/or current opportunities</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button className="secondary" onClick={downloadTemplate}>
            <Download size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Download Excel template
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Two sheets: <strong>Past Deals</strong> (with realized IRRs — used to de-smooth the model) and <strong>Opportunities</strong> (your current pipeline). Column names are matched flexibly; IRR and LTV can be entered as 0.19 or 19%.
          </span>
        </div>

        {status && (
          <div className={`upload-status ${status.error || !loadedSomething ? 'bad' : 'good'}`}>
            {status.error ? (
              <div><AlertTriangle size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{status.error}</div>
            ) : (
              <div>
                {loadedSomething
                  ? <><CheckCircle2 size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} /><strong>{status.fileName}</strong> loaded — {status.pastDeals} past deal{status.pastDeals === 1 ? '' : 's'}, {status.opportunities} opportunit{status.opportunities === 1 ? 'y' : 'ies'}. All scores now use your data.</>
                  : <><AlertTriangle size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />No rows could be read from <strong>{status.fileName}</strong>.</>}
              </div>
            )}
            {status.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--warning)' }}>⚠ {w}</div>
            ))}
            {loadedSomething && (
              <button style={{ marginTop: 10 }} onClick={() => goTo('dashboard')}>
                Open Client Dashboard <ArrowRight size={14} style={{ verticalAlign: 'text-bottom' }} />
              </button>
            )}
          </div>
        )}

        {!status && (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
            {uploadedFileName
              ? <>Currently using <strong>{uploadedFileName}</strong> ({pastDealsCount} past deals, {oppsCount} opportunities).</>
              : <>Currently running on <strong>sample data</strong> ({pastDealsCount} past deals, {oppsCount} opportunities) — everything works, but the scores aren't yours yet.</>}
          </div>
        )}
      </div>

      {/* STEP 2 — HOW TO USE */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>
          Step 2 — How to use the site
          <a href="/how-it-works.html" style={{ marginLeft: 12, fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)' }}>
            Visual explainer: how the whole machine works →
          </a>
        </h3>
        <div className="howto-grid">
          {HOW_TO_STEPS.map(s => {
            const Icon = s.icon
            const clickable = s.tab !== 'home' && s.tab !== 'copilot'
            return (
              <div
                key={s.title}
                className={`howto-card ${clickable ? 'clickable' : ''}`}
                onClick={clickable ? () => goTo(s.tab) : undefined}
              >
                <div className="howto-title"><Icon size={16} style={{ color: 'var(--accent)' }} />{s.title}</div>
                <div className="howto-body">{s.body}</div>
              </div>
            )
          })}
        </div>
        <p className="disclaimer" style={{ marginBottom: 0 }}>
          Your spreadsheet is parsed entirely in your browser — deal data is not uploaded to a server.
          The Copilot, when asked, sends a summary of current scores to the AI model to answer your question.
        </p>
      </div>

      {/* DATA SOURCES & COVERAGE — honest accounting of what's in and what's missing */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Data sources &amp; coverage</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
          Every number on this site traces to a public source, baked from the official files. Coverage is honest —
          where a source doesn't reach a market, the field is left blank rather than guessed.
        </p>
        <div className="howto-grid">
          <div className="howto-card">
            <div className="howto-title">📈 Markets &amp; returns</div>
            <div className="howto-body">
              <strong>20,216 markets</strong> from Zillow ZHVI (895 metros, 2,537 counties, 16,784 cities), quarterly since 2000.
              Markets need ≥10 years of clean history; ~4,600 city/county series with short or gappy records were excluded.
            </div>
          </div>
          <div className="howto-card">
            <div className="howto-title">🚓 Crime (FBI UCR/NIBRS)</div>
            <div className="howto-body">
              <strong>~10,800 markets</strong>, latest finalized year (2025). Markets with no participating police agency
              fall back to county, then statewide. A small share of agencies report no usable data each year. NIBRS
              participation varies by agency — treat as context, not a precise ranking.
            </div>
          </div>
          <div className="howto-card">
            <div className="howto-title">🏘️ Market context (8 datasets)</div>
            <div className="howto-body">
              <strong>7,372 markets.</strong> Rents &amp; yield (Zillow ZORI) and market-heat reach metros, counties and cities;
              <strong> income, hazard, migration, demand-quality, permits and flood data are county-level only</strong>, so a city
              shows its parent county's figures or none.
            </div>
          </div>
          <div className="howto-card">
            <div className="howto-title">⚠️ Known gaps</div>
            <div className="howto-body">
              <strong>Connecticut</strong> is absent from the HMDA demand-quality layer (its 2024 planning-region codes don't map
              to county keys). A few large counties (e.g. Maricopa, Dallas) aren't in the market list yet. Crime correlates
              mainly with population density, not returns — so it's shown as context, not a predictor.
            </div>
          </div>
        </div>
        <DataStatus />
        <p className="disclaimer" style={{ marginBottom: 0 }}>
          Sources: Zillow Research (ZHVI, ZORI, inventory), FBI Crime Data Explorer, U.S. Census (Building Permits),
          BEA (county income), FEMA (National Risk Index, NFIP flood claims), IRS (county migration), CFPB/FFIEC (HMDA).
          Public data is for market context; your own deal history and DDQ inputs are the edge.
        </p>
      </div>
    </div>
  )
}
