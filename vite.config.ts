import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // For local dev, if we add API routes later, proxy here like crime-map
    // proxy: { '/api': 'http://localhost:8888' } // for netlify dev
  },
  build: {
    outDir: 'dist',
  },
})
