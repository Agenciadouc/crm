import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDebouncer } from '../server/services/leadDebouncer.js'

// Relogio falso compativel com Node 16 (sem mock.timers)
function fakeClock() {
  let nextId = 1
  const timers = new Map()
  return {
    setTimer(fn, ms) { const id = nextId++; timers.set(id, { fn, ms }); return id },
    clearTimer(id) { timers.delete(id) },
    runAll() { const list = [...timers.entries()]; timers.clear(); for (const [, t] of list) t.fn() },
    lastDelay() { const all = [...timers.values()]; return all.length ? all[all.length - 1].ms : null },
    count() { return timers.size },
  }
}

test('nova mensagem do mesmo lead reinicia a espera: so a ultima roda', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(10, () => calls.push('primeira'))
  d.schedule(10, () => calls.push('segunda'))
  assert.equal(clock.count(), 1)
  assert.equal(clock.lastDelay(), 40000)
  clock.runAll()
  assert.deepEqual(calls, ['segunda'])
  assert.equal(d.has(10), false)
})

test('leads diferentes tem timers independentes', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(1, () => calls.push(1))
  d.schedule(2, () => calls.push(2))
  assert.equal(d.size(), 2)
  clock.runAll()
  assert.deepEqual(calls.sort(), [1, 2])
})

test('cancel e cancelWhere por agente', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(1, () => calls.push(1), { agentId: 7 })
  d.schedule(2, () => calls.push(2), { agentId: 7 })
  d.schedule(3, () => calls.push(3), { agentId: 8 })
  assert.equal(d.cancel(1), true)
  assert.equal(d.cancel(1), false)
  assert.equal(d.cancelWhere(meta => meta.agentId === 7), 1)
  clock.runAll()
  assert.deepEqual(calls, [3])
})

test('erro na funcao agendada nao derruba o processo', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  d.schedule(1, () => { throw new Error('falhou') })
  d.schedule(2, () => Promise.reject(new Error('falhou async')))
  assert.doesNotThrow(() => clock.runAll())
})
