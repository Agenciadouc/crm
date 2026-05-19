import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'

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

  const replacements = {
    NUMERO: c.numero || '',
    RAZAO_SOCIAL: c.razao_social || '',
    CNPJ: c.cnpj || '',
    INSCRICAO_ESTADUAL: c.inscricao_estadual || '',
    ENDERECO_LOGRADOURO: c.endereco_logradouro || '',
    ENDERECO_BAIRRO: c.endereco_bairro || '',
    ENDERECO_CEP: c.endereco_cep || '',
    ENDERECO_CIDADE: c.endereco_cidade || '',
    ENDERECO_ESTADO: c.endereco_estado || '',
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

export default router
