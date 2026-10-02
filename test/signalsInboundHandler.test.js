import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { configureStageMoveHooks } from '../server/services/stageMove.js'
import { createInboundHandler } from '../server/services/inboundHandler.js'
import { applyKeywordSignalsSchema } from '../server/services/signals/schema.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede nos testes') } })

function textPayload(text, idSuffix) {
  const p = JSON.parse(JSON.stringify(P.textConversation))
  p.data.message.conversation = text
  p.data.key.id = `3EB0SIGNAL${idSuffix}`
  return p
}

function setup() {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  const seed = seedBasic(db)
  db.prepare('UPDATE funnel_stages SET strong_keywords = ? WHERE id = ?').run(JSON.stringify(['quero comprar']), seed.stage1)
  const intake = createLeadIntake({ db, pickFromRoulette: () => null, notifyAndOpenLead: () => Promise.resolve(), triggerCapiForStageChange: () => {} })
  configureStageMoveHooks({ onMoved: null })
  const handler = createInboundHandler({
    db,
    broadcastSSE: () => {},
    triggerCapiForStageChange: () => {},
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: () => Promise.resolve(),
    shouldSendAway: () => false,
    processInboundMessage: () => Promise.resolve(),
    scheduleAiForInbound: () => Promise.resolve(),
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: () => Promise.resolve(),
    sendOptOutConfirmation: () => Promise.resolve(),
  })
  const receive = (payload, opts = {}) => {
    const { messages } = adapter.parseWebhook(seed.instance, payload, {})
    assert.equal(messages.length, 1)
    return handler.handleInboundMessage(seed.account, seed.instance, messages[0], { source: 'webhook', ...opts })
  }
  return { db, seed, receive }
}

test('mensagem inbound que bate palavra forte grava sinal em lead_signals', async () => {
  const { db, receive } = setup()
  await receive(textPayload('quero comprar isso agora', '001'))
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.ok(row, 'deveria ter gravado uma linha em lead_signals')
  assert.equal(row.signal_type, 'strong')
})

test('mensagem outbound (fromMe, enviada pelo celular) nao gera sinal nem quebra', async () => {
  const { db, receive } = setup()
  await receive(P.outboundFromMe)
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.equal(row, undefined, 'mensagem do proprio vendedor (fromMe) nao deve gerar sinal')
})
