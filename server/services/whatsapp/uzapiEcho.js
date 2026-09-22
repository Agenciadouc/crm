// Resposta digitada no celular do numero: a UzAPI nao manda a mensagem, so o status (recipient_id vazio,
// telefone do lead em contacts[0].wa_id). Aqui busca o conteudo e grava como mensagem ENVIADA (fromMe).
// Espera delayMs antes de checar: o status da mensagem que o PROPRIO CRM acabou de enviar pode chegar
// antes do INSERT do chamador; depois da espera, id ja existente = nao e eco.
export function createEchoResolver({ db, getProvider, handleInboundMessage, delayMs = 5000, wait = (ms) => new Promise(r => setTimeout(r, ms)), log = console }) {
  const inFlight = new Set()
  const known = (accountId, id) => !!db.prepare('SELECT 1 FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(id, accountId)

  async function resolveEchoes(account, instance, echoes) {
    let provider
    try { provider = getProvider(instance) } catch { return 0 }
    if (!provider.fetchMessageById || !Array.isArray(echoes) || echoes.length === 0) return 0
    const key = (e) => `${account.id}:${e.messageId}`
    const seen = new Set()
    const todo = echoes.filter(e => {
      if (!e?.messageId || !e.phone || seen.has(e.messageId)) return false
      seen.add(e.messageId)
      return !inFlight.has(key(e)) && !known(account.id, e.messageId)
    })
    if (todo.length === 0) return 0
    for (const e of todo) inFlight.add(key(e))
    let saved = 0
    try {
      await wait(delayMs)
      for (const e of todo) {
        if (known(account.id, e.messageId)) continue
        try {
          const normalized = await provider.fetchMessageById(instance, e.messageId, { phone: e.phone })
          if (!normalized) continue
          handleInboundMessage(account, instance, {
            ...normalized, phone: e.phone, remoteId: `${e.phone}@s.whatsapp.net`, messageId: e.messageId, fromMe: true,
          }, { source: 'webhook' })
          saved++
        } catch (err) {
          log.error(`[UzAPI eco] ${e.messageId}: ${err.message}`)
        }
      }
    } finally {
      for (const e of todo) inFlight.delete(key(e))
    }
    return saved
  }

  return { resolveEchoes }
}
