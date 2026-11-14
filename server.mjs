import { createHarnessBridge } from './src/backend/bridge.mjs'
import { StringDecoder } from 'node:string_decoder'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, lstatSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const runtime = resolve(import.meta.dirname, '../web/runtime')
const acde = JSON.parse(readFileSync(join(runtime, 'dopame-acde.json'), 'utf8'))
const preload = resolve(import.meta.dirname, 'acde-listen.js')
const data = process.env.ACDE_APP_DATA
if (!data) throw new Error('This backend must run inside acde')
mkdirSync(data, { recursive: true })
// Local plugins resolve from the DSH profile, like an installed third-party
// dependency; their source remains part of the deployed application package.
const pluginTarget = join(runtime, 'node_modules/@dopame/dsh-graph-collaboration')
const pluginLink = join(data, 'harness/profiles/web/node_modules/@dopame/dsh-graph-collaboration')
mkdirSync(join(pluginLink, '..'), { recursive: true })
const existingPlugin = lstatSync(pluginLink, { throwIfNoEntry: false })
if (existingPlugin && (!existingPlugin.isSymbolicLink() || readlinkSync(pluginLink) !== pluginTarget)) {
  throw new Error('Graph plugin path conflicts with an existing profile dependency')
}
if (!existingPlugin) symlinkSync(pluginTarget, pluginLink, process.platform === 'win32' ? 'junction' : 'dir')
if (!existsSync(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('Packaged Harness runtime missing')
// Use the deployed Node package: JS bundlers turn ws's optional native
// accelerators into stubs that fail on larger masked frames.
process.env.WS_NO_BUFFER_UTIL = '1'
process.env.WS_NO_UTF_8_VALIDATE = '1'
const websocket = await import(/* @vite-ignore */ pathToFileURL(join(runtime, 'node_modules/ws/wrapper.mjs')).href)
// Generations must never unlink each other's Harness listen socket on reload.
const childSockets = mkdtempSync(join(tmpdir(), 'dsh-'))

let token
const { promise: ready, resolve: markReady, reject: markFailed } = Promise.withResolvers()
// Retain startup failure for the page even when no request has arrived yet.
ready.catch(() => {})
const child = spawn(process.execPath, [
  '--import', join(runtime, 'dopame-child-lifetime.mjs'), '--import', preload,
  join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  'web', '--patch', join(runtime, 'dopame.patch.yml'), '--port', '3080', '--trusted-host', 'acde.local', '--no-open',
], {
  cwd: data,
  env: { ...process.env, ACDE_APP_SOCKETS: childSockets, DSH_HOME: join(data, 'harness'), DSH_TELEMETRY_DISABLED: '1',
    DOPAME_ACDE_COMMAND: acde.command, DOPAME_ACDE_PROJECT: acde.project,
    DOPAME_ACDE_ENV: JSON.stringify(acde.environment) },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
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
process.on('exit', () => {
  if (child.connected) child.disconnect()
  else child.kill('SIGTERM')
  rmSync(childSockets, { recursive: true, force: true })
})
// Exit the old backend before acdert binds the new generation's public socket.
// The child supervises its own graceful shutdown through the IPC channel.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => process.exit(0))
createHarnessBridge({
  socketPath: join(childSockets, '3080.sock'), ready, launchToken: () => token, websocket,
  reportRejection: facts => console.error('Harness trust rejection', JSON.stringify(facts)),
}).listen(3000)
