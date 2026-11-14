import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

export const DEFAULT_GRAPH = {
  version: 1, entry: 'develop', nodes: [
    { id: 'develop', label: '开发', instructions: '实现用户任务，并验证修改。', outcomes: { ready: 'review' } },
    { id: 'review', label: '评审', instructions: '审查实现与验证证据，指出具体问题。', outcomes: { pass: 'test', reject: 'develop' } },
    { id: 'test', label: '测试', instructions: '执行验收，检查正常与失败场景。', outcomes: { pass: null, fail: 'develop' } },
  ],
}

/** Validate a frozen, single-active-node graph. Cycles represent rework. */
export function validateGraph(graph) {
  if (!graph || !Number.isInteger(graph.version) || graph.version < 1 || !Array.isArray(graph.nodes)
    || !graph.nodes.length || graph.nodes.length > 20) throw new Error('图需要版本号和 1～20 个节点')
  const ids = new Set()
  for (const node of graph.nodes) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(node.id) || ids.has(node.id) || node.id === 'organizer') throw new Error('节点标识无效或重复')
    if (typeof node.label !== 'string' || !node.label.trim() || typeof node.instructions !== 'string') throw new Error('节点需要名称和职责')
    if (!node.outcomes || !Object.keys(node.outcomes).length || Object.keys(node.outcomes).some(key => !/^[a-z][a-z0-9_-]*$/.test(key))) throw new Error('节点需要合法的结果和流转定义')
    ids.add(node.id)
  }
  if (!ids.has(graph.entry)) throw new Error('入口节点不存在')
  for (const node of graph.nodes) for (const target of Object.values(node.outcomes)) {
    if (target !== null && !ids.has(target)) throw new Error('流转目标不存在')
  }
  const reached = new Set(), visit = id => {
    if (reached.has(id)) return
    reached.add(id)
    for (const target of Object.values(graph.nodes.find(n => n.id === id).outcomes)) if (target !== null) visit(target)
  }
  visit(graph.entry)
  if (reached.size !== ids.size) throw new Error('图中存在入口无法到达的节点')
  return structuredClone(graph)
}

/** SQLite owns events, materialized room state and the dispatch outbox atomically. */
export class GraphStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id), command_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(room_id,command_id));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), execution_id TEXT NOT NULL, session_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
      CREATE INDEX IF NOT EXISTS room_creation_command ON events(command_id) WHERE kind='room.created';`)
  }
  close() { this.db.close() }
  list() { return this.db.prepare('SELECT state FROM rooms ORDER BY rowid DESC').all().map(r => JSON.parse(r.state)) }
  get(id) {
    const row = this.db.prepare('SELECT state FROM rooms WHERE id=?').get(id)
    if (!row) throw new Error('协作工作区不存在')
    return JSON.parse(row.state)
  }
  events(id, after = 0) {
    return this.db.prepare('SELECT * FROM events WHERE room_id=? AND seq>? ORDER BY seq').all(id, after)
      .map(row => ({ seq: row.seq, kind: row.kind, data: JSON.parse(row.data), at: row.created_at }))
  }
  append(id, commandId, kind, data) {
    this.db.prepare('INSERT INTO events(room_id,command_id,kind,data,created_at) VALUES(?,?,?,?,?)')
      .run(id, commandId, kind, JSON.stringify(data), new Date().toISOString())
  }
  /** A repeated command has no second effect, including dispatch creation. */
  change(id, commandId, kind, fn) {
    if (typeof commandId !== 'string' || !commandId) throw new Error('缺少操作标识')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const room = this.get(id)
      if (!this.db.prepare('SELECT seq FROM events WHERE room_id=? AND command_id=?').get(id, commandId)) {
        const data = fn(room)
        this.append(id, commandId, kind, data)
        this.db.prepare('UPDATE rooms SET state=? WHERE id=?').run(JSON.stringify(room), id)
      }
      this.db.exec('COMMIT')
      return room
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  create({ name, cwd, graph = DEFAULT_GRAPH, commandId = randomUUID() }) {
    if (typeof name !== 'string' || !name.trim() || typeof cwd !== 'string' || !cwd.trim()) throw new Error('工作区需要名称和工作目录')
    if (typeof commandId !== 'string' || !commandId) throw new Error('缺少操作标识')
    const config = validateGraph(graph), id = randomUUID()
    const sessions = Object.fromEntries(['organizer', ...config.nodes.map(n => n.id)].map(key => [key, 'session-' + randomUUID()]))
    const room = { id, name: name.trim(), cwd, graph: config, sessions, ready: false, run: null }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare("SELECT room_id FROM events WHERE command_id=? AND kind='room.created'").get('create:' + commandId)
      if (existing) { const saved = this.get(existing.room_id); this.db.exec('COMMIT'); return saved }
      this.db.prepare('INSERT INTO rooms(id,state) VALUES(?,?)').run(id, JSON.stringify(room))
      this.append(id, 'create:' + commandId, 'room.created', { name: room.name, graph: config, sessions })
      this.db.exec('COMMIT'); return room
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  provisioned(id) { return this.change(id, 'provisioned', 'room.ready', room => { room.ready = true; return {} }) }
  /** Build the request and its stable requestId in the same transaction as activation. */
  activate(room, nodeId, context) {
    const node = room.graph.nodes.find(n => n.id === nodeId), id = randomUUID()
    const execution = { id, nodeId, sessionId: room.sessions[nodeId], status: 'queued', report: null }
    room.run.activeNode = nodeId
    room.run.execution = execution
    room.run.nodeStates[nodeId] = 'queued'
    const content = `你正在执行协作图的「${node.label}」节点。\n任务：${room.run.task}\n职责：${node.instructions}\n前序结果：${context || '无'}\n本次 execution_id：${id}\n允许结果：${Object.keys(node.outcomes).join(', ')}。\n完成工作后必须调用 graph_report_result，传入本次 execution_id、允许的 outcome 和证据摘要。需要人工决定时调用 graph_request_human。普通回复不会推进流程。不要直接唤醒其他节点或自行改变流程。`
    this.db.prepare('INSERT INTO outbox(id,room_id,execution_id,session_id,content,status) VALUES(?,?,?,?,?,?)')
      .run(id, room.id, id, execution.sessionId, content, 'pending')
  }
  start(id, { task, commandId }) {
    if (typeof task !== 'string' || !task.trim()) throw new Error('任务不能为空')
    return this.change(id, commandId, 'run.started', room => {
      if (!room.ready) throw new Error('会话尚未初始化')
      if (room.run && !['completed', 'cancelled'].includes(room.run.status)) throw new Error('当前任务尚未结束')
      room.run = { id: randomUUID(), task, status: 'running', activeNode: null, execution: null,
        nodeStates: Object.fromEntries(room.graph.nodes.map(n => [n.id, 'waiting'])) }
      this.activate(room, room.graph.entry, '')
      return { runId: room.run.id, task, execution: room.run.execution }
    })
  }
  /** Infer the node from the authenticated calling Session, never an actor argument. */
  report(sessionId, { executionId, outcome, summary, human = false }) {
    const room = this.list().find(r => Object.values(r.sessions).includes(sessionId))
    if (!room) throw new Error('此会话没有绑定协作节点')
    const current = room.run?.execution
    if (room.run?.status !== 'running' || !current || current.id !== executionId || current.sessionId !== sessionId) throw new Error('会话不属于当前有效执行，拒绝过期或越权提交')
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('需要结果摘要或人工问题')
    const node = room.graph.nodes.find(n => n.id === current.nodeId)
    if (!human && !Object.hasOwn(node.outcomes, outcome)) throw new Error('节点不允许此结果')
    if (current.report && JSON.stringify(current.report) !== JSON.stringify({ outcome, summary, human })) throw new Error('本轮结果已经提交，不能覆盖')
    return this.change(room.id, 'report:' + executionId, human ? 'node.human_requested' : 'node.reported', state => {
      state.run.execution.report = { outcome, summary, human }
      state.run.execution.status = 'finishing'
      state.run.nodeStates[current.nodeId] = 'finishing'
      return { executionId, nodeId: current.nodeId, outcome, summary, human }
    })
  }
  /** A result alone cannot advance the graph until its DSH turn actually ends. */
  finish(sessionId, executionId, completed) {
    const room = this.list().find(r => r.run?.execution?.id === executionId && r.run.execution.sessionId === sessionId)
    if (!room || !['running', 'cancelling'].includes(room.run.status)) return null
    return this.change(room.id, 'finished:' + executionId, 'execution.finished', state => {
      const run = state.run, execution = run.execution, report = execution.report
      if (run.status === 'cancelling') {
        execution.status = 'cancelled'; run.status = 'cancelled'; run.nodeStates[execution.nodeId] = 'cancelled'; run.activeNode = null
      } else if (!completed || !report) {
        execution.status = 'needs_attention'; run.status = 'needs_attention'; run.nodeStates[execution.nodeId] = 'needs_attention'
      } else if (report.human) {
        execution.status = 'waiting_human'; run.status = 'waiting_human'; run.nodeStates[execution.nodeId] = 'waiting_human'
      } else {
        run.nodeStates[execution.nodeId] = 'completed'
        const next = state.graph.nodes.find(n => n.id === execution.nodeId).outcomes[report.outcome]
        execution.status = 'completed'
        if (next === null) { run.status = 'completed'; run.activeNode = null }
        else this.activate(state, next, report.summary)
      }
      return { executionId, completed, next: run.activeNode, status: run.status }
    })
  }
  resume(id, { message, commandId }) {
    return this.change(id, commandId, 'execution.retried', room => {
      if (!room.run || !['needs_attention', 'waiting_human'].includes(room.run.status)) throw new Error('当前节点无需恢复')
      if (typeof message !== 'string' || !message.trim()) throw new Error('请提供处理意见')
      const previous = room.run.execution.id
      room.run.status = 'running'
      this.activate(room, room.run.activeNode, message)
      return { previous, executionId: room.run.execution.id, message }
    })
  }
  /** Called only after a cold history snapshot proves no executor survived. */
  executorLost(sessionId) {
    const room = this.list().find(r => ['running', 'cancelling'].includes(r.run?.status) && r.run.execution.sessionId === sessionId)
    if (!room) return null
    const delivery = this.db.prepare('SELECT status FROM outbox WHERE id=?').get(room.run.execution.id)
    // An accepted in-memory prompt may disappear before its first durable event.
    // Require explicit recovery instead of leaving it running or replaying effects.
    // A never-accepted pending delivery can still be dispatched normally.
    if (room.run.status !== 'cancelling' && delivery?.status !== 'accepted') return null
    return this.finish(sessionId, room.run.execution.id, false)
  }
  cancel(id, commandId) {
    return this.change(id, commandId, 'run.cancelled', room => {
      if (!room.run || ['completed', 'cancelled'].includes(room.run.status)) throw new Error('没有可取消的任务')
      room.run.status = 'cancelling'
      room.run.nodeStates[room.run.activeNode] = 'cancelling'
      this.db.prepare("UPDATE outbox SET status='cancelled' WHERE room_id=? AND status IN ('pending','uncertain')").run(id)
      return { runId: room.run.id, executionId: room.run.execution.id }
    })
  }
  pending() { return this.db.prepare("SELECT * FROM outbox WHERE status IN ('pending','uncertain') ORDER BY rowid").all() }
  accepted(id) {
    const delivery = this.db.prepare('SELECT * FROM outbox WHERE id=?').get(id)
    if (!delivery) throw new Error('投递不存在')
    return this.change(delivery.room_id, 'accepted:' + id, 'delivery.accepted', room => {
      this.db.prepare("UPDATE outbox SET status='accepted',error=NULL WHERE id=?").run(id)
      if (room.run?.execution.id === delivery.execution_id && room.run.status === 'running' && !room.run.execution.report) {
        room.run.execution.status = 'running'; room.run.nodeStates[room.run.activeNode] = 'running'
      }
      return { executionId: delivery.execution_id }
    })
  }
  uncertain(id, error) { this.db.prepare("UPDATE outbox SET status='uncertain',error=? WHERE id=? AND status<>'cancelled'").run(String(error), id) }
  deliveries(id) { return this.db.prepare('SELECT id,execution_id,session_id,status,error FROM outbox WHERE room_id=? ORDER BY rowid').all(id) }
  message(id, { commandId, actor, text }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('消息应为 1～100000 个字符')
    return this.change(id, commandId, 'chat.message', () => ({ actor, text }))
  }
}
