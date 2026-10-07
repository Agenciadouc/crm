// test/leadImport.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImportTestDb, seedImport } from './helpers/leadImportDb.js'
import { addLead } from './helpers/roteiroDb.js'
import { planImport, applyImport, autoTagName } from '../server/services/leadImport/importer.js'

const R = (row, fields, extra = {}) => ({ row, fields, extra })

test('previa: novos, existentes (so completa), repetidos na planilha e invalidos; nao grava', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Velha', phone: '5548999990000', email: 'velha@x.com' })
  const rows = [
    R(2, { name: 'Ana', phone: '(48) 99999-0000', email: 'nova@x.com', city: 'Floripa' }), // ja existe (outro formato)
    R(3, { name: 'Caio', phone: '48 3333-2222' }),
    R(4, { name: 'Caio de novo', phone: '554833332222', email: 'caio@x.com' }),           // repetido na planilha
    R(5, { name: 'Sem fone' }),
    R(6, { name: 'Curto', phone: '1234' }),
  ]
  const before = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n
  const p = planImport(db, { accountId: s.accountId, rows, destination: s.dest, fileName: 'lista.xlsx' })
  assert.equal(p.new_count, 1)
  assert.equal(p.existing_count, 1)
  assert.equal(p.filled_fields, 1) // so a cidade; o e-mail do CRM fica
  assert.deepEqual(p.skipped, [{ row: 4, reason: 'repetido na planilha (junto com a linha 3)' }, { row: 5, reason: 'sem telefone' }, { row: 6, reason: 'telefone inválido' }])
  assert.equal(p.samples.novos[0].phone, '(48) 9****-2222')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, before)
})

test('importar: cria com destino, extras, tags e tag automatica; existente so completa; nada automatico', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const velho = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Velha', phone: '5548999990000', email: 'velha@x.com', custom_fields: JSON.stringify({ Loja: 'A' }) })
  const rows = [
    R(2, { name: 'Ana', phone: '(48) 99999-0000', email: 'nova@x.com', city: 'floripa', tags: ['vip'] }, { Loja: 'B', Porte: 'grande' }),
    R(3, { name: 'Caio', phone: '48 3333-2222', value_estimated: 1500, tags: ['vip', 'feira'] }, { 'Tamanho da loja': '120 m²' }),
    R(4, { name: 'Caio 2', phone: '554833332222', email: 'caio@x.com' }),
  ]
  const r = applyImport(db, { accountId: s.accountId, rows, destination: { ...s.dest, stage_id: s.stages.qualificando }, fileName: 'lista-feira.xlsx', userId: s.gerenteId })
  assert.deepEqual([r.created, r.updated, r.skipped.length], [1, 1, 1])
  const caio = db.prepare("SELECT * FROM leads WHERE name = 'Caio'").get()
  assert.deepEqual([caio.phone, caio.stage_id, caio.source, caio.email, caio.value_estimated, caio.opted_in_at, caio.attendant_id], ['5548933332222', s.stages.qualificando, 'importacao', 'caio@x.com', 1500, null, null])
  assert.deepEqual(JSON.parse(caio.custom_fields), { 'Tamanho da loja': '120 m²' })
  assert.equal(db.prepare('SELECT trigger_type FROM stage_history WHERE lead_id = ?').get(caio.id).trigger_type, 'import')
  const v = db.prepare('SELECT * FROM leads WHERE id = ?').get(velho)
  assert.deepEqual([v.name, v.email, v.stage_id], ['Velha', 'velha@x.com', s.stages.qualificando])
  assert.deepEqual(JSON.parse(v.custom_fields), { Loja: 'A', Porte: 'grande' })
  const tagsOf = id => db.prepare('SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = ? ORDER BY t.name').all(id).map(x => x.name)
  const auto = autoTagName('lista-feira.xlsx')
  assert.deepEqual(tagsOf(caio.id), [auto, 'feira', 'vip'].sort())
  assert.ok(tagsOf(velho).includes(auto) && tagsOf(velho).includes('vip'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stage_history WHERE trigger_type <> 'import'").get().n, 0)
})

test('vendedor: um so ou rodizio entre atendentes ativos; tipo de contato com origem lista', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const rows = [R(2, { phone: '48911110001' }), R(3, { phone: '48911110002' }), R(4, { phone: '48911110003' })]
  applyImport(db, { accountId: s.accountId, rows, destination: { ...s.dest, attendant: { mode: 'split' }, contact_type: 'revendedor', auto_tag: false }, fileName: 'a.csv', userId: s.gerenteId })
  const got = db.prepare("SELECT attendant_id, contact_type, contact_type_origin FROM leads WHERE source = 'importacao' ORDER BY id").all()
  assert.deepEqual(got.map(x => x.attendant_id), [s.atendenteId, s.biaId, s.atendenteId])
  assert.ok(got.every(x => x.contact_type === 'revendedor' && x.contact_type_origin === 'lista'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n, 0)
})

test('destino invalido, outra conta, limite e erro no meio: nada gravado', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const rows = [R(2, { phone: '48911110001' })]
  const fail = d => { try { applyImport(db, { accountId: s.accountId, rows, destination: d, fileName: 'a.csv', userId: 1 }); return null } catch (e) { return e } }
  const outroFunil = Number(db.prepare("INSERT INTO funnels (account_id, name) VALUES (?, 'X')").run(s.otherAccountId).lastInsertRowid)
  assert.equal(fail({ ...s.dest, funnel_id: outroFunil }).status, 400)
  assert.equal(fail({ ...s.dest, stage_id: 99999 }).status, 400)
  assert.equal(fail({ ...s.dest, attendant: { mode: 'one', user_id: 99999 } }).status, 400)
  assert.equal(fail({ ...s.dest, contact_type: 'chefe' }).status, 400)
  const muitas = Array.from({ length: 5001 }, (_, i) => R(i + 2, { phone: `489${String(i).padStart(8, '0')}` }))
  assert.throws(() => planImport(db, { accountId: s.accountId, rows: muitas, destination: s.dest, fileName: 'a.csv' }), e => e.status === 400)
  // erro no meio: trigger que falha no 2o insert
  db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON leads WHEN NEW.phone = '5548911110002' BEGIN SELECT RAISE(ABORT, 'boom'); END;")
  const two = [R(2, { phone: '48911110001' }), R(3, { phone: '48911110002' })]
  assert.throws(() => applyImport(db, { accountId: s.accountId, rows: two, destination: s.dest, fileName: 'a.csv', userId: 1 }))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
})

test('nome da tag automatica', () => {
  assert.equal(autoTagName('lista-feira.xlsx', new Date(2026, 9, 6)), 'Importado 06/10 – lista-feira')
  assert.ok(autoTagName('x'.repeat(200) + '.csv', new Date(2026, 9, 6)).length <= 60)
})

test('revisao: celula com dois telefones = telefone invalido (nao cria lead com numero quebrado)', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const p = planImport(db, { accountId: s.accountId, rows: [R(2, { phone: '48 99999-0000 / 48 98888-1111' })], destination: s.dest, fileName: 'a.csv' })
  assert.deepEqual([p.new_count, p.skipped], [0, [{ row: 2, reason: 'telefone inválido' }]])
})

test('revisao: cidade e buscada uma vez por cidade (nao trava o servidor com planilha grande)', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  for (let i = 0; i < 300; i++) addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, phone: `55489${String(i).padStart(8, '0')}`, city: i % 2 ? 'Florianópolis' : 'São José' })
  let calls = 0
  const { cityKey } = { cityKey: v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() }
  db.function('city_key', { deterministic: true }, v => { calls++; return cityKey(v) })
  const rows = Array.from({ length: 60 }, (_, i) => R(i + 2, { phone: `48977${String(i).padStart(6, '0')}`, city: i % 2 ? 'florianopolis' : 'sao jose' }))
  applyImport(db, { accountId: s.accountId, rows, destination: s.dest, fileName: 'a.csv', userId: s.gerenteId })
  assert.ok(calls < 2000, `city_key chamado ${calls} vezes`)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao' AND city = 'Florianópolis'").get().n, 30)
})

test('revisao: falha no meio da cadencia nao deixa cadencia pela metade', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const cad = Number(db.prepare("INSERT INTO cadences (account_id, name, funnel_id, stage_id) VALUES (?, 'Novo', ?, ?)").run(s.accountId, s.funnelId, s.stages.novo).lastInsertRowid)
  db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type, description) VALUES (?, 0, 'ligacao', 'Ligar')").run(cad)
  db.exec("CREATE TEMP TRIGGER cad_boom BEFORE UPDATE ON lead_cadences BEGIN SELECT RAISE(ABORT, 'boom'); END;")
  const r = applyImport(db, { accountId: s.accountId, rows: [R(2, { phone: '48911110001' })], destination: s.dest, fileName: 'a.csv', userId: s.gerenteId })
  assert.equal(r.created, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadences').get().n, 0)
})
