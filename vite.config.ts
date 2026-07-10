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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devScoreApi(), devGate1Api(), devExtractApi()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
})
