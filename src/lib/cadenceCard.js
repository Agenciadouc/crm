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

const AVULSA_PRIMARY = { enviar: 'Enviar mensagem', roteiro: 'Ver roteiro e ligar', feito: 'Feito' }

// Passo da vez da avulsa (a partir de avulsaStepView(...).actions)
export function avulsaCardActions(view) {
  const actions = (view && view.actions) || []
  const p = actions.find(a => AVULSA_PRIMARY[a])
  return {
    primary: p ? { id: p, label: AVULSA_PRIMARY[p] } : null,
    secondary: actions.includes('pular') ? [{ id: 'pular', label: 'Pular' }] : [],
  }
}

const CADENCE_BLOCKS = ['proximo_passo', 'avulsa']

// Blocos que mostram o titulo "Cadencia": o primeiro de cada sequencia de blocos de cadencia lado a lado
export function cadenceTitleIds(ids) {
  return (ids || []).filter((id, i) => CADENCE_BLOCKS.includes(id) && !CADENCE_BLOCKS.includes(ids[i - 1]))
}
