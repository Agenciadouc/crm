import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { processInboundSignal } from '../server/services/signals/engine.js'

function setStageKeywords(db, stageId, fields) {
  const cols = Object.keys(fields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE funnel_stages SET ${cols} WHERE id = ?`).run(...Object.values(fields).map(v => JSON.stringify(v)), stageId)
}

function lastMessage(db, leadId) {
  return db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId)
}

function account(db, accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

test('forte vale sozinho e avanca de etapa', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['quero comprar'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quero comprar agora' })
  const msg = lastMessage(db, leadId)

  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: { ...db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) }, message: msg })

  assert.equal(result.type, 'strong')
  assert.ok(result.advanced, 'deveria ter avancado de etapa')
  const lead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.stage_id, s.stages.qualificando)
})

test('fraco SEM gatilho armado nao conta nada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa isso?' })
  const msg = lastMessage(db, leadId)

  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: msg })

  assert.equal(result.type, null)
  assert.equal(result.advanced, null)
  const lead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.stage_id, s.stages.novo)
})

test('fraco com gatilho armado + lead some = nunca confirma (fantasma), sem avanco', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 10 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 5 })
  const weakMsg = lastMessage(db, leadId)
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: weakMsg })
  assert.equal(result.type, 'weak')
  assert.equal(result.advanced, null, 'fraco sozinho (ainda nao confirmado) nao avanca')

  // lead nunca manda outra mensagem: nada mais pra processar, fica pendente pra sempre (fantasma na pratica)
  const pending = db.prepare("SELECT confirmed_at FROM lead_signals WHERE lead_id = ?").get(leadId)
  assert.equal(pending.confirmed_at, null)
})

test('fraco confirmado (lead manda outra mensagem depois) avanca de etapa na mensagem que confirma', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  const acc = account(db, s.accountId)
  const leadRow = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 15 })
  processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  addMessage(db, { leadId, direction: 'inbound', content: 'ainda ta ai?', minutesAgo: 0 })
  const result2 = processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  assert.ok(result2.advanced, 'a segunda mensagem do lead confirma o fraco e avanca')
  assert.equal(leadRow().stage_id, s.stages.qualificando)
})

test('negativo nunca avanca etapa, mesmo tendo sinal forte na mesma etapa', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['caro demais'], negative_keywords: ['caro demais, desisto'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'caro demais, desisto' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })

  assert.equal(result.type, 'negative')
  assert.equal(result.advanced, null)
})

test('fraco confirmado por uma mensagem que TAMBEM e negativa nao avanca (negativo domina a decisao de avanco)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'], negative_keywords: ['nao quero mais nada'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  const acc = account(db, s.accountId)
  const leadRow = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 15 })
  processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  addMessage(db, { leadId, direction: 'inbound', content: 'nao quero mais nada', minutesAgo: 0 })
  const result2 = processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  assert.equal(result2.type, 'negative', 'a 2a mensagem em si e classificada como negativa')
  assert.equal(result2.advanced, null, 'mesmo confirmando o fraco pendente, uma mensagem negativa nunca avanca etapa')
  assert.equal(leadRow().stage_id, s.stages.novo, 'etapa nao muda')

  const weakSignal = db.prepare("SELECT confirmed_at FROM lead_signals WHERE lead_id = ? AND signal_type = 'weak'").get(leadId)
  assert.ok(weakSignal.confirmed_at, 'o fraco pendente e confirmado mesmo assim (o lead respondeu, so nao avanca etapa)')
  const negSignal = db.prepare("SELECT 1 FROM lead_signals WHERE lead_id = ? AND signal_type = 'negative'").get(leadId)
  assert.ok(negSignal, 'o sinal negativo tambem fica registrado')
})

test('etapa sem nenhuma lista configurada nao quebra e nao gera sinal', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'oi, tudo bem?' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.deepEqual(result, { type: null, keyword: null, advanced: null })
})

test('acento e caixa variados casam igual (QUANTO CUSTA?? == quanto custa)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['não quero mais esperar, pode fechar'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'NAO QUERO MAIS ESPERAR, PODE FECHAR!!' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.equal(result.type, 'strong')
})

test('janela de silencio e a da conta, nao um valor fixo', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare('UPDATE accounts SET keyword_signal_ghost_hours = 1 WHERE id = ?').run(s.accountId)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  // gatilho ha 2h, janela da conta e so 1h -> nao arma mais
  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 120 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 0 })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.equal(result.type, null, 'gatilho de 2h atras nao deveria mais valer com janela de 1h')
})
