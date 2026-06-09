import { Fragment } from 'react'
import RAW from './us-market.json'
import { Info } from './Info'

interface Series { id: string; name: string; category: string; kind: string; latest: number; asof: string; yoy: number | null; n: number; annReturn?: number; annVol?: number; annVolDesmoothed?: number }
interface Data {
  asof: string; nSeries: number; missing: string[]; commonQuarters: number
  series: Series[]
  corr: { labels: string[]; names: string[]; category: string[]; matrix: (number | null)[][] }
  reCorr: { id: string; name: string; category: string; corr: number }[]
}
const D = RAW as unknown as Data

const CATS = ['Home prices', 'Rents', 'Commercial/REIT', 'Activity', 'Financing', 'Macro/rates']
// Short, readable axis labels for the heatmap (full names show on hover). The raw
// values are FRED/Zillow series tickers, which are too cryptic for an axis.
const SHORT: Record<string, string> = {
  CSUSHPINSA: "CS Nat'l", CSUSHPISA: "CS Nat'l SA", SPCS20RSA: 'CS 20-City', SPCS10RSA: 'CS 10-City',
  USSTHPI: 'FHFA', HPIPONM226S: 'FHFA (PO)', MSPUS: 'Median $', ZHVI_US: 'Zillow HVI',
  CUSR0000SEHA: 'CPI Rent', CUSR0000SEHC: 'CPI OER', ZORI_US: 'Zillow Rent', COMREPUSQ159N: 'CRE Price',
  HOUST: 'Starts', EXHOSLUSM495S: 'Home Sales', ACTLISCOUUS: 'Listings', MORTGAGE30US: 'Mtg 30Y',
  FEDFUNDS: 'Fed Funds', DGS10: '10Y UST', UNRATE: 'Unemploy.', CPIAUCSL: 'CPI', GDPC1: 'Real GDP',
  PAYEMS: 'Payrolls', BAMLH0A0HYM2: 'HY Spread', WILL5000IND: 'Equities', WILLREITIND: 'REITs',
}
const short = (id: string) => SHORT[id] ?? id
const pct = (x: number | null | undefined, d = 1) => x == null ? '—' : (x * 100).toFixed(d) + '%'

// correlation -> color (red negative, white 0, blue positive)
function corrColor(c: number | null): string {
  if (c == null) return '#f1f3f6'
  const a = Math.min(1, Math.abs(c))
  if (c >= 0) return `rgba(59,91,219,${0.12 + 0.78 * a})`
  return `rgba(194,56,74,${0.12 + 0.78 * a})`
}

export default function USMarket() {
  const { labels, names, matrix } = D.corr
  const N = labels.length
  const cell = 24, padL = 150, padT = 150
  const W = padL + N * cell + 12, H = padT + N * cell + 12

  return (
    <div className="um-root">
      <style>{CSS}</style>

      <header className="um-head">
        <div>
          <div className="um-brand">UNITED STATES · REAL ESTATE</div>
          <h1>Market base rates &amp; cross-correlations</h1>
          <div className="um-sub">{D.nSeries} national series · {D.commonQuarters}-quarter common overlap · data as of {D.asof}.
            Correlations on quarterly changes. This is the cross-market layer the deal scorer conditions on.</div>
        </div>
      </header>

      {/* CORRELATION WITH HOME PRICES */}
      <div className="um-two">
        <div className="um-panel">
          <h2>Correlation with U.S. home prices (Case-Shiller national) <Info width={270}>Correlation runs from <b>+1</b> (moves in lockstep with home prices) through <b>0</b> (unrelated) to <b>−1</b> (moves opposite — a hedge). Measured on aligned quarterly % changes. Note the three independent home-price indices all land +0.6 to +0.8 — they cross-validate each other.</Info></h2>
          {D.reCorr.map((r) => (
            <div className="um-cbar" key={r.id}>
              <span className="um-cname" title={r.name}>{r.name}</span>
              <div className="um-ctrack">
                <div className="um-czero" />
                <div className="um-cfill" style={{
                  width: `${Math.abs(r.corr) * 50}%`,
                  left: r.corr >= 0 ? '50%' : `${50 - Math.abs(r.corr) * 50}%`,
                  background: r.corr >= 0 ? '#3b5bdb' : '#c2384a',
                }} />
              </div>
              <span className="um-cval" style={{ color: r.corr >= 0 ? '#3b5bdb' : '#c2384a' }}>{r.corr >= 0 ? '+' : ''}{r.corr.toFixed(2)}</span>
            </div>
          ))}
          <div className="um-foot">Positive = moves with home prices; negative = hedges. Computed on aligned quarterly changes
            (home-price indices vs each series).</div>
        </div>

        {/* HEATMAP */}
        <div className="um-panel">
          <h2>Full correlation heatmap ({N}×{N}) <Info width={270}>Every cell is the correlation between its row and column series. <b>Deep blue</b> = strong positive, <b>red</b> = negative, pale = weak. Hover any cell for the exact pair and value. The home-price block (top-left) co-moves tightly; rates and unemployment sit apart — that diversification is what the portfolio risk model uses.</Info></h2>
          <div className="um-heatwrap">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520 }}>
              {/* column labels */}
              {labels.map((l, j) => (
                <text key={'c' + j} x={padL + j * cell + cell / 2} y={padT - 6}
                  fontSize={9} fill="#5b6573" textAnchor="start"
                  transform={`rotate(-55 ${padL + j * cell + cell / 2} ${padT - 6})`}>{short(l)}
                  <title>{names[j]} ({l})</title></text>
              ))}
              {/* row labels + cells */}
              {labels.map((l, i) => (
                <g key={'r' + i}>
                  <text x={padL - 6} y={padT + i * cell + cell / 2 + 3} fontSize={9} fill="#5b6573" textAnchor="end">{short(l)}
                    <title>{names[i]} ({l})</title></text>
                  {labels.map((_, j) => {
                    const c = matrix[i][j]
                    return <rect key={j} x={padL + j * cell} y={padT + i * cell} width={cell - 1.5} height={cell - 1.5}
                      rx={2} fill={corrColor(c)}>
                      <title>{names[i]} ↔ {names[j]}: {c == null ? 'n/a' : c.toFixed(2)}</title>
                    </rect>
                  })}
                </g>
              ))}
            </svg>
          </div>
          <div className="um-legend">
            <span><i style={{ background: 'rgba(194,56,74,0.85)' }} />−1</span>
            <span><i style={{ background: '#f1f3f6' }} />0</span>
            <span><i style={{ background: 'rgba(59,91,219,0.85)' }} />+1</span>
            <span style={{ color: '#5b6573' }}>hover a cell for the pair &amp; value</span>
          </div>
        </div>
      </div>

      {/* SERIES TABLE */}
      <div className="um-panel">
        <h2>All series — latest reads &amp; return distributions <Info width={280}>Latest value, year-over-year change, and — for price indices — the fitted annualized return and volatility. <b>Vol (de-smoothed)</b> removes index smoothing (Geltner) to show the honest risk the deal scorer actually uses; "raw" is the understated index figure. Rate/level series show their YoY change instead.</Info></h2>
        <table className="um-table">
          <thead><tr><th>Series</th><th>Latest</th><th>as of</th><th className="r">YoY</th><th className="r">Ann. return</th><th className="r">Vol (raw)</th><th className="r">Vol (de-smoothed)</th><th className="r">n (qtrs)</th></tr></thead>
          <tbody>
            {CATS.map((cat) => {
              const rows = D.series.filter((s) => s.category === cat)
              if (!rows.length) return null
              return (
                <Fragment key={cat}>
                  <tr className="um-catrow"><td colSpan={8}>{cat}</td></tr>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b> <span className="um-id">{s.id}</span></td>
                      <td>{s.latest.toLocaleString()}</td>
                      <td className="um-mut">{s.asof}</td>
                      <td className="r" style={{ color: (s.yoy ?? 0) >= 0 ? '#157f3c' : '#c2384a' }}>{s.yoy == null ? '—' : (s.yoy >= 0 ? '+' : '') + s.yoy + (s.kind === 'rate' ? 'pp' : '%')}</td>
                      <td className="r">{pct(s.annReturn)}</td>
                      <td className="r um-mut">{pct(s.annVol)}</td>
                      <td className="r"><b>{pct(s.annVolDesmoothed)}</b></td>
                      <td className="r um-mut">{s.n}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <div className="um-foot">Ann. return / vol shown for price-index series (de-smoothed = honest volatility after Geltner, the input the
          deal scorer uses). Rate/level series show YoY change. {D.missing.length > 0 && <> · <b>Pending FRED refresh ({D.missing.length}):</b> {D.missing.join(', ')} — re-run <code>load_us_market.py</code> when the FRED API is reachable.</>}</div>
      </div>
    </div>
  )
}

const CSS = `
.um-root{font-family:'Poppins',-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif;color:#11161f}
/* neutralize the app's global dark-theme table styles inside this light panel */
.um-root table{background:transparent;border-radius:0;overflow:visible}
.um-root th,.um-root td{background:transparent;color:#11161f}
.um-head{margin-bottom:16px}
.um-brand{font-size:12px;letter-spacing:.14em;color:#5b6573;font-weight:700}
.um-head h1{font-size:24px;margin:4px 0 2px;letter-spacing:-.02em}
.um-sub{color:#5b6573;font-size:13px;max-width:760px}
.um-two{display:grid;grid-template-columns:1fr 1.1fr;gap:16px;margin-bottom:16px;align-items:start}
.um-panel{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:16px 18px;min-width:0}
.um-panel h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6573;margin:0 0 14px;font-weight:700}
.um-cbar{display:flex;align-items:center;gap:10px;margin:5px 0}
.um-cname{width:165px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.um-ctrack{flex:1;height:14px;background:#f1f3f6;border-radius:4px;position:relative}
.um-czero{position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:#c2c8d2}
.um-cfill{position:absolute;top:0;bottom:0;border-radius:3px;opacity:.85}
.um-cval{width:42px;text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.um-heatwrap{overflow-x:auto}
.um-legend{font-size:11.5px;color:#5b6573;margin-top:8px;display:flex;gap:14px;align-items:center}
.um-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:middle;border:1px solid #e0e3e9}
.um-table{width:100%;border-collapse:collapse;font-size:12.5px}
.um-table td,.um-table th{padding:6px 8px;border-bottom:1px solid #eef0f4;text-align:left}
.um-table th{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#5b6573}
.um-table th.r,.um-table td.r{text-align:right;font-variant-numeric:tabular-nums}
.um-catrow td{background:#f7f8fa;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#3b5bdb;font-weight:700;padding-top:9px}
.um-id{color:#6b7280;font-size:10.5px;font-weight:500}
.um-mut{color:#5b6573}
.um-foot{color:#5b6573;font-size:11.5px;margin-top:10px;line-height:1.6}
.um-foot code{background:#f1f3f6;padding:1px 5px;border-radius:4px;font-size:11px}
@media(max-width:980px){.um-two{grid-template-columns:1fr}}
`
