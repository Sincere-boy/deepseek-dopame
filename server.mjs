import { createHarnessBridge } from './src/backend/bridge.mjs'
import { StringDecoder } from 'node:string_decoder'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const runtime = resolve(import.meta.dirname, '../web/runtime')
const preload = resolve(import.meta.dirname, 'acde-listen.js')
const data = process.env.ACDE_APP_DATA
if (!data) throw new Error('This backend must run inside acde')
mkdirSync(data, { recursive: true })
if (!existsSync(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('Packaged Harness runtime missing')

let token
const { promise: ready, resolve: markReady, reject: markFailed } = Promise.withResolvers()
// Retain startup failure for the page even when no request has arrived yet.
ready.catch(() => {})
const child = spawn(process.execPath, [
  '--import', preload, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  'web', '--patch', join(runtime, 'dopame.patch.yml'), '--port', '3080', '--trusted-host', 'acde.local', '--no-open',
], {
  cwd: data,
  env: { ...process.env, DSH_HOME: join(data, 'harness'), DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const startupTimer = setTimeout(() => {
  markFailed(new Error('Harness startup timed out'))
  child.kill('SIGTERM')
}, 60000).unref()
const decoder = new StringDecoder('utf8')
let pending = ''
child.stdout.on('data', chunk => {
  pending += decoder.write(chunk)
  let newline
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline)
    pending = pending.slice(newline + 1)
    const match = line.match(/dsh web: .*?[?&]token=([^\s]+)/)
    if (match) {
      token = match[1]
      clearTimeout(startupTimer)
      markReady()
      console.log('Harness profile ready')
    } else console.log(line)
  }
})
child.stderr.on('data', chunk => process.stderr.write(chunk))
child.on('error', error => { clearTimeout(startupTimer); markFailed(error) })
child.on('exit', (code, signal) => {
  clearTimeout(startupTimer)
  markFailed(new Error(`Harness stopped (${code ?? signal})`))
  // acdert owns backend restart policy; a dead Harness cannot keep serving.
  process.exit(code === 0 ? 0 : 1)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    child.kill(signal)
    setTimeout(() => { child.kill('SIGKILL'); process.exit(0) }, 2500).unref()
  })
}
createHarnessBridge({
  socketPath: join(process.env.ACDE_APP_SOCKETS, '3080.sock'), ready, launchToken: () => token,
  reportRejection: facts => console.error('Harness trust rejection', JSON.stringify(facts)),
}).listen(3000)
