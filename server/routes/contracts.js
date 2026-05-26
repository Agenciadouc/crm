import { Router } from 'express'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db, { DEFAULT_EVOLUTION_API_URL, DEFAULT_EVOLUTION_API_KEY } from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { createHubClient } from '../services/hubClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATE_PATH = path.resolve(__dirname, '..', 'templates', 'contrato-template.html')

// Helpers
function formatBRL(v) {
  const n = Number(v) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d)) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
function addMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + Number(months || 0))
  return d.toISOString().slice(0, 10)
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Auto-gera proximo numero do ano corrente: '001/2026', '002/2026', ...
function nextNumero() {
  const year = new Date().getFullYear()
  const suffix = `/${year}`
  const max = db.prepare("SELECT numero FROM contracts WHERE numero LIKE ? ORDER BY id DESC LIMIT 1").get(`%${suffix}`)
  let next = 1
  if (max?.numero) {
    const m = max.numero.match(/^(\d+)/)
    if (m) next = parseInt(m[1]) + 1
  }
  return `${String(next).padStart(3, '0')}${suffix}`
}

function renderTemplate(c) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8')

  // Blocos condicionais (frentes ativas / Anexo I opcional)
  const conditional = (name, active) => {
    const re = new RegExp(`<!--\\s*BEGIN:${name}\\s*-->[\\s\\S]*?<!--\\s*END:${name}\\s*-->`, 'g')
    if (active) {
      // Mantém conteúdo, só remove os marcadores
      html = html.replace(new RegExp(`<!--\\s*BEGIN:${name}\\s*-->`, 'g'), '').replace(new RegExp(`<!--\\s*END:${name}\\s*-->`, 'g'), '')
    } else {
      html = html.replace(re, '')
    }
  }
  conditional('FRENTE_DIAGNOSTICO', !!c.frente_diagnostico)
  conditional('FRENTE_ESTRUTURACAO', !!c.frente_estruturacao)
  conditional('FRENTE_AQUISICAO', !!c.frente_aquisicao)
  conditional('FRENTE_EDITORIAL', !!c.frente_editorial)
  const temAnexo = c.fat_mes1_valor != null || c.fat_mes2_valor != null || c.fat_mes3_valor != null
  conditional('ANEXO_FAT', temAnexo)

  // Inscrição estadual opcional
  conditional('TEM_IE', !!(c.inscricao_estadual && String(c.inscricao_estadual).trim()))

  // Helper pra normalizar dados da empresa em CAIXA ALTA (visual no contrato impresso)
  const upper = (v) => String(v || '').toUpperCase()

  const replacements = {
    NUMERO: c.numero || '',
    RAZAO_SOCIAL: upper(c.razao_social),
    CNPJ: upper(c.cnpj),
    INSCRICAO_ESTADUAL: upper(c.inscricao_estadual),
    ENDERECO_LOGRADOURO: upper(c.endereco_logradouro),
    ENDERECO_BAIRRO: upper(c.endereco_bairro),
    ENDERECO_CEP: upper(c.endereco_cep),
    ENDERECO_CIDADE: upper(c.endereco_cidade),
    ENDERECO_ESTADO: upper(c.endereco_estado),
    FEE_MENSAL: formatBRL(c.fee_mensal),
    COMISSAO_PERCENT: String(c.comissao_percent || 0).replace('.', ','),
    VIGENCIA_MESES: String(c.vigencia_meses || 3),
    DATA_INICIO: formatDate(c.data_inicio),
    DATA_FIM: formatDate(c.data_fim),
    RENOVACAO_MESES: String(c.renovacao_meses || 12),
    AVISO_PREVIO_DIAS: String(c.aviso_previo_dias || 30),
    REAJUSTE_INDICE: c.reajuste_indice || 'IGPM/FGV',
    EXCLUSOES_EXTRAS: c.exclusoes_extras || '',
    VIDEOS_POR_MES: String(c.videos_por_mes || 0),
    IMAGENS_POR_MES: String(c.imagens_por_mes || 0),
    FAT_MES1_REF: c.fat_mes1_ref || '',
    FAT_MES1_VALOR: c.fat_mes1_valor != null ? formatBRL(c.fat_mes1_valor) : '',
    FAT_MES2_REF: c.fat_mes2_ref || '',
    FAT_MES2_VALOR: c.fat_mes2_valor != null ? formatBRL(c.fat_mes2_valor) : '',
    FAT_MES3_REF: c.fat_mes3_ref || '',
    FAT_MES3_VALOR: c.fat_mes3_valor != null ? formatBRL(c.fat_mes3_valor) : '',
    FAT_BASE: c.fat_base != null ? formatBRL(c.fat_base) : '',
    LOCAL_ASSINATURA: c.local_assinatura || 'Sombrio/SC',
    DATA_ASSINATURA: formatDate(c.data_assinatura),
  }
  for (const [k, v] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`{{${k}}}`, 'g'), escapeHtml(v))
  }
  return html
}

// Authenticated router — super_admin OU users.can_manage_contracts=1
const router = Router()
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Nao autenticado' })
  if (req.user.role === 'super_admin') return next()
  const u = db.prepare('SELECT can_manage_contracts FROM users WHERE id = ?').get(req.user.id)
  if (u?.can_manage_contracts === 1) return next()
  return res.status(403).json({ error: 'Sem permissao para gerenciar contratos' })
})

router.get('/', (_req, res) => {
  const contracts = db.prepare(`
    SELECT c.*, u.name as created_by_name
    FROM contracts c LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.created_at DESC
  `).all()
  res.json({ contracts })
})

router.get('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  if (!contract) return res.status(404).json({ error: 'Contrato nao encontrado' })
  res.json({ contract })
})

router.get('/:id/html', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  if (!contract) return res.status(404).send('<h1>Contrato nao encontrado</h1>')
  try {
    const html = renderTemplate(contract)
    res.set('Content-Type', 'text/html; charset=utf-8').send(html)
  } catch (err) {
    console.error('[Contracts] Render error:', err.message)
    res.status(500).send('<h1>Erro ao renderizar contrato</h1>')
  }
})

function calcFatBase(b) {
  const vals = [b.fat_mes1_valor, b.fat_mes2_valor, b.fat_mes3_valor].filter(v => v != null && !isNaN(v)).map(Number)
  if (vals.length === 0) return null
  const sum = vals.reduce((a, b) => a + b, 0)
  return sum / vals.length
}

router.post('/', (req, res) => {
  const b = req.body || {}
  // Campos obrigatorios
  const required = ['razao_social', 'cnpj', 'endereco_logradouro', 'endereco_bairro', 'endereco_cep', 'endereco_cidade', 'endereco_estado', 'data_inicio', 'data_assinatura']
  for (const f of required) {
    if (!b[f] || String(b[f]).trim() === '') return res.status(400).json({ error: `Campo obrigatorio: ${f}` })
  }
  const vigencia = parseInt(b.vigencia_meses) || 3
  const dataFim = b.data_fim || addMonths(b.data_inicio, vigencia)
  const fatBase = calcFatBase(b)

  // Numero auto (com retry em caso de race condition pela UNIQUE constraint)
  let inserted = null
  for (let tries = 0; tries < 5 && !inserted; tries++) {
    const numero = nextNumero()
    try {
      const r = db.prepare(`
        INSERT INTO contracts (
          numero, razao_social, cnpj, inscricao_estadual,
          endereco_logradouro, endereco_bairro, endereco_cep, endereco_cidade, endereco_estado,
          fee_mensal, comissao_percent, vigencia_meses, data_inicio, data_fim,
          renovacao_meses, aviso_previo_dias, reajuste_indice,
          frente_diagnostico, frente_estruturacao, frente_aquisicao, frente_editorial, exclusoes_extras,
          videos_por_mes, imagens_por_mes,
          fat_mes1_ref, fat_mes1_valor, fat_mes2_ref, fat_mes2_valor, fat_mes3_ref, fat_mes3_valor, fat_base,
          local_assinatura, data_assinatura, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        numero, b.razao_social, b.cnpj, b.inscricao_estadual || null,
        b.endereco_logradouro, b.endereco_bairro, b.endereco_cep, b.endereco_cidade, b.endereco_estado,
        parseFloat(b.fee_mensal) || 3500, parseFloat(b.comissao_percent) || 1.0,
        vigencia, b.data_inicio, dataFim,
        parseInt(b.renovacao_meses) || 12, parseInt(b.aviso_previo_dias) || 30, b.reajuste_indice || 'IGPM/FGV',
        b.frente_diagnostico ? 1 : 0, b.frente_estruturacao ? 1 : 0, b.frente_aquisicao ? 1 : 0, b.frente_editorial ? 1 : 0,
        b.exclusoes_extras || null,
        parseInt(b.videos_por_mes) || 0, parseInt(b.imagens_por_mes) || 0,
        b.fat_mes1_ref || null, b.fat_mes1_valor != null ? parseFloat(b.fat_mes1_valor) : null,
        b.fat_mes2_ref || null, b.fat_mes2_valor != null ? parseFloat(b.fat_mes2_valor) : null,
        b.fat_mes3_ref || null, b.fat_mes3_valor != null ? parseFloat(b.fat_mes3_valor) : null,
        fatBase,
        b.local_assinatura || 'Sombrio/SC', b.data_assinatura, req.user.id
      )
      inserted = db.prepare('SELECT * FROM contracts WHERE id = ?').get(r.lastInsertRowid)
    } catch (e) {
      if (!e.message.includes('UNIQUE constraint') || tries === 4) throw e
    }
  }
  res.json({ contract: inserted })
})

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Contrato nao encontrado' })
  const b = req.body || {}

  // Numero NAO muda. Aceita updates parciais.
  const fields = [
    'razao_social', 'cnpj', 'inscricao_estadual',
    'endereco_logradouro', 'endereco_bairro', 'endereco_cep', 'endereco_cidade', 'endereco_estado',
    'fee_mensal', 'comissao_percent', 'vigencia_meses', 'data_inicio', 'data_fim',
    'renovacao_meses', 'aviso_previo_dias', 'reajuste_indice',
    'frente_diagnostico', 'frente_estruturacao', 'frente_aquisicao', 'frente_editorial', 'exclusoes_extras',
    'videos_por_mes', 'imagens_por_mes',
    'fat_mes1_ref', 'fat_mes1_valor', 'fat_mes2_ref', 'fat_mes2_valor', 'fat_mes3_ref', 'fat_mes3_valor',
    'local_assinatura', 'data_assinatura',
  ]
  const sets = []
  const params = []
  for (const f of fields) {
    if (b[f] !== undefined) {
      let val = b[f]
      if (['frente_diagnostico', 'frente_estruturacao', 'frente_aquisicao', 'frente_editorial'].includes(f)) val = val ? 1 : 0
      else if (['fee_mensal', 'comissao_percent', 'fat_mes1_valor', 'fat_mes2_valor', 'fat_mes3_valor'].includes(f)) val = val != null && val !== '' ? parseFloat(val) : null
      else if (['vigencia_meses', 'renovacao_meses', 'aviso_previo_dias', 'videos_por_mes', 'imagens_por_mes'].includes(f)) val = parseInt(val) || 0
      sets.push(`${f} = ?`); params.push(val)
    }
  }
  // Recalcula data_fim se mudou inicio ou vigencia (e cliente nao passou data_fim explicito)
  if ((b.data_inicio !== undefined || b.vigencia_meses !== undefined) && b.data_fim === undefined) {
    const ini = b.data_inicio || existing.data_inicio
    const vig = b.vigencia_meses !== undefined ? parseInt(b.vigencia_meses) : existing.vigencia_meses
    sets.push('data_fim = ?'); params.push(addMonths(ini, vig))
  }
  // Recalcula fat_base se algum mes mudou
  if (b.fat_mes1_valor !== undefined || b.fat_mes2_valor !== undefined || b.fat_mes3_valor !== undefined) {
    const merged = {
      fat_mes1_valor: b.fat_mes1_valor !== undefined ? (b.fat_mes1_valor != null && b.fat_mes1_valor !== '' ? parseFloat(b.fat_mes1_valor) : null) : existing.fat_mes1_valor,
      fat_mes2_valor: b.fat_mes2_valor !== undefined ? (b.fat_mes2_valor != null && b.fat_mes2_valor !== '' ? parseFloat(b.fat_mes2_valor) : null) : existing.fat_mes2_valor,
      fat_mes3_valor: b.fat_mes3_valor !== undefined ? (b.fat_mes3_valor != null && b.fat_mes3_valor !== '' ? parseFloat(b.fat_mes3_valor) : null) : existing.fat_mes3_valor,
    }
    sets.push('fat_base = ?'); params.push(calcFatBase(merged))
  }
  if (sets.length === 0) return res.json({ contract: existing })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE contracts SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  res.json({ contract: updated })
})

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM contracts WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Contrato nao encontrado' })
  db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ─── POST /:id/approve — Aprova contrato e cria conta + gerente no CRM ───
// Email gerado: <slug-razao-social>@drosagencia.com.br
// Senha: dros2026
router.post('/:id/approve', requireRole('super_admin', 'gerente'), async (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  if (!contract) return res.status(404).json({ error: 'Contrato nao encontrado' })
  if (contract.approved_at) return res.status(400).json({ error: 'Contrato ja aprovado em ' + contract.approved_at })
  if (!contract.razao_social || !contract.razao_social.trim()) {
    return res.status(400).json({ error: 'Razao Social obrigatoria pra aprovar contrato' })
  }

  // Resolve email: usa o que o usuario mandou OU gera default (primeira palavra slugificada)
  const slugify = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '')

  let email
  if (req.body.email && typeof req.body.email === 'string' && req.body.email.trim()) {
    email = req.body.email.trim().toLowerCase()
    // Valida formato basico
    if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Email invalido' })
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(400).json({ error: 'Email ja em uso. Escolha outro.' })
    }
  } else {
    // Default: primeira palavra slugificada (max 20 chars)
    const firstWord = String(contract.razao_social || '').trim().split(/\s+/)[0] || ''
    const emailPrefix = slugify(firstWord).substring(0, 20)
    if (!emailPrefix) return res.status(400).json({ error: 'Razao Social invalida (sem caracteres alfanumericos)' })
    email = `${emailPrefix}@drosagencia.com.br`
    let suffix = 2
    while (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      email = `${emailPrefix}${suffix}@drosagencia.com.br`
      suffix++
      if (suffix > 99) return res.status(500).json({ error: 'Nao foi possivel gerar email unico' })
    }
  }

  // Gera slug da conta
  const accountSlug = String(contract.razao_social || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let finalSlug = accountSlug
  let slugSuffix = 2
  while (db.prepare('SELECT id FROM accounts WHERE slug = ?').get(finalSlug)) {
    finalSlug = `${accountSlug}-${slugSuffix}`
    slugSuffix++
  }

  const password = 'dros2026'
  const passwordHash = bcrypt.hashSync(password, 10)

  // Transacao: cria account + funil default + user gerente + atualiza contract
  const result = db.transaction(() => {
    // 1. Conta
    const acc = db.prepare(`
      INSERT INTO accounts (name, slug, cnpj, razao_social, cidade, estado, valor_mensal, contrato_inicio, evolution_api_url, evolution_api_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contract.razao_social.trim(),
      finalSlug,
      contract.cnpj || null,
      contract.razao_social,
      contract.endereco_cidade || null,
      contract.endereco_estado || null,
      contract.fee_mensal || null,
      contract.data_inicio || null,
      DEFAULT_EVOLUTION_API_URL,
      DEFAULT_EVOLUTION_API_KEY,
    )
    const accountId = acc.lastInsertRowid

    // 2. Funil default (mesmas etapas que accounts.js POST)
    const funnelRes = db.prepare('INSERT INTO funnels (account_id, name, is_default) VALUES (?, ?, 1)').run(accountId, 'Funil Principal')
    const funnelId = funnelRes.lastInsertRowid
    const stages = [
      { name: 'Novo Lead', position: 0, color: '#FFB300' },
      { name: 'Em Atendimento', position: 1, color: '#5DADE2' },
      { name: 'Qualificado', position: 2, color: '#9B59B6' },
      { name: 'Visita Agendada', position: 3, color: '#FFAA83' },
      { name: 'Proposta', position: 4, color: '#FF6B8A' },
      { name: 'Venda', position: 5, color: '#34C759', is_conversion: 1, is_terminal: 1 },
      { name: 'Perdido', position: 6, color: '#FF6B6B', is_terminal: 1 },
    ]
    const stageStmt = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal) VALUES (?, ?, ?, ?, ?, ?)')
    for (const s of stages) stageStmt.run(funnelId, s.name, s.position, s.color, s.is_conversion || 0, s.is_terminal || 0)

    // 3. User gerente
    db.prepare(`
      INSERT INTO users (account_id, name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, 'gerente', 1)
    `).run(accountId, contract.razao_social.trim(), email, passwordHash)

    // 4. Atualiza contract com refs
    db.prepare(`
      UPDATE contracts
      SET approved_at = datetime('now'), approved_by = ?, account_id = ?, approved_email = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, accountId, email, contract.id)

    return { accountId, email, password }
  })()

  // Best-effort: tambem cria cliente no HUB (best effort — se falhar, CRM ja foi criado OK)
  let hubResult = { ok: false, reason: 'nao_tentado' }
  try {
    hubResult = await createHubClient(contract, result.email, result.password)
    if (hubResult.ok && hubResult.client?.id) {
      db.prepare("UPDATE contracts SET hub_client_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(hubResult.client.id, contract.id)
    }
  } catch (e) {
    console.error('[Contract Approve] HUB create catch:', e.message)
    hubResult = { ok: false, reason: e.message }
  }

  const updated = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id)
  res.json({
    contract: updated,
    credentials: {
      email: result.email,
      password: result.password,
      account_id: result.accountId,
    },
    hub: hubResult.ok
      ? { created: true, client_id: hubResult.client?.id, client_name: hubResult.client?.name }
      : { created: false, reason: hubResult.reason },
    message: hubResult.ok
      ? 'Contrato aprovado. Cliente criado no CRM e no HUB.'
      : 'Contrato aprovado. Cliente criado no CRM (HUB falhou: ' + (hubResult.reason || 'desconhecido') + ' — pode tentar reaprovar via endpoint de re-sync).',
  })
})

// POST /:id/sync-hub — retry cria no HUB se o approve original falhou la
router.post('/:id/sync-hub', requireRole('super_admin', 'gerente'), async (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)
  if (!contract) return res.status(404).json({ error: 'Contrato nao encontrado' })
  if (!contract.approved_at) return res.status(400).json({ error: 'Contrato nao foi aprovado ainda' })
  if (contract.hub_client_id) return res.status(400).json({ error: 'Contrato ja sincronizado com HUB (client_id=' + contract.hub_client_id + ')' })
  if (!contract.approved_email) return res.status(400).json({ error: 'Email do gerente nao encontrado no contrato' })

  const password = 'dros2026'  // padrao usado na aprovacao original
  const hubResult = await createHubClient(contract, contract.approved_email, password)
  if (hubResult.ok && hubResult.client?.id) {
    db.prepare("UPDATE contracts SET hub_client_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hubResult.client.id, contract.id)
    return res.json({ ok: true, client_id: hubResult.client.id, message: 'Cliente criado no HUB' })
  }
  res.status(500).json({ ok: false, reason: hubResult.reason })
})

export default router
