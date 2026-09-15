// Timer por chave (lead): cada schedule cancela o anterior da mesma chave.
// Em memoria — a producao roda 1 processo pm2. Timers injetaveis para teste.

export function createDebouncer({ delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const entries = new Map() // key -> { handle, meta }

  function schedule(key, fn, meta = {}) {
    const prev = entries.get(key)
    if (prev) clearTimer(prev.handle)
    const handle = setTimer(() => {
      entries.delete(key)
      try {
        const result = fn()
        if (result && typeof result.catch === 'function') {
          result.catch(e => console.error('[Debouncer] erro async:', e && e.message))
        }
      } catch (e) {
        console.error('[Debouncer] erro:', e && e.message)
      }
    }, delayMs)
    entries.set(key, { handle, meta })
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
    size: () => entries.size,
  }
}
