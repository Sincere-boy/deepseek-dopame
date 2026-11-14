import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'

const require = createRequire(join(process.env.ACDE_INSTALL ?? join(homedir(), '.acde'), 'current/lib/acde/package.json'))
const { Acde } = await import(pathToFileURL(require.resolve('acde/driver')).href)
const session = await Acde.attach({ cwd: process.env.DOPAME_PROJECT || process.cwd() })
const app = session.window({ app: 'deepseek-harness' })
const output = resolve(process.argv[3] || '/tmp/dsh-graph-layering')
mkdirSync(output, { recursive: true })
const results = []
const settle = () => app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
const original = await app.evaluate(`({room:localStorage.getItem('graph-room'),width:innerWidth,height:innerHeight})`)

async function check(name, form = false) {
  await settle()
  const facts = await app.evaluate(`(() => {
    const rect=e=>e.getBoundingClientRect(), root=document.querySelector('.gc'), body=root.querySelector(${JSON.stringify(form ? '.form' : '.body')});
    const b=rect(body), chrome=Array.from(root.querySelectorAll('header,.toolbar,.tabs')).filter(e=>e.getBoundingClientRect().height);
    const hits=[];
    function hit(e,clip){
      if(e.disabled||getComputedStyle(e).display==='none')return;
      // acdert may retain descendant rectangles under display:none containers.
      for(let p=e.parentElement;p&&p!==root;p=p.parentElement)if(getComputedStyle(p).display==='none')return;
      const r=rect(e), l=Math.max(r.left,clip.left),t=Math.max(r.top,clip.top),rr=Math.min(r.right,clip.right),bb=Math.min(r.bottom,clip.bottom);
      if(rr-l<8||bb-t<8)return;
      const target=document.elementFromPoint((l+rr)/2,(t+bb)/2);
      hits.push({label:e.getAttribute('aria-label')||e.textContent.slice(0,45)||e.tagName,ok:target===e||e.contains(target),rect:r.toJSON(),point:[(l+rr)/2,(t+bb)/2],coveredBy:target?.tagName+' '+target?.className+' '+target?.textContent.slice(0,55)});
    }
    const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
    for(const c of chrome)for(const e of c.querySelectorAll('button,select'))hit(e,viewport);
    const clipped={left:Math.max(b.left,0),top:Math.max(b.top,0),right:Math.min(b.right,innerWidth),bottom:Math.min(b.bottom,innerHeight)};
    for(const e of body.querySelectorAll('button,input,textarea,summary'))hit(e,clipped);
    return {hits,body:b.toJSON(),chromeBottom:Math.max(...chrome.map(e=>rect(e).bottom)),height:innerHeight,overflow:root.scrollWidth>root.clientWidth+1};
  })()`)
  assert.ok(facts.body.top >= facts.chromeBottom - 1, name + ': 滚动区域侵入顶部控件')
  assert.ok(facts.body.bottom <= facts.height + 1, name + ': 内容超出应用窗口')
  assert.equal(facts.overflow, false, name + ': 水平溢出')
  if (facts.hits.some(hit => !hit.ok)) { await app.screenshot({path:join(output,'failure.png')}); console.error(JSON.stringify({name,facts},null,2)) }
  for (const hit of facts.hits) assert.ok(hit.ok, `${name}: ${hit.label} 被 ${hit.coveredBy} 遮挡`)
  results.push({ name, checkedControls: facts.hits.length })
}
try {
  await app.getByRole('button', { name: '协作工作区', exact: true }).click()
  if (process.argv[2]) await app.getByRole('combobox', { name: '选择协作工作区' }).selectOption(process.argv[2])
  await app.getByRole('button', { name: '群聊与状态图', exact: true }).click()
  await app.restore()
  for (const [width, height] of [[1120, 600], [760, 520], [960, 600]]) {
    await app.resize(width, height)
    // The shared DSH sidebar animates at the compact/expanded breakpoint.
    await new Promise(resolve => setTimeout(resolve, 350))
    for (const outer of ['top', 'middle', 'composer', 'bottom']) {
      for (const inner of ['top', 'middle', 'bottom']) {
        await app.evaluate(`(() => {const b=document.querySelector('.gc .body'),m=document.querySelector('.gc .messages'),c=document.querySelector('.gc .chat');
          b.scrollTop=${outer === 'top' ? '0' : outer === 'middle' ? '180' : outer === 'composer' ? 'c.offsetHeight-110' : 'b.scrollHeight'};
          m.scrollTop=${inner === 'top' ? '0' : inner === 'middle' ? 'm.scrollHeight/2' : 'm.scrollHeight'};return true})()`)
        await check(`${width}x${height} outer:${outer} messages:${inner}`)
      }
    }
    await app.getByRole('button', { name: '状态图', exact: true }).click()
    await app.getByRole('button', { name: '节点 测试', exact: true }).click()
    await check(`${width}x${height} graph-only`)
    await app.screenshot({ path: join(output, `graph-${width}.png`) })
    await app.getByRole('button', { name: '群聊与状态图', exact: true }).click()
  }
  await app.fill()
  const combo = app.getByRole('combobox', { name: '选择协作工作区' })
  await combo.click(); await app.keyboard.press('Escape'); await check('workspace dropdown closed')
  await app.getByRole('button', { name: '新建工作区', exact: true }).click()
  await app.getByText('流程图配置', { exact: true }).click()
  for (const position of ['top', 'middle', 'bottom']) {
    await app.evaluate(`(() => {const f=document.querySelector('.gc .form');f.scrollTop=${position === 'top' ? '0' : position === 'middle' ? 'f.scrollHeight/2' : 'f.scrollHeight'};return true})()`)
    await check('creation form ' + position, true)
  }
  await app.getByRole('button', { name: '返回', exact: true }).click()
  if (original.room) await combo.selectOption(original.room)
  await app.getByRole('button', { name: '群聊与状态图', exact: true }).click()
  await app.evaluate("document.querySelector('.gc .body').scrollTop=0")
  await settle(); await app.screenshot({ path: join(output, 'workspace.png') })
  console.log(JSON.stringify({ passed: results.length, checkedControls: results.reduce((n,r)=>n+r.checkedControls,0), screenshots: output, modelCalls: 0 }, null, 2))
} finally { if (!process.env.DOPAME_KEEP_QA_SIZE) await app.fill(); await session.close() }
