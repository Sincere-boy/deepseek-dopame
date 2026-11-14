import { mkdtempSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'

/** One official MCP connection, working directory and owned dev session per Agent. */
export class AgentMcpSessions {
  constructor({ command, env = {}, mount, temporaryRoot = process.platform === 'darwin' ? '/tmp' : tmpdir() }) {
    this.command = command
    this.env = env
    this.mount = mount
    this.temporaryRoot = temporaryRoot
    this.records = new Map()
    this.disposedAgents = new WeakSet()
    this.closed = false
  }

  ensure(agent) {
    if (this.closed || this.disposedAgents.has(agent)) return Promise.reject(new Error('acde MCP session is disposed'))
    const previous = this.records.get(agent)
    if (previous) return previous.ready
    const cwd = agent.session.header.cwd
    if (!cwd || !isAbsolute(cwd)) return Promise.reject(new Error('请先为会话选择工作区，再使用 acde 工具。'))
    const directory = mkdtempSync(join(this.temporaryRoot, 'dsh-mcp-'))
    // The official transport scrubs credentials but retains backend plumbing.
    // Nested acde processes must not inherit the hosting DSH's app identity.
    const env = { ...this.env, NODE_ENV: 'development', NODE_OPTIONS: '', XDG_RUNTIME_DIR: directory }
    for (const key of ['ACDE_APP_ID', 'ACDE_APP_DATA', 'ACDE_APP_SOCKETS', 'ACDE_APP_CHANNEL', 'ACDE_APP_CONTROL', 'PORT']) env[key] = ''
    const record = { directory }
    this.records.set(agent, record)
    record.ready = Promise.resolve().then(async () => {
      record.dispose = await this.mount(agent, {
        serverName: 'acde', transport: 'stdio', command: this.command, args: ['mcp'], cwd, env,
        toolCallTimeoutMs: 60000, failOnStartupError: true,
      })
      record.mounted = true
    }).catch(error => {
      if (this.records.get(agent) === record) this.records.delete(agent)
      rmSync(directory, { recursive: true, force: true })
      throw error
    })
    return record.ready
  }

  ready(agent) { return this.records.get(agent)?.mounted === true }

  async release(record) {
    await record.ready.catch(() => {})
    try { await record.dispose?.() }
    finally { rmSync(record.directory, { recursive: true, force: true }) }
  }

  async disposeAgent(agent) {
    this.disposedAgents.add(agent)
    const record = this.records.get(agent)
    this.records.delete(agent)
    if (record) await this.release(record)
  }

  async dispose() {
    this.closed = true
    const records = [...this.records.values()]
    this.records.clear()
    await Promise.all(records.map(record => this.release(record)))
  }
}
