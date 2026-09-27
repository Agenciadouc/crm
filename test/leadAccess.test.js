// Testes diretos de server/services/leadAccess.js com banco em memoria (parametro
// `database` opcional). Existem por causa do defeito do fix round 1: renomear o import
// do topo do arquivo (`db` -> `defaultDb`) sem atualizar o corpo de getUserPrimaryInstanceId
// deixou um `db.prepare(...)` solto la dentro — ReferenceError em toda mensagem enviada por
// atendente (server/routes/messages.js:53), e nenhum teste existente chamava essa funcao.
// Chamar as duas funcoes aqui com o banco injetado garante que um ReferenceError desses
// derruba a suite, em vez de passar em silencio.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { canAtendenteAccessLead, getUserPrimaryInstanceId } from '../server/services/leadAccess.js'

test('getUserPrimaryInstanceId: sem instancia primaria -> null, com instancia -> o id', () => {
  const db = createRoteiroTestDb()
  const { accountId } = seedRoteiroBase(db)
  const semInstancia = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Sem Instancia', 's@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'n2', 'connected')").run(accountId).lastInsertRowid)
  const comInstancia = Number(db.prepare("INSERT INTO users (account_id, name, email, role, primary_instance_id) VALUES (?, 'Com Instancia', 'c@a.local', 'atendente', ?)").run(accountId, instanceId).lastInsertRowid)

  assert.equal(getUserPrimaryInstanceId(semInstancia, db), null)
  assert.equal(getUserPrimaryInstanceId(comInstancia, db), instanceId)
})

test('canAtendenteAccessLead: attendant_id, lead_instance_assignments e primary_instance_id, com banco injetado', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const dono = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Dono', 'd@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const outro = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Outro', 'o@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const semNada = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Sem Nada', 'n@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'n3', 'connected')").run(accountId).lastInsertRowid)
  db.prepare('UPDATE users SET primary_instance_id = ? WHERE id = ?').run(instanceId, outro)

  const leadDono = addLead(db, { account_id: accountId, name: 'Lead Dono', funnel_id: funnelId, stage_id: stages.novo, attendant_id: dono })
  const leadPorInstancia = addLead(db, { account_id: accountId, name: 'Lead Instancia', funnel_id: funnelId, stage_id: stages.novo, instance_id: instanceId })
  const leadPorAssignment = addLead(db, { account_id: accountId, name: 'Lead Assignment', funnel_id: funnelId, stage_id: stages.novo })
  db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(leadPorAssignment, instanceId, semNada)
  const leadDeNinguem = addLead(db, { account_id: accountId, name: 'Lead Ninguem', funnel_id: funnelId, stage_id: stages.novo })

  const lead = id => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)

  assert.equal(canAtendenteAccessLead(dono, lead(leadDono), db), true, 'attendant_id')
  assert.equal(canAtendenteAccessLead(outro, lead(leadPorInstancia), db), true, 'primary_instance_id')
  assert.equal(canAtendenteAccessLead(semNada, lead(leadPorAssignment), db), true, 'lead_instance_assignments')
  assert.equal(canAtendenteAccessLead(semNada, lead(leadDeNinguem), db), false, 'sem nenhum vinculo')
  assert.equal(canAtendenteAccessLead(dono, null, db), false, 'lead nulo')
})
