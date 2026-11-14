import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphStore, DEFAULT_GRAPH, validateGraph } from '../plugins/graph-collaboration/store.mjs'
import { promptRequestId } from '../plugins/graph-collaboration/events.mjs'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-graph-'))
  let store = new GraphStore(join(dir, 'graph.sqlite'))
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  const room = store.create({ name: '登录开发', cwd: dir })
  store.provisioned(room.id)
  return { room, get store() { return store }, reopen() { store.close(); store = new GraphStore(join(dir, 'graph.sqlite')); return store } }
}
test('events, node activation and one stable outbox request survive a restart atomically', t => {
  const f = fixture(t)
  const run = f.store.start(f.room.id, { task: '修复登录', commandId: 'start-1' }).run
  f.store.start(f.room.id, { task: '修复登录', commandId: 'start-1' })
  assert.equal(f.store.pending().length, 1)
  const store = f.reopen()
  assert.equal(store.get(f.room.id).run.execution.id, run.execution.id)
  assert.equal(store.pending()[0].id, run.execution.id)
  assert.equal(store.events(f.room.id).filter(e => e.kind === 'run.started').length, 1)
})
test('retrying workspace creation preserves the same room and bound sessions', t => {
  const f = fixture(t)
  const args = { name: '创建重试', cwd: f.room.cwd, commandId: 'create-once' }
  const created = f.store.create(args)
  assert.deepEqual(f.reopen().create(args), created)
  assert.equal(f.store.list().length, 2)
  assert.equal(f.store.events(created.id).filter(e => e.kind === 'room.created').length, 1)
})
test('rejects wrong sessions, stale executions and outcomes outside the frozen graph', t => {
  const { room, store } = fixture(t)
  const execution = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  assert.throws(() => store.report(room.sessions.review, { executionId: execution.id, outcome: 'ready', summary: '伪造' }), /越权/)
  assert.throws(() => store.report(execution.sessionId, { executionId: 'old', outcome: 'ready', summary: '迟到' }), /过期/)
  assert.throws(() => store.report(execution.sessionId, { executionId: execution.id, outcome: 'pass', summary: '跳过评审' }), /不允许/)
  assert.equal(store.events(room.id).length, 3)
  assert.equal(store.get(room.id).run.activeNode, 'develop')
})
test('an explicit report waits for turn completion before the next prompt is created', t => {
  const { room, store } = fixture(t)
  const e = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  store.accepted(e.id)
  store.report(e.sessionId, { executionId: e.id, outcome: 'ready', summary: '修复并验证' })
  assert.equal(store.get(room.id).run.activeNode, 'develop')
  assert.equal(store.pending().length, 0)
  const next = store.finish(e.sessionId, e.id, true)
  assert.equal(next.run.activeNode, 'review')
  assert.equal(store.pending().length, 1)
  assert.equal(store.pending()[0].session_id, room.sessions.review)
  assert.equal(store.finish(e.sessionId, e.id, true), null)
})
test('rework follows the rejected edge and rejects results from a previous execution', t => {
  const { room, store } = fixture(t)
  let e = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  store.report(e.sessionId, { executionId: e.id, outcome: 'ready', summary: '第一次实现' })
  e = store.finish(e.sessionId, e.id, true).run.execution
  store.report(e.sessionId, { executionId: e.id, outcome: 'reject', summary: '缺少失败场景验证' })
  const rework = store.finish(e.sessionId, e.id, true).run
  assert.equal(rework.activeNode, 'develop')
  assert.equal(rework.nodeStates.develop, 'queued')
  assert.notEqual(rework.execution.id, e.id)
  assert.throws(() => store.report(e.sessionId, { executionId: e.id, outcome: 'pass', summary: '迟到评审' }), /过期/)
})
test('ordinary chat and an unreported turn cannot advance the workflow', t => {
  const { room, store } = fixture(t)
  const e = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  store.message(room.id, { commandId: 'chat', actor: 'develop', text: '我完成了' })
  assert.equal(store.get(room.id).run.activeNode, 'develop')
  store.finish(e.sessionId, e.id, true)
  assert.equal(store.get(room.id).run.status, 'needs_attention')
})
test('human handling and cancellation block a new run until terminal confirmation', t => {
  const { room, store } = fixture(t)
  const e = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  store.report(e.sessionId, { executionId: e.id, summary: '请确认需求', human: true })
  store.finish(e.sessionId, e.id, true)
  assert.equal(store.get(room.id).run.status, 'waiting_human')
  const retry = store.resume(room.id, { message: '按方案 A', commandId: 'answer' }).run.execution
  store.cancel(room.id, 'cancel')
  assert.throws(() => store.start(room.id, { task: '新任务', commandId: 'new' }), /尚未结束/)
  store.finish(retry.sessionId, retry.id, false)
  assert.equal(store.get(room.id).run.status, 'cancelled')
  assert.equal(store.pending().length, 0)
  assert.equal(store.start(room.id, { task: '新任务', commandId: 'new' }).run.status, 'running')
})
test('invalid graph edges and unreachable nodes fail before persistence', () => {
  const graph = structuredClone(DEFAULT_GRAPH)
  graph.nodes[0].outcomes.ready = 'missing'
  assert.throws(() => validateGraph(graph), /目标不存在/)
  graph.nodes[0].outcomes.ready = null
  assert.throws(() => validateGraph(graph), /无法到达/)
})
test('DSH user-message association uses source.rpcId, never text or assistant wrappers', () => {
  assert.equal(promptRequestId({ type: 'user/message', data: { source: { kind: 'user', rpcId: 'execution-1' }, content: [] } }), 'execution-1')
  assert.equal(promptRequestId({ type: 'user/message', data: { source: { kind: 'plugin', rpcId: 'execution-1' }, content: [] } }), null)
  assert.equal(promptRequestId({ type: 'assistant/message', data: { message: { source: { kind: 'user', rpcId: 'execution-1' } } } }), null)
  assert.equal(promptRequestId({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'execution-1' }] } }), null)
})
test('a lost accepted prompt pauses even if it crashed before its first durable message', t => {
  const f = fixture(t)
  const execution = f.store.start(f.room.id, { task: '修复登录', commandId: 'start' }).run.execution
  f.store.accepted(execution.id)
  const store = f.reopen()
  assert.equal(store.executorLost(execution.sessionId).run.status, 'needs_attention')
  assert.equal(store.pending().length, 0, '不得重放可能已经执行的副作用')
  assert.equal(store.executorLost(execution.sessionId), null)
  const retry = store.resume(f.room.id, { message: '已检查文件，请继续', commandId: 'retry' }).run.execution
  assert.notEqual(retry.id, execution.id)
  assert.equal(store.executorLost(retry.sessionId), null, '尚未受理的投递仍应正常派发')
  assert.equal(store.pending().length, 1)
})
test('a lost executor settles cancellation without requiring a durable prompt event', t => {
  const { room, store } = fixture(t)
  const execution = store.start(room.id, { task: '修复登录', commandId: 'start' }).run.execution
  store.cancel(room.id, 'cancel')
  assert.equal(store.executorLost(execution.sessionId).run.status, 'cancelled')
  assert.equal(store.pending().length, 0)
})
