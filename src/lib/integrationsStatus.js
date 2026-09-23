// Regras puras da tela de Integracoes. JS puro com .d.ts ao lado para rodar no `node --test`.

// Texto do cartao WhatsApp: se a lista falhou, nao pode dizer "Nenhum número".
export function whatsappTileStatus({ instances, loadError }) {
  if (loadError) return 'Não foi possível carregar'
  if (!instances.length) return 'Nenhum número'
  const connected = instances.filter(i => i.status === 'connected').length
  return `${connected} de ${instances.length} conectado(s)`
}

// Guarda de resposta atrasada: begin(chave) antes de pedir; isLatest(ticket, chaveAtual) ao receber.
// So a ultima requisicao vale, e so se a chave (ex.: conta) ainda for a mesma.
export function createLatestRequest() {
  let seq = 0
  let lastKey
  return {
    begin(key) { seq += 1; lastKey = key; return seq },
    isLatest(ticket, currentKey) { return ticket === seq && lastKey === currentKey },
  }
}
