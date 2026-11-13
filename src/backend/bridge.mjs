import { createServer, request } from 'node:http'

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
  server.on('upgrade', (req, socket, head) => {
    const cookie = cookies.get(req.headers.host ?? 'acde.local')
    if (!cookie) { socket.destroy(); return }
    const proxy = request(options(req.url, { ...req.headers, cookie }))
    proxy.on('upgrade', (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`)
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        socket.write(response.rawHeaders[i] + ': ' + response.rawHeaders[i + 1] + '\r\n')
      }
      socket.write('\r\n')
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.on('error', () => remote.destroy())
      remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
      socket.pipe(remote).pipe(socket)
    })
    proxy.on('response', () => socket.destroy())
    proxy.on('error', () => socket.destroy())
    proxy.end()
  })
  return server
}
