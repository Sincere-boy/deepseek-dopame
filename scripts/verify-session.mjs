import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const filename = process.argv[2]
if (!filename) throw new Error('Usage: node scripts/verify-session.mjs <validation-session.v3.jsonl.zstd>')
// Harness appends independent Zstandard frames; Node decodes one frame per call.
const source = readFileSync(filename)
const frames = []
let offset = 0
while (offset < source.length) {
  const decoded = zstdDecompressSync(source.subarray(offset), { info: true })
  assert.ok(decoded.engine.bytesWritten > 0, 'Decoder made no progress')
  frames.push(decoded.buffer)
  offset += decoded.engine.bytesWritten
}
const rows = Buffer.concat(frames).toString().trim().split('\n').map(line => JSON.parse(line))
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
  'web_search', 'ask_user_question', 'job_list', 'job_output', 'present', 'workflow', 'list_agents', 'skill']
for (const name of required) assert.ok(passed.has(name), `No successful ${name} call recorded`)
assert.deepEqual(unexpectedErrors, [], 'Unexpected failed tool calls')
const assistantText = rows.filter(row => row.type === 'assistant/message')
  .flatMap(row => row.data.message.content).filter(block => block.type === 'text')
  .map(block => block.text).join('\n')
for (const marker of ['DOPAME_HARNESS_OK', 'DOPAME_FILE_OK', 'DOPAME_EDIT_OK', 'DOPAME_SHELL_OK',
  'DOPAME_JOB_OK', 'INTERACTION_OK', 'DOPAME_WORKFLOW_OK', 'DOPAME_SKILL_OK']) {
  assert.ok(assistantText.includes(marker), `Missing assistant result ${marker}`)
}
assert.ok(rows.some(row => row.type === 'deliverables/presented'), 'No deliverable event recorded')
// Report only names/counts, never prompts, credentials, file contents or raw events.
console.log(JSON.stringify({ events: rows.length, passedTools: Object.fromEntries(passed),
  expectedReadGuardRejections: readGuardRejections, unexpectedErrors }, null, 2))
