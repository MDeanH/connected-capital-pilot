// /api/address-intel?q=<address> — resolve a US street address to its market,
// plus true address-level intel for Miami-Dade County.
//
// Nationwide: US Census geocoder (free, no key) -> matched address, lat/lng,
// county + place names (the client maps those onto its market keys).
// Miami-Dade (county FIPS 12086), in parallel:
//   parcel  : Miami-Dade GIS point->FOLIO, then the Property Appraiser's
//             public proxy for assessed values, year built, zoning, size
//   flood   : FEMA NFHL flood zone + base flood elevation at the point
//   crime   : City of Miami NIBRS layer — incidents within 800m, last 180
//             days, by category (City of Miami jurisdiction only)
//
// All upstream sources are public, no-key endpoints. Responses are CDN-cached
// per address for 24h; per-IP rate limited.

import type { Config, Context } from '@netlify/functions'

const json = (status: number, obj: unknown, cache = false) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cache ? { 'Cache-Control': 'public, max-age=0, s-maxage=86400' } : {}),
    },
  })

async function fetchTimeout(url: string, ms = 9000, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function geocode(q: string) {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`
  const d: any = await (await fetchTimeout(url, 10_000)).json()
  const m = d?.result?.addressMatches?.[0]
  if (!m) return null
  const g = m.geographies ?? {}
  const county = g['Counties']?.[0]
  const place = g['Incorporated Places']?.[0]
  const state = (m.matchedAddress || '').split(',').slice(-2)[0]?.trim()
  return {
    matched: m.matchedAddress as string,
    lng: m.coordinates.x as number,
    lat: m.coordinates.y as number,
    countyName: county?.NAME as string | undefined,   // "Miami-Dade County"
    countyGeoid: county?.GEOID as string | undefined, // "12086"
    placeName: place?.NAME as string | undefined,     // "Miami city"
    stateAbbr: state && state.length === 2 ? state : (m.addressComponents?.state as string | undefined),
  }
}

async function parcelIntel(lng: number, lat: number, matchedAddress?: string) {
  const gis = `https://gisweb.miamidade.gov/arcgis/rest/services/AddressSearchMap_PropertiesWithZip/MapServer/1/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=30&units=esriSRUnit_Meter&outFields=FOLIO,address&returnGeometry=false&f=json`
  const g: any = await (await fetchTimeout(gis)).json()
  const feats: any[] = g?.features ?? []
  if (!feats.length) return null
  // prefer the parcel whose address starts with the queried house number —
  // a pure radius pick can land on the neighbor
  const houseNum = (matchedAddress || '').trim().split(/\s+/)[0]
  const best = (houseNum && feats.find(f => String(f.attributes?.address ?? '').trim().startsWith(houseNum))) || feats[0]
  const folio = best?.attributes?.FOLIO
  if (!folio) return null
  const pa: any = await (await fetchTimeout(
    `https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=${folio}`,
    10_000, { headers: { 'User-Agent': 'Mozilla/5.0' } },
  )).json()
  const info = pa?.PropertyInfo ?? {}
  const assess: any[] = pa?.Assessment?.AssessmentInfos ?? []
  assess.sort((a, b) => (b.Year ?? 0) - (a.Year ?? 0))
  const cur = assess[0] ?? {}
  const prev = assess.find(a => a.Year === (cur.Year ?? 0) - 1)
  return {
    folio,
    siteAddress: pa?.SiteAddress?.[0]?.Address ?? null,
    assessedYear: cur.Year ?? null,
    totalValue: cur.TotalValue ?? null,
    landValue: cur.LandValue ?? null,
    buildingValue: cur.BuildingOnlyValue ?? null,
    valueYoY: cur.TotalValue && prev?.TotalValue ? Math.round((cur.TotalValue / prev.TotalValue - 1) * 1000) / 1000 : null,
    yearBuilt: info.YearBuilt ?? null,
    floors: info.FloorCount ?? null,
    beds: info.BedroomCount ?? null,
    baths: info.BathroomCount ?? null,
    livingArea: info.BuildingActualArea ?? info.BuildingHeatedArea ?? null,
    lotSize: info.LotSize ?? null,
    zoning: info.PrimaryZoneDescription ?? null,
    landUse: info.DORDescription ?? null,
  }
}

async function floodIntel(lng: number, lat: number) {
  const url = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STATIC_BFE&returnGeometry=false&f=json`
  const d: any = await (await fetchTimeout(url)).json()
  const a = d?.features?.[0]?.attributes
  if (!a) return null
  return { zone: a.FLD_ZONE ?? null, subtype: a.ZONE_SUBTY ?? null, baseFloodElevFt: a.STATIC_BFE ?? null }
}

async function crimeNearby(lng: number, lat: number) {
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', distance: '800', units: 'esriSRUnit_Meter',
    where: `reportdate >= DATE '${since}'`,
    groupByFieldsForStatistics: 'nibrsdesc',
    outStatistics: '[{"statisticType":"count","onStatisticField":"OBJECTID","outStatisticFieldName":"n"}]',
    f: 'json',
  })
  const d: any = await (await fetchTimeout(
    `https://services1.arcgis.com/CvuPhqcTQpZPT9qY/arcgis/rest/services/Crimes_public_67c0535145c14baf897e47a8d4986539/FeatureServer/0/query?${params}`,
  )).json()
  const rows = (d?.features ?? [])
    .map((f: any) => ({ type: String(f.attributes?.nibrsdesc ?? '').replace(/\s+/g, ' ').trim() || 'Other', n: f.attributes?.n ?? 0 }))
    .sort((a: any, b: any) => b.n - a.n)
  if (!rows.length) return null
  return {
    radiusM: 800, days: 180,
    total: rows.reduce((s: number, r: any) => s + r.n, 0),
    top: rows.slice(0, 5),
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 200)
  if (q.length < 8) return json(400, { error: 'Provide a full street address' })

  let geo
  try {
    geo = await geocode(q)
  } catch {
    return json(502, { error: 'Geocoder unavailable — try again shortly' })
  }
  if (!geo) return json(404, { error: 'Address not found — include street, city and state' })

  const out: any = { ...geo, miamiDade: null }

  if (geo.countyGeoid === '12086') {
    const inMiamiCity = (geo.placeName || '').toLowerCase().startsWith('miami city')
    const [parcel, flood, crime] = await Promise.all([
      parcelIntel(geo.lng, geo.lat, geo.matched).catch(() => null),
      floodIntel(geo.lng, geo.lat).catch(() => null),
      inMiamiCity ? crimeNearby(geo.lng, geo.lat).catch(() => null) : Promise.resolve(null),
    ])
    out.miamiDade = { parcel, flood, crime }
  }

  return json(200, out, true)
}

export const config: Config = {
  path: '/api/address-intel',
  rateLimit: { windowSize: 60, windowLimit: 20, aggregateBy: ['ip', 'domain'] },
}
