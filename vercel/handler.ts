// Preview adapter for the existing pure engines. Mirrors the Vite bridges;
// nothing is persisted, and this adapter never substitutes a sample deal.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { computeScore } from '../netlify/functions/lib/compute.ts'
import { computeGate1, DEFAULT_CONFIG } from '../netlify/functions/lib/gate1/preview.ts'
import type { Gate1Request } from '../netlify/functions/lib/gate1/preview.ts'
import { fetchSeriesMap } from '../netlify/functions/lib/gate1/fred.ts'
import { computeMacroSnapshot, buildMarketContext, MARKET_SERIES, utcWeekStart } from '../netlify/functions/lib/gate1/macro.ts'
import type { Regime } from '../netlify/functions/lib/gate1/types.ts'

interface PreviewRequest extends IncomingMessage { query: Record<string,string|string[]|undefined>; body?: unknown }
export default async function handler(req: PreviewRequest, res: ServerResponse) {
  const reply = (status: number, data: unknown) => {
    res.statusCode=status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store')
    res.end(JSON.stringify(data))
  }
  const url = new URL(req.url ?? '/', 'https://preview.invalid')
  const queryPath = req.query?.path ?? url.searchParams.get('path')
  const path = '/' + (Array.isArray(queryPath) ? queryPath.join('/') : queryPath ?? url.pathname.replace(/^\/api\//,''))
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string,unknown>
    if (path === '/auth/status') return reply(200,{enabled:false,accountsRequired:false})
    if (path === '/health') return reply(200,{ok:true,persisted:false})
    if (req.method === 'GET' && (path === '/config/active' || path === '/config/0')) return reply(200,{version:0,config:DEFAULT_CONFIG,note:'shipped default (default-config.json)',author:null})
    if (path === '/config' && req.method === 'POST') {
      if (typeof body.note !== 'string' || !body.note.trim()) return reply(400,{error:'A version note is required'})
      return reply(200,{persisted:false,warning:'Preview — rulebook was NOT saved. Continue using the local draft or export JSON.'})
    }
    if (path === '/score' && req.method === 'POST') return reply(200,computeScore(body))
    if (['/gate1/preview','/gate1/decide'].includes(path) && req.method === 'POST') {
      if (body.posture != null && !['green','yellow','red'].includes(String(body.posture))) return reply(400,{error:'Invalid posture'})
      const result=computeGate1(body as unknown as Gate1Request)
      return reply(200,path.endsWith('/decide') ? {...result,persisted:false,warning:'Preview — decision computed but NOT recorded'} : result)
    }
    if (path === '/gate1/preview-batch' && req.method === 'POST') {
      if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) return reply(400,{error:'Batch needs 1–100 rows'})
      if (body.posture != null && !['green','yellow','red'].includes(String(body.posture))) return reply(400,{error:'Invalid posture'})
      return reply(200,{results:body.rows.map(fields => {
        try { return computeGate1({fields,posture:body.posture} as Gate1Request) }
        catch(err) { return {error:err instanceof Error ? err.message : String(err)} }
      })})
    }
    if (path === '/macro/history' && req.method === 'GET') return reply(200,[])
    if ((path === '/macro/latest' && req.method === 'GET') || (path === '/macro/override' && req.method === 'POST')) {
      const manual=path.endsWith('/override')
      if (manual && (typeof body.note !== 'string' || !body.note.trim())) return reply(400,{error:'Override requires a reason'})
      if (manual && body.regime != null && !['soft_landing','stagflation','recession'].includes(String(body.regime))) return reply(400,{error:'Invalid regime'})
      const ids:Record<string,string>={...MARKET_SERIES}
      for(const d of DEFAULT_CONFIG.macro.signals ?? []) if(d.fred) ids[d.id]=d.fred
      const series=await fetchSeriesMap(ids)
      const snapshot=computeMacroSnapshot({config:DEFAULT_CONFIG,weekOf:utcWeekStart(new Date()),series,previous:null,
        manualValues:manual ? body.signalValues as Record<string,number> : undefined,
        forcedRegime:manual ? body.regime as Regime : undefined,source:manual?'manual':'auto',note:manual?String(body.note).trim():undefined})
      const market=buildMarketContext({sofr:series.sofr??[],mortgage30y:series.mortgage30y??[],treasury10y:series.treasury10y??[],sp500:series.sp500??[]})
      return reply(200,{...snapshot,market,live:true,persisted:false,...(manual?{warning:'Preview — macro override computed but NOT recorded'}:{})})
    }
    if (path === '/extract') return reply(503,{error:'AI extraction is not configured in this preview. Start a new deal manually, or explicitly load the labeled sample. Uploaded documents are not replaced with sample data.'})
    if (path === '/gate1/decisions' || path === '/deals') return reply(503,{error:'Persistence is not configured on this preview',persisted:false})
    return reply(404,{error:'Route unavailable in this preview'})
  } catch(err) { return reply(400,{error:err instanceof Error?err.message:String(err)}) }
}
