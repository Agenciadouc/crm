// Catraca anti-ban (spec 10.7): entre dois envios automaticos no mesmo numero, espera sorteada de 5 a 20s.
// Serializa por chave (id do numero); numeros diferentes andam em paralelo.
const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function createSendPacer({ sleep = defaultSleep, random = Math.random, nowMs = () => Date.now(), minMs = 5000, maxMs = 20000 } = {}) {
  const chains = new Map()
  const lastAt = new Map()

  function wait(key) {
    const prev = chains.get(key) || Promise.resolve()
    const next = prev.then(async () => {
      const last = lastAt.get(key)
      if (last != null) {
        const gap = minMs + Math.floor(random() * (maxMs - minMs + 1))
        const remaining = last + gap - nowMs()
        if (remaining > 0) await sleep(Math.min(remaining, maxMs))
      }
      lastAt.set(key, nowMs())
    })
    chains.set(key, next.catch(() => {}))
    return next
  }

  return { wait }
}

export const followUpPacer = createSendPacer()
