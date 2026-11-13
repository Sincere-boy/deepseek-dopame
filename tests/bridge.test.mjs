import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { once } from 'node:events'
import { connect } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { createHarnessBridge } from '../src/backend/bridge.mjs'

async function fixture(t, handler, ready = Promise.resolve()) {
  const dir = await mkdtemp('/tmp/dshb-')
  const upstream = createServer(handler)
  const bridge = createHarnessBridge({ socketPath: join(dir, 'up.sock'), ready, launchToken: () => 'test-token' })
  const sockets = new Set()
  for (const server of [upstream, bridge]) {
    server.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
  }
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all([upstream, bridge].map(server => new Promise(resolve => server.close(resolve))))
    await rm(dir, { recursive: true, force: true })
  })
  upstream.listen(join(dir, 'up.sock')); await once(upstream, 'listening')
  bridge.listen(join(dir, 'bridge.sock')); await once(bridge, 'listening')
  const call = (path, host = 'localhost', extra = {}) => new Promise((resolve, reject) => {
    request({ socketPath: join(dir, 'bridge.sock'), path,
      headers: { host, origin: 'http://' + host }, ...extra }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }))
    }).on('error', reject).end()
  })
  return { upstream, call, path: join(dir, 'bridge.sock') }
}

function auth(req, res) {
  if (req.url === '/?token=test-token') {
    res.writeHead(303, { 'set-cookie': `auth=${req.headers.host}; HttpOnly; Path=/`, location: '/' })
    res.end(); return true
  }
  if (req.url === '/') {
    res.end('<main>Harness</main>'); return true
  }
  return false
}

test('keeps cookies bound to each authority and retains Host/Origin', { timeout: 3000 }, async t => {
  const { call } = await fixture(t, (req, res) => {
    if (auth(req, res)) return
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie }))
  })
  await call('/api/dopame/bootstrap', 'localhost')
  await call('/api/dopame/bootstrap', 'acde.local')
  for (const host of ['localhost', 'acde.local']) {
    const result = JSON.parse((await call('/api/check', host)).body)
    assert.deepEqual(result, { host, origin: 'http://' + host, cookie: 'auth=' + host })
  }
})

test('streams the first chunk before the upstream response finishes', { timeout: 3000 }, async t => {
  const release = Promise.withResolvers()
  const first = Promise.withResolvers()
  const { path } = await fixture(t, async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first\n\n')
    await release.promise
    res.end('data: last\n\n')
  })
  let ended = false
  const done = new Promise((resolve, reject) => {
    request({ socketPath: path, path: '/stream' }, res => {
      const chunks = []
      res.on('data', chunk => { chunks.push(chunk); first.resolve() })
      res.on('end', () => { ended = true; resolve(Buffer.concat(chunks).toString()) })
    }).on('error', reject).end()
  })
  await first.promise
  assert.equal(ended, false)
  release.resolve()
  assert.equal(await done, 'data: first\n\ndata: last\n\n')
})

test('preserves binary messages and answers upstream heartbeats independently', { timeout: 3000 }, async t => {
  const { upstream, path, call } = await fixture(t, auth)
  const bytes = Buffer.from([0, 1, 2, 255])
  const pong = Promise.withResolvers()
  const wsServer = new WebSocketServer({ server: upstream })
  t.after(() => { for (const ws of wsServer.clients) ws.terminate(); wsServer.close() })
  wsServer.on('connection', (socket, req) => {
    assert.equal(req.headers.cookie, 'auth=localhost')
    assert.equal(req.headers.origin, 'http://localhost')
    socket.on('message', (data, binary) => socket.send(data, { binary }))
    socket.on('pong', data => pong.resolve(data.toString()))
    socket.ping('heartbeat')
  })
  await call('/api/dopame/bootstrap')
  // A browser-facing peer that never sends Pong must not prevent the bridge
  // itself from satisfying its independent upstream liveness contract.
  const client = new WebSocket('ws://localhost/mux', {
    createConnection: () => connect(path), autoPong: false, origin: 'http://localhost',
  })
  t.after(() => client.terminate())
  await once(client, 'open')
  const echoed = once(client, 'message')
  client.send(bytes)
  const [data, binary] = await echoed
  assert.deepEqual(data, bytes)
  assert.equal(binary, true)
  assert.equal(await pong.promise, 'heartbeat')
})

test('reports startup failure to the page', { timeout: 3000 }, async t => {
  const ready = Promise.reject(new Error('failed startup'))
  ready.catch(() => {})
  const { call } = await fixture(t, () => {}, ready)
  const result = await call('/api/dopame/bootstrap')
  assert.deepEqual(result, { status: 503, body: 'failed startup' })
})
