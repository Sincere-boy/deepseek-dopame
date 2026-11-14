import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise the deployed adapter and the real official bridge without model calls.
const require = createRequire(resolve('.acde/web/runtime/package.json'))
const load = async name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const { default: ToolRuntime } = await load('@deepseek-ai/dsh-tools')
const { createScope } = await load('@deepseek-ai/dsh-scope')
const { apply } = await load('@dopame/dsh-acde-mcp')
const directory = mkdtempSync(join(tmpdir(), 'dsh-mcp-qa-'))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await apply(ctx, { command: join(process.env.ACDE_INSTALL || join(homedir(), '.acde'), 'bin/acde'), env: {} })
const agents = []
let calls = 0
async function call(agent, name, args = {}) {
  const result = await ctx.tools.execute({ agent, name: 'mcp__acde__' + name, arguments: args,
    callId: 'qa-' + ++calls, signal: new AbortController().signal })
  assert.equal(result.isError, false, JSON.stringify(result.content))
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}
try {
  for (const marker of ['first', 'second']) {
    const cwd = join(directory, marker)
    mkdirSync(cwd)
    symlinkSync(resolve('node_modules'), join(cwd, 'node_modules'), 'dir')
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'dsh-mcp-isolation-qa', type: 'module', packageManager: 'npm@11.6.2' }))
    writeFileSync(join(cwd, 'acde.config.jsonc'), JSON.stringify({ type: 'app', id: 'dsh-mcp-isolation-qa',
      label: marker, entry: 'index.html', size: [400, 300], backend: { entry: 'server.mjs', port: 3000 } }))
    writeFileSync(join(cwd, 'index.html'), '<!doctype html><title>' + marker + '</title><p>' + marker + '</p>')
    writeFileSync(join(cwd, 'server.mjs'), `export default {fetch(){return new Response(${JSON.stringify(marker)})}}`)
    const agent = { session: { id: marker, header: { cwd } } }
    agent.ctx = createScope(ctx, agent).ctx
    agents.push(agent)
  }
  const assemblies = await Promise.all(agents.map(agent => ctx.systemPrompt.assemble({ agent, scope: agent })))
  for (const assembly of assemblies) assert.ok(assembly.tools.some(tool => tool.name === 'mcp__acde__start'), 'first request must include MCP tools')
  assert.equal(ctx.tools.schemas().filter(tool => tool.name.startsWith('mcp__acde__')).length, 0, 'no shared global MCP instance')
  const starts = await Promise.all(agents.map(agent => call(agent, 'start', { dirs: ['.'], headless: true })))
  assert.ok(starts[0].includes(agents[0].session.header.cwd), starts[0])
  assert.ok(starts[1].includes(agents[1].session.header.cwd), starts[1])
  // Obtain the exact eval field from the official schema (keeps this verifier
  // honest when installed acde versions change their argument spelling).
  const schema = assemblies[0].tools.find(tool => tool.name === 'mcp__acde__eval').parameters.properties
  const expressionKey = Object.keys(schema).find(key => ['expression', 'code', 'js'].includes(key))
  assert.ok(expressionKey, 'official eval expression parameter')
  const read = agent => call(agent, 'eval', { web: 'dsh-mcp-isolation-qa', [expressionKey]: "fetch('/api/check').then(r=>r.text())" })
  assert.ok((await read(agents[0])).includes('first'))
  assert.ok((await read(agents[1])).includes('second'))
  await call(agents[0], 'stop')
  assert.ok((await read(agents[1])).includes('second'), 'stopping one Agent must not disconnect another')
  await call(agents[1], 'stop')
  console.log(JSON.stringify({ firstRequestTools: assemblies.map(a => a.tools.length), relativeCwd: true,
    sameAppIdBackendsIsolated: true, stopIsolation: true, modelCalls: 0 }, null, 2))
} finally {
  await ctx.fiber.dispose()
  rmSync(directory, { recursive: true, force: true })
}
