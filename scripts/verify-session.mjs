import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const filename = process.argv[2]
if (!filename) throw new Error('Usage: node scripts/verify-session.mjs <validation-session.v3.jsonl.zstd>')
// Harness appends independent Zstandard frames; Node decodes one frame per call.
function readRows(path) {
  const source = readFileSync(path)
  const frames = []
  let offset = 0
  while (offset < source.length) {
    const decoded = zstdDecompressSync(source.subarray(offset), { info: true })
    assert.ok(decoded.engine.bytesWritten > 0, 'Decoder made no progress')
    frames.push(decoded.buffer)
    offset += decoded.engine.bytesWritten
  }
  return Buffer.concat(frames).toString().trim().split('\n').map(line => JSON.parse(line))
}
const rows = readRows(filename)
const names = new Map()
const passed = new Map()
const unexpectedErrors = []
let readGuardRejections = 0
for (const event of rows) {
  if (event.type === 'tool/call') names.set(event.data.callId, event.data.name)
  if (event.type !== 'tool/result') continue
  for (const result of event.data.message.content) {
    if (result.type !== 'tool-result') continue
    const name = names.get(result.toolCallId)
    if (!result.isError) passed.set(name, (passed.get(name) ?? 0) + 1)
    else if (name === 'edit' && JSON.stringify(result.content).includes('file has not been read')) readGuardRejections++
    else unexpectedErrors.push(name)
  }
}
const required = ['write', 'read', 'edit', 'bash', 'glob', 'grep', 'todo_write', 'web_fetch',
  'web_search', 'ask_user_question', 'job_list', 'job_output', 'present', 'workflow', 'list_agents', 'skill',
  'create_goal', 'get_goal', 'update_goal', 'job_kill', 'read_image', 'exit_plan_mode', 'subagent',
  'subagent_fork', 'send_message', 'interrupt_agent', 'ralph']
for (const name of required) assert.ok(passed.has(name), `No successful ${name} call recorded`)
const roster = rows.filter(row => row.type === 'request/header').at(-1).data.header.tools.map(tool => tool.name)
assert.deepEqual(new Set(roster), new Set(required), 'Validation must cover the complete Standard tool roster')
assert.deepEqual(unexpectedErrors, [], 'Unexpected failed tool calls')
const assistantText = rows.filter(row => row.type === 'assistant/message')
  .flatMap(row => row.data.message.content).filter(block => block.type === 'text')
  .map(block => block.text).join('\n')
for (const marker of ['DOPAME_HARNESS_OK', 'DOPAME_FILE_OK', 'DOPAME_EDIT_OK', 'DOPAME_SHELL_OK',
  'DOPAME_JOB_OK', 'INTERACTION_OK', 'DOPAME_WORKFLOW_OK', 'DOPAME_SKILL_OK']) {
  assert.ok(assistantText.includes(marker), `Missing assistant result ${marker}`)
}
assert.ok(rows.some(row => row.type === 'deliverables/presented'), 'No deliverable event recorded')
const group = dirname(dirname(filename))
const childTexts = []
for (const entry of readdirSync(group, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const path = join(group, entry.name, basename(filename))
  if (!existsSync(path) || path === filename) continue
  const child = readRows(path)
  if (child[0].parentSession !== rows[0].id) continue
  childTexts.push(child.filter(row => row.type === 'assistant/message')
    .flatMap(row => row.data.message.content).map(block => {
      if (block.type === 'text') return block.text
      if (block.type !== 'tool-call' || !['send_message', 'structured_output'].includes(block.name)) return ''
      const args = typeof block.arguments === 'string' ? JSON.parse(block.arguments) : block.arguments
      if (block.name === 'send_message' && args.agent_id === rows[0].id) return args.message
      if (block.name === 'structured_output' && args.status === 'complete') return args.summary
      return ''
    }).join('\n'))
}
for (const marker of ['SUBAGENT_READ_OK', 'SUBAGENT_FOLLOWUP_OK', 'FORK_RESUME_OK', 'RALPH_SMOKE_OK']) {
  assert.ok(childTexts.some(text => text.includes(marker)), `Missing actual child result ${marker}`)
}
// Report only names/counts, never prompts, credentials, file contents or raw events.
console.log(JSON.stringify({ events: rows.length, verifiedChildSessions: childTexts.length, passedTools: Object.fromEntries(passed),
  expectedReadGuardRejections: readGuardRejections, unexpectedErrors }, null, 2))
