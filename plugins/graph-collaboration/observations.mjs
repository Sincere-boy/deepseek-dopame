import { promptRequestId } from './events.mjs'

/** Only durable turn endings settle executions; liveness checks are separate. */
export function createSessionObserver({ store, controller, signal, dispatch, onActivity = () => {}, onError = error => console.error('Graph session observation failed:', error.message) }) {
  const observers = new Map()
  function observe(sessionId, roomId, role) {
    if (observers.has(sessionId)) return
    const state = { executionId: null, promise: null }
    observers.set(sessionId, state)
    state.promise = (async () => {
      for await (const frame of controller.follow({ address: { kind: 'session', sessionId }, maxMessages: 1000 }, signal)) {
        for (const item of frame.type === 'snapshot' ? frame.records : [frame]) {
          const event = item.event
          if (!event) continue
          onActivity(sessionId, event)
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
      }
    })().catch(error => { if (!signal.aborted) onError(error) })
      .finally(() => { if (!signal.aborted) observers.delete(sessionId) })
  }
  return { observe, settled: () => Promise.allSettled([...observers.values()].map(o => o.promise)) }
}
