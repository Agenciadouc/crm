// Traducao de variaveis dos textos automaticos do numero.
// Um mesmo texto ("Primeira mensagem" da tela de Integracoes) e gravado na saudacao
// (instance_auto_messages.greeting_text) e na primeira mensagem de lead entregue a vendedor
// (whatsapp_instances.first_msg_template). Por isso os dois caminhos entendem as mesmas variaveis.
// Modulo puro (sem db) para rodar no node --test.

function firstName(s) {
  if (!s) return ''
  return String(s).split(' ')[0] || String(s)
}

// Saudacao e ausencia (autoMessages.js). Sem etapa/funil neste caminho: ficam em branco.
export function applyAutoMessageVars(text, lead, instance) {
  if (!text) return text
  const leadName = lead?.name || 'Cliente'
  const leadFirst = firstName(lead?.name) || 'Cliente'
  const attendant = lead?.attendant_name || 'nosso time'
  const attendantFirst = firstName(lead?.attendant_name) || 'nosso time'
  return String(text)
    .replace(/\{\{name\}\}/g, leadName)
    .replace(/\{\{nome\}\}/g, leadName)
    .replace(/\{\{primeiro_nome\}\}/g, leadFirst)
    .replace(/\{\{first_name\}\}/g, leadFirst)
    .replace(/\{\{phone\}\}/g, lead?.phone || '')
    .replace(/\{\{empresa\}\}/g, lead?.empresa || '')
    .replace(/\{\{cidade\}\}/g, lead?.city || '')
    .replace(/\{\{instance\}\}/g, instance?.instance_name || '')
    .replace(/\{\{atendente\}\}/g, attendant)
    .replace(/\{\{attendant\}\}/g, attendant)
    .replace(/\{\{vendedor\}\}/g, attendant)
    .replace(/\{\{atendente_nome\}\}/g, attendantFirst)
    .replace(/\{\{vendedor_primeiro_nome\}\}/g, attendantFirst)
    .replace(/\{\{etapa\}\}/g, '')
    .replace(/\{\{funil\}\}/g, '')
}

// Primeira mensagem de lead entregue a vendedor (leadHandoff.js). Mantem o comportamento
// antigo: variavel sem dado vira texto vazio.
export function renderHandoffTemplate(tpl, vars = {}) {
  if (!tpl) return ''
  return String(tpl)
    .replace(/\{\{primeiro_nome\}\}/g, vars.lead_first_name || '')
    .replace(/\{\{first_name\}\}/g, vars.lead_first_name || '')
    .replace(/\{\{nome\}\}/g, vars.lead_name || '')
    .replace(/\{\{name\}\}/g, vars.lead_name || '')
    .replace(/\{\{vendedor\}\}/g, vars.user_name || '')
    .replace(/\{\{atendente\}\}/g, vars.user_name || '')
    .replace(/\{\{vendedor_primeiro_nome\}\}/g, vars.user_first_name || '')
    .replace(/\{\{atendente_nome\}\}/g, vars.user_first_name || '')
    .replace(/\{\{cidade\}\}/g, vars.city || '')
    .replace(/\{\{empresa\}\}/g, vars.empresa || '')
    .replace(/\{\{phone\}\}/g, vars.phone || '')
    .replace(/\{\{etapa\}\}/g, vars.stage_name || '')
    .replace(/\{\{funil\}\}/g, vars.funnel_name || '')
    .replace(/\{\{instance\}\}/g, vars.instance_name || '')
}
