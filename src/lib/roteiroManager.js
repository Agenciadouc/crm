// Regras puras da tela do gestor "Qualificacao" (spec 3.1–3.3, 6.5): abas, edicao do rascunho,
// perfil maximo, versoes, "porque" das sugestoes e textos do teste A/B.
// Sem React (testavel com node:test).

// ------------------------------------------------------------------ abas ----

export const QUALIFICACAO_TABS = ['roteiro', 'desempenho', 'sugestoes']

export function parseTab(search) {
  const t = new URLSearchParams(search || '').get('tab')
  return QUALIFICACAO_TABS.includes(t) ? t : 'roteiro'
}

// ------------------------------------------------------------ numeros ----

// 83.3 -> "83,3%"; null -> "—"
export function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `${String(Math.round(Number(n) * 10) / 10).replace('.', ',')}%`
}

// Perfil maximo (spec 5.1): soma, nas perguntas de opcoes, da maior pontuacao de cada uma (negativa conta 0)
export function maxProfilePoints(questions) {
  let total = 0
  for (const q of questions || []) {
    if (q.kind !== 'options' || !Array.isArray(q.options) || !q.options.length) continue
    const best = Math.max(...q.options.map(o => Number(o.points) || 0))
    total += Math.max(0, best)
  }
  return total
}

export function profileMaxText(points) {
  if (!points) {
    return 'Perfil máximo deste roteiro: 0 pontos. Adicione perguntas de opções com pontos (ex.: Orçamento — "Acima de R$20 mil" = 30) para o termômetro medir o Perfil.'
  }
  return `Perfil máximo deste roteiro: ${points} ${points === 1 ? 'ponto' : 'pontos'}. Cada lead vai de 0 a 50 no Perfil conforme as opções respondidas.`
}

// ------------------------------------------------------ edicao do rascunho ----

// Chave nova gerada no navegador (o servidor aceita a chave enviada); deixa o desvio
// apontar para uma pergunta que ainda nao foi salva.
export function newLocalKey() {
  let s = ''
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export function stageQuestions(questions, stageId) {
  return (questions || []).filter(q => q.stage_id === stageId).sort((a, b) => a.position - b.position)
}

// Renumera as posicoes 0..n-1 dentro de cada etapa, na ordem atual
function renumber(questions, stageIds) {
  const pos = new Map()
  for (const id of stageIds) stageQuestions(questions, id).forEach((q, i) => pos.set(q.question_key, i))
  return questions.map(q => (pos.has(q.question_key) ? { ...q, position: pos.get(q.question_key) } : q))
}

// Sobe (-1) ou desce (+1) a pergunta dentro da etapa
export function moveQuestion(questions, key, dir) {
  const q = (questions || []).find(x => x.question_key === key)
  if (!q) return questions
  const list = stageQuestions(questions, q.stage_id)
  const i = list.findIndex(x => x.question_key === key)
  const j = i + dir
  if (j < 0 || j >= list.length) return questions
  const order = list.map(x => x.question_key)
  ;[order[i], order[j]] = [order[j], order[i]]
  const pos = new Map(order.map((k, idx) => [k, idx]))
  return questions.map(x => (pos.has(x.question_key) ? { ...x, position: pos.get(x.question_key) } : x))
}

// Leva a pergunta para o fim de outra etapa
export function moveToStage(questions, key, stageId) {
  const q = (questions || []).find(x => x.question_key === key)
  if (!q || q.stage_id === stageId) return questions
  const from = q.stage_id
  const end = stageQuestions(questions, stageId).length
  const moved = questions.map(x => (x.question_key === key ? { ...x, stage_id: stageId, position: end } : x))
  return renumber(moved, [from, stageId])
}

export function addQuestion(questions, stageId, key = newLocalKey()) {
  const list = questions || []
  const q = {
    question_key: key, stage_id: stageId, position: stageQuestions(list, stageId).length,
    text: '', kind: 'text', required: false, spin: null, profile_key: null, ai_hint: null, options: [],
  }
  return list.concat([q])
}

// Apaga a pergunta; desvio que voltava para ela passa a nao voltar para nenhuma
export function removeQuestion(questions, deviations, key) {
  const q = (questions || []).find(x => x.question_key === key)
  if (!q) return { questions, deviations }
  const rest = renumber(questions.filter(x => x.question_key !== key), [q.stage_id])
  const devs = (deviations || []).map(d => (d.return_question_key === key ? { ...d, return_question_key: null } : d))
  return { questions: rest, deviations: devs }
}

// Troca texto <-> opcoes: opcoes comecam com 2 linhas vazias (o servidor pede de 2 a 10)
export function changeKind(question, kind) {
  if (question.kind === kind) return question
  if (kind === 'options') {
    const options = question.options && question.options.length >= 2
      ? question.options
      : [{ label: '', points: 0 }, { label: '', points: 0 }]
    return { ...question, kind, options }
  }
  return { ...question, kind, options: [] }
}

// Conteudo comparavel (sem ids de banco); a ordem das perguntas segue etapa/posicao
function canon(content) {
  const qs = [...((content && content.questions) || [])]
    .sort((a, b) => (a.stage_id - b.stage_id) || (a.position - b.position))
    .map(q => ({
      k: q.question_key || '', s: q.stage_id, p: q.position, t: String(q.text || '').trim(), kind: q.kind,
      r: !!q.required, b: q.spin || null, pk: q.profile_key || null, h: String(q.ai_hint || '').trim() || null,
      o: (q.options || []).map(o => [String(o.label || '').trim(), Number(o.points) || 0]),
    }))
  const ds = ((content && content.deviations) || []).map(d => [
    String(d.triggers || '').trim(), String(d.reply_text || '').trim(), d.return_question_key || null,
  ])
  return JSON.stringify({ qs, ds })
}

export function sameContent(a, b) {
  return canon(a) === canon(b)
}

const isEmpty = c => !c || (!(c.questions || []).length && !(c.deviations || []).length)

// Rascunho do servidor diferente do publicado -> "Mudancas nao publicadas"
export function hasUnpublished(roteiro) {
  if (!roteiro || !roteiro.draft) return false
  if (!roteiro.published) return !isEmpty(roteiro.draft)
  return !sameContent(roteiro.draft, roteiro.published)
}

// O funil ja tem perguntas (rascunho ou publicado)? Montar com IA pede confirmacao.
export function hasAnyQuestions(roteiro) {
  return !!roteiro && (((roteiro.draft && roteiro.draft.questions) || []).length > 0
    || ((roteiro.published && roteiro.published.questions) || []).length > 0)
}

// "Versoes anteriores": sem a linha do rascunho, mais nova primeiro
export function previousVersions(versions) {
  return (versions || []).filter(v => v.status !== 'draft').sort((a, b) => b.version - a.version)
}

// Corpo do PUT /draft
export function toDraftInput(content) {
  return {
    questions: (content.questions || []).map(q => ({
      question_key: q.question_key, stage_id: q.stage_id, position: q.position, text: q.text, kind: q.kind,
      required: !!q.required, spin: q.spin || null, profile_key: q.profile_key || null, ai_hint: q.ai_hint || null,
      options: q.kind === 'options'
        ? (q.options || []).map((o, idx) => ({ option_key: o.option_key, label: o.label, points: Number(o.points) || 0, position: idx, ...(o.sets_profile_key ? { sets_profile_key: o.sets_profile_key } : {}) }))
        : [],
    })),
    deviations: (content.deviations || []).map((d, idx) => ({
      triggers: d.triggers, reply_text: d.reply_text, return_question_key: d.return_question_key || null, position: idx,
    })),
  }
}

// ------------------------------------------------------------ sugestoes ----

const lost = rate => (rate == null ? null : Math.max(0, Math.round((100 - Number(rate)) * 10) / 10))

function weakIntro(rate, sent) {
  const l = lost(rate)
  if (l == null) return 'Esta pergunta tem pouca resposta.'
  const envios = sent ? ` em ${sent} ${sent === 1 ? 'envio' : 'envios'}` : ''
  return `Esta pergunta perde ${fmtPct(l)} dos clientes (taxa ${fmtPct(rate)}${envios}).`
}

const SPIN_NAMES = { situation: 'Situação', problem: 'Problema', implication: 'Implicação', need_payoff: 'Necessidade de Solução' }
const WEEKLY = 'Da revisão semanal:'

// Sugestao da revisao semanal (spec 2026-10-02 §10): o motivo que a IA viu nas conversas.
function weeklyWhy(s) {
  const p = s.payload || {}
  const e = s.evidence || {}
  const reason = e.reason ? ` ${e.reason}` : ''
  if (s.type === 'new_question') {
    return `${WEEKLY}${reason} Ex.: "${p.text}" (${p.spin ? SPIN_NAMES[p.spin] || p.spin : 'sem fase'}, perfil ${p.profile_name || 'Todos'}).`
  }
  if (s.type === 'new_profile') {
    const n = Number(e.count) || 0
    return `${WEEKLY}${reason}${n ? ` Apareceu em ${n} ${n === 1 ? 'conversa' : 'conversas'}.` : ''}`
  }
  if (s.type === 'rewrite') return `${WEEKLY}${reason} A IA escreveu 2 versões novas; teste uma contra a atual.`
  return null
}

// Frase com o numero que justifica a sugestao (spec 3.3)
export function suggestionWhy(s) {
  const p = (s && s.payload) || {}
  const e = (s && s.evidence) || {}
  if (e.source === 'weekly') {
    const w = weeklyWhy(s)
    if (w) return w
  }
  switch (s && s.type) {
    case 'seller_phrasing': {
      const who = p.seller_name ? ` com ${p.seller_name}` : ''
      return `${weakIntro(p.current_rate, e.sent)} A versão abaixo teve ${fmtPct(p.seller_rate)}${who}.`
    }
    case 'rewrite':
      return `${weakIntro(p.current_rate, e.sent)} A IA escreveu 2 versões novas; teste uma contra a atual.`
    case 'new_option': {
      const n = Number(p.count) || 0
      const base = `${n} ${n === 1 ? 'cliente respondeu' : 'clientes responderam'} algo como "${p.label}"${e.source === 'weekly' ? ' nas conversas da semana' : ' em texto livre'}. Virando opção, o vendedor marca com um clique e a resposta conta pontos no Perfil.`
      return e.source === 'weekly' ? `${WEEKLY} ${base}` : base
    }
    case 'new_deviation': {
      const n = Number(p.count) || Number(e.leads) || 0
      return `${n} ${n === 1 ? 'cliente perguntou' : 'clientes diferentes perguntaram'} isso fora do roteiro. Com o desvio, o vendedor já tem a resposta pronta e volta para o roteiro.`
    }
    case 'reorder': {
      const b = e.before || {}
      const a = e.after || {}
      const gain = p.gain != null ? `${String(p.gain).replace('.', ',')} pontos` : 'mais'
      const nums = b.rate != null && a.rate != null
        ? ` (${fmtPct(b.rate)} quando feita antes, ${fmtPct(a.rate)} quando feita depois)`
        : ''
      return `Fazer a pergunta antes aumenta a resposta em ${gain}${nums}.`
    }
    default:
      return ''
  }
}

export const SUGGESTION_TITLES = {
  rewrite: 'Reescrever pergunta fraca',
  seller_phrasing: 'Jeito do melhor vendedor',
  new_option: 'Nova opção de resposta',
  new_deviation: 'Novo desvio',
  reorder: 'Trocar a ordem',
  new_question: 'Pergunta nova',
  new_profile: 'Perfil novo',
}

// Sugestao seller_phrasing ja criada para a pergunta e o vendedor (Desempenho > "Usar o jeito de X")
export function findSellerSuggestion(suggestions, questionKey, seller) {
  return (suggestions || []).find(s => s.type === 'seller_phrasing' && s.question_key === questionKey
    && ((s.evidence && s.evidence.seller_id != null && seller && s.evidence.seller_id === seller.user_id)
      || (seller && seller.name && s.payload && s.payload.seller_name === seller.name))) || null
}

// ---------------------------------------------------------------- A/B ----

export function testRemainingText(test) {
  if (test.status !== 'testing') return 'Teste terminado.'
  const d = Number(test.days_left) || 0
  const prazo = d <= 0 ? 'Termina na próxima análise da madrugada' : `Faltam até ${d} ${d === 1 ? 'dia' : 'dias'}`
  return `${prazo} (ou antes, quando cada versão tiver 30 envios).`
}

export function testResultText(test) {
  const a = test.a || {}
  const b = test.b || {}
  const nums = `Atual ${fmtPct(a.rate)} (${a.sent || 0} envios) × nova ${fmtPct(b.rate)} (${b.sent || 0} envios).`
  if (test.status === 'won') return `A nova versão venceu. ${nums}`
  if (test.status === 'lost') return `A versão atual continua melhor ou empatou (diferença menor que 5 pontos). ${nums}`
  return nums
}

// Largura da barra (0..100) a partir da taxa
export function barWidth(rate) {
  const n = Number(rate)
  if (rate == null || Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, n))
}
