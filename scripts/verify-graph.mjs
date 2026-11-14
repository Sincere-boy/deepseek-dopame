import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Inspect real, persisted executions without creating rooms or calling a model.
// Start the app first, then pass the id of a completed validation workspace.
const install = process.env.ACDE_INSTALL ?? join(homedir(), '.acde')
const require = createRequire(join(install, 'current/lib/acde/package.json'))
const { Acde } = await import(pathToFileURL(require.resolve('acde/driver')).href)
const session = await Acde.attach({ cwd: process.cwd() })
if (!(await session.windows()).some(w => w.app === 'deepseek-harness')) await session.open('deepseek-harness')
// Match by application: acdert assigns a new native window id on page reload.
const app = session.window({ app: 'deepseek-harness' })
const endpoint = '/api/graph-collaboration'
const read = id => app.evaluate(`fetch(${JSON.stringify(endpoint + (id ? '?roomId=' + encodeURIComponent(id) : ''))}).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() })`)
try {
  const { rooms } = await read()
  const roomId = process.argv[2] || rooms.find(r => r.name === '协作图端到端验证' && r.run?.status === 'completed')?.id
  assert.ok(roomId, '需要一个已完成的验证工作区：npm run test:graph -- <roomId> [截图路径]')
  const { room, events, deliveries } = await read(roomId)
  assert.equal(room.run?.status, 'completed', '请使用已完成的工作区，避免验证干扰活跃执行')
  assert.equal(new Set(Object.values(room.sessions)).size, room.graph.nodes.length + 1, '组织者和每个节点必须使用独立会话')
  assert.equal(new Set(events.map(e => e.seq)).size, events.length)
  const nodes = new Map(room.graph.nodes.map(n => [n.id, n]))
  let execution, report, expectedNode, transitions = 0, reworks = 0
  for (const event of events) {
    if (event.kind === 'run.started') {
      execution = event.data.execution.id; expectedNode = room.graph.entry; report = null
    } else if (event.kind === 'execution.retried') {
      execution = event.data.executionId; report = null
    } else if (['node.reported', 'node.human_requested'].includes(event.kind)) {
      assert.equal(event.data.nodeId, expectedNode, '节点不能跳过前序')
      if (execution) assert.equal(event.data.executionId, execution)
      const delivery = deliveries.find(d => d.execution_id === event.data.executionId)
      assert.ok(delivery, '节点报告必须对应持久化投递')
      assert.equal(delivery.session_id, room.sessions[event.data.nodeId], '报告与节点绑定会话一致')
      report = event.data
    } else if (event.kind === 'execution.finished' && event.data.completed && report && !report.human && ['running', 'completed'].includes(event.data.status)) {
      assert.equal(event.data.executionId, report.executionId)
      assert.equal(event.data.next, nodes.get(report.nodeId).outcomes[report.outcome], '结束后必须沿声明的边流转')
      if (event.data.next && room.graph.nodes.findIndex(n => n.id === event.data.next) <= room.graph.nodes.findIndex(n => n.id === report.nodeId)) reworks++
      expectedNode = event.data.next; report = null; execution = null; transitions++
    } else if (event.kind === 'delivery.accepted' && execution) {
      assert.equal(event.data.executionId, execution)
    }
  }
  assert.ok(transitions >= room.graph.nodes.length, '需要真实完成的节点执行记录')
  assert.ok(deliveries.every(d => d.status === 'accepted' || d.status === 'cancelled'))

  // Test the real admission route. Rejection must happen before prompt dispatch.
  const rpcId = randomUUID()
  const envelope = { type: 'client-request', rpcId, method: 'session/prompt', payload: { args: { request: {
    sessionId: room.sessions[room.graph.entry], requestId: randomUUID(), mode: 'queue',
    content: [{ type: 'text', text: '验证受管节点入口必须拒绝此消息。' }],
  } } } }
  const blocked = await app.evaluate(`fetch('/api/session/prompt', { method:'POST', headers:{'content-type':'application/json'}, body:${JSON.stringify(JSON.stringify(envelope))} }).then(r=>r.json())`)
  assert.equal(blocked.rpcId, rpcId)
  assert.equal(blocked.result.ok, false)
  assert.equal(blocked.result.error.code, 'graph/managed-session')

  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  await app.getByRole('combobox', { name: '选择协作工作区' }).selectOption(room.id)
  await app.getByRole('button', { name: '节点 ' + room.graph.nodes[0].label, exact: true }).click()
  const rendered = await app.evaluate(`(() => {
    const svg=document.querySelector('.gc svg');
    return { nodes:document.querySelectorAll('.gc .diagram button').length, paths:svg.querySelectorAll('path').length, text:svg.textContent, detail:document.querySelector('.gc .graph .detail').textContent };
  })()`)
  assert.equal(rendered.nodes, room.graph.nodes.length)
  assert.ok(rendered.paths >= room.graph.nodes.flatMap(n => Object.keys(n.outcomes)).length * 2)
  assert.ok(rendered.text.includes('完成'))
  assert.ok(rendered.detail.includes(room.graph.nodes[0].label + ' · 节点详情'))
  await app.getByRole('button', { name: '打开节点会话', exact: true }).click()
  await app.locator('[data-composer-input]').waitFor({ state: 'visible' })
  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  await app.getByRole('button', { name: '状态图', exact: true }).click()
  const screenshot = resolve(process.argv[3] || '/tmp/dsh-graph-validation.png')
  await app.screenshot({ path: screenshot })
  await app.reload()
  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  await app.getByRole('button', { name: '节点 ' + room.graph.nodes[0].label, exact: true }).waitFor({ state: 'visible' })
  const restored = await read(room.id)
  assert.deepEqual(restored.room.run, room.run, '页面重载不能改变后端执行状态')
  assert.equal(restored.events.length, events.length, '重载不能重复消费历史事件')
  console.log(JSON.stringify({ room: room.name, status: room.run.status, transitions, reworks,
    independentSessions: Object.keys(room.sessions).length, managedPrompt: 'rejected',
    graphNodes: rendered.nodes, openNodeSession: 'passed', reload: 'passed', screenshot }, null, 2))
} finally {
  await session.close()
}
