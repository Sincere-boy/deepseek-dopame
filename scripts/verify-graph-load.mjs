import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const install = process.env.ACDE_INSTALL ?? join(homedir(), '.acde')
const require = createRequire(join(install, 'current/lib/acde/package.json'))
const { Acde } = await import(pathToFileURL(require.resolve('acde/driver')).href)
const session = await Acde.attach({ cwd: process.cwd() })
const app = session.window({ app: 'deepseek-harness' })
async function until(read, accept) {
  const deadline = Date.now() + 15000
  do { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)) } while (Date.now() < deadline)
  assert.fail('等待工作区界面更新超时')
}
const ui = () => app.evaluate(`({options:Array.from(document.querySelectorAll('.gc select option')).map(e=>({id:e.value,text:e.textContent})),error:document.querySelector('.gc [role=alert]')?.textContent||'',empty:document.querySelector('.gc .empty')?.textContent||''})`)
try {
  await until(async () => {
    const notice = app.getByRole('button', { name: 'Continue', exact: true })
    if (await notice.isVisible()) await notice.click()
    return app.getByRole('button', { name: '协作工作区', exact: true }).isVisible()
  }, Boolean)
  const before = await app.evaluate("fetch('/api/graph-collaboration').then(r=>r.json())")
  assert.ok(before.rooms.length, '请先创建至少一个协作工作区')
  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  await until(ui, v => v.options.length === before.rooms.length + 1)
  const select = app.getByRole('combobox', { name: '选择协作工作区' })
  await select.selectOption(before.rooms[0].id)
  await app.evaluate(`(() => { if (!window.__graphOriginalFetch) { window.__graphOriginalFetch = window.fetch; window.fetch = (input, init) => { const url = typeof input === 'string' ? input : input.url; return window.__graphOffline && url.includes('/api/graph-collaboration') ? Promise.reject(new TypeError('Failed to fetch')) : window.__graphOriginalFetch(input, init) }; } window.__graphOffline = true; return true })()`)
  await app.getByRole('button', { name: '重新加载', exact: true }).click()
  const cached = await until(ui, v => v.error.includes('工作区加载失败'))
  assert.equal(cached.options.length, before.rooms.length + 1, '暂时断连不得清空已加载的列表')
  assert.ok(!cached.empty.includes('暂无协作工作区'))
  await app.evaluate('window.__graphOffline = false')
  await app.getByRole('button', { name: '重新加载', exact: true }).click()
  await until(ui, v => !v.error && v.options.length === before.rooms.length + 1)
  const after = await app.evaluate("fetch('/api/graph-collaboration').then(r=>r.json())")
  assert.deepEqual(after.rooms.map(r => r.id), before.rooms.map(r => r.id), '不得重新创建工作区')
  console.log(JSON.stringify({ workspaces: after.rooms.length, cachedListPreserved: true, failedLoadDistinguished: true,
    retryRecovered: true, staleErrorCleared: true, modelCalls: 0 }, null, 2))
} finally {
  await app.evaluate('(() => { if (window.__graphOriginalFetch) window.fetch = window.__graphOriginalFetch; delete window.__graphOriginalFetch; delete window.__graphOffline; return true })()').catch(() => {})
  await session.close()
}
