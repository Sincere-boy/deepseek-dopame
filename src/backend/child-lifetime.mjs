// The IPC channel closes even if the owner crashes or is killed. Give Harness
// its normal shutdown signal, then enforce acdert's bounded shutdown deadline.
if (typeof process.send === 'function') {
  const shutdown = () => {
    setTimeout(() => process.kill(process.pid, 'SIGKILL'), 2500).unref()
    process.kill(process.pid, 'SIGTERM')
  }
  if (process.connected) process.once('disconnect', shutdown)
  else shutdown()
}
