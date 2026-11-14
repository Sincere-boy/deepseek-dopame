// acdert's contenteditable selection can be valid without a painted native
// caret. Render only its visual indicator; Lexical still owns editing/selection.
const selector = '[data-composer-input][contenteditable="true"]'
const style = document.createElement('style')
style.textContent = `
[data-dopame-caret-host] { caret-color: transparent !important; }
[data-dopame-caret] {
  position: fixed; width: 1px; pointer-events: none; z-index: 1000;
  animation: dopame-caret-blink 1s step-end infinite;
}
@keyframes dopame-caret-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { [data-dopame-caret] { animation: none; } }
`
document.head.append(style)
let caret, host, scheduled = false, resetBlink = false
const mutations = new MutationObserver(() => schedule(true))
const resize = new ResizeObserver(() => schedule())
function schedule(reset = false) {
  resetBlink ||= reset
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => { scheduled = false; update(); resetBlink = false })
}
function update() {
  const root = document.activeElement?.closest?.(selector)
  if (root !== host) {
    host?.removeAttribute('data-dopame-caret-host')
    mutations.disconnect()
    resize.disconnect()
    host = root
    if (host) {
      mutations.observe(host, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['contenteditable'] })
      resize.observe(host)
      resize.observe(host.parentElement)
    }
  }
  if (caret) caret.hidden = true
  const selection = getSelection()
  if (!host?.isConnected || !selection?.isCollapsed || !selection.rangeCount
    || !host.contains(selection.anchorNode)) return
  const bounds = host.getBoundingClientRect()
  const computed = getComputedStyle(host)
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  // An empty Lexical root has no line box yet. Its first line starts at padding.
  let left = rect.height > 0 ? rect.left : bounds.left + parseFloat(computed.paddingLeft)
  let top = rect.height > 0 ? rect.top : bounds.top + parseFloat(computed.paddingTop)
  let bottom = top + (rect.height || parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5)
  let clipTop = 0, clipBottom = innerHeight, clipLeft = 0, clipRight = innerWidth
  for (let parent = host; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent)
    const box = parent.getBoundingClientRect()
    if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
      clipTop = Math.max(clipTop, box.top); clipBottom = Math.min(clipBottom, box.bottom)
    }
    if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
      clipLeft = Math.max(clipLeft, box.left); clipRight = Math.min(clipRight, box.right)
    }
  }
  top = Math.max(top, clipTop); bottom = Math.min(bottom, clipBottom)
  if (bottom <= top || left < clipLeft || left >= clipRight) return
  if (!caret?.isConnected) {
    caret = document.createElement('div')
    caret.setAttribute('data-dopame-caret', '')
    caret.setAttribute('aria-hidden', 'true')
    document.body.append(caret)
  }
  host.setAttribute('data-dopame-caret-host', '')
  Object.assign(caret.style, { left: left + 'px', top: top + 'px', height: (bottom - top) + 'px',
    backgroundColor: computed.getPropertyValue('--dsw-alias-state-business-primary').trim() || computed.color })
  caret.hidden = false
  if (resetBlink) {
    caret.style.animation = 'none'
    void caret.offsetWidth
    caret.style.animation = ''
  }
}
for (const name of ['focusin', 'focusout', 'selectionchange', 'input', 'keyup', 'pointerup', 'compositionend']) {
  document.addEventListener(name, () => schedule(true))
}
document.addEventListener('scroll', () => schedule(), true)
window.addEventListener('resize', () => schedule())
window.addEventListener('focus', () => schedule(true))
window.addEventListener('blur', () => { if (caret) caret.hidden = true })
