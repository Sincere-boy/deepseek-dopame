import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(join(process.env.ACDE_INSTALL ?? join(homedir(), '.acde'), 'current/lib/acde/package.json'))
const { Acde } = await import(pathToFileURL(require.resolve('acde/driver')).href)
const session = await Acde.attach({ cwd: process.cwd() })
const app = session.window({ app: 'deepseek-harness' })
const results = []
let originalSize, canClear = false
async function settle() {
  await app.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}
async function check(name) {
  await settle()
  const geometry = await app.evaluate(`(() => {
    const e = document.querySelector('[data-composer-input]'), c = document.querySelector('[data-dopame-caret]')
    const s = getSelection(), r = s.getRangeAt(0).getBoundingClientRect(), b = e.getBoundingClientRect()
    return { focused: document.activeElement === e, collapsed: s.isCollapsed, hidden: c?.hidden,
      caret: c?.getBoundingClientRect().toJSON(), range: r.toJSON(), input: b.toJSON(),
      width: innerWidth, height: innerHeight }
  })()`)
  assert.ok(geometry.focused && geometry.collapsed && !geometry.hidden, `${name}: caret should be visible`)
  assert.ok(geometry.caret.height > 0, `${name}: caret has no height`)
  assert.ok(geometry.caret.top >= 0 && geometry.caret.bottom <= geometry.height, `${name}: clipped caret`)
  assert.ok(geometry.caret.left >= geometry.input.left && geometry.caret.right <= geometry.input.right, `${name}: outside input`)
  if (geometry.range.height > 0) {
    assert.ok(Math.abs(geometry.range.left - geometry.caret.left) < 1, `${name}: wrong insertion position`)
    assert.ok(Math.abs(geometry.range.top - geometry.caret.top) < 1, `${name}: wrong line`)
  }
  results.push(name)
}
try {
  await app.focus()
  await app.locator('[data-composer-input]').waitFor({ state: 'visible' })
  assert.equal(await app.evaluate('document.querySelector("[data-composer-input]").textContent'), '', 'Keep the existing draft; run this check with an empty composer')
  canClear = true
  originalSize = await app.evaluate('({width:innerWidth,height:innerHeight})')
  const input = app.locator('[data-composer-input]')
  await input.click()
  await check('empty input')
  await app.keyboard.insertText('光标测试 ABC')
  assert.equal(await app.evaluate('document.querySelector("[data-composer-input]").textContent'), '光标测试 ABC')
  await check('Chinese and Latin text')
  const phases = new Set()
  for (let i = 0; i < 8; i++) {
    phases.add(await app.evaluate('getComputedStyle(document.querySelector("[data-dopame-caret]")).opacity'))
    await new Promise(resolve => setTimeout(resolve, 160))
  }
  assert.deepEqual([...phases].sort(), ['0', '1'], 'Caret must actually blink')
  results.push('visible and invisible blink phases')
  await app.evaluate(`(() => { const s=getSelection(); s.collapse(s.anchorNode, 2) })()`)
  await check('move within text')
  await app.keyboard.press('End')
  await app.keyboard.press('Shift+Enter')
  await app.keyboard.insertText('第二行')
  await check('second line')
  await app.keyboard.press('Control+a')
  await settle()
  assert.equal(await app.evaluate('document.querySelector("[data-dopame-caret]").hidden'), true, 'Selection must not display an insertion caret')
  results.push('text selection hides caret')
  await app.evaluate(`(() => { const s=getSelection(); s.collapse(s.focusNode, s.focusOffset) })()`)
  await check('collapse selection')
  await app.resize(960, 520)
  await check('window resize')
  await session.emulate({ reducedMotion: true })
  await settle()
  assert.equal(await app.evaluate('getComputedStyle(document.querySelector("[data-dopame-caret]")).animationName'), 'none')
  results.push('reduced motion uses steady caret')
  await session.emulate({ reducedMotion: false })
  await app.evaluate('document.querySelector("[data-composer-input]").blur()')
  await settle()
  assert.equal(await app.evaluate('document.querySelector("[data-dopame-caret]").hidden'), true)
  results.push('blur hides caret')
  console.log(JSON.stringify({ passed: results, sentMessages: 0 }, null, 2))
} finally {
  try {
    if (canClear) {
      await app.locator('[data-composer-input]').click()
      await app.keyboard.press('Control+a')
      await app.keyboard.press('Backspace')
      await session.emulate({ reducedMotion: false })
      if (originalSize) await app.resize(originalSize.width, originalSize.height)
    }
  } finally { await session.close() }
}
