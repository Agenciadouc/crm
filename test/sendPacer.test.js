import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSendPacer } from '../server/services/whatsapp/sendPacer.js'

function fakeClock() {
  let t = 1_000_000
  const sleeps = []
  return {
    nowMs: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
    advance: (ms) => { t += ms },
    sleeps,
  }
}

test('primeiro envio no numero nao espera', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  assert.deepEqual(c.sleeps, [])
})

test('envios seguidos no mesmo numero: espera sorteada entre 5s e 20s', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await Promise.all([p.wait(1), p.wait(1), p.wait(1)])
  assert.deepEqual(c.sleeps, [5000, 5000])

  const c2 = fakeClock()
  const p2 = createSendPacer({ sleep: c2.sleep, nowMs: c2.nowMs, random: () => 0.999999 })
  await p2.wait(1); await p2.wait(1)
  assert.deepEqual(c2.sleeps, [20000])
})

test('se ja passou tempo suficiente, nao espera', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  c.advance(30000)
  await p.wait(1)
  assert.deepEqual(c.sleeps, [])
})

test('numeros diferentes nao se bloqueiam', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await Promise.all([p.wait(1), p.wait(2)])
  assert.deepEqual(c.sleeps, [])
})

test('erro no sleep nao trava a fila do numero', async () => {
  const c = fakeClock()
  let fail = true
  const p = createSendPacer({ sleep: async (ms) => { if (fail) { fail = false; throw new Error('x') } return c.sleep(ms) }, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  await assert.rejects(p.wait(1))
  await p.wait(1)
})
