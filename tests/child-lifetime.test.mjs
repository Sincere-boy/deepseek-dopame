import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

async function child(t, shutdown) {
  const handle = spawn(process.execPath, ['--import',
    fileURLToPath(new URL('../src/backend/child-lifetime.mjs', import.meta.url)),
    '-e', `process.on('SIGTERM', () => { ${shutdown} }); console.log('ready'); setInterval(() => {}, 1000)`,
  ], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  t.after(() => { if (handle.exitCode === null && handle.signalCode === null) handle.kill('SIGKILL') })
  await once(handle.stdout, 'data')
  return handle
}

test('owner disconnect signals a graceful child shutdown', { timeout: 5000 }, async t => {
  const handle = await child(t, 'process.exit(0)')
  const exited = once(handle, 'exit')
  handle.disconnect()
  assert.deepEqual(await exited, [0, null])
})

test('owner disconnect bounds a child that ignores graceful shutdown', { timeout: 5000 }, async t => {
  const handle = await child(t, '')
  const exited = once(handle, 'exit')
  handle.disconnect()
  assert.deepEqual(await exited, [null, 'SIGKILL'])
})

test('owner can disappear before the preload finishes', { timeout: 5000 }, async t => {
  const handle = spawn(process.execPath, ['--import',
    fileURLToPath(new URL('../src/backend/child-lifetime.mjs', import.meta.url)),
    '-e', 'setInterval(() => {}, 1000)',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  t.after(() => { if (handle.exitCode === null && handle.signalCode === null) handle.kill('SIGKILL') })
  const exited = once(handle, 'exit')
  handle.disconnect()
  assert.deepEqual(await exited, [null, 'SIGTERM'])
})
