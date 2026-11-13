// Keep the original transcript scroller while replacing bottom-sticky layout,
// whose placement in acdert can leave the composer outside a resized viewport.
const style = document.createElement('style')
style.textContent = `
[data-dopame-composer-layout] > [data-composer-seat] {
  position: fixed !important;
  left: var(--dopame-composer-left) !important;
  width: var(--dopame-composer-width) !important;
  right: auto !important;
  bottom: 0 !important;
}
[data-dopame-composer-layout]::after {
  content: '';
  display: block;
  flex: 0 0 var(--dopame-composer-height);
}
`
document.head.append(style)
let current
let scheduled = false
const resize = new ResizeObserver(schedule)
function clear() {
  if (!current) return
  current.scroll.removeAttribute('data-dopame-composer-layout')
  resize.unobserve(current.scroll)
  resize.unobserve(current.seat)
  current = undefined
}
function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => { scheduled = false; layout() })
}
function layout() {
  const scroll = document.querySelector('[data-conversation-scroll]')
  const seat = scroll?.querySelector(':scope > [data-composer-seat]')
  if (!scroll || !seat) { clear(); return }
  if (current?.scroll !== scroll || current?.seat !== seat) {
    clear()
    current = { scroll, seat }
    resize.observe(scroll)
    resize.observe(seat)
  }
  const active = scroll.closest('[data-phase]')?.dataset.phase === 'active'
  const overlay = scroll.querySelector('[data-conversation-composer-overlay]')
  if (!active || overlay) {
    scroll.removeAttribute('data-dopame-composer-layout')
    return
  }
  const rect = scroll.getBoundingClientRect()
  scroll.style.setProperty('--dopame-composer-left', rect.left + 'px')
  scroll.style.setProperty('--dopame-composer-width', scroll.clientWidth + 'px')
  scroll.setAttribute('data-dopame-composer-layout', '')
  scroll.style.setProperty('--dopame-composer-height', seat.getBoundingClientRect().height + 'px')
}
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['data-phase', 'data-conversation-composer-overlay'],
})
window.addEventListener('resize', schedule)
schedule()

const { window: nativeWindow } = await import('acde:window')
nativeWindow.requestMode('free')
// A standalone run can persist screen-sized normal bounds. In a desktop,
// recover oversized restores into its reserved work area rather than the Dock.
function fitOversizedRestore() {
  if (nativeWindow.minimizable && nativeWindow.state === 'normal'
    && innerHeight > nativeWindow.output.workArea.height) nativeWindow.requestState('filled')
}
nativeWindow.on('output', fitOversizedRestore)
fitOversizedRestore()
