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
