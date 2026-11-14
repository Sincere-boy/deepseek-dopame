import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GraphStore } from '../plugins/graph-collaboration/store.mjs'
import { SessionHealth } from '../plugins/graph-collaboration/session-health.mjs'

function fixture(t) {
  const store = new GraphStore(':memory:'); t.after(() => store.close())
  const room = store.create({ name: '会话状态测试', cwd: '/tmp', graph: { version: 1, entry: 'test', nodes: [
    { id: 'test', label: '测试', instructions: '完成验收并提交 pass', outcomes: { pass: null } },
  ] } }); store.provisioned(room.id)
  const execution = store.start(room.id, { task: '状态检测', commandId: 'start' }).run.execution; store.accepted(execution.id)
  let time = Date.now(), running = false, queue = [], jobs = [], fail = false, present = true
  const controller = {
    async list() { if (fail) throw new Error('离线'); return { items: present ? [{ sessionId: execution.sessionId, running }] : [] } },
    async *control() { yield { type: 'baseline', value: { queues: present ? { [execution.sessionId]: queue } : {}, jobs: { [execution.sessionId]: jobs } } } },
  }
  const health = new SessionHealth({ controller, rooms: () => store.list(), signal: new AbortController().signal, now: () => time })
  const view = () => health.forRoom(store.get(room.id))[execution.sessionId]
  return { store, room, execution, health, view, advance(ms) { time += ms }, running(value) { running = value }, queue(value) { queue = value }, jobs(value) { jobs = value }, fail(value) { fail = value }, present(value) { present = value } }
}
test('a running role is never stalled merely because no business result arrived', async t => {
  const f = fixture(t); f.running(true); await f.health.refresh(); f.advance(600000); await f.health.refresh()
  assert.equal(f.view().status, 'running'); assert.equal(f.view().health, 'ok')
  assert.equal(f.store.get(f.room.id).run.status, 'running')
})
test('pending inbox messages and active background jobs both prevent idle recovery', async t => {
  const f = fixture(t); f.queue([{ rpcId: f.execution.id }]); await f.health.refresh()
  assert.equal(f.view().status, 'queued')
  f.queue([]); f.jobs([{ status: 'running' }]); await f.health.refresh(); f.advance(600000); await f.health.refresh()
  assert.equal(f.view().status, 'background'); assert.equal(f.view().health, 'ok')
})
test('continuous idle time raises a health warning while a late valid pass can still complete the graph', async t => {
  const f = fixture(t); await f.health.refresh(); f.advance(299999); await f.health.refresh()
  assert.equal(f.view().health, 'ok'); f.advance(2); await f.health.refresh()
  assert.equal(f.view().health, 'stalled'); assert.equal(f.store.get(f.room.id).run.status, 'running')
  assert.doesNotThrow(() => f.store.report(f.execution.sessionId, { executionId: f.execution.id, outcome: 'pass', summary: '迟到但有效的结果' }))
  assert.equal(f.store.finish(f.execution.sessionId, f.execution.id, true).run.status, 'completed')
})
test('a failed or stale state query remains unknown and cannot prove a stopped session', async t => {
  const f = fixture(t); await f.health.refresh(); f.advance(20000)
  assert.equal(f.view().status, 'unknown')
  f.fail(true); await f.health.refresh(); f.advance(600000); f.fail(false); await f.health.refresh()
  assert.equal(f.view().health, 'ok', '连接失败的时段不能算作持续空闲')
  assert.equal(f.store.get(f.room.id).run.status, 'running')
})
test('real progress resets the idle grace window and missing sessions are explicit', async t => {
  const f = fixture(t); await f.health.refresh(); f.advance(299000)
  f.health.activityAt(f.execution.sessionId, { time: Date.now() + 299000 }); await f.health.refresh(); f.advance(2000); await f.health.refresh()
  assert.equal(f.view().health, 'ok'); f.present(false); await f.health.refresh()
  assert.equal(f.view().status, 'missing'); assert.equal(f.store.get(f.room.id).run.status, 'running')
})
test('only an explicit verified idle recovery rotates the execution id, rejecting stale UI actions', async t => {
  const f = fixture(t); await f.health.refresh(); f.advance(300001); await f.health.refresh()
  assert.equal(f.view().health, 'stalled')
  assert.throws(() => f.store.resume(f.room.id, { message: '继续', commandId: 'retry' }), /无需恢复/)
  assert.throws(() => f.store.resume(f.room.id, { message: '继续', commandId: 'stale', executionId: 'old' }, { recoverIdle: true }), /执行已变化/)
  const next = f.store.resume(f.room.id, { message: '检查已有成果后继续', commandId: 'retry', executionId: f.execution.id }, { recoverIdle: true })
  assert.notEqual(next.run.execution.id, f.execution.id)
  assert.throws(() => f.store.report(f.execution.sessionId, { executionId: f.execution.id, outcome: 'pass', summary: '旧执行' }), /过期/)
})
