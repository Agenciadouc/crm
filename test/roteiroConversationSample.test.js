// Amostra de conversas reais da conta para a IA do roteiro (spec 2026-10-02 §8.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { sampleConversations } from '../server/services/roteiro/conversationSample.js'

function conversa(db, s, { name = 'Maria Souza', phone = '5548999112233', stage = 'qualificando', msgs = 3, accountId = s.accountId, funnelId = s.funnelId, stageId, minutesAgo = 0 } = {}) {
  const id = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stageId === undefined ? s.stages[stage] : stageId, name, phone })
  addMessage(db, { leadId: id, direction: 'outbound', content: 'Oi Maria, tudo bem?', minutesAgo: minutesAgo + 30 })
  addMessage(db, { leadId: id, direction: 'inbound', content: 'Oi! Meu fone é 48 99911-2233, sou a Maria', minutesAgo: minutesAgo + 20 })
  for (let i = 2; i < msgs; i++) addMessage(db, { leadId: id, direction: 'inbound', content: 'x'.repeat(400), minutesAgo: minutesAgo + 10 })
  return id
}

test('so da conta, sem nome/telefone, cortes de 300 e cabecalho com resultado', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const comprou = conversa(db, s)
  db.prepare('INSERT INTO lead_sales (account_id, lead_id, value) VALUES (?, ?, 100)').run(s.accountId, comprou)
  const otherFunnel = Number(db.prepare("INSERT INTO funnels (account_id, name) VALUES (?, 'F')").run(s.otherAccountId).lastInsertRowid)
  conversa(db, s, { accountId: s.otherAccountId, funnelId: otherFunnel, stageId: null, name: 'Outra Conta' })
  const r = sampleConversations(db, { accountId: s.accountId })
  assert.equal(r.count, 1); assert.equal(r.counts.bought, 1)
  assert.match(r.text, /resultado: comprou/)
  assert.match(r.text, /etapa atual: Qualificando/)
  assert.match(r.text, /Vendedor: Oi \[cliente\], tudo bem\?/)
  assert.match(r.text, /\[telefone\]/)
  assert.doesNotMatch(r.text, /Maria|99911|Outra Conta/)
  assert.ok(r.text.split('\n').every(l => l.length <= 320))
})

test('filtros: 1 recebida e 3 mensagens nos ultimos 90 dias; prioridade; teto corta as de menor prioridade', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  conversa(db, s, { msgs: 2 }) // so 2 mensagens: fora
  conversa(db, s, { name: 'Velho Antigo', minutesAgo: 100 * 1440 }) // fora dos 90 dias
  const adv = conversa(db, s, { name: 'Ana Lima', phone: '5511988887777' })
  db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id) VALUES (?, ?, ?)').run(adv, s.stages.novo, s.stages.qualificando)
  for (let i = 0; i < 3; i++) conversa(db, s, { name: `Zé ${i}`, phone: `55119000000${i}` })
  const r = sampleConversations(db, { accountId: s.accountId, caps: { bought: 20, advanced: 10, other: 2 } })
  assert.deepEqual(r.counts, { bought: 0, advanced: 1, other: 2 })
  assert.match(r.text.split('### ')[1], /resultado: avançou/) // maior prioridade primeiro
  const small = sampleConversations(db, { accountId: s.accountId, maxChars: 1000 })
  assert.ok(small.text.length <= 1000)
  assert.deepEqual(small.counts, { bought: 0, advanced: 1, other: 1 })
})

test('conta sem conversas: texto vazio', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  assert.deepEqual(sampleConversations(db, { accountId: s.accountId }), { text: '', count: 0, counts: { bought: 0, advanced: 0, other: 0 } })
})
