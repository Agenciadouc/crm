// Timer por chave (lead): cada schedule cancela o anterior da mesma chave.
// Em memoria — a producao roda 1 processo pm2. Timers injetaveis para teste.

export function createDebouncer({ delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const entries = new Map() // key -> { handle, meta }

  // meta: objeto (mesclado com o meta do agendamento anterior — o que ja estava
  // sobrevive ao reagendamento) ou funcao (prevMeta) => meta, pra calcular o dado do
  // bloco so quando o bloco comeca (prevMeta = null). O meta resolvido vai pra fn().
  function resolveMeta(meta, prevMeta) {
    if (typeof meta === 'function') return meta(prevMeta) || {}
    return { ...(prevMeta || {}), ...(meta || {}) }
  }

  function schedule(key, fn, meta = {}) {
    const prev = entries.get(key)
    const prevMeta = prev ? prev.meta : null
    if (prev) clearTimer(prev.handle)
    const resolved = resolveMeta(meta, prevMeta)
    const handle = setTimer(() => {
      entries.delete(key)
      try {
        const result = fn(resolved)
        if (result && typeof result.catch === 'function') {
          result.catch(e => console.error('[Debouncer] erro async:', e && e.message))
        }
      } catch (e) {
        console.error('[Debouncer] erro:', e && e.message)
      }
    }, delayMs)
    entries.set(key, { handle, meta: resolved })
  }

  function cancel(key) {
    const entry = entries.get(key)
    if (!entry) return false
    clearTimer(entry.handle)
    entries.delete(key)
    return true
  }

  function cancelWhere(predicate) {
    let cancelled = 0
    for (const [key, entry] of entries) {
      if (predicate(entry.meta)) {
        clearTimer(entry.handle)
        entries.delete(key)
        cancelled++
      }
    }
    return cancelled
  }

  return {
    schedule,
    cancel,
    cancelWhere,
    has: key => entries.has(key),
    getMeta: key => (entries.has(key) ? entries.get(key).meta : null),
    size: () => entries.size,
  }
}
