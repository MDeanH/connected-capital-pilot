import { useEffect, useState } from 'react'
import { Info } from './Info'

// Market context overlay — five open datasets baked offline by
// scripts/build_market_context.py into public/market-context.json:
// Zillow ZORI rents, Zillow inventory/list/days-to-pending, BEA county income,
// FEMA National Risk Index, IRS county migration flows.

interface Ctx {
  rent?: number; rentYoY?: number; grossYield?: number
  invYoY?: number; listVsZhvi?: number; daysToPending?: number
  income?: number; incomeGrowth5y?: number; priceToIncome?: number
  nriScore?: number; nriRating?: string; topHazards?: [string, number][]
  netMigHH?: number; netAGI_M?: number; inAvgAGI?: number; topOrigins?: [string, number][]
  // subtle-signal sidecars: HMDA, Census permits, NFIP claims
  investorShare?: number; denialRate?: number; loanCount?: number
  permits?: number; permitsPer1k?: number; permitsVs5y?: number; sfShare?: number
  claims10y?: number; paid10yM?: number; claimsTrend?: number; worstYear?: number
  nonRenewalRate?: number
}
interface CtxFile { sources: Record<string, string>; markets: Record<string, Ctx> }

let ctxCache: Promise<CtxFile | null> | null = null
function loadCtx(): Promise<CtxFile | null> {
  if (!ctxCache) {
    ctxCache = fetch('/market-context.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return ctxCache
}

function lookup(d: CtxFile, marketKey: string): { label: string; ctx: Ctx } | null {
  if (d.markets[marketKey]) return { label: marketKey, ctx: d.markets[marketKey] }
  const idx = marketKey.lastIndexOf(', ')
  if (idx < 0) return null
  const st = marketKey.slice(idx + 2)
  const base = marketKey.slice(0, idx).replace(/ \(city[^)]*\)$/, '')
  for (const cand of [`${base} (city), ${st}`, `${base}, ${st}`, `${base} County, ${st}`]) {
    if (d.markets[cand]) return { label: cand, ctx: d.markets[cand] }
  }
  return null
}

const pctS = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`

function Row({ label, children, tip }: { label: string; children: any; tip: string }) {
  return (
    <div className="mc-row">
      <span className="mc-label">{label}<Info width={240}>{tip}</Info></span>
      <span className="mc-val">{children}</span>
    </div>
  )
}

export default function MarketContext({ marketKey }: { marketKey: string }) {
  const [data, setData] = useState<CtxFile | null>(null)
  useEffect(() => { loadCtx().then(setData) }, [])

  if (!data) return null
  const hit = lookup(data, marketKey)
  if (!hit) return null
  const c = hit.ctx
  const any = (...ks: (keyof Ctx)[]) => ks.some(k => c[k] !== undefined && c[k] !== null)
  if (!any('rent', 'invYoY', 'income', 'nriScore', 'netMigHH', 'investorShare', 'permitsPer1k', 'claims10y')) return null

  return (
    <div className="mc-card">
      <style>{CSS}</style>
      <div className="mc-head">Market context <span className="mc-src">{hit.label}</span></div>

      {any('rent') && (
        <Row label="Rent & yield" tip="Zillow Observed Rent Index (ZORI), latest month. Gross yield = 12 × monthly rent ÷ Zillow home value (a cap-rate proxy before expenses).">
          ${c.rent!.toLocaleString()}/mo
          {c.grossYield !== undefined && <> · <b>{(c.grossYield * 100).toFixed(1)}%</b> gross yield</>}
          {c.rentYoY !== undefined && <> · {pctS(c.rentYoY)} YoY</>}
        </Row>
      )}
      {any('invYoY', 'daysToPending', 'listVsZhvi') && (
        <Row label="Market heat" tip="Zillow for-sale inventory change vs a year ago (rising inventory cools prices), days from listing to pending sale (exit liquidity), and median list price vs typical home value (seller expectation gap).">
          {c.invYoY !== undefined && <>inventory {pctS(c.invYoY)} YoY</>}
          {c.daysToPending !== undefined && <> · {c.daysToPending}d to pending</>}
          {c.listVsZhvi !== undefined && <> · list/value {c.listVsZhvi!.toFixed(2)}</>}
        </Row>
      )}
      {any('income') && (
        <Row label="Affordability" tip="BEA per-capita personal income (county). Price-to-income = Zillow home value ÷ per-capita income — compare across markets, higher = more stretched.">
          ${(c.income! / 1000).toFixed(0)}k income
          {c.priceToIncome !== undefined && <> · <b>{c.priceToIncome!.toFixed(1)}×</b> price/income</>}
          {c.incomeGrowth5y !== undefined && <> · {pctS(c.incomeGrowth5y)} 5y</>}
        </Row>
      )}
      {any('nriScore') && (
        <Row label="Hazard risk" tip="FEMA National Risk Index (county): composite natural-hazard risk from 18 hazards (modeled expected annual loss, social vulnerability, resilience). Drives insurance costs.">
          NRI {c.nriScore} <span className="mc-chip">{c.nriRating}</span>
          {c.topHazards && c.topHazards.length > 0 && <> · {c.topHazards.slice(0, 2).map(h => h[0]).join(', ')}</>}
        </Row>
      )}
      {any('netMigHH') && (
        <Row label="Migration" tip="IRS county-to-county flows (2022→2023 returns): net households moving in, net adjusted gross income carried with them, and the largest feeder county.">
          {c.netMigHH! >= 0 ? '+' : ''}{c.netMigHH!.toLocaleString()} households
          {c.netAGI_M !== undefined && <> · {c.netAGI_M! >= 0 ? '+' : '−'}${Math.abs(c.netAGI_M!) >= 1000 ? (Math.abs(c.netAGI_M!) / 1000).toFixed(1) + 'B' : Math.abs(c.netAGI_M!).toFixed(0) + 'M'} AGI</>}
          {c.topOrigins && c.topOrigins[0] && <> · from {c.topOrigins[0][0]}</>}
        </Row>
      )}
      {any('investorShare', 'denialRate') && (
        <Row label="Demand quality" tip="HMDA mortgage data (CFPB): share of originated home-purchase loans going to investors/second homes, and the denial rate. High investor share = price growth carried by speculative demand; rising denials = tightening credit.">
          {c.investorShare !== undefined && <><b>{(c.investorShare * 100).toFixed(0)}%</b> investor share</>}
          {c.denialRate !== undefined && <> · {(c.denialRate * 100).toFixed(0)}% denials</>}
          {c.loanCount !== undefined && <> · {c.loanCount.toLocaleString()} loans</>}
        </Row>
      )}
      {any('permitsPer1k', 'permitsVs5y') && (
        <Row label="Supply pipeline" tip="Census Building Permits Survey: housing units permitted in the latest year per 1,000 residents, and vs the county's own 5-year norm. A surge above norm means future supply pressure on rents and prices.">
          {c.permitsPer1k !== undefined && <><b>{c.permitsPer1k.toFixed(1)}</b> units/1k residents</>}
          {c.permitsVs5y !== undefined && <> · {c.permitsVs5y.toFixed(2)}× 5-yr norm</>}
          {c.sfShare !== undefined && <> · {(c.sfShare * 100).toFixed(0)}% single-family</>}
        </Row>
      )}
      {any('claims10y') && (
        <Row label="Flood claims" tip="FEMA NFIP: actual paid flood-insurance claims in this county over the last 10 loss-years — realized losses, not modeled risk. A rising trend signals deteriorating insurability ahead of risk scores.">
          {c.claims10y!.toLocaleString()} claims
          {c.paid10yM !== undefined && <> · ${c.paid10yM! >= 1000 ? (c.paid10yM! / 1000).toFixed(1) + 'B' : c.paid10yM!.toFixed(0) + 'M'} paid (10y)</>}
          {c.claimsTrend !== undefined && c.claimsTrend !== null && <> · trend {c.claimsTrend!.toFixed(1)}×</>}
        </Row>
      )}
    </div>
  )
}

const CSS = `
.mc-card{margin-top:8px;padding:10px 12px;background:var(--surface-2,#f7f8fa);border:1px solid var(--border,#e6e9ef);border-radius:10px}
.mc-head{font-size:.78rem;font-weight:700;color:var(--text,#11161f);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.mc-src{margin-left:auto;font-weight:500;font-size:.68rem;color:var(--muted,#5b6573)}
.mc-row{display:flex;gap:8px;margin-top:7px;font-size:.74rem;align-items:baseline}
.mc-label{width:88px;flex-shrink:0;color:var(--muted,#5b6573)}
.mc-val{color:var(--text,#11161f);line-height:1.4}
.mc-val b{font-weight:700}
.mc-chip{display:inline-block;padding:0 6px;border-radius:8px;background:var(--accent-soft,#eef2ff);color:var(--accent,#3b5bdb);font-size:.66rem;font-weight:600}
`
