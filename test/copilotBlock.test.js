import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { runBlock, resolveBlockMeta } from '../server/services/copilotBlock.js'

// whatsapp_instances nao esta no helper (cada suite monta o que usa)
function addInstances(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      instance_name TEXT,
      status TEXT,
      api_url TEXT,
      api_key TEXT
    );
  `)
}

function insertMsg(db, { accountId, leadId }, { content = null, mediaType = 'text', waMsgId = null, direction = 'inbound' } = {}) {
  return Number(db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, media_type, wa_msg_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(leadId, accountId, direction, content, mediaType, waMsgId).lastInsertRowid)
}

// Monta o cenario padrao: instancia conectada, agente que responde audio, STT que funciona.
function setup({ instanceStatus = 'connected', respondsToAudio = 1, agent = undefined } = {}) {
  const db = createTestDb()
  addInstances(db)
  const seed = seedAccountAndLead(db)
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'inst', ?)").run(seed.accountId, instanceStatus).lastInsertRowid)

  const calls = { process: [], fetchAudio: [], transcribe: [], broadcast: [] }
  const deps = {
    findAgent: () => (agent === undefined ? { id: seed.agentId, responds_to_audio: respondsToAudio } : agent),
    fetchAudio: async (inst, waMsgId) => {
      calls.fetchAudio.push({ instanceName: inst && inst.instance_name, waMsgId })
      return { buffer: Buffer.from(`bytes-${waMsgId}`), mimetype: 'audio/ogg' }
    },
    transcribe: async buffer => {
      const key = String(buffer).replace('bytes-', '')
      calls.transcribe.push(key)
      return { ok: true, transcript: `falei ${key}`, durationSec: 6, costUsd: 0.0005 }
    },
    process: async (lead, content, mediaType, instanceId2, opts) => {
      calls.process.push({ leadId: lead.id, content, mediaType, instanceId: instanceId2, opts })
      return { ok: true }
    },
    broadcast: (accountId, leadId) => calls.broadcast.push({ accountId, leadId }),
  }
  return { db, seed, instanceId, deps, calls }
}

// ─── resolveBlockMeta ─────────────────────────────────────────────────

test('meta: a 1a mensagem do bloco cria o blockStartMessageId; as seguintes herdam sem consultar de novo', () => {
  let consultas = 0
  const base = { agentId: 7, accountId: 1 }
  const primeira = resolveBlockMeta(null, base, () => { consultas++; return 100 })
  assert.deepEqual(primeira, { agentId: 7, accountId: 1, blockStartMessageId: 100 })

  const segunda = resolveBlockMeta(primeira, base, () => { consultas++; return 200 })
  assert.equal(segunda.blockStartMessageId, 100, 'o bloco nao pode recomecar na 2a mensagem')
  const terceira = resolveBlockMeta(segunda, base, () => { consultas++; return 300 })
  assert.equal(terceira.blockStartMessageId, 100)
  assert.equal(consultas, 1)
})

test('meta: id nulo no inicio do bloco continua nulo (nao recomeca o bloco na 2a mensagem)', () => {
  let consultas = 0
  const base = { agentId: 7, accountId: 1 }
  const primeira = resolveBlockMeta(null, base, () => { consultas++; return null })
  assert.equal(primeira.blockStartMessageId, null)

  const segunda = resolveBlockMeta(primeira, base, () => { consultas++; return 200 })
  assert.equal(segunda.blockStartMessageId, null, 'a 1a mensagem nao pode sumir em silencio')
  assert.equal(consultas, 1)
})

// ─── runBlock ─────────────────────────────────────────────────────────

test('bloco com audio + texto: UMA analise, mediaType text, conteudo na ordem do lead', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'e pra quinta' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: { content: 'e pra quinta', mediaType: 'text' }, ...deps })

  assert.equal(calls.process.length, 1)
  assert.equal(calls.process[0].mediaType, 'text')
  assert.equal(calls.process[0].content, 'falei A1\ne pra quinta')
  assert.equal(calls.process[0].instanceId, instanceId)
  // custo do STT vai junto pro ai_agent_token_log
  assert.deepEqual(calls.process[0].opts.stt, { seconds: 6, costUsd: 0.0005, provider: 'deepgram' })
})

test('transcricao salva avisa o Chat aberto (broadcast por audio transcrito)', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A2' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.equal(calls.broadcast.length, 2)
  assert.deepEqual(calls.broadcast[0], { accountId: seed.accountId, leadId: seed.leadId })
})

test('bloco so de texto nao gasta STT e nao manda stt no opts', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = insertMsg(db, seed, { content: 'oi' })
  insertMsg(db, seed, { content: 'tudo bem?' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.equal(calls.process[0].content, 'oi\ntudo bem?')
  assert.equal(calls.process[0].opts.stt, null)
  assert.deepEqual(calls.transcribe, [])
  assert.deepEqual(calls.broadcast, [])
})

test('agente com responds_to_audio desligado NAO gasta Deepgram: audio vira placeholder e o texto segue', async () => {
  const { db, seed, instanceId, deps, calls } = setup({ respondsToAudio: 0 })
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'me responde por favor' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.deepEqual(calls.fetchAudio, [])
  assert.deepEqual(calls.transcribe, [])
  assert.equal(calls.process[0].content, '[Audio nao transcrito]\nme responde por favor')
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(first).transcription, null)
})

test('instancia desconectada nao tenta baixar audio, mas a analise do bloco acontece', async () => {
  const { db, seed, instanceId, deps, calls } = setup({ instanceStatus: 'disconnected' })
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'oi' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.deepEqual(calls.fetchAudio, [])
  assert.equal(calls.process[0].content, '[Audio nao transcrito]\noi')
})

test('sem agente no momento do disparo tambem nao gasta STT', async () => {
  const { db, seed, instanceId, deps, calls } = setup({ agent: null })
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.deepEqual(calls.transcribe, [])
  assert.equal(calls.process[0].content, '[Audio nao transcrito]')
})

test('sem blockStartMessageId cai no caminho antigo: ultima mensagem, com o mediaType dela', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: null, fallback: { content: '[Audio]', mediaType: 'audio' }, ...deps })

  assert.equal(calls.process.length, 1)
  assert.equal(calls.process[0].content, '[Audio]')
  assert.equal(calls.process[0].mediaType, 'audio', 'o caminho antigo preserva o mediaType original')
  assert.deepEqual(calls.transcribe, [])
})

test('bloco vazio (mensagem apagada) cai no caminho antigo', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const ultimo = insertMsg(db, seed, { content: 'oi' })
  db.prepare('DELETE FROM messages WHERE id = ?').run(ultimo)

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: ultimo, fallback: { content: 'oi', mediaType: 'text' }, ...deps })

  assert.equal(calls.process.length, 1)
  assert.equal(calls.process[0].content, 'oi')
  assert.equal(calls.process[0].mediaType, 'text')
})

test('IA pausada DURANTE a janela de 40s: nao transcreve (nao gasta) e nao analisa', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'e pra quinta' })
  // vendedor aperta "Pausar IA" depois do agendamento, antes do disparo
  db.prepare("UPDATE leads SET ai_paused_at = datetime('now') WHERE id = ?").run(seed.leadId)

  const out = await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: { content: 'e pra quinta', mediaType: 'text' }, ...deps })

  assert.equal(out, null)
  assert.deepEqual(calls.fetchAudio, [])
  assert.deepEqual(calls.transcribe, [])
  assert.deepEqual(calls.process, [])
  assert.deepEqual(calls.broadcast, [])
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(first).transcription, null)
})

test('lead apagado durante a espera: nao analisa nada', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = insertMsg(db, seed, { content: 'oi' })
  db.prepare('DELETE FROM leads WHERE id = ?').run(seed.leadId)

  const out = await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.equal(out, null)
  assert.equal(calls.process.length, 0)
})

test('bloco pega so as mensagens daquele lead/conta, do inicio do bloco em diante', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  insertMsg(db, seed, { content: 'antes do bloco' })
  const first = insertMsg(db, seed, { content: 'comeco' })
  insertMsg(db, seed, { content: 'resposta do vendedor', direction: 'outbound' })
  insertMsg(db, seed, { content: 'fim' })

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.equal(calls.process[0].content, 'comeco\nfim')
})
