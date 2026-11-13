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
const results = []
async function settle() {
  await app.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
}
async function check(name) {
  await settle()
  const geometry = await app.evaluate(`(async () => {
    const { window: native } = await import('acde:window')
    const seat = document.querySelector('[data-composer-seat]').getBoundingClientRect()
    const editor = document.querySelector('[data-composer-input]').getBoundingClientRect()
    const send = document.querySelector('button[aria-label="Send message"]')?.getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, workArea: native.output.workArea,
      seat: seat.toJSON(), editor: editor.toJSON(), send: send?.toJSON() }
  })()`)
  assert.ok(geometry.seat.bottom <= geometry.height + 1, `${name}: composer below viewport`)
  assert.ok(geometry.seat.top >= 0, `${name}: composer above viewport`)
  assert.ok(geometry.editor.bottom <= geometry.height, `${name}: editor clipped`)
  assert.ok(geometry.seat.left >= 0 && geometry.seat.right <= geometry.width, `${name}: composer width overflow`)
  if (geometry.send) assert.ok(geometry.send.bottom <= geometry.height, `${name}: send button clipped`)
  const frame = (await app.info()).rect
  const area = geometry.workArea
  assert.ok(frame[1] >= area.y - 1, `${name}: title bar hidden behind menu`)
  assert.ok(frame[1] + frame[3] <= area.y + area.height + 1, `${name}: window under Dock`)
  results.push({ name, viewport: [geometry.width, geometry.height], composerBottom: geometry.seat.bottom })
}
try {
  await app.restore()
  await check('normal')
  const before = await app.info()
  const chrome = before.rect[3] - await app.evaluate('innerHeight')
  await app.mouse.move(500, -chrome / 2)
  await app.mouse.down()
  await app.mouse.move(520, -chrome / 2)
  await app.mouse.up()
  const after = await app.info()
  assert.ok(Math.abs(after.rect[0] - before.rect[0]) > 1, 'title-bar drag did not move the window')
  results.push({ name: 'native title-bar drag', deltaX: after.rect[0] - before.rect[0] })
  for (const [width, height] of [[960, 520], [1120, 600]]) {
    await app.resize(width, height)
    for (const position of ['top', 'middle', 'bottom']) {
      await app.evaluate(`(() => { const s=document.querySelector('[data-conversation-scroll]');
        s.scrollTop=${position === 'top' ? '0' : position === 'middle' ? 's.scrollHeight / 2' : 's.scrollHeight'} })()`)
      await check(`${width}x${height} scroll ${position}`)
    }
  }
  await app.fill()
  await check('filled work area')
  await app.restore()
  await check('restored')
  const editor = app.locator('[data-composer-input]')
  await editor.click()
  await app.keyboard.insertText('窗口布局验证')
  assert.equal(await app.evaluate('document.querySelector("[data-composer-input]").textContent'), '窗口布局验证')
  await app.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await app.keyboard.press('Backspace')
  assert.equal(await app.evaluate('document.querySelector("[data-composer-input]").textContent'), '')
  console.log(JSON.stringify({ passed: results, input: 'Chinese text inserted and cleared without sending' }, null, 2))
} finally {
  await app.mouse.up()
  await session.close()
}
