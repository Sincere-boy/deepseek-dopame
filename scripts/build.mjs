import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'vendor/harness')
if (!existsSync(resolve(root, 'dist/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))) {
  throw new Error('Prepare runtime first: npm run prepare:harness')
}
mkdirSync(resolve(root, 'dist'), { recursive: true })
cpSync(resolve(root, 'src/index.html'), resolve(root, 'dist/index.html'))
cpSync(resolve(root, 'src/dopame.patch.yml'), resolve(root, 'dist/runtime/dopame.patch.yml'))
cpSync(resolve(root, 'src/backend/child-lifetime.mjs'), resolve(root, 'dist/runtime/dopame-child-lifetime.mjs'))
cpSync(resolve(upstream, 'apps/web/dist/assets'), resolve(root, 'dist/assets'), { recursive: true })
