import { stepTitle } from './nextStep.js'

// Logica pura dos dois cartoes do bloco "Cadencia" da aba Atendimento (etapa e avulsa).
// Mesma estrutura: cabecalho "Etapa · nome" / "Avulsa · nome" com "N de M", um botao principal
// (laranja) e as acoes secundarias como links discretos. JS puro com .d.ts.

export const NO_TEXT_HINT = '(sem texto pronto — você escreve)'

const MESSAGE_TYPES = ['mensagem', 'whatsapp']

export function cardHeader(kind, name, n, m) {
  const base = kind === 'avulsa' ? 'Avulsa' : 'Etapa'
  const nm = String(name == null ? '' : name).trim()
  return { title: nm ? `${base} · ${nm}` : base, count: m ? `${n || 0} de ${m}` : '' }
}

// Passo da vez da cadencia da etapa
export function stageCardActions(step) {
  if (!step) return { primary: null, secondary: [] }
  const t = step.action_type
  if (t === 'pergunta') {
    // Ja perguntou: o que falta e anotar a resposta
    if (step.state === 'aguardando') return { primary: { id: 'ja_sei', label: 'Já sei a resposta' }, secondary: [] }
    return { primary: { id: 'perguntar', label: 'Enviar pergunta' }, secondary: [{ id: 'ja_sei', label: 'Já sei a resposta' }] }
  }
  // Mensagem sempre envia pela janela (sem texto pronto ela abre vazia); Feito fica discreto
  if (MESSAGE_TYPES.includes(t)) return { primary: { id: 'enviar', label: 'Enviar mensagem' }, secondary: [{ id: 'feito', label: 'Marcar como feito' }] }
  // Ligacao: a janela do roteiro tem o [Feito]
  if (t === 'ligacao') return { primary: { id: 'ligar', label: 'Ver roteiro e ligar' }, secondary: [] }
  return { primary: { id: 'feito', label: 'Feito' }, secondary: [] }
}

// Passo da vez da etapa no Chat: na mensagem, a descricao (interna) e so o titulo e o texto e
// SO o texto pronto (auto_message). Sem texto pronto a janela abre vazia. Igual ao cartao da avulsa.
export function stageStepView(step) {
  if (!step) return { title: '', text: '' }
  if (MESSAGE_TYPES.includes(step.action_type)) {
    return { title: String(step.description || '').trim(), text: String(step.auto_message || '').trim() }
  }
  return { title: '', text: stepTitle(step) }
}

const AVULSA_PRIMARY = { enviar: 'Enviar mensagem', roteiro: 'Ver roteiro e ligar', feito: 'Feito' }
const AVULSA_SECONDARY = { feito: 'Marcar como feito', pular: 'Pular' }

// Passo da vez da avulsa (a partir de avulsaStepView(...).actions)
export function avulsaCardActions(view) {
  const actions = (view && view.actions) || []
  const p = actions.find(a => AVULSA_PRIMARY[a])
  return {
    primary: p ? { id: p, label: AVULSA_PRIMARY[p] } : null,
    secondary: actions.filter(a => a !== p && AVULSA_SECONDARY[a]).map(a => ({ id: a, label: AVULSA_SECONDARY[a] })),
  }
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
