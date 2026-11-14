import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { AgentMcpSessions } from './sessions.mjs'

export const name = 'dopame-acde-mcp'
export const inject = ['tools', 'agents', 'systemPrompt']

export async function apply(ctx, config) {
  const sessions = new AgentMcpSessions({ ...config,
    async mount(agent, options) {
      const fiber = agent.ctx.plugin(mcpClient, options)
      try { await fiber }
      catch (error) { await fiber.dispose(); throw error }
      return () => fiber.dispose()
    },
  })
  // Assembly collects schemas before agent/pre-step runs. On first use, await
  // discovery and rebuild that initial snapshot so the FIRST request has tools.
  // Later assemblies reuse the connection and take the ordinary waterfall path.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent
    if (agent?.session.header.cwd && !sessions.ready(agent)) {
      await sessions.ensure(agent)
      return ctx.systemPrompt.assemble(context)
    }
    return next()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    void sessions.disposeAgent(agent).catch(error => ctx.logger.warn('acde MCP cleanup failed: %s', error.message))
  })
  ctx.effect(() => () => sessions.dispose(), 'per-agent acde MCP connections')
}
