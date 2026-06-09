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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devScoreApi()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
})
