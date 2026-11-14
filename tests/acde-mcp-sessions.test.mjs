import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { AgentMcpSessions } from '../plugins/acde-mcp/sessions.mjs'

const agent = cwd => ({ session: { header: { cwd } } })

test('MCP relative paths use the calling workspace; agents own distinct runtime namespaces', async () => {
  const mounted = []
  const sessions = new AgentMcpSessions({ command: 'acde', env: { TMPDIR: '/tmp', ACDE_APP_ID: 'deepseek-harness' },
    mount: async (subject, config) => { mounted.push({ subject, config }); return async () => {} },
  })
  try {
    const first = agent('/tmp/project-a'), second = agent('/tmp/project-b')
    await Promise.all([sessions.ensure(first), sessions.ensure(first), sessions.ensure(second)])
    assert.equal(mounted.length, 2)
    assert.equal(mounted[0].config.cwd, '/tmp/project-a')
    assert.equal(mounted[1].config.cwd, '/tmp/project-b')
    assert.notEqual(mounted[0].config.env.XDG_RUNTIME_DIR, mounted[1].config.env.XDG_RUNTIME_DIR)
    for (const { config } of mounted) {
      assert.equal(config.env.ACDE_APP_ID, '')
      assert.equal(config.env.ACDE_APP_SOCKETS, '')
      assert.equal(config.env.NODE_ENV, 'development')
      assert.equal(config.env.TMPDIR, '/tmp')
      assert.deepEqual(config.args, ['mcp'])
    }
    await sessions.disposeAgent(first)
    assert.equal(sessions.ready(first), false)
    assert.equal(sessions.ready(second), true)
    assert.equal(existsSync(mounted[0].config.env.XDG_RUNTIME_DIR), false)
    assert.equal(existsSync(mounted[1].config.env.XDG_RUNTIME_DIR), true)
    await assert.rejects(sessions.ensure(first), /disposed/)
  } finally { await sessions.dispose() }
  assert.equal(existsSync(mounted[1].config.env.XDG_RUNTIME_DIR), false)
})

test('failed discovery can retry without leaking its runtime directory', async () => {
  let attempts = 0, failedDirectory
  const sessions = new AgentMcpSessions({ command: 'acde', mount: async (_agent, config) => {
    if (!attempts++) { failedDirectory = config.env.XDG_RUNTIME_DIR; throw new Error('offline') }
    return async () => {}
  } })
  const subject = agent('/tmp/project')
  try {
    await assert.rejects(sessions.ensure(subject), /offline/)
    assert.equal(existsSync(failedDirectory), false)
    await sessions.ensure(subject)
    assert.equal(sessions.ready(subject), true)
  } finally { await sessions.dispose() }
})

test('disposal waits for in-flight discovery and disconnects it before deleting its directory', async () => {
  const gate = Promise.withResolvers()
  let disconnected = false, directory
  const sessions = new AgentMcpSessions({ command: 'acde', mount: async (_agent, config) => {
    directory = config.env.XDG_RUNTIME_DIR
    await gate.promise
    return async () => { assert.equal(existsSync(directory), true); disconnected = true }
  } })
  const mounting = sessions.ensure(agent('/tmp/project'))
  const closing = sessions.dispose()
  await assert.rejects(sessions.ensure(agent('/tmp/other')), /disposed/)
  gate.resolve()
  await Promise.all([mounting, closing])
  assert.equal(disconnected, true)
  assert.equal(existsSync(directory), false)
})

test('a session without a workspace cannot fall back to the hosting DSH project', async () => {
  const sessions = new AgentMcpSessions({ command: 'acde', mount: () => assert.fail('must not spawn') })
  await assert.rejects(sessions.ensure(agent(undefined)), /选择工作区/)
  await assert.rejects(sessions.ensure(agent('.')), /选择工作区/)
  await sessions.dispose()
})
