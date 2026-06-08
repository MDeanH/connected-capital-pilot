import { useState, useMemo } from 'react'
import Plot from 'react-plotly.js'
import { Settings, BarChart3, MessageSquare, Upload, Target } from 'lucide-react'

// Types (ported from Python model)
interface Opportunity {
  id: string
  name: string
  sub_type: 'Development' | 'Value-Add'
  sponsor_exits: number
  ltv: number
  execution_risk: 'Low' | 'Medium' | 'High'
  rate_environment: 'low' | 'elevated'
  projected_gross_irr?: number
  notes?: string
}

interface PastDeal {
  id: string
  sub_type: string
  sponsor_exits: number
  ltv: number
  execution_risk: string
  realized_irr: number
  outcome_label: string
}

interface ModelConfig {
  target_return_default: number
  feature_weights: {
    sponsor: number
    market: number
    structure: number
    macro: number
    qual: number
  }
  version: string
}

interface ScoreResult {
  p_hit_target: number
  expected_return: number
  p_loss: number
  confidence: number
  top_drivers: string[]
  recommended_size_pct: number
  risk_note: string
  model_version: string
}

// Sample data (ported from src/data/sample.py)
const SAMPLE_PAST_DEALS: PastDeal[] = [
  { id: "past_001", sub_type: "Value-Add", sponsor_exits: 5, ltv: 0.62, execution_risk: "Medium", realized_irr: 0.19, outcome_label: "hit_target" },
  { id: "past_002", sub_type: "Development", sponsor_exits: 1, ltv: 0.78, execution_risk: "High", realized_irr: 0.08, outcome_label: "missed" },
  { id: "past_003", sub_type: "Value-Add", sponsor_exits: 7, ltv: 0.55, execution_risk: "Low", realized_irr: 0.27, outcome_label: "hit_target" },
]

const INITIAL_OPPORTUNITIES: Opportunity[] = [
  { id: "opp_dev_downtown", name: "Downtown Core Dev", sub_type: "Development", sponsor_exits: 3, ltv: 0.72, execution_risk: "High", rate_environment: "elevated", projected_gross_irr: 0.24, notes: "Strong location but heavy lift on entitlements" },
  { id: "opp_va_suburban", name: "Suburban Value-Add Portfolio", sub_type: "Value-Add", sponsor_exits: 6, ltv: 0.58, execution_risk: "Medium", rate_environment: "elevated", projected_gross_irr: 0.18, notes: "Stabilized assets, light reno, good cash flow" },
  { id: "opp_dev_mixed", name: "Mixed-Use Infill Dev", sub_type: "Development", sponsor_exits: 2, ltv: 0.68, execution_risk: "Medium", rate_environment: "elevated", projected_gross_irr: 0.21, notes: "Slightly better sponsor history than downtown" },
]

// JS port of the Python scoring logic (from src/model/scoring.py)
function computeScore(opp: Opportunity, config: ModelConfig, pastDeals: PastDeal[]): ScoreResult {
  const w = config.feature_weights
  const target = config.target_return_default

  const sponsorScore = Math.min(1.0, opp.sponsor_exits / 8.0) * w.sponsor
  const marketScore = (0.5 + 0.5 * (1.0 - Math.min(1.0, opp.ltv))) * w.market
  const structureScore = (opp.execution_risk !== 'High' ? 0.7 : 0.35) * w.structure
  const macroScore = (opp.rate_environment === 'elevated' ? 0.6 : 0.8) * w.macro
  const qualScore = (opp.execution_risk === 'High' ? 0.4 : 0.75) * w.qual

  let base = sponsorScore + marketScore + structureScore + macroScore + qualScore

  const macroAdj = opp.rate_environment === 'elevated' ? -0.08 : 0.03
  const pHit = Math.max(0.15, Math.min(0.92, base + macroAdj + (Math.random() - 0.5) * 0.05))

  const expected = target * (0.6 + 0.8 * pHit) + (Math.random() - 0.5) * 0.03
  const pLoss = Math.max(0.05, 0.38 - 0.45 * pHit)
  const expectedShortfall = 0.12 + (0.18 * (1 - pHit))

  const nComps = pastDeals.length
  const confidence = Math.min(0.92, 0.45 + 0.04 * Math.min(nComps, 25) + 0.15 * (opp.sponsor_exits / 6))

  const drivers = [
    ["Sponsor track record", sponsorScore, sponsorScore > 0.15 ? "positive" : "negative"],
    ["Market / supply-demand & leverage", marketScore, marketScore > 0.12 ? "positive" : "negative"],
    ["Execution / qual risk (DDQ)", qualScore, qualScore < 0.08 ? "negative" : "positive"],
  ].sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number)).slice(0, 3) as [string, number, string][]

  const riskNote = `To target ${(target*100).toFixed(0)}%: illustrative P(loss) ~${(pLoss*100).toFixed(0)}%, expected shortfall ~${(expectedShortfall*100).toFixed(1)}%. Wide interval on limited comps.`
  const recSize = Math.max(1.5, Math.min(12.0, (pHit - 0.35) * 18 + 3.5))

  return {
    p_hit_target: Math.round(pHit * 1000) / 1000,
    expected_return: Math.round(expected * 1000) / 1000,
    p_loss: Math.round(pLoss * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    top_drivers: drivers.map(d => d[0]),
    recommended_size_pct: Math.round(recSize * 10) / 10,
    risk_note: riskNote,
    model_version: config.version,
  }
}

const DEFAULT_CONFIG: ModelConfig = {
  target_return_default: 0.20,
  feature_weights: { sponsor: 0.28, market: 0.22, structure: 0.18, macro: 0.20, qual: 0.12 },
  version: "v0.2-netlify"
}

export default function App() {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_CONFIG)
  const [opportunities, setOpportunities] = useState<Opportunity[]>(INITIAL_OPPORTUNITIES)
  const [pastDeals] = useState<PastDeal[]>(SAMPLE_PAST_DEALS)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'opps' | 'ddq' | 'model' | 'corr' | 'copilot'>('dashboard')
  const [minProb, setMinProb] = useState(0)
  const [selectedSubtypes, setSelectedSubtypes] = useState<('Development' | 'Value-Add')[]>(['Development', 'Value-Add'])
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')

  const [ddqSponsorExits, setDdqSponsorExits] = useState(3)
  const [ddqLtv, setDdqLtv] = useState(0.65)
  const [ddqExecRisk, setDdqExecRisk] = useState<'Low' | 'Medium' | 'High'>('Medium')
  const [ddqNotes, setDdqNotes] = useState('')

  const weights = config.feature_weights

  const scoredOpps = useMemo(() => {
    return opportunities.map(opp => ({
      ...opp,
      score: computeScore(opp, config, pastDeals)
    }))
  }, [opportunities, config, pastDeals])

  const filtered = scoredOpps.filter(o =>
    o.score.p_hit_target >= minProb &&
    selectedSubtypes.includes(o.sub_type)
  )

  const selected = selectedOppId ? scoredOpps.find(o => o.id === selectedOppId) : null

  const updateWeight = (key: keyof typeof weights, value: number) => {
    setConfig(prev => ({
      ...prev,
      feature_weights: { ...prev.feature_weights, [key]: value }
    }))
  }

  const recompute = () => {
    // Triggers re-render via state
  }

  const addFromDDQ = () => {
    const newOpp: Opportunity = {
      id: `ddq_${Date.now()}`,
      name: "New DDQ Opportunity",
      sub_type: "Development",
      sponsor_exits: ddqSponsorExits,
      ltv: ddqLtv,
      execution_risk: ddqExecRisk,
      rate_environment: "elevated",
      notes: ddqNotes || "Added via DDQ form"
    }
    setOpportunities(prev => [...prev, newOpp])
    setActiveTab('dashboard')
    setSelectedOppId(newOpp.id)
    setDdqNotes('')
  }

  const [isCopilotThinking, setIsCopilotThinking] = useState(false)

  const sendChat = async () => {
    const trimmed = chatInput.trim()
    if (!trimmed) return

    const userMsg = trimmed
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }])
    setChatInput('')
    setIsCopilotThinking(true)

    const context = `
Current model:
- Target return: ${(config.target_return_default * 100).toFixed(0)}%
- Weights: ${JSON.stringify(config.feature_weights)}

Current filtered opportunities (with live scores):
${filtered.slice(0, 5).map(o => 
  `- ${o.name} (${o.sub_type}): P(hit)=${(o.score.p_hit_target*100).toFixed(0)}%, expected=${(o.score.expected_return*100).toFixed(1)}%, P(loss)=${(o.score.p_loss*100).toFixed(0)}%, top driver=${o.score.top_drivers[0]}`
).join('\n')}

Selected opportunity: ${selected ? `${selected.name} - ${selected.score.risk_note}` : 'None'}

Recent past deals used for calibration:
${pastDeals.slice(0, 3).map(d => `- ${d.id}: realized ${(d.realized_irr*100).toFixed(1)}% (${d.outcome_label})`).join('\n')}
`.trim()

    try {
      const res = await fetch('/api/grok/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userMsg }],
          context
        })
      })

      const data = await res.json()

      if (data.error) {
        throw new Error(data.error)
      }

      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: data.reply || "No response from the model." 
      }])
    } catch (err: any) {
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `Copilot error: ${err.message}. (Make sure XAI_API_KEY is set in Netlify, or run with "netlify dev" locally.)` 
      }])
    } finally {
      setIsCopilotThinking(false)
    }
  }

  const corrData = [
    [1.0, 0.65, 0.35],
    [0.65, 1.0, 0.40],
    [0.35, 0.40, 1.0]
  ]
  const corrLabels = ['RE_Dev', 'RE_ValueAdd', 'Private_Lending']

  return (
    <div className="app">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>AI Diligence Platform</h1>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Probability of hitting target return • Risk quantification • Transparent drivers</div>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
          Netlify • v0.2 • Private repo
        </div>
      </header>

      <div className="tabs">
        {[
          { id: 'dashboard', label: '📊 Client Dashboard', icon: BarChart3 },
          { id: 'opps', label: 'Opportunities', icon: Target },
          { id: 'ddq', label: 'DDQ Intake', icon: Upload },
          { id: 'model', label: 'Analyst Model Studio', icon: Settings },
          { id: 'corr', label: 'Correlations', icon: BarChart3 },
          { id: 'copilot', label: '🧠 Diligence Copilot', icon: MessageSquare },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id as any)}
            >
              <Icon size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="main">
        {activeTab === 'dashboard' && (
          <>
            <div className="grid-4">
              <div className="card">
                <div className="metric-label">Avg. Hit Probability</div>
                <div className="metric-value">{(scoredOpps.reduce((s, o) => s + o.score.p_hit_target, 0) / scoredOpps.length * 100).toFixed(0)}%</div>
              </div>
              <div className="card">
                <div className="metric-label">High-Confidence Deals</div>
                <div className="metric-value">{scoredOpps.filter(o => o.score.confidence >= 0.65).length}</div>
              </div>
              <div className="card">
                <div className="metric-label">Target Return</div>
                <div className="metric-value">{(config.target_return_default * 100).toFixed(0)}%</div>
              </div>
              <div className="card">
                <div className="metric-label">Model Version</div>
                <div className="metric-value" style={{ fontSize: '1.1rem' }}>{config.version}</div>
              </div>
            </div>

            <div className="filters">
              <label>Min Probability: ${(minProb * 100).toFixed(0)}%</label>
              <input type="range" min="0" max="1" step="0.05" value={minProb} onChange={e => setMinProb(parseFloat(e.target.value))} />
              <div>
                {['Development', 'Value-Add'].map(st => (
                  <label key={st} style={{ marginRight: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedSubtypes.includes(st as any)}
                      onChange={e => {
                        if (e.target.checked) setSelectedSubtypes(prev => [...prev, st as any])
                        else setSelectedSubtypes(prev => prev.filter(s => s !== st))
                      }}
                    /> {st}
                  </label>
                ))}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>P(Hit)</th>
                  <th>Expected</th>
                  <th>P(Loss)</th>
                  <th>Conf.</th>
                  <th>Top Driver</th>
                  <th>Suggested %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id} onClick={() => { setSelectedOppId(o.id); setActiveTab('dashboard') }} style={{ cursor: 'pointer' }}>
                    <td>{o.name}</td>
                    <td>{o.sub_type}</td>
                    <td className={o.score.p_hit_target > 0.7 ? 'prob-high' : o.score.p_hit_target > 0.4 ? 'prob-med' : 'prob-low'}>
                      ${(o.score.p_hit_target * 100).toFixed(0)}%
                    </td>
                    <td>{(o.score.expected_return * 100).toFixed(1)}%</td>
                    <td>{(o.score.p_loss * 100).toFixed(0)}%</td>
                    <td>{(o.score.confidence * 100).toFixed(0)}%</td>
                    <td>{o.score.top_drivers[0]}</td>
                    <td>{o.score.recommended_size_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selected && (
              <div style={{ marginTop: '2rem' }} className="card">
                <h3>{selected.name} — {selected.sub_type}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                  <div>
                    <div style={{ marginBottom: '0.5rem' }}>Probability of Hitting Target</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 700, color: selected.score.p_hit_target > 0.65 ? 'var(--success)' : 'var(--warning)' }}>
                      ${(selected.score.p_hit_target * 100).toFixed(0)}%
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                      <strong>Risk to earn the target:</strong><br />
                      {selected.score.risk_note}
                    </div>
                    <div style={{ marginTop: '0.75rem' }}>
                      <strong>Recommended allocation:</strong> ~{selected.score.recommended_size_pct}% of book (risk-budgeted)
                    </div>
                  </div>

                  <div>
                    <div style={{ marginBottom: '0.5rem' }}>Top Drivers</div>
                    {selected.score.top_drivers.map((d, i) => (
                      <div key={i} style={{ margin: '4px 0', padding: '4px 8px', background: '#27272a', borderRadius: 4 }}>{d}</div>
                    ))}

                    <div style={{ marginTop: '1rem' }}>
                      <Plot
                        data={[{ 
                          x: Array.from({ length: 50 }, (_, i) => (i - 25) * 0.008 + (selected.score.expected_return || 0.18)),
                          type: 'histogram',
                          marker: { color: '#6366f1' }
                        }]}
                        layout={{
                          height: 220,
                          margin: { t: 10, b: 30, l: 30, r: 10 },
                          paper_bgcolor: '#1a1f2e',
                          plot_bgcolor: '#1a1f2e',
                          font: { color: '#e6e6e6' },
                          title: 'Illustrative Return Distribution',
                          shapes: [{ type: 'line', x0: config.target_return_default, x1: config.target_return_default, y0: 0, y1: 12, line: { color: '#eab308', dash: 'dash' } }]
                        }}
                        config={{ displayModeBar: false }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'opps' && (
          <div>
            <h2>Opportunities &amp; Past Deals</h2>
            <h3>Current Opportunities</h3>
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Sponsor Exits</th><th>LTV</th><th>Risk</th></tr></thead>
              <tbody>
                {opportunities.map(o => <tr key={o.id}><td>{o.name}</td><td>{o.sub_type}</td><td>{o.sponsor_exits}</td><td>${(o.ltv*100).toFixed(0)}%</td><td>{o.execution_risk}</td></tr>)}
              </tbody>
            </table>

            <h3 style={{ marginTop: '2rem' }}>Historical / Past Deals (training signal)</h3>
            <table>
              <thead><tr><th>ID</th><th>Type</th><th>Sponsor Exits</th><th>Realized IRR</th><th>Outcome</th></tr></thead>
              <tbody>
                {pastDeals.map(d => <tr key={d.id}><td>{d.id}</td><td>{d.sub_type}</td><td>{d.sponsor_exits}</td><td>${(d.realized_irr*100).toFixed(1)}%</td><td>{d.outcome_label}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'ddq' && (
          <div className="card">
            <h2>DDQ Intake (RE Dev / Value-Add)</h2>
            <div style={{ display: 'grid', gap: '1rem', maxWidth: 520 }}>
              <label>Sponsor exits (last 10 yrs): ${ddqSponsorExits}<br />
                <input type="range" min="0" max="12" value={ddqSponsorExits} onChange={e => setDdqSponsorExits(+e.target.value)} />
              </label>
              <label>Peak LTV: ${(ddqLtv*100).toFixed(0)}%<br />
                <input type="range" min="0.4" max="0.85" step="0.01" value={ddqLtv} onChange={e => setDdqLtv(+e.target.value)} />
              </label>
              <label>Execution risk:
                <select value={ddqExecRisk} onChange={e => setDdqExecRisk(e.target.value as any)}>
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </label>
              <textarea placeholder="Key qualitative notes / red flags" value={ddqNotes} onChange={e => setDdqNotes(e.target.value)} rows={4} style={{ width: '100%' }} />
              <button onClick={addFromDDQ}>Save DDQ &amp; Add Opportunity</button>
            </div>
            <p className="disclaimer">In a full version this would run LLM extraction on uploaded PDFs and feed structured fields into the model.</p>
          </div>
        )}

        {activeTab === 'model' && (
          <div className="card">
            <h2>Analyst Model Studio</h2>
            <p>Live editable weights (changes immediately affect scores on the Dashboard).</p>
            {Object.keys(weights).map((k) => (
              <div key={k} style={{ margin: '12px 0' }}>
                <label>${k.charAt(0).toUpperCase() + k.slice(1)}: ${(weights as any)[k].toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.01" value={(weights as any)[k]} onChange={e => updateWeight(k as any, parseFloat(e.target.value))} />
              </div>
            ))}
            <button onClick={recompute}>Recompute All</button>
            <pre style={{ marginTop: '1rem', background: '#111', padding: '1rem', borderRadius: 6 }}>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}

        {activeTab === 'corr' && (
          <div className="card">
            <h2>Cross-Market Correlations</h2>
            <Plot
              data={[{ 
                z: corrData,
                x: corrLabels,
                y: corrLabels,
                type: 'heatmap',
                colorscale: 'RdYlGn',
                zmin: -1,
                zmax: 1,
                text: corrData.map(row => row.map(v => v.toFixed(2))),
                texttemplate: '%{text}'
              }]}
              layout={{
                height: 420,
                paper_bgcolor: '#1a1f2e',
                font: { color: '#e6e6e6' },
                title: 'Illustrative Correlation Matrix'
              }}
            />
            <p className="disclaimer">Editable matrix + full MC portfolio simulation coming in later iterations.</p>
          </div>
        )}

        {activeTab === 'copilot' && (
          <div className="card" style={{ maxWidth: 720 }}>
            <h2>🧠 Diligence Copilot (AI Analyst)</h2>
            <div className="chat">
              <div className="chat-messages">
                {chatHistory.length === 0 && <div style={{ color: '#64748b' }}>Ask about drivers, scenarios, or recommendations. The copilot calls the live Grok model via Netlify Function (make sure XAI_API_KEY is set in Netlify).</div>}
                {chatHistory.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>{m.content}</div>
                ))}
                {isCopilotThinking && <div className="message assistant">Thinking...</div>}
              </div>
              <div style={{ display: 'flex', padding: '0.5rem', borderTop: '1px solid #2a3142' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="What is driving the low probability on the downtown value-add deal?"
                  style={{ flex: 1, background: '#111', border: '1px solid #2a3142', color: 'white', padding: '0.5rem' }}
                  disabled={isCopilotThinking}
                />
                <button onClick={sendChat} style={{ marginLeft: 8 }} disabled={isCopilotThinking}>Send</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="disclaimer" style={{ padding: '0 1.5rem 2rem' }}>
        All computation client-side for this Netlify demo. Public data (FRED, Zillow Research, Census) used for context only in the full platform. Your historical outcomes + DDQ inputs provide the proprietary edge.
      </div>
    </div>
  )
}
