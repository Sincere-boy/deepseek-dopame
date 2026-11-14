import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { GraphStore, DEFAULT_GRAPH } from './store.mjs'
import { promptRequestId } from './events.mjs'

export const name = 'graph-collaboration'
export const inject = ['connection', 'sessionController', 'sessions', 'agents', 'tools']

/** Host-owned collaboration events and dispatch; Client code only requests commands. */
export async function apply(ctx) {
  const directory = join(process.env.DSH_HOME, 'graph-collaboration')
  mkdirSync(directory, { recursive: true })
  const store = new GraphStore(join(directory, 'graph.sqlite'))
  const abort = new AbortController()
  let dispatching = false, dispatchSettled = Promise.resolve()
  const observers = new Map()

  function owner(sessionId) {
    const room = store.list().find(r => Object.values(r.sessions).includes(sessionId))
    if (!room) throw new Error('此会话未加入协作工作区')
    return room
  }
  async function prompt(sessionId, text, requestId = randomUUID()) {
    return ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue',
      content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' }, abort.signal)
  }
  async function provision(room) {
    const listed = await ctx.sessionController.list({})
    const ids = new Set((listed.sessions ?? listed.items ?? []).map(s => s.id ?? s.sessionId))
    for (const [role, sessionId] of Object.entries(room.sessions)) {
      if (!ids.has(sessionId)) {
        const created = await ctx.sessionController.create({ sessionId, cwd: room.cwd, agentPreset: 'standard' })
        if (created.sessionId !== sessionId) throw new Error('会话标识冲突，拒绝替换已绑定会话')
        await ctx.sessionController.rename({ sessionId, title: `${room.name} · ${role === 'organizer' ? '组织者' : room.graph.nodes.find(n => n.id === role).label}` })
      }
      observe(sessionId, room.id, role)
    }
    return store.provisioned(room.id)
  }
  function observe(sessionId, roomId, role) {
    if (observers.has(sessionId)) return
    const promise = (async () => {
      for await (const frame of ctx.sessionController.follow({ address: { kind: 'session', sessionId }, maxMessages: 1000 }, abort.signal)) {
        const entries = frame.type === 'snapshot' ? frame.records : [frame]
        for (const item of entries) {
          const event = item.event ?? (item.type === 'event' ? item.event : null)
          if (!event) continue
          if (event.type === 'assistant/message') {
            const text = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
            if (text.trim()) store.message(roomId, { commandId: `session:${sessionId}:${event.seq}`, actor: role, text })
          }
          // Only an end belonging to the dispatched prompt may settle that execution.
          // The exact association is recovered from durable user-message source ids.
          if (event.type === 'user/message') {
            const execution = store.get(roomId).run?.execution
            if (execution?.sessionId === sessionId && promptRequestId(event) === execution.id) {
              observers.get(sessionId).executionId = execution.id
            }
          }
          if (event.type === 'turn/end') {
            const executionId = observers.get(sessionId)?.executionId
            if (executionId) {
              store.finish(sessionId, executionId, event.data.reason.kind === 'completed')
              observers.get(sessionId).executionId = null
              void dispatch()
            }
          }
        }
        if (frame.type === 'snapshot') {
          const executionId = observers.get(sessionId)?.executionId
          // A cold persisted turn without an end has no surviving executor.
          // Preserve its evidence and require an explicit retry with a new id.
          if (!ctx.agents.get(sessionId)) {
            if (executionId) store.finish(sessionId, executionId, false)
            else store.executorLost(sessionId)
            observers.get(sessionId).executionId = null
          }
        }
      }
    })().catch(error => {
      if (!abort.signal.aborted) console.error('Graph session observation failed:', error.message)
    })
    observers.set(sessionId, { promise, executionId: null })
  }
  async function dispatch() {
    if (dispatching || abort.signal.aborted) return
    dispatching = true
    const completion = Promise.withResolvers()
    dispatchSettled = completion.promise
    try {
      for (const row of store.pending()) {
        if (abort.signal.aborted) break
        const room = store.get(row.room_id)
        if (room.run?.status !== 'running' || room.run.execution.id !== row.execution_id) continue
        observe(row.session_id, room.id, room.run.activeNode)
        try { await prompt(row.session_id, row.content, row.id); store.accepted(row.id) }
        catch (error) { store.uncertain(row.id, error.message) }
      }
    } finally { dispatching = false; completion.resolve() }
  }

  for (const human of [false, true]) ctx.tools.register(defineTool({
    name: human ? 'graph_request_human' : 'graph_report_result',
    description: human ? '请求人工处理当前协作节点的问题，等待当前轮次结束后暂停流程。' : '提交当前协作节点的业务结果；后端校验会话身份、执行标识和结果，当前轮次结束后才流转。',
    parameters: {
      execution_id: { type: 'string', required: true, description: '任务消息中给出的本次执行标识。' },
      ...human ? {} : { outcome: { type: 'string', required: true, description: '任务消息中允许的结果之一。' } },
      summary: { type: 'string', required: true, description: human ? '问题、选项和需要人工决定的事项。' : '结果摘要与实际验证证据。' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if (!exec.agent) throw new Error('必须由实际执行节点的会话调用')
      store.report(exec.agent.session.id, { executionId: args.execution_id, outcome: args.outcome, summary: args.summary, human })
      return Promise.resolve({ accepted: true, message: '已记录，当前轮次结束后由后端处理。' })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'graph_get_status', description: '查看所属协作工作区的任务、节点状态和最近流程事件，不启动或改变执行。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(_args, exec) {
      const room = owner(exec.agent?.session.id)
      return Promise.resolve({ name: room.name, graph: room.graph, run: room.run, events: store.events(room.id).filter(e => e.kind !== 'chat.message').slice(-10) })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'graph_start_run', description: '组织者为所属协作工作区启动用户明确要求执行的任务。已有任务未结束时拒绝启动。',
    parameters: { task: { type: 'string', required: true, description: '完整任务与验收要求。' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      const room = owner(exec.agent?.session.id)
      if (room.sessions.organizer !== exec.agent?.session.id) throw new Error('只有组织者可启动任务')
      const state = store.start(room.id, { task: args.task, commandId: 'organizer:' + exec.callId })
      void dispatch()
      return Promise.resolve({ runId: state.run.id, activeNode: state.run.activeNode })
    },
  }))
  // Standard DSH clients post prompt commands through this authenticated route.
  // Owned node sessions accept execution only through this plugin's dispatcher.
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/session/prompt', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let rpcId = ''
      try {
        const envelope = await request.json()
        rpcId = envelope.rpcId
        if (envelope.type !== 'client-request' || envelope.method !== 'session/prompt' || typeof rpcId !== 'string') throw new Error('无效的会话请求')
        const command = envelope.payload?.args?.request
        const managed = store.list().find(room => Object.entries(room.sessions).some(([role, id]) => role !== 'organizer' && id === command?.sessionId))
        if (managed) return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: {
          code: 'graph/managed-session', message: '此会话由协作图调度，请在协作工作区发送任务或处理意见。', details: {},
        } } })
        const value = await ctx.sessionController.prompt(command, request.signal)
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
      } catch (error) {
        const failure = remoteErrorOf(error)
        return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: {
          code: failure?.code || 'gateway/bad-request', message: failure?.message || error.message, details: failure?.details || {},
        } } })
      }
    },
  }), 'graph-collaboration managed prompt admission')
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/graph-collaboration', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET') {
          const id = url.searchParams.get('roomId'), room = id ? store.get(id) : null
          return Response.json({ rooms: store.list(), room, defaultGraph: DEFAULT_GRAPH,
            events: id ? store.events(id, Number(url.searchParams.get('after') || 0)) : [], deliveries: id ? store.deliveries(id) : [] })
        }
        const body = await request.text()
        if (body.length > 150000) throw new Error('请求过大')
        const args = JSON.parse(body)
        let room
        if (args.action === 'create') room = await provision(store.create(args))
        else if (args.action === 'provision') room = await provision(store.get(args.roomId))
        else if (args.action === 'start') room = store.start(args.roomId, args)
        else if (args.action === 'resume') room = store.resume(args.roomId, args)
        else if (args.action === 'cancel') {
          room = store.cancel(args.roomId, args.commandId)
          await dispatchSettled
          const agent = ctx.agents.get(room.run.execution.sessionId)
          if (agent) for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
            if (message.source?.rpcId === room.run.execution.id) agent.inbox.remove(message.id)
          }
          const active = ctx.sessions.get(room.run.execution.sessionId)
          const listed = await ctx.sessionController.list({})
          const running = listed.items.find(item => item.sessionId === room.run.execution.sessionId)?.running
          if (active && running) ctx.sessionController.cancel({ sessionId: active.id })
          else store.finish(room.run.execution.sessionId, room.run.execution.id, false)
        } else if (args.action === 'chat') {
          room = owner(store.get(args.roomId).sessions.organizer)
          store.message(room.id, { commandId: args.commandId, actor: 'user', text: args.text })
          await prompt(room.sessions.organizer, `你是此协作工作区的组织者。理解用户需求、回答进展；用户明确要求执行时才调用 graph_start_run。节点由后端按冻结图派发。\n用户：${args.text}`, args.commandId)
        } else throw new Error('未知操作')
        void dispatch()
        return Response.json({ room })
      } catch (error) { return Response.json({ error: error.message }, { status: 400 }) }
    },
  }), 'graph-collaboration authenticated routes')
  for (const room of store.list()) if (room.ready) for (const [role, id] of Object.entries(room.sessions)) observe(id, room.id, role)
  const timer = setInterval(() => { void dispatch() }, 3000)
  ctx.effect(() => async () => {
    clearInterval(timer); abort.abort()
    await Promise.allSettled([...observers.values()].map(o => o.promise))
    await dispatchSettled
    store.close()
  }, 'graph-collaboration lifecycle')
  void dispatch()
}
