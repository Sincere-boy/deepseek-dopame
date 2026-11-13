import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'vendor/harness')
if (!existsSync(resolve(upstream, 'apps/cli/lib/bin.js'))) {
  throw new Error('Build Harness first: npm run prepare:harness')
}
const runtime = resolve(root, 'dist/runtime')
rmSync(runtime, { recursive: true, force: true })
mkdirSync(resolve(root, 'dist'), { recursive: true })
const deploy = spawnSync('corepack', [
  'pnpm', '--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted', '--config.auto-install-peers=false',
  '--config.allow-unused-patches=true', runtime,
], { cwd: upstream, stdio: 'inherit' })
if (deploy.status !== 0) throw new Error('Harness runtime deployment failed')
// Deployment must supply workspace peers through one flat Cordis installation.
const packages = new Map()
for (const manifest of globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/*/package.json', 'native/system/package.json', 'native/system/packages/*/package.json'], { cwd: upstream })) {
  const value = JSON.parse(readFileSync(resolve(upstream, manifest), 'utf8'))
  packages.set(value.name, { value, dir: resolve(upstream, manifest, '..') })
}
const queue = ['@deepseek-ai/dsh']
const visited = new Set()
for (const name of queue) {
  if (visited.has(name)) continue
  visited.add(name)
  const pkg = packages.get(name)
  if (!pkg) continue
  const destination = resolve(runtime, 'node_modules', name)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(resolve(destination, '..'), { recursive: true })
  cpSync(pkg.dir, destination, { recursive: true, dereference: true,
    filter: path => !path.slice(pkg.dir.length).split('/').includes('node_modules') })
  queue.push(...Object.keys({ ...pkg.value.dependencies, ...pkg.value.peerDependencies }))
}
