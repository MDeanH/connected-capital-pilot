// Use the app's automatic JSX runtime without tsx CLI IPC or browser services.
import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'cc-threshold-grid-'))
try {
  const output = join(temp, 'check.cjs')
  buildSync({ entryPoints: [join(root, 'scripts/check-threshold-grid.tsx')],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    packages: 'external', define: { 'import.meta.env.DEV': 'false' }, outfile: output })
  execFileSync(process.execPath, [output], {
    stdio: 'inherit', env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
  })
} finally {
  rmSync(temp, { recursive: true, force: true })
}
