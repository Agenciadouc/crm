// Health da Evolution por URL da instancia (antes usava so process.env.EVOLUTION_API_URL).
export function apiUrlKey(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '')
}

// Mesma regra de hoje: conta como "no ar" so 2xx, 401 e 404 — a raiz da Evolution pode exigir
// apikey (401) ou nao ter rota em GET / (404) e mesmo assim o servico esta de pe. Qualquer outro
// status (502/503 de restart, 500) e erro de rede/timeout contam como fora do ar: com a API caida,
// o tick pula as instancias em vez de marcar todas como desconectadas por erro de parse.
export async function checkApiUrlsAlive(instances, fetchImpl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 5000
  const result = new Map()
  const bases = [...new Set((instances || []).map(i => apiUrlKey(i.api_url)).filter(Boolean))]
  for (const base of bases) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const r = await fetchImpl(`${base}/`, { signal: controller.signal })
      result.set(base, !!(r && (r.ok || r.status === 401 || r.status === 404)))
    } catch {
      result.set(base, false)
    } finally {
      clearTimeout(timer)
    }
  }
  return result
}
