import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { acquireHarnessLease } from '../src/backend/instance-lease.mjs'

test('a duplicate Harness is rejected before it can bind; independent data directories remain usable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lease-'))
  let first, other, restarted
  try {
    const path = join(directory, 'instance.sqlite')
    first = acquireHarnessLease(path)
    assert.throws(() => acquireHarnessLease(path), /已有运行中的实例/)
    other = acquireHarnessLease(join(directory, 'other.sqlite'))
    first.close(); first = null
    restarted = acquireHarnessLease(path)
  } finally { first?.close(); other?.close(); restarted?.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('an abruptly killed owner releases the Harness lease without stale PID cleanup', { timeout: 5000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lease-'))
  const path = join(directory, 'instance.sqlite')
  const moduleUrl = new URL('../src/backend/instance-lease.mjs', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {acquireHarnessLease} from ${JSON.stringify(moduleUrl)}; const db=acquireHarnessLease(${JSON.stringify(path)}); console.log('ready');setInterval(()=>{},1000)`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }) })
  await once(child.stdout, 'data')
  assert.throws(() => acquireHarnessLease(path), /已有运行中的实例/)
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
  const recovered = acquireHarnessLease(path)
  recovered.close()
})
