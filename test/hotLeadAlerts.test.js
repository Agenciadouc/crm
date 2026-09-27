import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'
import { businessMinutesBetween } from '../server/services/leadScore/businessMinutes.js'
import { runHotLeadAlerts } from '../server/services/leadScore/hotLeadAlerts.js'

const WEEKDAYS_8_18 = JSON.stringify({
  mon: [{ start: '08:00', end: '18:00' }], tue: [{ start: '08:00', end: '18:00' }], wed: [{ start: '08:00', end: '18:00' }],
  thu: [{ start: '08:00', end: '18:00' }], fri: [{ start: '08:00', end: '18:00' }], sat: [], sun: [],
})

// Sexta 25/09/2026 17:30 em Sao Paulo (UTC-3) = 20:30 UTC; segunda 28/09 08:30 = 11:30 UTC.
const FRI_1730 = new Date('2026-09-25T20:30:00Z')
const MON_0830 = new Date('2026-09-28T11:30:00Z')

// --- businessMinutes ------------------------------------------------------------------

test('businessMinutesBetween: sexta 17:30 -> segunda 08:30 com horario 08-18 = 60 min', () => {
  assert.equal(businessMinutesBetween(WEEKDAYS_8_18, FRI_1730, MON_0830), 60)
})

test('businessMinutesBetween: aceita objeto e respeita o fuso', () => {
  const schedule = JSON.parse(WEEKDAYS_8_18)
  assert.equal(businessMinutesBetween(schedule, FRI_1730, MON_0830, 'America/Sao_Paulo'), 60)
  // em UTC, sexta 20:30 -> segunda 11:30: so conta segunda 08:00-11:30 = 210
  assert.equal(businessMinutesBetween(schedule, FRI_1730, MON_0830, 'UTC'), 210)
})

test('businessMinutesBetween: sem horario ou invalido = minutos corridos', () => {
  const from = new Date('2026-09-25T10:00:00Z')
  const to = new Date('2026-09-25T11:30:00Z')
  assert.equal(businessMinutesBetween(null, from, to), 90)
  assert.equal(businessMinutesBetween('isso nao e json', from, to), 90)
  assert.equal(businessMinutesBetween(JSON.stringify({ mon: [], tue: [] }), from, to), 90)
  assert.equal(businessMinutesBetween(null, to, from), 0)
})

test('businessMinutesBetween: limita a 7 dias de contagem', () => {
  const from = new Date('2026-09-01T00:00:00Z')
  const to = new Date('2026-09-20T00:00:00Z')
  const everyDay = JSON.stringify(Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => [d, [{ start: '00:00', end: '23:59' }]])))
  assert.ok(businessMinutesBetween(everyDay, from, to) <= 10080)
})

// --- runHotLeadAlerts ------------------------------------------------------------------

function insertMsg(db, { leadId, accountId, direction, createdAt }) {
  db.prepare('INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(leadId, accountId, direction, 'oi', toSqliteDate(createdAt))
}

function hotLead(db, s, fields = {}) {
  return addLead(db, {
    account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, attendant_id: s.atendenteId,
    score: 72, score_band: 'quente', ...fields,
  })
}

function alertsFor(db, leadId) {
  return db.prepare("SELECT * FROM analyst_alerts WHERE lead_id = ? AND type = 'lead_quente_sem_resposta'").all(leadId)
}

test('runHotLeadAlerts: cria 1 aviso para lead quente sem resposta ha >= 60 min e nao duplica', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const now = new Date('2026-09-23T15:00:00Z')
  const leadId = hotLead(db, s, { name: 'Maria Souza' })
  insertMsg(db, { leadId, accountId: s.accountId, direction: 'outbound', createdAt: new Date(now.getTime() - 120 * 60000) })
  insertMsg(db, { leadId, accountId: s.accountId, direction: 'inbound', createdAt: new Date(now.getTime() - 90 * 60000) })

  assert.equal(runHotLeadAlerts(db, { now }).created, 1)
  const [alert] = alertsFor(db, leadId)
  assert.equal(alert.account_id, s.accountId)
  assert.equal(alert.severity, 'alta')
  assert.equal(alert.status, 'open')
  assert.equal(alert.title, 'Maria Souza está Quente e sem resposta')
  assert.equal(alert.description, 'Última mensagem do cliente há 90 min (horário de atendimento).')
  assert.equal(alert.suggested_action, 'Responda agora: leads respondidos em até 1 hora têm muito mais chance de fechar.')
  assert.equal(alert.assigned_to_user_id, s.atendenteId)

  assert.equal(runHotLeadAlerts(db, { now: new Date(now.getTime() + 10 * 60000) }).created, 0)
  assert.equal(alertsFor(db, leadId).length, 1)
})

test('runHotLeadAlerts: nao cria para lead respondido, recente, frio, arquivado ou em etapa final', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const now = new Date('2026-09-23T15:00:00Z')
  const ago = min => new Date(now.getTime() - min * 60000)

  const respondido = hotLead(db, s)
  insertMsg(db, { leadId: respondido, accountId: s.accountId, direction: 'inbound', createdAt: ago(120) })
  insertMsg(db, { leadId: respondido, accountId: s.accountId, direction: 'outbound', createdAt: ago(100) })

  const recente = hotLead(db, s)
  insertMsg(db, { leadId: recente, accountId: s.accountId, direction: 'inbound', createdAt: ago(30) })

  const frio = hotLead(db, s, { score: 20, score_band: 'frio' })
  insertMsg(db, { leadId: frio, accountId: s.accountId, direction: 'inbound', createdAt: ago(120) })

  const arquivado = hotLead(db, s, { is_archived: 1 })
  insertMsg(db, { leadId: arquivado, accountId: s.accountId, direction: 'inbound', createdAt: ago(120) })

  const vendido = hotLead(db, s, { stage_id: s.stages.venda })
  insertMsg(db, { leadId: vendido, accountId: s.accountId, direction: 'inbound', createdAt: ago(120) })

  assert.equal(runHotLeadAlerts(db, { now }).created, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analyst_alerts').get().n, 0)
})

test('runHotLeadAlerts: conta so horario de atendimento da instancia e usa score_alert_minutes da conta', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare('INSERT INTO instance_auto_messages (instance_id, away_schedule_json) VALUES (?, ?)').run(s.instanceId, WEEKDAYS_8_18)
  const leadId = hotLead(db, s, { name: 'Pedro', score: 90, score_band: 'pronto', last_instance_id: s.instanceId })
  insertMsg(db, { leadId, accountId: s.accountId, direction: 'inbound', createdAt: FRI_1730 })

  // 60 minutos uteis; conta pede 90 -> ainda nao
  db.prepare('UPDATE accounts SET score_alert_minutes = 90 WHERE id = ?').run(s.accountId)
  assert.equal(runHotLeadAlerts(db, { now: MON_0830 }).created, 0)

  db.prepare('UPDATE accounts SET score_alert_minutes = 60 WHERE id = ?').run(s.accountId)
  assert.equal(runHotLeadAlerts(db, { now: MON_0830 }).created, 1)
  const [alert] = alertsFor(db, leadId)
  assert.equal(alert.title, 'Pedro está Pronto p/ fechar e sem resposta')
  assert.equal(alert.description, 'Última mensagem do cliente há 60 min (horário de atendimento).')
})

test('runHotLeadAlerts: aviso resolvido nao impede um novo depois', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const now = new Date('2026-09-23T15:00:00Z')
  const leadId = hotLead(db, s)
  insertMsg(db, { leadId, accountId: s.accountId, direction: 'inbound', createdAt: new Date(now.getTime() - 90 * 60000) })
  db.prepare(`INSERT INTO analyst_alerts (account_id, lead_id, type, severity, title, status) VALUES (?, ?, 'lead_quente_sem_resposta', 'alta', 'x', 'resolved')`).run(s.accountId, leadId)
  assert.equal(runHotLeadAlerts(db, { now }).created, 1)
})
