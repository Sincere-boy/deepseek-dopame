import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GraphStore } from '../plugins/graph-collaboration/store.mjs'
import { createSessionObserver } from '../plugins/graph-collaboration/observations.mjs'

function fixture(t) {
  const store = new GraphStore(':memory:')
  t.after(() => store.close())
  const room = store.create({ name: '观察时序验证', cwd: '/tmp' })
  store.provisioned(room.id)
  return { store, room }
}
const user = execution => ({ event: { type: 'user/message', data: { source: { kind: 'user', rpcId: execution.id } } } })
const end = { type: 'event', event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } }
test('a delayed opening snapshot cannot interrupt work started after observer initialization', async t => {
  const { store, room } = fixture(t)
  const opening = Promise.withResolvers(), ending = Promise.withResolvers(), seen = Promise.withResolvers()
  const controller = { async *follow() { await opening.promise; yield { type: 'snapshot', records: [] }; seen.resolve(); await ending.promise; yield user(store.get(room.id).run.execution); yield end } }
  const observer = createSessionObserver({ store, controller, agents: new Map(), signal: new AbortController().signal, dispatch() {} })
  observer.observe(room.sessions.develop, room.id, 'develop')
  const execution = store.start(room.id, { task: '测试较慢的历史读取与任务派发交错', commandId: 'start' }).run.execution
  store.accepted(execution.id)
  opening.resolve(); await seen.promise
  assert.equal(store.get(room.id).run.status, 'running', '不能把正在派发的新任务误认为冷启动遗留执行')
  store.report(execution.sessionId, { executionId: execution.id, outcome: 'ready', summary: '有效测试结果' })
  ending.resolve(); await observer.settled()
  assert.equal(store.get(room.id).run.activeNode, 'review')
})
test('a cold snapshot without an executor cannot alone invalidate an accepted execution', async t => {
  const { store, room } = fixture(t)
  const execution = store.start(room.id, { task: '进程中断后的遗留执行', commandId: 'start' }).run.execution
  store.accepted(execution.id)
  const controller = { async *follow() { yield { type: 'snapshot', records: [user(execution)] } } }
  const observer = createSessionObserver({ store, controller, agents: new Map(), signal: new AbortController().signal, dispatch() {} })
  observer.observe(execution.sessionId, room.id, 'develop'); await observer.settled()
  assert.equal(store.get(room.id).run.status, 'running')
  assert.doesNotThrow(() => store.report(execution.sessionId, { executionId: execution.id, outcome: 'ready', summary: '仍可接受本次有效结果' }))
})
test('a surviving executor is not interrupted when a plugin observes its history again', async t => {
  const { store, room } = fixture(t)
  const execution = store.start(room.id, { task: '仍在运行的任务', commandId: 'start' }).run.execution
  store.accepted(execution.id)
  const controller = { async *follow() { yield { type: 'snapshot', records: [user(execution)] } } }
  const observer = createSessionObserver({ store, controller, agents: new Map([[execution.sessionId, {}]]), signal: new AbortController().signal, dispatch() {} })
  observer.observe(execution.sessionId, room.id, 'develop'); await observer.settled()
  assert.equal(store.get(room.id).run.status, 'running')
})
