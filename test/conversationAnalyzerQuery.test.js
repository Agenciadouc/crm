// O conversationAnalyzer.js importa server/db.js na primeira linha, entao nao da para
// chamar analyzeConversation() em teste (e refatorar o arquivo esta fora de escopo).
// O que da para provar de verdade: as consultas que ele usa para carregar as mensagens
// sao lidas DO PROPRIO ARQUIVO e rodadas contra um banco em memoria — se alguem tirar o
// COALESCE de la, este teste quebra.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ANALYZER = readFileSync(resolve(__dirname, '../server/services/conversationAnalyzer.js'), 'utf8')

// Lista de colunas de cada SELECT ... FROM messages que carrega o texto da conversa
function messageSelectColumns() {
  const re = /SELECT\s+(id, direction,[\s\S]*?)\s+FROM messages/g
  const cols = []
  let m
  while ((m = re.exec(ANALYZER)) !== null) cols.push(m[1].replace(/\s+/g, ' ').trim())
  return cols
}

// Replica o mapeamento do analisador (conversationAnalyzer.js:473)
const MAX_CONTENT_LEN_PER_MSG = 4000
function toAnalyzerText(m) {
  let text = String(m.content || '').slice(0, MAX_CONTENT_LEN_PER_MSG)
  if (!text.trim()) text = `(${m.media_type || 'midia'})`
  return text
}

function seedConversation(db) {
  const seed = seedAccountAndLead(db)
  const ins = db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, media_type, transcription)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const audioComTranscricao = Number(ins.run(seed.leadId, seed.accountId, 'inbound', '[Audio]', 'audio', 'quero fechar essa semana').lastInsertRowid)
  const audioSemTranscricao = Number(ins.run(seed.leadId, seed.accountId, 'inbound', '[Audio]', 'audio', null).lastInsertRowid)
  const texto = Number(ins.run(seed.leadId, seed.accountId, 'outbound', 'perfeito, te mando a proposta', 'text', null).lastInsertRowid)
  return { seed, audioComTranscricao, audioSemTranscricao, texto }
}

test('as tres consultas do analisador existem e todas leem a transcricao', () => {
  const cols = messageSelectColumns()
  assert.equal(cols.length, 3, 'esperava as 3 consultas de mensagens do conversationAnalyzer')
  for (const c of cols) {
    assert.ok(c.includes("COALESCE(NULLIF(transcription, ''), content) AS content"), `consulta sem a transcricao: ${c}`)
    // continua entregando as mesmas colunas de sempre (o alias mantem o mapeamento)
    for (const esperada of ['id', 'direction', 'content', 'sender_name', 'sent_by_user_id', 'ai_agent_id', 'follow_up_id', 'media_type', 'created_at']) {
      assert.ok(new RegExp(`\\b${esperada}\\b`).test(c), `faltou ${esperada} em: ${c}`)
    }
  }
})

test('audio com transcricao chega ao gerente como o texto falado; sem transcricao, igual a hoje', () => {
  const db = createTestDb()
  const { seed, audioComTranscricao, audioSemTranscricao, texto } = seedConversation(db)

  for (const cols of messageSelectColumns()) {
    const rows = db.prepare(`SELECT ${cols} FROM messages WHERE lead_id = ? ORDER BY id ASC`).all(seed.leadId)
    const porId = new Map(rows.map(r => [r.id, r]))

    // audio transcrito: o gerente le o que o lead falou, nao '[Audio]'
    assert.equal(porId.get(audioComTranscricao).content, 'quero fechar essa semana')
    assert.equal(toAnalyzerText(porId.get(audioComTranscricao)), 'quero fechar essa semana')
    // sem transcricao: comportamento de hoje, intacto
    assert.equal(porId.get(audioSemTranscricao).content, '[Audio]')
    assert.equal(toAnalyzerText(porId.get(audioSemTranscricao)), '[Audio]')
    // texto puro: intacto
    assert.equal(toAnalyzerText(porId.get(texto)), 'perfeito, te mando a proposta')
    // media_type continua sendo 'audio' (o gerente sabe que veio de audio)
    assert.equal(porId.get(audioComTranscricao).media_type, 'audio')
  }
})

test('transcricao vazia nao vira texto vazio: cai no content, como hoje', () => {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  const id = Number(db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, media_type, transcription)
    VALUES (?, ?, 'inbound', '[Audio]', 'audio', '')
  `).run(seed.leadId, seed.accountId).lastInsertRowid)

  const cols = messageSelectColumns()[0]
  const row = db.prepare(`SELECT ${cols} FROM messages WHERE id = ?`).get(id)
  assert.equal(row.content, '[Audio]')
})
