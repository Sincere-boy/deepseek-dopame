/** Read the caller-minted prompt identity from DSH's durable user-message event. */
export function promptRequestId(event) {
  return event.type === 'user/message' && event.data?.source?.kind === 'user'
    && typeof event.data.source.rpcId === 'string' ? event.data.source.rpcId : null
}
