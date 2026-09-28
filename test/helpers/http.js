// Sobe um router num Express nu, porta efemera, e faz requisicoes cruas com node:http
// (sem fetch global — producao e Node 16). Padrao de test/roteiroHttp.test.js.
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../../server/middleware/auth.js'

export function token({ id, role, accountId = null }) {
  return jwt.sign({ id, role, account_id: accountId }, JWT_SECRET)
}

export function peca(base, { method = 'GET', path = '/', jwtToken, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + path)
    const dados = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
        ...(dados ? { 'Content-Length': dados.length } : {}),
      },
    }, res => {
      let bruto = ''
      res.setEncoding('utf8')
      res.on('data', c => { bruto += c })
      res.on('end', () => {
        let json = null
        try { json = bruto ? JSON.parse(bruto) : null } catch { json = null }
        resolve({ status: res.statusCode, body: json })
      })
    })
    req.on('error', reject)
    if (dados) req.write(dados)
    req.end()
  })
}

// mount(app) registra as rotas; fn({ base }) roda os pedidos.
export async function withServer(mount, fn) {
  const app = express()
  app.use(express.json())
  mount(app)
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn({ base }) } finally { await new Promise(r => server.close(r)) }
}
