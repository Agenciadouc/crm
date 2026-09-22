import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'node:http'
import express from 'express'
import { createTestDb } from './helpers/db.js'
import { createMediaTemp, MEDIA_TEMP_TTL_MS } from '../server/services/mediaTemp.js'
import { createMediaTempRouter } from '../server/routes/mediaTemp.js'

function setup() {
  const db = createTestDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-temp-'))
  let now = Date.parse('2026-09-22T12:00:00Z')
  const mt = createMediaTemp({ db, dir, env: { PUBLIC_BASE_URL: 'https://crm.test' }, nowMs: () => now })
  return { db, dir, mt, advance: (ms) => { now += ms } }
}
const tokenOf = (url) => url.split('/').pop()

test('put grava o arquivo e devolve a URL publica com token de 32 hex; get devolve o conteudo', () => {
  const { mt, dir } = setup()
  const url = mt.put(Buffer.from('JPGDATA'), 'image/jpeg')
  assert.match(url, /^https:\/\/crm\.test\/api\/media-temp\/[a-f0-9]{32}$/)
  assert.equal(fs.readdirSync(dir).length, 1)
  const f = mt.get(tokenOf(url))
  assert.equal(f.buffer.toString(), 'JPGDATA')
  assert.equal(f.mimetype, 'image/jpeg')
})

test('10 minutos: o link expira e o arquivo e apagado', () => {
  const { mt, dir, advance } = setup()
  const url = mt.put(Buffer.from('X'), 'image/png')
  advance(MEDIA_TEMP_TTL_MS - 1000)
  assert.ok(mt.get(tokenOf(url)))
  advance(2000)
  assert.equal(mt.get(tokenOf(url)), null)
  assert.equal(fs.readdirSync(dir).length, 0)
})

test('token invalido ou desconhecido devolve null', () => {
  const { mt } = setup()
  assert.equal(mt.get('../../etc/passwd'), null)
  assert.equal(mt.get('f'.repeat(32)), null)
  assert.equal(mt.get(undefined), null)
})

test('cleanup apaga os vencidos e mantem os validos', () => {
  const { mt, db, advance } = setup()
  mt.put(Buffer.from('A'), 'image/png')
  advance(MEDIA_TEMP_TTL_MS + 1)
  const novo = mt.put(Buffer.from('B'), 'image/png')
  assert.equal(mt.cleanup(), 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_temp').get().n, 1)
  assert.ok(mt.get(tokenOf(novo)))
})

test('rota GET /api/media-temp/:token serve o arquivo com o tipo certo e 404 quando nao existe', async () => {
  const { mt } = setup()
  const url = mt.put(Buffer.from('OGG'), 'audio/ogg')
  const app = express()
  app.use('/api/media-temp', createMediaTempRouter(mt))
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const ok = await fetch(`${base}/api/media-temp/${tokenOf(url)}`)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'audio/ogg')
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal(await ok.text(), 'OGG')
    const nf = await fetch(`${base}/api/media-temp/${'0'.repeat(32)}`)
    assert.equal(nf.status, 404)
  } finally {
    await new Promise(r => server.close(r))
  }
})
