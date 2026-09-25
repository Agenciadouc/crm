// Reconhecimento de pergunta digitada pelo vendedor, sem IA (spec 6.2).
// Nao importa server/db.js: funcoes puras de texto.

// Palavras vazias pt-BR ignoradas na comparacao (junto com palavras < 3 letras).
const STOPWORDS = new Set([
  'voce', 'para', 'com', 'que', 'qual', 'quais', 'uma', 'um', 'seu', 'sua', 'seus', 'suas',
  'dos', 'das', 'nos', 'nas', 'por', 'mais', 'isso', 'esse', 'essa', 'tem', 'ter', 'como',
  'ja', 'nao', 'sim', 'sobre', 'pra', 'pro', 'quem', 'quando', 'onde', 'nome',
])

// Minusculas, sem acento, sem pontuacao (tudo que nao e a-z0-9 vira espaco), espacos colapsados.
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// normalizeText + remove stopwords pt-BR e palavras com menos de 3 letras.
export function normalizeWords(text) {
  const normalized = normalizeText(text)
  if (!normalized) return []
  return normalized.split(' ').filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

// Compara o texto digitado com uma lista de perguntas pendentes e devolve a mais parecida
// (similaridade = |intersecao| / |palavras da pergunta| >= 0.6), ou null se nenhuma bater.
export function recognizeQuestion(text, questions) {
  const messageWords = new Set(normalizeWords(text))
  if (!messageWords.size) return null

  let best = null
  for (const q of questions || []) {
    const questionText = String(q.text || '').replace(/\{nome\}/gi, '')
    const questionWords = normalizeWords(questionText)
    if (!questionWords.length) continue

    const uniqueWords = new Set(questionWords)
    let intersection = 0
    for (const w of uniqueWords) if (messageWords.has(w)) intersection++
    const similarity = intersection / uniqueWords.size

    if (similarity >= 0.6 && (!best || similarity > best.similarity)) {
      best = { question_key: q.question_key, text: q.text, similarity }
    }
  }
  return best
}
