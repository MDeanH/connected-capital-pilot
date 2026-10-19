// The Vercel Node builder typechecks api/*.ts with module NodeNext, which
// rejects this repo's .ts import specifiers, extensionless relative imports,
// and JSON imports. esbuild bundles the existing sources into one ESM
// function. A bracket catch-all file is built but not routed, so the function
// is api/gateway.js and vercel.json rewrites /api/* onto it.
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await build({
  entryPoints: ['./vercel/handler.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'api/gateway.js',
  packages: 'external',
  logLevel: 'info',
})

await rm('api/[...path].js', { force: true })
await rm('api/[...path].ts', { force: true })
