/** Runtime liveness is evidence about execution, never a business outcome. */
export class SessionHealth {
  constructor({ controller, rooms, agent = () => undefined, signal, now = Date.now, stallMs = 300000, timeoutMs = 5000 }) {
    Object.assign(this, { controller, rooms, agent, signal, now, stallMs, timeoutMs })
    this.rows = new Map(); this.queues = {}; this.jobs = {}
    this.activity = new Map(); this.idleSince = new Map()
    this.checkedAt = null; this.error = null; this.pending = null
  }
  activityAt(sessionId, event) {
    if (Number.isFinite(event.time)) this.activity.set(sessionId, Math.max(this.activity.get(sessionId) || 0, event.time))
  }
  async baseline(signal) {
    const stream = this.controller.control(signal)[Symbol.asyncIterator]()
    try {
      const first = await stream.next()
      if (first.done || first.value.type !== 'baseline') throw new Error('会话控制状态尚未就绪')
      return first.value.value
    } finally { await stream.return?.() }
  }
  refresh() {
    if (this.pending) return this.pending
    this.pending = this.read().finally(() => { this.pending = null })
    return this.pending
  }
  async read() {
    const abort = new AbortController(), cancel = () => abort.abort()
    this.signal.addEventListener('abort', cancel, { once: true })
    if (this.signal.aborted) cancel()
    const timer = setTimeout(cancel, this.timeoutMs)
    try {
      const [listed, control] = await Promise.all([this.controller.list({}, abort.signal), this.baseline(abort.signal)])
      abort.signal.throwIfAborted()
      this.rows = new Map(listed.items.map(row => [row.sessionId, row]))
      this.queues = control.queues; this.jobs = control.jobs
      this.checkedAt = this.now(); this.error = null
      const current = new Set()
      for (const room of this.rooms()) {
        if (room.run?.status !== 'running') continue
        const execution = room.run.execution
        current.add(execution.id)
        if (this.status(execution.sessionId).status === 'idle') {
          if (!this.idleSince.has(execution.id)) this.idleSince.set(execution.id, this.now())
        } else this.idleSince.delete(execution.id)
      }
      for (const id of this.idleSince.keys()) if (!current.has(id)) this.idleSince.delete(id)
    } catch (error) {
      this.error = error.message || '会话状态查询失败'
      this.idleSince.clear() // An outage is not evidence of continuous idleness.
    } finally {
      clearTimeout(timer); this.signal.removeEventListener('abort', cancel)
    }
  }
  status(sessionId) {
    const live = this.agent(sessionId)
    const fresh = this.checkedAt !== null && !this.error && this.now() - this.checkedAt < 15000
    const queued = Math.max((this.queues[sessionId] || []).length, (live?.inbox?.nextTurn?.length || 0) + (live?.inbox?.nextStep?.length || 0))
    const background = (this.jobs[sessionId] || []).filter(job => ['running', 'stopping'].includes(job.status)).length
    let status
    if (live?.status === 'running') status = 'running'
    else if (!fresh) status = 'unknown'
    else if (this.rows.get(sessionId)?.running === true) status = 'running'
    else if (queued) status = 'queued'
    else if (background) status = 'background'
    else if (!this.rows.has(sessionId) && !Object.hasOwn(this.queues, sessionId)) status = 'missing'
    else status = 'idle'
    return { status, queued: fresh ? queued : null, background: fresh ? background : null,
      checkedAt: this.checkedAt, error: fresh ? null : this.error || '会话状态尚未确认' }
  }
  forRoom(room) {
    return Object.fromEntries(Object.entries(room.sessions).map(([role, id]) => {
      const state = this.status(id), execution = room.run?.execution
      const since = execution?.sessionId === id ? this.idleSince.get(execution.id) : undefined
      const progress = Math.max(since || 0, this.activity.get(id) || 0, execution?.createdAt || 0)
      const stalled = room.run?.status === 'running' && execution.sessionId === id && execution.status !== 'queued'
        && state.status === 'idle' && since !== undefined && this.now() - progress >= this.stallMs
      return [id, { ...state, role, health: stalled ? 'stalled' : state.status === 'unknown' ? 'unknown' : state.status === 'missing' ? 'missing' : 'ok',
        idleSince: since ?? null, lastProgressAt: this.activity.get(id) ?? null }]
    }))
  }
  snapshot(rooms) { return Object.assign({}, ...rooms.map(room => this.forRoom(room))) }
}
