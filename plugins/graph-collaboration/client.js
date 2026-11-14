window.__ModuleLoader__.load({ id: '@dopame/dsh-graph-collaboration', factory(require) {
  const { createElement: h, useEffect, useRef, useState } = require('react')
  const statusText = { waiting: '等待前序', queued: '待执行', running: '执行中', finishing: '正在收尾', completed: '已完成', needs_attention: '需要处理', waiting_human: '等待人工', cancelling: '正在取消', cancelled: '已取消' }
  const liveText = { running: '执行中', queued: '排队', background: '后台任务', idle: '空闲', missing: '会话缺失', unknown: '状态未知' }
  const css = `
  .gc{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#172033);font:14px system-ui}
  .gc *{box-sizing:border-box}
  .gc button,.gc input,.gc textarea,.gc select{font:inherit}
  .gc button{cursor:pointer;border:1px solid #dce1eb;background:#fff;color:#23304a;border-radius:8px;padding:8px 12px}
  .gc button:disabled{opacity:.5;cursor:default}
  .gc button.primary{background:#315ee8;color:#fff;border-color:#315ee8}
  .gc header{padding:20px 24px;border-bottom:1px solid #e9edf3;display:flex;align-items:center;gap:12px}
  .gc h2{font-size:20px;margin:0}
  .gc small{color:#718096}
  .gc .toolbar{display:flex;gap:8px;padding:12px 24px;border-bottom:1px solid #e9edf3;flex-wrap:wrap}
  .gc .tabs{display:flex;gap:8px;padding:8px 16px}
  .gc .body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto}
  .gc .chat{display:flex;flex-direction:column;flex:none;height:100vh;min-height:760px;width:100%;border-bottom:1px solid #e9edf3}
  .gc .body.graph-only .chat{display:none}
  .gc .chat-title{padding:12px 20px;border-bottom:1px solid #e9edf3;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .gc .chat-title,.gc .compose{position:relative;z-index:1;flex-shrink:0;background:var(--dsw-alias-bg-base,#fff)}
  .gc .messages{position:relative;z-index:0;flex:1;min-height:0;overflow:auto;padding:20px}
  .gc .message{padding:12px 14px;background:#f3f6fc;border-radius:12px;margin-bottom:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}
  .gc .message.user{background:#eaf0ff}
  .gc .message strong{display:block;font-size:12px;margin-bottom:5px;color:#557}
  .gc .compose{padding:16px;border-top:1px solid #e9edf3}
  .gc textarea,.gc input,.gc select{border:1px solid #d5ddeb;border-radius:8px;padding:10px;background:#fff;color:#172033}
  .gc textarea{width:100%;resize:vertical;min-height:72px}
  .gc .actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  .gc .graph{flex:none;width:100%;padding:20px;background:#f8faff}
  .gc .diagram{width:100%;margin:0 auto}
  .gc .detail{border-top:1px solid #dce1eb;margin-top:20px;padding-top:16px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
  .gc .error{padding:10px 24px;background:#fff1f0;color:#a42222}
  .gc .empty{padding:32px;color:#718096}
  .gc .form{padding:24px;overflow:auto;display:flex;flex-direction:column;gap:12px;min-height:0}
  .gc .form label{display:flex;flex-direction:column;gap:6px}
  .gc .form-feedback{position:sticky;bottom:0;background:var(--dsw-alias-bg-base,#fff);padding:12px 0;border-top:1px solid #e9edf3}
  .gc .form-feedback .error{padding:10px 12px;border-radius:8px}
  .gc .events{max-height:220px;overflow:auto;font-size:12px;line-height:1.8}
  .gc .events li{margin-bottom:6px}
  .gc .meta{font-size:12px;color:#718096}
  `
  const endpoint = '/api/graph-collaboration'
  function WorkflowGraph({ nodes, run, events, states = {}, selected, onSelect }) {
    const width = 360, nodeWidth = 170, nodeHeight = 60, center = 166
    const positions = new Map(nodes.map((node, index) => [node.id, { x: center - nodeWidth / 2, y: 30 + index * 118, index }]))
    const endY = 30 + nodes.length * 118
    const colors = { queued: ['#edf2ff', '#315ee8'], running: ['#edf2ff', '#315ee8'], finishing: ['#edf2ff', '#315ee8'], completed: ['#e9faf2', '#20a575'], waiting_human: ['#fff8e6', '#d6951d'], needs_attention: ['#fff1f0', '#d34848'], cancelled: ['#f3f4f6', '#9aa4b5'] }
    const edges = nodes.flatMap(node => Object.entries(node.outcomes).map(([outcome, target], edgeIndex) => {
      const from = positions.get(node.id), to = target === null ? { x: center - nodeWidth / 2, y: endY, index: nodes.length } : positions.get(target)
      const backwards = to.index <= from.index, adjacent = to.index === from.index + 1
      const start = events.findLastIndex(e => e.kind === 'run.started')
      const active = events.slice(start + 1).some(e => e.kind === 'node.reported' && e.data.nodeId === node.id && e.data.outcome === outcome)
      const color = active ? '#20a575' : backwards ? '#d89a38' : '#aab6ca'
      let path, arrow, labelX, labelY
      if (backwards) {
        const x = from.x + nodeWidth, lane = 300 + edgeIndex * 14, y = to.y + nodeHeight / 2
        path = `M ${x} ${from.y + nodeHeight / 2} C ${lane} ${from.y + nodeHeight / 2}, ${lane} ${y}, ${x + 5} ${y}`
        arrow = `M ${x} ${y} L ${x + 8} ${y - 4} L ${x + 8} ${y + 4} Z`
        labelX = lane - 22; labelY = (from.y + to.y) / 2 + nodeHeight / 2
      } else if (adjacent) {
        path = `M ${center} ${from.y + nodeHeight} L ${center} ${to.y - 6}`
        arrow = `M ${center} ${to.y} L ${center - 4} ${to.y - 8} L ${center + 4} ${to.y - 8} Z`
        labelX = center - 9; labelY = from.y + nodeHeight + 30
      } else {
        const lane = 24 + edgeIndex * 12, y = to.y + nodeHeight / 2
        path = `M ${from.x} ${from.y + nodeHeight / 2} H ${lane} V ${y} H ${to.x - 6}`
        arrow = `M ${to.x} ${y} L ${to.x - 8} ${y - 4} L ${to.x - 8} ${y + 4} Z`
        labelX = lane + 8; labelY = (from.y + to.y) / 2 + 25
      }
      const label = ({ ready: target === null ? '完成' : '交给' + nodes.find(n => n.id === target)?.label, pass: '通过', reject: '退回修改', fail: '未通过' })[outcome] || outcome
      return h('g', { key: node.id + ':' + outcome, 'aria-label': `${node.label} ${label} ${nodes.find(n => n.id === target)?.label || '完成'}` },
        h('path', { d: path, fill: 'none', stroke: color, strokeWidth: active ? 2.5 : 1.5 }), h('path', { d: arrow, fill: color }),
        h('text', { x: labelX, y: labelY, fill: color, fontSize: 11, textAnchor: backwards ? 'middle' : 'end' }, label))
    }))
    const height = endY + 70
    // acdert renders SVG groups but exposes no hit-test box for them. Use real
    // HTML buttons in the same coordinate space so clicks and focus are native.
    return h('div', { className: 'diagram', style: { position: 'relative', height: nodes.length <= 3 ? 320 : height, maxHeight: 'none', maxWidth: width } },
      h('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', width: '100%', height: '100%', role: 'img', 'aria-label': '协作流程图，箭头表示合法流转，回线表示返工', style: { display: 'block' } }, ...edges,
        h('g', null, h('rect', { x: center - 48, y: endY, width: 96, height: 40, rx: 20, fill: run?.status === 'completed' ? '#e9faf2' : '#eef1f6', stroke: run?.status === 'completed' ? '#20a575' : '#bdc7d8' }), h('text', { x: center, y: endY + 25, textAnchor: 'middle', fill: '#63718a', fontSize: 13 }, '完成'))),
      ...nodes.map(node => {
        const position = positions.get(node.id), state = run?.nodeStates[node.id] || 'waiting', color = colors[state] || ['#ffffff', '#bdc7d8']
        return h('button', { key: node.id, type: 'button', 'aria-label': '节点 ' + node.label, 'aria-pressed': selected === node.id, onClick: () => onSelect(node.id),
          style: { position: 'absolute', left: position.x / width * 100 + '%', top: position.y / height * 100 + '%', width: nodeWidth / width * 100 + '%', height: nodeHeight / height * 100 + '%', padding: 0, background: color[0], border: `1.5px solid ${color[1]}`, borderRadius: 12, boxShadow: selected === node.id ? '0 0 0 3px #b8caff' : 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 } },
          h('strong', { style: { color: '#243552', fontSize: 14 } }, node.label), h('span', { style: { color: color[1], fontSize: 11 } }, statusText[state] + ' · ' + (liveText[states[node.id]?.status] || '状态未知')))
      }))
  }
  async function command(args) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: crypto.randomUUID(), ...args }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '操作失败')
    return data
  }
  function apply(ctx) {
    ctx.effect(() => { const tag = document.createElement('style'); tag.textContent = css; document.head.append(tag); return () => tag.remove() }, 'graph-collaboration styles')
    function Panel() {
      const [data, setData] = useState({ rooms: [], events: [] }), [selected, setSelected] = useState(localStorage.getItem('graph-room') || '')
      const [create, setCreate] = useState(false), [name, setName] = useState(''), [cwd, setCwd] = useState(''), [graph, setGraph] = useState('')
      const [draft, setDraft] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
      const [loadStatus, setLoadStatus] = useState('loading'), [loadError, setLoadError] = useState('')
      const [nodeId, setNodeId] = useState(''), [tab, setTab] = useState('chat')
      const messages = useRef(null), followLatest = useRef(true)
      useEffect(() => {
        if (messages.current && followLatest.current) messages.current.scrollTop = messages.current.scrollHeight
      }, [selected, data.events.length])
      useEffect(() => {
        const controller = new AbortController(); let timer
        setLoadStatus('loading')
        async function refresh() {
          try {
            const response = await fetch(endpoint + (selected ? '?roomId=' + encodeURIComponent(selected) : ''), { signal: controller.signal })
            const next = await response.json()
            if (!response.ok) {
              if (selected && next.error === '协作工作区不存在' && !controller.signal.aborted) {
                select(''); setError('原工作区不存在，请从列表重新选择。'); return
              }
              throw new Error(next.error || '工作区服务返回错误')
            }
            if (!controller.signal.aborted) { setData(next); setLoadStatus('ready'); setLoadError('') }
          } catch (e) {
            if (!controller.signal.aborted) {
              setLoadStatus('failed')
              setLoadError(e.message === 'Failed to fetch' ? '无法连接工作区服务。请重新加载；若仍失败，请关闭并重新打开 DSH 应用。' : e.message)
            }
          }
          if (!controller.signal.aborted) timer = setTimeout(refresh, 1500)
        }
        refresh(); return () => { controller.abort(); clearTimeout(timer) }
      }, [selected, revision])
      function select(id) { if (id !== selected) followLatest.current = true; setSelected(id); localStorage.setItem('graph-room', id); setNodeId(''); setError('') }
      async function act(action, extra = {}) {
        setBusy(true); setError('')
        try { const result = await command({ action, roomId: selected, ...extra }); if (result.room) select(result.room.id); setRevision(n => n + 1); return true }
        catch (e) { setError(e.message); return false }
        finally { setBusy(false) }
      }
      async function createRoom(event) {
        event.preventDefault()
        if (busy) return
        const missing = [!name.trim() && '工作区名称', !cwd.trim() && '项目工作目录'].filter(Boolean)
        if (missing.length) { setError('请填写' + missing.join('和') + '。'); return }
        let config
        try { config = JSON.parse(graph) } catch { setError('流程图配置不是有效 JSON，请检查括号、逗号和引号。'); return }
        if (await act('create', { name: name.trim(), cwd: cwd.trim(), graph: config })) setCreate(false)
      }
      const room = data.room?.id === selected ? data.room : null, run = room?.run, nodes = room?.graph.nodes || [], node = nodes.find(n => n.id === nodeId) || nodes.find(n => n.id === run?.activeNode) || nodes[0]
      const liveStates = Object.fromEntries(nodes.map(n => [n.id, data.sessionStates?.[room.sessions[n.id]]]))
      const nodeLive = liveStates[node?.id], stalled = run?.status === 'running' && liveStates[run.activeNode]?.health === 'stalled'
      const runEvents = data.events.slice(data.events.findLastIndex(e => e.kind === 'run.started') + 1)
      const nodeReport = runEvents.findLast(e => ['node.reported', 'node.human_requested'].includes(e.kind) && e.data.nodeId === node?.id)
      const labels = { user: '你', organizer: '组织者', ...Object.fromEntries(nodes.map(n => [n.id, n.label])) }
      const button = (text, onClick, extra = {}) => h('button', { type: 'button', disabled: busy, onClick, ...extra }, text)
      const chats = data.events.filter(e => e.kind === 'chat.message' || e.kind === 'run.started').map(e => e.kind === 'run.started' ? { ...e, data: { actor: 'user', text: e.data.task || room?.run?.task || '启动任务' } } : e)
      const eventLabels = { 'room.created': '创建工作区', 'room.ready': '节点会话已就绪', 'run.started': '任务开始', 'delivery.accepted': '会话已受理任务', 'node.reported': '节点提交结果', 'node.human_requested': '节点请求人工处理', 'execution.finished': '本轮执行结束', 'execution.retried': '恢复节点执行', 'run.cancelled': '请求取消任务' }
      return h('section', { className: 'gc', 'aria-label': '协作工作区' },
        h('header', null, h('div', null, h('h2', null, '协作工作区'), h('small', null, '会话独立执行 · 流程事件驱动')), h('span', { style: { flex: 1 } }), button('新建工作区', () => { setCreate(true); setError(''); setGraph(JSON.stringify(data.defaultGraph, null, 2)) }, { disabled: busy || !data.defaultGraph || loadStatus === 'failed' })),
        loadError && h('div', { role: 'alert', className: 'error' }, '工作区加载失败：' + loadError),
        !create && error && h('div', { role: 'alert', className: 'error' }, error),
        create ? h('form', { className: 'form', noValidate: true, onSubmit: createRoom, 'aria-busy': busy },
          h('h3', null, '创建协作工作区'),
          h('p', { className: 'meta' }, '名称和项目目录均为必填项。填写项目的绝对路径后，再创建并绑定会话。'),
          h('label', null, '工作区名称', h('input', { 'aria-label': '工作区名称', value: name, onChange: e => setName(e.target.value), required: true })),
          h('label', null, '项目工作目录', h('input', { 'aria-label': '项目工作目录', placeholder: '/你的项目绝对路径', value: cwd, onChange: e => setCwd(e.target.value), required: true })),
          h('details', null, h('summary', null, '流程图配置'), h('p', null, '每个节点声明职责与允许的结果。创建后本工作区使用这份固定配置。'), h('textarea', { 'aria-label': '流程图配置', value: graph, onChange: e => setGraph(e.target.value), rows: 15 })),
          h('div', { className: 'form-feedback' }, error && h('div', { role: 'alert', className: 'error' }, error),
            h('div', { className: 'actions' }, h('button', { type: 'submit', className: 'primary', disabled: busy }, busy ? '正在创建会话…' : '创建并绑定会话'), button('返回', () => { setCreate(false); setError('') })))) : h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { className: 'toolbar' }, h('select', { 'aria-label': '选择协作工作区', value: selected, disabled: data.rooms.length === 0, onChange: e => select(e.target.value) }, h('option', { value: '' }, data.rooms.length ? '选择工作区' : loadStatus === 'loading' ? '正在加载工作区…' : loadStatus === 'failed' ? '工作区加载失败' : '暂无协作工作区'), ...data.rooms.map(r => h('option', { key: r.id, value: r.id }, r.name))),
            button('重新加载', () => setRevision(n => n + 1)),
            loadStatus === 'loading' && h('span', { className: 'meta', role: 'status' }, '正在加载…'),
            room && h('span', { className: 'meta' }, !room.ready ? '会话待初始化' : run ? statusText[run.status] : '尚未开始任务'),
            stalled && h('span', { className: 'error', role: 'status' }, '当前角色已持续空闲 5 分钟，尚未推进流程，请查看会话后处理。'),
            room && !room.ready && button('重试初始化', () => act('provision')),
            run && ['running', 'waiting_human', 'needs_attention'].includes(run.status) && button('取消任务', () => act('cancel'))),
          !room ? h('div', { className: 'empty', role: 'status' }, loadStatus === 'loading' ? '正在加载已有工作区…' : loadStatus === 'failed' ? '工作区暂时无法加载，请点击“重新加载”重试。' : data.rooms.length ? '请选择已有工作区。' : '暂无协作工作区。点击“新建工作区”，为各个节点绑定独立会话。') : h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { className: 'tabs' }, button('群聊与状态图', () => setTab('chat')), button('状态图', () => setTab('graph'))),
            h('div', { className: 'body ' + (tab === 'chat' ? 'combined' : 'graph-only') },
              h('div', { className: 'chat' }, h('div', { className: 'chat-title' }, h('strong', null, '组织者 · 协作群聊'), button('打开组织者会话', () => ctx.uiWorkspace.openSession(room.sessions.organizer))), h('div', { className: 'messages', role: 'log', 'aria-label': '协作消息', ref: messages, onScroll: e => { const el = e.currentTarget; followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 } },
                !chats.length && h('p', { className: 'meta' }, '在下方描述需求，与组织者交流；点击“启动流程”会直接按图执行输入的任务。'),
                ...chats.map(e => h('article', { key: e.seq, className: 'message ' + e.data.actor }, h('strong', null, labels[e.data.actor] || e.data.actor), e.data.text))),
                h('div', { className: 'compose' }, h('textarea', { 'aria-label': '协作消息', placeholder: run?.status === 'waiting_human' ? '输入人工处理意见…' : '向组织者描述需求或询问进展…', value: draft, onChange: e => setDraft(e.target.value) }),
                  h('div', { className: 'actions' }, button('发送给组织者', async () => { if (await act('chat', { text: draft })) setDraft('') }, { disabled: busy || !draft.trim() || !room.ready }),
                    (!run || ['completed', 'cancelled'].includes(run.status)) && button('启动流程', async () => { if (await act('start', { task: draft })) setDraft('') }, { className: 'primary', disabled: busy || !draft.trim() || !room.ready }),
                    run && (['waiting_human', 'needs_attention'].includes(run.status) || stalled) && button('提交处理意见并重试', async () => { if (await act('resume', { message: draft, executionId: run.execution.id })) setDraft('') }, { className: 'primary', disabled: busy || !draft.trim() })))),
              h('aside', { className: 'graph', 'aria-label': '流程状态图' }, h('h3', null, '流程状态图'),
                h(WorkflowGraph, { nodes, run, events: data.events, states: liveStates, selected: node?.id, onSelect: setNodeId }),
                node && h('div', { className: 'detail' }, h('strong', null, node.label + ' · 节点详情'), h('p', null, node.instructions), button('打开节点会话', () => ctx.uiWorkspace.openSession(room.sessions[node.id])),
                  h('p', { className: 'meta' }, '会话状态：' + (liveText[nodeLive?.status] || '状态未知') + (nodeLive?.queued ? ' · 待处理消息 ' + nodeLive.queued : '') + (nodeLive?.background ? ' · 后台任务 ' + nodeLive.background : '') + (nodeLive?.health === 'stalled' ? ' · 持续空闲，等待处理' : '')),
                  h('p', { className: 'meta' }, nodeReport?.data.summary || '当前节点尚未提交结果。')),
                h('details', { className: 'detail' }, h('summary', null, '事件时间线'), h('ol', { className: 'events' }, ...data.events.filter(e => e.kind !== 'chat.message').map(e => h('li', { key: e.seq }, new Date(e.at).toLocaleTimeString() + ' · ' + (eventLabels[e.kind] || e.kind) + (e.data.summary ? ' · ' + e.data.summary : '')))))))))
      )
    }
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'graph-collaboration' }, Panel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'graph-collaboration', label: '协作工作区', order: 5 }, () => h('span', { 'aria-hidden': true }, '◇')))
  }
  return { inject: ['slots', 'layout', 'uiWorkspace'], apply }
} })
