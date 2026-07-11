import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

// Local-dev bridge: serve POST /api/score by running the SAME engine the Netlify
// `score` function uses, loaded through Vite's TS pipeline (no netlify-cli needed).
function devScoreApi(): Plugin {
  return {
    name: 'dev-score-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/score', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const mod = await server.ssrLoadModule('/netlify/functions/lib/compute.ts')
            res.end(JSON.stringify(mod.computeScore(raw ? JSON.parse(raw) : {})))
          } catch (e: unknown) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}

// Local-dev bridge for the Gate 1 endpoints: same engine module the Netlify
// function uses; `decide` responds persisted:false (no Supabase in plain vite dev).
function devGate1Api(): Plugin {
  return {
    name: 'dev-gate1-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/gate1', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const mod = await server.ssrLoadModule('/netlify/functions/lib/gate1/preview.ts')
            const payload = mod.computeGate1(raw ? JSON.parse(raw) : {})
            const decide = (req.url || '').includes('decide')
            res.end(JSON.stringify(decide
              ? { ...payload, persisted: false, warning: 'dev server — decision computed but NOT recorded' }
              : payload))
          } catch (e: unknown) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}

// Local-dev bridge for /api/extract — same extraction core as the Netlify
// function; without ANTHROPIC_API_KEY it returns the same clear 500 the
// deployed function would, so the UI's fallback path is honest in dev too.
function devExtractApi(): Plugin {
  return {
    name: 'dev-extract-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/extract', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const raw = Buffer.concat(chunks).toString('utf8')
            if (raw.length > 4_500_000) {
              res.statusCode = 413
              res.end(JSON.stringify({ error: 'Documents too large for sync extraction — compress the OM PDF below ~3MB' }))
              return
            }
            const mod = await server.ssrLoadModule('/netlify/functions/lib/gate1/extract-core.ts')
            const result = await mod.runExtraction(raw ? JSON.parse(raw) : {})
            res.end(JSON.stringify(result))
          } catch (e: unknown) {
            const err = e as Error & { status?: number }
            res.statusCode = err?.status ?? 500
            res.end(JSON.stringify({ error: err?.message ?? String(e) }))
          }
        })
      })
    },
  }
}

// Local-dev bridge for /api/macro/* — same pure compute + FRED fetch modules
// the Netlify function uses (real network fetches to FRED in dev). history is
// [] and overrides respond persisted:false — no Supabase in plain vite dev.
function devMacroApi(): Plugin {
  return {
    name: 'dev-macro-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/macro', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const sub = (req.url || '/').split('?')[0]
            if (sub.startsWith('/history')) { res.end('[]'); return }
            const fred = await server.ssrLoadModule('/netlify/functions/lib/gate1/fred.ts')
            const macro = await server.ssrLoadModule('/netlify/functions/lib/gate1/macro.ts')
            const { DEFAULT_CONFIG } = await server.ssrLoadModule('/netlify/functions/lib/gate1/preview.ts')
            const isOverride = sub.startsWith('/override')
            if (isOverride && req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return }
            const body = isOverride && raw ? JSON.parse(raw) : {}
            if (isOverride && (typeof body.note !== 'string' || !body.note.trim())) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Override requires a note — manual control is never silent' }))
              return
            }
            const ids: Record<string, string> = { ...macro.MARKET_SERIES }
            for (const def of DEFAULT_CONFIG.macro.signals ?? []) if (def.fred) ids[def.id] = def.fred
            const series = await fred.fetchSeriesMap(ids)
            const snapshot = macro.computeMacroSnapshot({
              config: DEFAULT_CONFIG,
              weekOf: new Date().toISOString().slice(0, 10),
              series,
              previous: null,
              manualValues: isOverride ? body.signalValues : undefined,
              forcedRegime: isOverride ? body.regime : undefined,
              source: isOverride ? 'manual' : 'auto',
              note: isOverride ? body.note.trim() : undefined,
            })
            const market = macro.buildMarketContext({
              sofr: series.sofr ?? [], mortgage30y: series.mortgage30y ?? [],
              treasury10y: series.treasury10y ?? [], sp500: series.sp500 ?? [],
            })
            res.end(JSON.stringify(isOverride
              ? { ...snapshot, market, persisted: false, warning: 'dev server — override computed but NOT recorded' }
              : { ...snapshot, market, live: true, persisted: false, sourceNote: 'computed live from FRED (dev server)' }))
          } catch (e: unknown) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}

// Local-dev bridge for /api/config/* — always version 0 (the shipped default);
// saving versions needs Supabase, so POST answers the same honest 503 as prod.
function devConfigApi(): Plugin {
  return {
    name: 'dev-config-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/config', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          void raw
          res.setHeader('Content-Type', 'application/json')
          try {
            if (req.method === 'POST') {
              res.statusCode = 503
              res.end(JSON.stringify({ error: 'Config versions need Supabase — export the draft instead' }))
              return
            }
            if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return }
            const { DEFAULT_CONFIG } = await server.ssrLoadModule('/netlify/functions/lib/gate1/preview.ts')
            const sub = (req.url || '/').split('?')[0]
            const zero = { version: 0, note: 'shipped default (default-config.json)', author: null, config: DEFAULT_CONFIG }
            if (sub === '/' || sub === '') { res.end(JSON.stringify([{ version: 0, note: zero.note, author: null }])); return }
            if (sub.startsWith('/active') || sub === '/0') { res.end(JSON.stringify(zero)); return }
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Config version not found (dev server has only version 0)' }))
          } catch (e: unknown) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devScoreApi(), devGate1Api(), devExtractApi(), devMacroApi(), devConfigApi()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
})
