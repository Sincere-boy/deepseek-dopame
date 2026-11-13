import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'

// Carry the Harness protocol without changing authority-bound authentication.
export function createHarnessBridge({ socketPath, ready, launchToken, reportRejection = () => {} }) {
  const cookies = new Map()
  const options = (path, headers = {}) => ({ socketPath, path,
    headers: { ...headers, host: headers.host ?? 'acde.local', 'accept-encoding': 'identity' } })
  const collect = (path, headers) => new Promise((resolve, reject) => {
    request(options(path, headers), response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ response, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    }).on('error', reject).end()
  })
  const server = createServer(async (req, res) => {
    try {
      await ready
      const authority = req.headers.host ?? 'acde.local'
      if (req.url === '/api/dopame/bootstrap') {
        const auth = await collect('/?token=' + encodeURIComponent(launchToken()), { host: authority })
        const cookie = auth.response.headers['set-cookie']?.map(row => row.split(';')[0]).join('; ')
        if (!cookie) throw new Error('Harness did not issue an authentication cookie')
        cookies.set(authority, cookie)
        const page = await collect('/', { cookie, host: authority })
        res.writeHead(page.response.statusCode, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        })
        res.end(page.body)
        return
      }
      const proxy = request({
        ...options(req.url, { ...req.headers, cookie: cookies.get(authority) ?? '' }), method: req.method,
      }, response => {
        if (response.statusCode === 403) reportRejection({ host: authority, origin: req.headers.origin })
        res.writeHead(response.statusCode, response.headers)
        response.pipe(res)
      })
      proxy.on('error', error => { if (!res.headersSent) res.writeHead(502); res.end(error.message) })
      res.on('close', () => proxy.destroy())
      req.pipe(proxy)
    } catch (error) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(error.message)
    }
  })
  const clients = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  const closeCode = code => code === 1005 ? 1000 : code === 1006 ? 1011 : code
  server.on('upgrade', (req, socket, head) => {
    const cookie = cookies.get(req.headers.host ?? 'acde.local')
    if (!cookie) { socket.destroy(); return }
    // Each hop owns RFC 6455 control frames. In acdert 0.0.9 a raw tunnel
    // fails the upstream's Ping/Pong deadline after several idle minutes.
    const remote = new WebSocket(`ws://${req.headers.host ?? 'acde.local'}${req.url}`, {
      createConnection: () => connect(socketPath), perMessageDeflate: false,
      headers: { cookie, ...req.headers.origin && { origin: req.headers.origin } },
    })
    let client
    remote.on('open', () => clients.handleUpgrade(req, socket, head, connection => {
      client = connection
      remote.on('message', (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
      })
      client.on('message', (data, binary) => {
        if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary })
      })
      client.on('close', (code, reason) => remote.close(closeCode(code), reason))
      client.on('error', () => remote.terminate())
    }))
    remote.on('close', (code, reason) => {
      if (client) client.close(closeCode(code), reason)
      else socket.destroy()
    })
    remote.on('error', () => {
      if (client) client.close(1011, 'Harness connection failed')
      else socket.destroy()
    })
    socket.on('close', () => { if (!client) remote.terminate() })
  })
  server.on('close', () => {
    for (const client of clients.clients) client.terminate()
    clients.close()
  })
  return server
}
