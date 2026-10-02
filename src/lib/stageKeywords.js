// Normaliza o valor de uma lista de palavras-chave de etapa antes de salvar: aceita tanto
// o array que a UI produz durante a edicao (campo tocado nesta sessao) quanto a string JSON
// que vem do backend quando o campo nunca foi tocado -- sem isso, qualquer campo nao editado
// virava undefined no payload e o backend gravava NULL, apagando a configuracao existente.
export function cleanKeywordList(v) {
  let arr = v
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr) } catch { return undefined }
  }
  if (!Array.isArray(arr)) return undefined
  const cleaned = arr.map(k => String(k).trim()).filter(Boolean)
  return cleaned.length ? cleaned : undefined
}
