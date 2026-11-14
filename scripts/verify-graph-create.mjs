import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'

// Exercise real form submission, including native validation compatibility.
// Creates one idle workspace in the app's test directory; never calls a model.
const install = process.env.ACDE_INSTALL ?? join(homedir(), '.acde')
const require = createRequire(join(install, 'current/lib/acde/package.json'))
const { Acde } = await import(pathToFileURL(require.resolve('acde/driver')).href)
const session = await Acde.attach({ cwd: process.cwd() })
if (!(await session.windows()).some(w => w.app === 'deepseek-harness')) await session.open('deepseek-harness')
const app = session.window({ app: 'deepseek-harness' })
const graph = { version: 1, entry: 'product', nodes: [
  { id: 'product', label: '产品', instructions: '明确需求、约束和验收标准；关键需求不明确时请求人工确认。', outcomes: { ready: 'develop' } },
  { id: 'develop', label: '开发', instructions: '依据产品需求实现功能并自测；修复测试退回的问题，提供验证证据。', outcomes: { ready: 'test' } },
  { id: 'test', label: '测试', instructions: '按验收标准测试；通过则结束，失败则提供复现步骤并退回开发。', outcomes: { pass: null, fail: 'develop' } },
] }
const name = '产品开发测试 · 表单验证 ' + Date.now()
const cwd = resolve(process.argv[2] || join(homedir(), '.local/share/acde/apps/deepseek-harness/graph-validation-workspace'))
mkdirSync(cwd, { recursive: true })
async function until(read, accept) {
  const deadline = Date.now() + 10000
  let value
  do {
    value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  assert.fail('等待界面更新超时：' + JSON.stringify(value))
}
const errorText = () => app.evaluate("document.querySelector('.gc [role=alert]')?.textContent || ''")
try {
  await app.fill()
  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  await app.getByRole('button', { name: '新建工作区', exact: true }).click()
  const title = app.getByRole('textbox', { name: '工作区名称', exact: true })
  const directory = app.getByRole('textbox', { name: '项目工作目录', exact: true })
  const submit = app.getByRole('button', { name: '创建并绑定会话', exact: true })
  await title.fill(''); await directory.fill(''); await submit.click()
  await until(errorText, text => text.includes('工作区名称和项目工作目录'))
  await title.fill(name); await submit.click()
  await until(errorText, text => text === '请填写项目工作目录。')
  await directory.fill(cwd)
  await app.getByText('流程图配置', { exact: true }).click()
  const config = app.getByRole('textbox', { name: '流程图配置', exact: true })
  await config.fill('{'); await submit.click()
  await until(errorText, text => text.includes('不是有效 JSON'))
  assert.equal(await title.value(), name, '校验失败不能清空用户输入')
  const invalid = structuredClone(graph); invalid.nodes[0].outcomes.ready = 'missing'
  await config.fill(JSON.stringify(invalid, null, 2)); await submit.click()
  await until(errorText, text => text.includes('流转目标不存在'))
  const before = await app.evaluate("fetch('/api/graph-collaboration').then(r=>r.json()).then(d=>d.rooms.length)")
  await config.fill(JSON.stringify(graph, null, 2)); await submit.click()
  await app.locator('.gc form').waitFor({ state: 'hidden' })
  const room = await until(() => app.evaluate(`fetch('/api/graph-collaboration').then(r=>r.json()).then(d=>d.rooms.find(r=>r.name===${JSON.stringify(name)}))`), value => value?.ready)
  assert.equal(Object.keys(room.sessions).length, 4)
  assert.equal(new Set(Object.values(room.sessions)).size, 4)
  assert.deepEqual(room.graph, graph)
  assert.equal(room.run, null, '创建会话不得启动模型任务')
  const after = await app.evaluate("fetch('/api/graph-collaboration').then(r=>r.json()).then(d=>d.rooms.length)")
  assert.equal(after, before + 1, '失败的表单提交不得创建工作区')
  await until(() => app.evaluate("document.querySelector('.gc .diagram button')?.getAttribute('aria-label')"), value => value === '节点 产品')
  const sizes = []
  await app.restore()
  for (const width of [1120, 760]) {
    await app.resize(width, 600)
    const geometry = await app.evaluate(`(() => {
      const chat=document.querySelector('.gc .chat'), graph=document.querySelector('.gc .graph');
      return {chat:chat.getBoundingClientRect().toJSON(),graph:graph.getBoundingClientRect().toJSON(),chatDisplay:getComputedStyle(chat).display,graphDisplay:getComputedStyle(graph).display};
    })()`)
    assert.ok(Math.abs(geometry.chat.left - geometry.graph.left) < 1)
    assert.ok(Math.abs(geometry.chat.width - geometry.graph.width) < 1)
    assert.ok(geometry.graph.top >= geometry.chat.bottom - 1, '状态图必须在群聊下方')
    assert.notEqual(geometry.chatDisplay, 'none'); assert.notEqual(geometry.graphDisplay, 'none')
    sizes.push(width)
  }
  await app.fill()
  console.log(JSON.stringify({ roomId: room.id, room: name, validation: ['empty fields', 'missing directory', 'invalid JSON', 'invalid graph'],
    nativeFormSubmit: 'passed', independentSessions: 4, layout: 'vertical', verifiedWidths: sizes, modelCalls: 0 }, null, 2))
} finally {
  await session.close()
}
