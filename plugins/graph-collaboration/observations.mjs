import { promptRequestId } from './events.mjs'

/** Follow durable session events; cold recovery applies only to startup work. */
export function createSessionObserver({ store, controller, agents, signal, dispatch, onError = error => console.error('Graph session observation failed:', error.message) }) {
  const observers = new Map()
  const recovery = new Map(store.list().filter(room => ['running', 'cancelling'].includes(room.run?.status))
    .map(room => [room.run.execution.sessionId, room.run.execution.id]))
  function observe(sessionId, roomId, role) {
    if (observers.has(sessionId)) return
    const state = { executionId: null, promise: null }
    observers.set(sessionId, state)
    state.promise = (async () => {
      for await (const frame of controller.follow({ address: { kind: 'session', sessionId }, maxMessages: 1000 }, signal)) {
        for (const item of frame.type === 'snapshot' ? frame.records : [frame]) {
          const event = item.event
          if (!event) continue
          if (event.type === 'assistant/message') {
            const text = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
            if (text.trim()) store.message(roomId, { commandId: `session:${sessionId}:${event.seq}`, actor: role, text })
          }
          if (event.type === 'user/message') {
            const execution = store.get(roomId).run?.execution
            if (execution?.sessionId === sessionId && promptRequestId(event) === execution.id) state.executionId = execution.id
          }
          if (event.type === 'turn/end' && state.executionId) {
            store.finish(sessionId, state.executionId, event.data.reason.kind === 'completed')
            state.executionId = null
            void dispatch()
          }
        }
        if (frame.type === 'snapshot') {
          const candidate = recovery.get(sessionId)
          recovery.delete(sessionId)
          // A snapshot may finish loading after a NEW prompt is admitted. The
          // absence of an Agent at that instant cannot prove that prompt died.
          // Only work already persisted when this observer started is eligible.
          if (candidate && store.get(roomId).run?.execution.id === candidate && !agents.get(sessionId)) {
            if (state.executionId === candidate) store.finish(sessionId, candidate, false)
            else store.executorLost(sessionId)
            state.executionId = null
          }
        }
      }
    })().catch(error => { if (!signal.aborted) onError(error) })
  }
  return { observe, settled: () => Promise.allSettled([...observers.values()].map(o => o.promise)) }
}
