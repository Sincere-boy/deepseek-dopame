import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'vendor/harness')
if (!existsSync(resolve(root, 'dist/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))) {
  throw new Error('Prepare runtime first: npm run prepare:harness')
}
mkdirSync(resolve(root, 'dist'), { recursive: true })
cpSync(resolve(root, 'src/index.html'), resolve(root, 'dist/index.html'))
cpSync(resolve(root, 'src/desktop-layout.mjs'), resolve(root, 'dist/desktop-layout.mjs'))
cpSync(resolve(root, 'src/dopame.patch.yml'), resolve(root, 'dist/runtime/dopame.patch.yml'))
cpSync(resolve(root, 'src/backend/child-lifetime.mjs'), resolve(root, 'dist/runtime/dopame-child-lifetime.mjs'))
const install = process.env.ACDE_INSTALL ?? join(homedir(), '.acde')
writeFileSync(resolve(root, 'dist/runtime/dopame-acde.json'), JSON.stringify({
  project: root, command: join(install, 'bin', process.platform === 'win32' ? 'acde.exe' : 'acde'),
  // MCP's default child environment omits Unix session-discovery directories.
  environment: Object.fromEntries(['TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
}) + '\n')
cpSync(resolve(upstream, 'apps/web/dist/assets'), resolve(root, 'dist/assets'), { recursive: true })
