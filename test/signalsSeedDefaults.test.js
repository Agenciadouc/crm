import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { seedDefaultKeywordsForUntouchedStages } from '../server/services/signals/schema.js'

function stageRow(db, stageId) {
  return db.prepare('SELECT trigger_keywords, weak_keywords, strong_keywords, negative_keywords FROM funnel_stages WHERE id = ?').get(stageId)
}

test('semeia forte/negativo nas etapas 100% intocadas (sem apagar o score com o deploy)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)

  const n = seedDefaultKeywordsForUntouchedStages(db)
  assert.ok(n > 0, 'deveria ter semeado pelo menos 1 etapa')

  const row = stageRow(db, s.stages.novo)
  assert.equal(row.trigger_keywords, null, 'gatilho fica de fora (especifico do negocio)')
  assert.equal(row.weak_keywords, null, 'fraco fica de fora (precisa de gatilho especifico)')
  assert.deepEqual(JSON.parse(row.strong_keywords), ['quero comprar', 'pode fechar'])
  assert.deepEqual(JSON.parse(row.negative_keywords), ['não quero', 'caro demais'])
})

test('nao sobrescreve etapa que ja tem QUALQUER campo configurado', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare('UPDATE funnel_stages SET trigger_keywords = ? WHERE id = ?').run(JSON.stringify(['pergunta customizada']), s.stages.novo)

  seedDefaultKeywordsForUntouchedStages(db)

  const row = stageRow(db, s.stages.novo)
  assert.deepEqual(JSON.parse(row.trigger_keywords), ['pergunta customizada'])
  assert.equal(row.strong_keywords, null, 'nao deveria ter semeado forte numa etapa que ja tinha config')
})

test('e uma migracao de 1x so (guardada em app_settings) — rodar de novo nao mexe em etapa nova sem config', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)

  seedDefaultKeywordsForUntouchedStages(db)
  // Uma etapa nova criada DEPOIS da migracao (ex.: o gestor cria um funil novo depois do deploy)
  // nao deve ganhar defaults automaticos so porque ainda esta sem config.
  const novaEtapa = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, ?, 99)').run(s.funnelId, 'Etapa Nova').lastInsertRowid

  const n2 = seedDefaultKeywordsForUntouchedStages(db)
  assert.equal(n2, 0, 'a 2a chamada nao deveria semear nada (migracao ja rodou)')
  const row = stageRow(db, novaEtapa)
  assert.equal(row.strong_keywords, null, 'etapa criada depois do deploy fica sem default automatico')
})
