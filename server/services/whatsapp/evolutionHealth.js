// Health da Evolution por URL da instancia (antes usava so process.env.EVOLUTION_API_URL).
export function apiUrlKey(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '')
}

// Mesma regra de hoje: qualquer resposta HTTP conta como "no ar"; so erro de rede/timeout conta como fora.
export async function checkApiUrlsAlive(instances, fetchImpl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 5000
  const result = new Map()
  const bases = [...new Set((instances || []).map(i => apiUrlKey(i.api_url)).filter(Boolean))]
  for (const base of bases) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await fetchImpl(`${base}/`, { signal: controller.signal })
      result.set(base, true)
    } catch {
      result.set(base, false)
    } finally {
      clearTimeout(timer)
    }
  }
  return result
}
