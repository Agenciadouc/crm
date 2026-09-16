import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { loadInboundBlock, lastInboundMessageId, transcribeBlock, AUDIO_FAILED_PLACEHOLDER } from '../server/services/blockTranscriber.js'

function insertMsg(db, { accountId, leadId }, { content = null, mediaType = 'text', waMsgId = null, direction = 'inbound', transcription = null } = {}) {
  const id = db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, media_type, wa_msg_id, transcription)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(leadId, accountId, direction, content, mediaType, waMsgId, transcription).lastInsertRowid
  return Number(id)
}

// Dublê do Deepgram: registra quem foi baixado/transcrito e devolve texto por wa_msg_id.
function fakeStt(transcripts, { failFor = [] } = {}) {
  const fetched = []
  const transcribed = []
  return {
    fetched,
    transcribed,
    fetchAudio: async msg => {
      fetched.push(msg.wa_msg_id)
      if (failFor.includes(msg.wa_msg_id)) throw new Error('evolution_no_base64')
      return { buffer: Buffer.from(`bytes-${msg.wa_msg_id}`), mimetype: 'audio/ogg' }
    },
    transcribe: async (buffer, opts) => {
      const key = String(buffer).replace('bytes-', '')
      transcribed.push(key)
      assert.equal(opts.mimetype, 'audio/ogg')
      const text = transcripts[key]
      if (text === undefined) return { ok: false, reason: 'no_api_key' }
      return { ok: true, transcript: text, durationSec: 3, costUsd: 0.0002 }
    },
  }
}

test('audio + texto no mesmo bloco viram UMA analise com os dois, na ordem do lead', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'na verdade e pra quinta' })
  const stt = fakeStt({ A1: 'oi, queria marcar pra terca' })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  assert.equal(block.length, 2)

  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt })
  assert.equal(out.text, 'oi, queria marcar pra terca\nna verdade e pra quinta')
  assert.equal(out.transcribed, 1)
  assert.equal(out.failed, 0)
  // salvou no cache
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(first).transcription, 'oi, queria marcar pra terca')
})

test('dois audios no bloco: os dois sao transcritos, na ordem', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  const second = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A2' })
  const stt = fakeStt({ A1: 'primeiro audio', A2: 'segundo audio' })
  // onTranscribed so pode avisar DEPOIS do texto estar salvo na coluna
  const avisados = []
  const onTranscribed = (msg, transcript) => avisados.push({
    id: msg.id,
    transcript,
    noBanco: db.prepare('SELECT transcription FROM messages WHERE id = ?').get(msg.id).transcription,
  })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt, onTranscribed })

  assert.equal(out.text, 'primeiro audio\nsegundo audio')
  assert.deepEqual(avisados, [
    { id: first, transcript: 'primeiro audio', noBanco: 'primeiro audio' },
    { id: second, transcript: 'segundo audio', noBanco: 'segundo audio' },
  ])
  assert.equal(out.transcribed, 2)
  assert.deepEqual(stt.transcribed, ['A1', 'A2'])
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(second).transcription, 'segundo audio')
})

test('audio que ja tem transcricao nao e transcrito de novo (cache, o dono nao paga duas vezes)', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1', transcription: 'ja transcrito antes' })
  insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A2' })
  const stt = fakeStt({ A1: 'NAO DEVE APARECER', A2: 'audio novo' })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt })

  assert.equal(out.text, 'ja transcrito antes\naudio novo')
  assert.equal(out.cached, 1)
  assert.equal(out.transcribed, 1)
  assert.deepEqual(stt.fetched, ['A2'])
  assert.deepEqual(stt.transcribed, ['A2'])
})

test('falha em um audio nao derruba o bloco: entra como [Audio nao transcrito] e o resto segue', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  const broken = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A2' })
  insertMsg(db, seed, { content: 'me confirma por favor' })
  const stt = fakeStt({ A1: 'bom dia' }, { failFor: ['A2'] })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt })

  assert.equal(out.text, `bom dia\n${AUDIO_FAILED_PLACEHOLDER}\nme confirma por favor`)
  assert.equal(out.transcribed, 1)
  assert.equal(out.failed, 1)
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(broken).transcription, null)
})

test('transcricao vazia conta como falha e nao vira cache', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  const stt = fakeStt({ A1: '   ' })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt })

  assert.equal(out.text, AUDIO_FAILED_PLACEHOLDER)
  assert.equal(out.failed, 1)
  assert.equal(db.prepare('SELECT transcription FROM messages WHERE id = ?').get(first).transcription, null)
})

test('bloco so de texto nao chama download nem transcricao', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: 'oi' })
  insertMsg(db, seed, { content: 'tudo bem?' })
  const stt = fakeStt({})

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, ...stt })

  assert.equal(out.text, 'oi\ntudo bem?')
  assert.equal(out.transcribed, 0)
  assert.deepEqual(stt.fetched, [])
  assert.deepEqual(stt.transcribed, [])
})

test('bloco carrega so o inbound do lead certo, da mensagem inicial em diante, filtrando account_id', () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const outro = seedAccountAndLead(db, { accountName: 'Outra Conta' })

  insertMsg(db, seed, { content: 'mensagem velha, de antes do bloco' })
  const first = insertMsg(db, seed, { content: 'comeco do bloco' })
  insertMsg(db, seed, { content: 'resposta do vendedor', direction: 'outbound' })
  insertMsg(db, seed, { content: 'fim do bloco' })
  // mesma conversa, account_id diferente: so o filtro por account_id exclui esta
  db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, media_type) VALUES (?, ?, 'inbound', 'de outra conta', 'text')").run(seed.leadId, outro.accountId)

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  assert.deepEqual(block.map(m => m.content), ['comeco do bloco', 'fim do bloco'])
})

test('lastInboundMessageId pega a mensagem que o webhook acabou de inserir', () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  insertMsg(db, seed, { content: 'primeira' })
  const ultima = insertMsg(db, seed, { content: 'segunda' })
  insertMsg(db, seed, { content: 'saida do vendedor', direction: 'outbound' })
  assert.equal(lastInboundMessageId(db, { accountId: seed.accountId, leadId: seed.leadId }), ultima)
})

test('sem instancia conectada (sem downloader) o audio nao derruba o bloco', async () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const first = insertMsg(db, seed, { content: '[Audio]', mediaType: 'audio', waMsgId: 'A1' })
  insertMsg(db, seed, { content: 'texto junto' })

  const block = loadInboundBlock(db, { accountId: seed.accountId, leadId: seed.leadId, fromMessageId: first })
  const out = await transcribeBlock(db, { accountId: seed.accountId, messages: block, fetchAudio: null, transcribe: null })

  assert.equal(out.text, `${AUDIO_FAILED_PLACEHOLDER}\ntexto junto`)
  assert.equal(out.failed, 1)
})
