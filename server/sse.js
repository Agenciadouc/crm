// SSE client management — shared between index.js and route files
const sseClients = new Map() // accountId -> Set<res>

export function addSSEClient(accountId, res) {
  if (!sseClients.has(accountId)) sseClients.set(accountId, new Set())
  sseClients.get(accountId).add(res)
}

export function removeSSEClient(accountId, res) {
  sseClients.get(accountId)?.delete(res)
}

export function broadcastSSE(accountId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const clients = sseClients.get(accountId)
  if (clients) for (const client of clients) client.write(payload)
  const adminClients = sseClients.get('admin')
  if (adminClients) for (const client of adminClients) client.write(payload)
}

// Manda evento pra TODOS os usuarios conectados (independente da conta).
// Usado pra broadcasts globais tipo "aviso de manutencao" que precisam
// chegar em todo mundo simultaneamente.
export function broadcastSSEAll(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const [, clients] of sseClients) {
    for (const client of clients) {
      try { client.write(payload) } catch { /* client disconnected */ }
    }
  }
}

// Broadcast de aviso do sistema (banner/popup). Persiste em memoria pra
// que usuarios que entrarem depois tambem vejam ate expirar.
let currentSystemNotice = null
export function setSystemNotice(notice) {
  currentSystemNotice = notice
  broadcastSSEAll('system:notice', notice)
}
export function clearSystemNotice() {
  currentSystemNotice = null
  broadcastSSEAll('system:notice', null)
}
export function getSystemNotice() {
  if (!currentSystemNotice) return null
  if (currentSystemNotice.expiresAt && Date.now() > currentSystemNotice.expiresAt) {
    currentSystemNotice = null
    return null
  }
  return currentSystemNotice
}
