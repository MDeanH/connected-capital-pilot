// /api/data-status — live freshness check for every dataset the site ships.
//
// Compares the baked vintage (public/data-vintages.json, committed with each
// rebake) against each source's latest published marker, server-side (the
// browser can't: CORS). Response is CDN-cached for 6h, so sources see at most
// a handful of light probes per day.
//
// status per dataset: "current" (green) | "update" (red: newer data published)
//                     | "unknown" (gray: probe failed)

import type { Config, Context } from '@netlify/functions'

const FBI_KEY = 'iiHnOKfno2Mgkt5AynpvPpUQTEyxE77jo1RU8PIv' // FBI CDE public webapp key (not a secret)
const ZILLOW = 'https://files.zillowstatic.com/research/public_csvs'

interface Vintage { id: string; name: string; vintage: string | null; check: string }
interface Row { id: string; name: string; vintage: string | null; status: 'current' | 'update' | 'unknown'; latest?: string }

async function fetchTimeout(url: string, ms = 7000, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Latest month column in a wide Zillow CSV — fetch only the header bytes.
async function zillowLatest(path: string): Promise<string | null> {
  const r = await fetchTimeout(`${ZILLOW}/${path}`, 8000, { headers: { Range: 'bytes=0-8000' } })
  if (!r.ok && r.status !== 206) return null
  const header = (await r.text()).split('\n')[0]
  const dates = header.split(',').map(c => c.replace(/"/g, '').trim()).filter(c => /^20\d\d-\d\d-\d\d$/.test(c))
  return dates.length ? dates[dates.length - 1] : null
}

async function check(v: Vintage): Promise<Row> {
  const row: Row = { id: v.id, name: v.name, vintage: v.vintage, status: 'unknown' }
  if (!v.vintage) return row
  try {
    switch (v.check) {
      case 'zillow_zhvi':
      case 'zillow_zori':
      case 'zillow_inv': {
        const path = v.check === 'zillow_zhvi' ? 'zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv'
          : v.check === 'zillow_zori' ? 'zori/Metro_zori_uc_sfrcondomfr_sm_month.csv'
          : 'invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv'
        const latest = await zillowLatest(path)
        if (!latest) return row
        row.latest = latest
        row.status = latest > v.vintage ? 'update' : 'current'
        return row
      }
      case 'fbi_next_year': {
        const next = parseInt(v.vintage) + 1
        const url = `https://api.usa.gov/crime/fbi/cde/summarized/state/FL/violent-crime?from=01-${next}&to=12-${next}&type=counts&API_KEY=${FBI_KEY}`
        // the CDE API throws transient 503s — one quick retry
        let r = await fetchTimeout(url, 4000).catch(() => null as Response | null)
        if (!r || !r.ok) r = await fetchTimeout(url, 4500).catch(() => null as Response | null)
        if (!r || !r.ok) return row
        const d: any = await r.json()
        const actuals = d?.offenses?.actuals ?? {}
        const fl = Object.keys(actuals).find(k => !k.includes('United States') && k.includes('Offenses'))
        const months = fl ? Object.values(actuals[fl] as Record<string, number>) : []
        const hasData = months.filter(x => typeof x === 'number' && x > 0).length >= 6
        row.latest = hasData ? String(next) : v.vintage
        row.status = hasData ? 'update' : 'current'
        return row
      }
      case 'age_45d': {
        const ageDays = (Date.now() - new Date(v.vintage).getTime()) / 86_400_000
        row.status = ageDays > 45 ? 'update' : 'current'
        row.latest = ageDays > 45 ? 'newer observations on FRED' : undefined
        return row
      }
      case 'hmda_next_year': {
        const next = parseInt(v.vintage) + 1
        const r = await fetchTimeout(`https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations?years=${next}&states=DE&actions_taken=1`)
        row.status = r.ok ? 'update' : 'current'
        if (r.ok) row.latest = String(next)
        return row
      }
      case 'irs_next_vintage': {
        // vintage "2022-23" -> probe countyinflow2324.csv
        const [a, b] = v.vintage.split('-')
        const probe = `${(parseInt(a) + 1) % 100}`.padStart(2, '0') + `${(parseInt(b) + 1) % 100}`.padStart(2, '0')
        const r = await fetchTimeout(`https://www.irs.gov/pub/irs-soi/countyinflow${probe}.csv`, 7000, { method: 'HEAD' })
        row.status = r.ok ? 'update' : 'current'
        if (r.ok) row.latest = `20${probe.slice(0, 2)}-${probe.slice(2)}`
        return row
      }
      case 'bps_next_year': {
        const next = parseInt(v.vintage) + 1
        const r = await fetchTimeout(`https://www2.census.gov/econ/bps/County/co${next}a.txt`, 7000, { method: 'HEAD' })
        row.status = r.ok ? 'update' : 'current'
        if (r.ok) row.latest = String(next)
        return row
      }
      case 'bea_modified': {
        // CAINC1 zip is republished when a new data year lands (~Nov). vintage =
        // the date we downloaded our copy; republished after that => newer data.
        const r = await fetchTimeout('https://apps.bea.gov/regional/zip/CAINC1.zip', 7000, { method: 'HEAD' })
        const lm = r.headers.get('last-modified')
        if (!lm) return row
        const lmDate = new Date(lm).toISOString().slice(0, 10)
        row.latest = lmDate
        row.status = lmDate > v.vintage ? 'update' : 'current'
        return row
      }
      case 'nri_modified': {
        const r = await fetchTimeout('https://www.arcgis.com/sharing/rest/content/items/39485e8035d446a5bff03259508ae355?f=json')
        if (!r.ok) return row
        const d: any = await r.json()
        if (!d?.modified) return row
        const mod = new Date(d.modified).toISOString().slice(0, 10)
        row.latest = mod
        row.status = mod > v.vintage ? 'update' : 'current'
        return row
      }
      case 'nfip_refresh': {
        const r = await fetchTimeout("https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=name%20eq%20%27FimaNfipClaims%27&$select=lastDataSetRefresh")
        if (!r.ok) return row
        const d: any = await r.json()
        const refresh = d?.OpenFemaDataSets?.[0]?.lastDataSetRefresh
        if (!refresh) return row
        row.latest = refresh.slice(0, 10)
        // NFIP refreshes ~monthly; only flag when meaningfully newer than our pull
        const days = (new Date(refresh).getTime() - new Date(v.vintage).getTime()) / 86_400_000
        row.status = days > 45 ? 'update' : 'current'
        return row
      }
      default:
        return row
    }
  } catch {
    return row
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const origin = new URL(req.url).origin
  let vintages: { generated: string; datasets: Vintage[] }
  try {
    vintages = await (await fetchTimeout(`${origin}/data-vintages.json`, 5000)).json()
  } catch {
    return new Response(JSON.stringify({ error: 'vintages manifest unavailable' }), { status: 503 })
  }

  const rows = await Promise.all(vintages.datasets.map(check))
  return new Response(
    JSON.stringify({ checkedAt: new Date().toISOString(), generated: vintages.generated, datasets: rows }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // CDN-cache 6h; serve stale while revalidating so users never wait on probes
        'Cache-Control': 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400',
      },
    },
  )
}

export const config: Config = {
  path: '/api/data-status',
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ['ip', 'domain'] },
}
