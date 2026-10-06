import { stepTitle, stepTypeLabel } from './nextStep.js'

// Logica pura dos dois cartoes do bloco "Cadencia" da aba Atendimento (etapa e avulsa), no visual
// do bloco antigo: linha laranja "Etapa N/M: TIPO", caixa com o texto, botao principal e botao
// "So avancar" de largura toda, e links pequenos embaixo. JS puro com .d.ts.

// Caixa do texto vazia (mensagem sem texto pronto): a janela de conferir abre vazia
export const BOX_PLACEHOLDER = 'Sem texto pronto — você escreve ao enviar'

const MESSAGE_TYPES = ['mensagem', 'whatsapp']

// "Passo 1/4: PERGUNTA" (etapa) / "Etapa 6/7: MENSAGEM" (avulsa); sem total, so o tipo
export function stepLine(kind, n, m, type) {
  const t = String(stepTypeLabel(type) || '').toUpperCase()
  if (!m) return t
  return `${kind === 'avulsa' ? 'Etapa' : 'Passo'} ${n || 1}/${m}: ${t}`
}

const PULAR = { id: 'pular', label: 'Pular' }

// Botao principal, botao "Pular"/"Ja sei a resposta" e links pequenos do passo da vez (mesmas palavras na etapa e na extra)
export function cadenceCardActions(kind, step) {
  if (!step) return { primary: null, secondary: null, links: [] }
  const t = step.action_type
  if (MESSAGE_TYPES.includes(t)) {
    return { primary: { id: 'enviar', label: 'Enviar' }, secondary: PULAR, links: [{ id: 'feito', label: 'Já mandei por fora' }] }
  }
  if (t === 'pergunta') {
    // Avulsa: a pergunta nao tem resposta por aqui; o servidor so aceita pular
    if (kind === 'avulsa') return { primary: null, secondary: PULAR, links: [] }
    if (step.state === 'aguardando') return { primary: { id: 'ja_sei', label: 'Já sei a resposta' }, secondary: null, links: [] }
    return { primary: { id: 'perguntar', label: 'Enviar' }, secondary: { id: 'ja_sei', label: 'Já sei a resposta' }, links: [] }
  }
  // Ligacao: a janela do roteiro tem o [Feito]
  if (t === 'ligacao') return { primary: { id: 'ligar', label: 'Ver roteiro e ligar' }, secondary: PULAR, links: [] }
  return { primary: { id: 'feito', label: 'Feito' }, secondary: PULAR, links: [] }
}

// Passo da vez da etapa no Chat: na mensagem, a descricao (interna) e so o titulo e o texto e
// SO o texto pronto (auto_message). Sem texto pronto a janela abre vazia. Igual ao cartao da avulsa.
// fill = troca das variaveis so para a previa (a janela troca na abertura, do texto cru)
export function stageStepView(step, fill = t => t) {
  if (!step) return { title: '', text: '' }
  if (MESSAGE_TYPES.includes(step.action_type)) {
    const raw = String(step.auto_message || '').trim()
    return { title: String(step.description || '').trim(), text: raw ? String(fill(raw) || '').trim() : '' }
  }
  return { title: '', text: stepTitle(step) }
}

export const CADENCE_GROUP = 'cadencia'
const CADENCE_BLOCKS = ['proximo_passo', 'avulsa']

// Ordem de desenho da aba: etapa e avulsa viram UM grupo "cadencia", na posicao do primeiro
// dos dois que aparece (o segundo sai da propria posicao). Um so visivel: o grupo tem so ele.
export function cadenceRenderList(ids) {
  const out = []
  for (const id of ids || []) {
    if (!CADENCE_BLOCKS.includes(id)) out.push(id)
    else if (!out.includes(CADENCE_GROUP)) out.push(CADENCE_GROUP)
  }
  return out
}

// Cartao unico "Proximo passo" (etapa + cadencia extra, ajuste 06/10): o que fazer, em uma palavra
const ACTION_WORDS = { pergunta: 'Pergunte', mensagem: 'Mande', whatsapp: 'Mande', ligacao: 'Ligue', email: 'Mande um e-mail', visita: 'Visite', reuniao: 'Faça a reunião' }
export function actionWord(type) {
  return ACTION_WORDS[type] || String(stepTypeLabel(type) || type || '')
}

// "N de M" do cartao: passos da etapa primeiro, depois os da cadencia extra. Nada pendente: null.
// extra = { done, total } da cadencia extra ainda em andamento (ou null)
export function unifiedProgress({ stageDone = 0, stageTotal = 0, stageHasNext = false, extra = null }) {
  const extraTotal = extra ? extra.total || 0 : 0
  const m = (stageTotal || 0) + extraTotal
  if (stageHasNext) return { n: (stageDone || 0) + 1, m }
  if (extra && (extra.done || 0) < extraTotal) return { n: (stageTotal || 0) + (extra.done || 0) + 1, m }
  return null
}

const COUNT_NAMES = {
  pergunta: ['pergunta', 'perguntas'], mensagem: ['mensagem', 'mensagens'], ligacao: ['ligação', 'ligações'],
  email: ['e-mail', 'e-mails'], visita: ['visita', 'visitas'], reuniao: ['reunião', 'reuniões'],
}
const countKey = t => (t === 'whatsapp' ? 'mensagem' : t)
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`

// "Depois: 2 perguntas, 1 mensagem e 4 passos da cadência extra"
export function afterSummary(after, extraRemaining = 0) {
  const counts = new Map()
  for (const s of after || []) {
    const k = countKey(s.action_type)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const parts = [...counts].map(([k, n]) => plural(n, COUNT_NAMES[k] || [String(stepTypeLabel(k) || k).toLowerCase(), String(stepTypeLabel(k) || k).toLowerCase()]))
  const stagePart = parts.join(', ')
  const extraPart = extraRemaining > 0 ? plural(extraRemaining, ['passo da cadência extra', 'passos da cadência extra']) : ''
  if (!stagePart && !extraPart) return ''
  return `Depois: ${[stagePart, extraPart].filter(Boolean).join(' e ')}`
}
