import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const runtime = resolve(import.meta.dirname, '../web/runtime')
const preload = resolve(import.meta.dirname, 'acde-listen.js')
const data = process.env.ACDE_APP_DATA
if (!data) throw new Error('This backend must run inside acde')
mkdirSync(data, { recursive: true })
if (!existsSync(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('Packaged Harness runtime missing')

let token
let cookie
let failure
const waiters = []
const child = spawn(process.execPath, [
  '--import', preload, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  'web', '--patch', join(runtime, 'dopame.patch.yml'), '--port', '3080', '--trusted-host', 'acde.local', '--no-open',
], {
  cwd: data,
  env: { ...process.env, DSH_HOME: join(data, 'harness'), DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', chunk => {
  output += chunk.toString()
  const match = output.match(/dsh web: .*?[?&]token=([^\s]+)/)
  if (match && !token) {
    token = match[1]
    for (const waiter of waiters.splice(0)) waiter()
    console.log('Harness profile ready')
  }
  if (!match) process.stdout.write(chunk)
})
child.stderr.on('data', chunk => process.stderr.write(chunk))
child.on('error', error => { failure = error.message })
child.on('exit', (code, signal) => {
  failure = `Harness stopped (${code ?? signal})`
  for (const waiter of waiters.splice(0)) waiter()
})
process.on('SIGTERM', () => { child.kill('SIGTERM'); process.exit(0) })
process.on('SIGINT', () => { child.kill('SIGTERM'); process.exit(0) })

function upstream(path, headers = {}) {
  return { socketPath: join(process.env.ACDE_APP_SOCKETS, '3080.sock'),
    path, headers: { ...headers, host: headers.host ?? 'acde.local', 'accept-encoding': 'identity' } }
}
function collect(path, headers = {}) {
  return new Promise((resolve, reject) => {
    request(upstream(path, headers), response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ response, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    }).on('error', reject).end()
  })
}

const server = createServer(async (req, res) => {
  try {
    if (!token && !failure) await Promise.race([
      new Promise(resolve => waiters.push(resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Harness startup timed out')), 60000)),
    ])
    if (failure) throw new Error(failure)
    if (req.url === '/api/dopame/bootstrap') {
      const auth = await collect('/?token=' + encodeURIComponent(token), { host: req.headers.host })
      cookie = auth.response.headers['set-cookie']?.map(row => row.split(';')[0]).join('; ')
      if (!cookie) throw new Error('Harness did not issue an authentication cookie')
      const page = await collect('/', { cookie, host: req.headers.host })
      res.writeHead(page.response.statusCode, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(page.body)
      return
    }
    const proxy = request({ ...upstream(req.url, { ...req.headers, cookie: cookie ?? '' }), method: req.method }, response => {
      if (response.statusCode === 403) console.error('Harness trust rejection', JSON.stringify({ host: req.headers.host, origin: req.headers.origin, fetchSite: req.headers['sec-fetch-site'] }))
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
  if (!cookie || failure) { socket.destroy(); return }
  const proxy = request(upstream(req.url, { ...req.headers, cookie }))
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
server.listen(3000)
