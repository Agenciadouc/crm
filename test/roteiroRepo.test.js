import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import {
  newKey, getRoteiro, saveDraft, publish, restoreVersion, createSpinDraft,
  getPublishedQuestions, getPublishedDeviations, RoteiroError,
} from '../server/services/roteiro/repo.js'

function baseContent(stageId, otherStageId) {
  return {
    questions: [
      { stage_id: stageId, position: 0, text: 'Qual seu nome completo?', kind: 'text', required: true, spin: null, ai_hint: null },
      {
        stage_id: stageId, position: 1, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, spin: 'need_payoff', ai_hint: null,
        options: [{ label: 'Até R$5 mil', points: 5 }, { label: 'Acima de R$20 mil', points: 15 }],
      },
    ],
    deviations: [
      { triggers: 'preço, valor, quanto custa', reply_text: 'Depende do pacote, te explico já já.', return_question_key: null, position: 0 },
    ],
  }
}

test('newKey: gera string aleatoria de 12 hex', () => {
  const a = newKey()
  const b = newKey()
  assert.match(a, /^[0-9a-f]{12}$/)
  assert.match(b, /^[0-9a-f]{12}$/)
  assert.notEqual(a, b)
})

test('getRoteiro: funil sem linhas devolve draft/published nulos e versions vazio', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId } = seedRoteiroBase(db)
  const r = getRoteiro(db, accountId, funnelId)
  assert.equal(r.draft, null)
  assert.equal(r.published, null)
  assert.deepEqual(r.versions, [])
  assert.equal(r.stages.length, 5)
})

test('getRoteiro: funil de outra conta -> 404', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId } = seedRoteiroBase(db)
  assert.throws(() => getRoteiro(db, 999999, funnelId), (err) => {
    assert.ok(err instanceof RoteiroError)
    assert.equal(err.code, 'not_found')
    assert.equal(err.status, 404)
    return true
  })
  // funil existe mas pertence a outra conta
  assert.throws(() => getRoteiro(db, accountId, 999999), (err) => err instanceof RoteiroError && err.status === 404)
})

test('saveDraft + getRoteiro: salva 2 perguntas e 1 desvio, gera keys', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const content = baseContent(stages.novo)
  const saved = saveDraft(db, accountId, funnelId, content)

  assert.equal(saved.status, 'draft')
  assert.equal(saved.version, 0)
  assert.equal(saved.questions.length, 2)
  assert.equal(saved.deviations.length, 1)
  for (const q of saved.questions) assert.match(q.question_key, /^[0-9a-f]{12}$/)
  const optQuestion = saved.questions.find(q => q.kind === 'options')
  assert.equal(optQuestion.options.length, 2)
  for (const o of optQuestion.options) assert.match(o.option_key, /^[0-9a-f]{12}$/)
  assert.equal(optQuestion.required, true)

  const r = getRoteiro(db, accountId, funnelId)
  assert.equal(r.draft.questions.length, 2)
  assert.equal(r.draft.deviations.length, 1)
  assert.equal(r.published, null)
})

test('saveDraft: salvar de novo com as mesmas keys mantem as keys', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const first = saveDraft(db, accountId, funnelId, baseContent(stages.novo))
  const keys = first.questions.map(q => q.question_key).sort()
  const optionKeys = first.questions.find(q => q.kind === 'options').options.map(o => o.option_key).sort()

  const resend = {
    questions: first.questions.map(q => ({ ...q })),
    deviations: first.deviations.map(d => ({ ...d })),
  }
  const second = saveDraft(db, accountId, funnelId, resend)
  assert.deepEqual(second.questions.map(q => q.question_key).sort(), keys)
  assert.deepEqual(second.questions.find(q => q.kind === 'options').options.map(o => o.option_key).sort(), optionKeys)
})

test('saveDraft: validacao - texto vazio', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.novo, position: 0, text: '  ', kind: 'text', required: false }],
    deviations: [],
  }), (err) => {
    assert.ok(err instanceof RoteiroError)
    assert.equal(err.status, 400)
    assert.equal(err.message, 'A pergunta precisa de um texto.')
    return true
  })
})

test('saveDraft: validacao - opcoes com 1 item', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.novo, position: 0, text: 'Pergunta', kind: 'options', required: false, options: [{ label: 'Unica', points: 0 }] }],
    deviations: [],
  }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Perguntas de opções precisam de 2 a 10 opções.')
    return true
  })
})

test('saveDraft: validacao - pontos fora de -50..50', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [{
      stage_id: stages.novo, position: 0, text: 'Pergunta', kind: 'options', required: false,
      options: [{ label: 'A', points: 60 }, { label: 'B', points: 0 }],
    }],
    deviations: [],
  }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Os pontos de cada opção vão de -50 a 50.')
    return true
  })
})

test('saveDraft: validacao - etapa final nao tem perguntas', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.venda, position: 0, text: 'Pergunta', kind: 'text', required: false }],
    deviations: [],
  }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Etapas finais (venda/perdido) não têm perguntas.')
    return true
  })
})

test('saveDraft: validacao - etapa de outro funil', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, otherAccountId } = seedRoteiroBase(db)
  const otherFunnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil B', 1, 1)").run(otherAccountId).lastInsertRowid)
  const otherStageId = Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, ?, ?, 0, 0)').run(otherFunnelId, 'Novo B', 0).lastInsertRowid)

  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: otherStageId, position: 0, text: 'Pergunta', kind: 'text', required: false }],
    deviations: [],
  }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'A etapa escolhida não pertence a este funil.')
    return true
  })
})

test('saveDraft: validacao - desvio sem gatilho/resposta', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId } = seedRoteiroBase(db)
  assert.throws(() => saveDraft(db, accountId, funnelId, {
    questions: [],
    deviations: [{ triggers: '', reply_text: '', return_question_key: null, position: 0 }],
  }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Desvio precisa das palavras-gatilho e da resposta.')
    return true
  })
})

test('publish: cria versao 1 publicada, getPublishedQuestions retorna 2; editar rascunho nao muda a publicada', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, gerenteId, stages } = seedRoteiroBase(db)
  saveDraft(db, accountId, funnelId, baseContent(stages.novo))

  const published = publish(db, accountId, funnelId, gerenteId)
  assert.equal(published.status, 'published')
  assert.equal(published.version, 1)
  assert.ok(published.published_at)

  const qs = getPublishedQuestions(db, accountId, funnelId)
  assert.equal(qs.length, 2)
  const devs = getPublishedDeviations(db, accountId, funnelId)
  assert.equal(devs.length, 1)

  // editar rascunho nao muda a publicada
  saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.novo, position: 0, text: 'Pergunta editada', kind: 'text', required: false }],
    deviations: [],
  })
  const qs2 = getPublishedQuestions(db, accountId, funnelId)
  assert.equal(qs2.length, 2)
  assert.ok(qs2.some(q => q.text === 'Qual seu nome completo?'))

  const r = getRoteiro(db, accountId, funnelId)
  assert.equal(r.draft.questions.length, 1)
  assert.equal(r.draft.questions[0].text, 'Pergunta editada')
})

test('publish sem rascunho -> no_draft 400', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, gerenteId } = seedRoteiroBase(db)
  assert.throws(() => publish(db, accountId, funnelId, gerenteId), (err) => {
    assert.ok(err instanceof RoteiroError)
    assert.equal(err.code, 'no_draft')
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Não há rascunho para publicar.')
    return true
  })
})

test('publicar de novo: versao 2, versao 1 archived; restoreVersion(v1) restaura conteudo no rascunho', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, gerenteId, stages } = seedRoteiroBase(db)
  saveDraft(db, accountId, funnelId, baseContent(stages.novo))
  const v1 = publish(db, accountId, funnelId, gerenteId)

  saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.novo, position: 0, text: 'Pergunta editada v2', kind: 'text', required: false }],
    deviations: [],
  })
  const v2 = publish(db, accountId, funnelId, gerenteId)
  assert.equal(v2.version, 2)

  const r = getRoteiro(db, accountId, funnelId)
  const v1Row = r.versions.find(v => v.id === v1.id)
  assert.equal(v1Row.status, 'archived')
  const v2Row = r.versions.find(v => v.id === v2.id)
  assert.equal(v2Row.status, 'published')

  const restored = restoreVersion(db, accountId, v1.id)
  assert.equal(restored.status, 'draft')
  assert.equal(restored.questions.length, 2)
  assert.ok(restored.questions.some(q => q.text === 'Qual seu nome completo?'))

  const r2 = getRoteiro(db, accountId, funnelId)
  assert.equal(r2.draft.questions.length, 2)
})

test('restoreVersion: versao de outra conta -> 404', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, otherAccountId, gerenteId, stages } = seedRoteiroBase(db)
  saveDraft(db, accountId, funnelId, baseContent(stages.novo))
  const v1 = publish(db, accountId, funnelId, gerenteId)

  assert.throws(() => restoreVersion(db, otherAccountId, v1.id), (err) => {
    assert.ok(err instanceof RoteiroError)
    assert.equal(err.code, 'not_found')
    assert.equal(err.status, 404)
    assert.equal(err.message, 'Versão não encontrada.')
    return true
  })
})

test('createSpinDraft: adiciona as 6 perguntas SPIN na 1a etapa de conversa (Novo e contato); chamar 2x nao duplica', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)

  const draft = createSpinDraft(db, accountId, funnelId)
  assert.equal(draft.status, 'draft')
  assert.equal(draft.questions.length, 6)
  for (const q of draft.questions) {
    assert.equal(q.stage_id, stages.qualificando)
    assert.equal(q.required, true)
    assert.equal(q.kind, 'options')
  }
  assert.deepEqual(draft.questions.map(q => q.spin), ['situation', 'problem', 'problem', 'implication', 'implication', 'need_payoff'])

  const draft2 = createSpinDraft(db, accountId, funnelId)
  assert.equal(draft2.questions.length, 6)
  assert.deepEqual(draft2.questions.map(q => q.question_key).sort(), draft.questions.map(q => q.question_key).sort())
})

test('createSpinDraft: parte do rascunho atual (preserva perguntas existentes) e posiciona apos elas', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.qualificando, position: 0, text: 'Pergunta manual', kind: 'text', required: false }],
    deviations: [],
  })
  const draft = createSpinDraft(db, accountId, funnelId)
  assert.equal(draft.questions.length, 7)
  const manual = draft.questions.find(q => q.text === 'Pergunta manual')
  assert.ok(manual)
  const spinQs = draft.questions.filter(q => q.spin)
  for (const q of spinQs) assert.ok(q.position > manual.position)
})

test('createSpinDraft: parte da publicada quando nao ha rascunho', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, gerenteId, stages } = seedRoteiroBase(db)
  saveDraft(db, accountId, funnelId, baseContent(stages.novo))
  publish(db, accountId, funnelId, gerenteId)
  // apaga rascunho manualmente para simular "sem rascunho"
  db.prepare("DELETE FROM roteiro_versions WHERE account_id = ? AND funnel_id = ? AND status = 'draft'").run(accountId, funnelId)

  const draft = createSpinDraft(db, accountId, funnelId)
  assert.equal(draft.status, 'draft')
  // ja tinha need_payoff publicado -> so adiciona situation/problem(2)/implication(2)
  const fases = draft.questions.map(q => q.spin).filter(Boolean).sort()
  assert.deepEqual(fases, ['implication', 'implication', 'need_payoff', 'problem', 'problem', 'situation'])
  assert.equal(draft.questions.length, 2 + 5)
})

test('createSpinDraft: funil de outra conta -> 404', () => {
  const db = createRoteiroTestDb()
  const { funnelId } = seedRoteiroBase(db)
  assert.throws(() => createSpinDraft(db, 999999, funnelId), (err) => err instanceof RoteiroError && err.status === 404)
})

test('getPublishedQuestions/getPublishedDeviations: vazio quando nao ha publicada', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId } = seedRoteiroBase(db)
  assert.deepEqual(getPublishedQuestions(db, accountId, funnelId), [])
  assert.deepEqual(getPublishedDeviations(db, accountId, funnelId), [])
})

test('publish: pergunta apagada que estava em teste A/B cancela o teste (spec 6.5)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const q = (key, text) => ({ question_key: key, stage_id: s.stages.qualificando, position: 0, text, kind: 'text', required: false, spin: null, ai_hint: null })
  saveDraft(db, s.accountId, s.funnelId, { questions: [q('orcamento', 'Qual seu orçamento?'), q('prazo', 'Qual o prazo?')], deviations: [] })
  publish(db, s.accountId, s.funnelId, s.gerenteId)

  // segundo funil da conta com a pergunta 'decisor' publicada
  const funnel2 = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil 2', 0, 1)").run(s.accountId).lastInsertRowid)
  const st2 = Number(db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Etapa', 0)").run(funnel2).lastInsertRowid)
  saveDraft(db, s.accountId, funnel2, { questions: [{ ...q('decisor', 'Quem decide?'), stage_id: st2 }], deviations: [] })
  publish(db, s.accountId, funnel2, s.gerenteId)

  const addVariant = (accountId, key, status = 'testing') => Number(db.prepare('INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, ?, ?)').run(accountId, key, 'Texto B', status).lastInsertRowid)
  const vPrazo = addVariant(s.accountId, 'prazo')
  const vOrc = addVariant(s.accountId, 'orcamento')
  const vDecisor = addVariant(s.accountId, 'decisor')
  const vGanhou = addVariant(s.accountId, 'prazo', 'won')
  const vOutraConta = addVariant(s.otherAccountId, 'prazo')

  // apaga 'prazo' e publica
  saveDraft(db, s.accountId, s.funnelId, { questions: [q('orcamento', 'Qual seu orçamento?')], deviations: [] })
  publish(db, s.accountId, s.funnelId, s.gerenteId)

  const v = id => db.prepare('SELECT status, ended_at FROM roteiro_variants WHERE id = ?').get(id)
  assert.equal(v(vPrazo).status, 'cancelled')
  assert.ok(v(vPrazo).ended_at)
  assert.equal(v(vOrc).status, 'testing')
  assert.equal(v(vDecisor).status, 'testing', 'pergunta publicada em outro funil da conta continua em teste')
  assert.equal(v(vGanhou).status, 'won')
  assert.equal(v(vOutraConta).status, 'testing')
})
