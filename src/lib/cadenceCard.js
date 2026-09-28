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

const PULAR = { id: 'pular', label: 'Só avançar (sem enviar)' }

// Botao principal, botao "So avancar"/"Ja sei a resposta" e links pequenos do passo da vez
export function cadenceCardActions(kind, step) {
  if (!step) return { primary: null, secondary: null, links: [] }
  const t = step.action_type
  if (MESSAGE_TYPES.includes(t)) {
    return { primary: { id: 'enviar', label: 'Revisar e enviar' }, secondary: PULAR, links: [{ id: 'feito', label: 'Marcar como feito' }] }
  }
  if (t === 'pergunta') {
    // Avulsa: a pergunta nao tem resposta por aqui; o servidor so aceita pular
    if (kind === 'avulsa') return { primary: null, secondary: PULAR, links: [] }
    if (step.state === 'aguardando') return { primary: { id: 'ja_sei', label: 'Já sei a resposta' }, secondary: null, links: [] }
    return { primary: { id: 'perguntar', label: 'Revisar e enviar' }, secondary: { id: 'ja_sei', label: 'Já sei a resposta' }, links: [] }
  }
  // Ligacao: a janela do roteiro tem o [Feito]
  if (t === 'ligacao') return { primary: { id: 'ligar', label: 'Ver roteiro e ligar' }, secondary: PULAR, links: [] }
  return { primary: { id: 'feito', label: 'Feito' }, secondary: { id: 'pular', label: 'Só avançar' }, links: [] }
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
