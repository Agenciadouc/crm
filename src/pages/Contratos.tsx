import { useState, useEffect } from 'react'
import { fetchContracts, createContract, updateContract, deleteContract, type Contract, type ContractInput } from '../lib/api'
import { FileSignature, Plus, Edit3, Trash2, Download } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

const BLANK: ContractInput = {
  razao_social: '',
  cnpj: '',
  inscricao_estadual: '',
  endereco_logradouro: '',
  endereco_bairro: '',
  endereco_cep: '',
  endereco_cidade: '',
  endereco_estado: '',
  fee_mensal: 3500,
  comissao_percent: 1.0,
  vigencia_meses: 3,
  data_inicio: today(),
  renovacao_meses: 12,
  aviso_previo_dias: 30,
  reajuste_indice: 'IGPM/FGV',
  frente_diagnostico: true,
  frente_estruturacao: true,
  frente_aquisicao: true,
  frente_editorial: true,
  exclusoes_extras: '',
  videos_por_mes: 4,
  imagens_por_mes: 8,
  fat_mes1_ref: '',
  fat_mes1_valor: null,
  fat_mes2_ref: '',
  fat_mes2_valor: null,
  fat_mes3_ref: '',
  fat_mes3_valor: null,
  local_assinatura: 'Sombrio/SC',
  data_assinatura: today(),
}

function formatBRL(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export default function Contratos() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<'new' | number | null>(null)
  const [form, setForm] = useState<ContractInput>(BLANK)
  const [saving, setSaving] = useState(false)

  const isEditing = typeof modalMode === 'number'

  const load = () => { setLoading(true); fetchContracts().then(setContracts).finally(() => setLoading(false)) }
  useEffect(load, [])

  const openNew = () => { setForm(BLANK); setModalMode('new') }

  const openEdit = (c: Contract) => {
    setForm({
      razao_social: c.razao_social,
      cnpj: c.cnpj,
      inscricao_estadual: c.inscricao_estadual || '',
      endereco_logradouro: c.endereco_logradouro,
      endereco_bairro: c.endereco_bairro,
      endereco_cep: c.endereco_cep,
      endereco_cidade: c.endereco_cidade,
      endereco_estado: c.endereco_estado,
      fee_mensal: c.fee_mensal,
      comissao_percent: c.comissao_percent,
      vigencia_meses: c.vigencia_meses,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim,
      renovacao_meses: c.renovacao_meses,
      aviso_previo_dias: c.aviso_previo_dias,
      reajuste_indice: c.reajuste_indice,
      frente_diagnostico: c.frente_diagnostico === 1,
      frente_estruturacao: c.frente_estruturacao === 1,
      frente_aquisicao: c.frente_aquisicao === 1,
      frente_editorial: c.frente_editorial === 1,
      exclusoes_extras: c.exclusoes_extras || '',
      videos_por_mes: c.videos_por_mes || 0,
      imagens_por_mes: c.imagens_por_mes || 0,
      fat_mes1_ref: c.fat_mes1_ref || '',
      fat_mes1_valor: c.fat_mes1_valor,
      fat_mes2_ref: c.fat_mes2_ref || '',
      fat_mes2_valor: c.fat_mes2_valor,
      fat_mes3_ref: c.fat_mes3_ref || '',
      fat_mes3_valor: c.fat_mes3_valor,
      local_assinatura: c.local_assinatura,
      data_assinatura: c.data_assinatura,
    })
    setModalMode(c.id)
  }

  const closeModal = () => { setModalMode(null); setForm(BLANK) }

  // Auto-calc data_fim quando data_inicio ou vigencia mudam (UI only)
  const dataFimCalc = form.data_inicio && form.vigencia_meses
    ? addMonths(form.data_inicio, form.vigencia_meses)
    : ''
  // Auto-calc media faturamento base
  const fatVals = [form.fat_mes1_valor, form.fat_mes2_valor, form.fat_mes3_valor].filter(v => v != null && !isNaN(v as number)) as number[]
  const fatBase = fatVals.length > 0 ? fatVals.reduce((a, b) => a + b, 0) / fatVals.length : null

  const handleSave = async () => {
    if (!form.razao_social.trim()) return alert('Razao social obrigatoria')
    if (!form.cnpj.trim()) return alert('CNPJ obrigatorio')
    if (!form.endereco_logradouro.trim()) return alert('Endereco obrigatorio')
    if (!form.endereco_cidade.trim() || !form.endereco_estado.trim()) return alert('Cidade e estado obrigatorios')
    if (!form.data_inicio) return alert('Data inicio obrigatoria')
    if (!form.data_assinatura) return alert('Data assinatura obrigatoria')

    setSaving(true)
    try {
      const payload = { ...form, data_fim: dataFimCalc || undefined }
      if (isEditing) await updateContract(modalMode as number, payload)
      else await createContract(payload)
      closeModal(); load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSaving(false)
  }

  const handleDelete = async (c: Contract) => {
    if (!confirm(`Apagar contrato ${c.numero} de "${c.razao_social}"?`)) return
    try { await deleteContract(c.id); load() }
    catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleDownload = async (c: Contract) => {
    // Endpoint exige JWT — window.open direto perde o header.
    // Faz fetch autenticado, abre nova aba com about:blank, escreve o HTML e dispara print.
    const token = localStorage.getItem('dros_crm_token')
    try {
      const res = await fetch(`/crm/api/contracts/${c.id}/html`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { alert('Erro ao carregar contrato: ' + res.status); return }
      const html = await res.text()
      const w = window.open('about:blank', '_blank')
      if (!w) { alert('Bloqueador de popup ativo? Permite popups pra esse site.'); return }
      w.document.open()
      w.document.write(html)
      w.document.close()
      // Espera os estilos aplicarem antes de printar
      setTimeout(() => { try { w.print() } catch {} }, 400)
    } catch (e: any) {
      alert('Erro: ' + (e?.message || 'desconhecido'))
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1><FileSignature size={22} style={{ verticalAlign: -4, marginRight: 6 }} />Contratos</h1>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={14} /> Novo Contrato
        </button>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><span>Carregando...</span></div>
      ) : contracts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <FileSignature size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p>Nenhum contrato ainda. Clique em <span className="strong">+ Novo Contrato</span> pra cadastrar o primeiro.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Numero</th>
                <th>Razao Social</th>
                <th>CNPJ</th>
                <th>Fee</th>
                <th>Inicio</th>
                <th>Vigencia</th>
                <th>Criado por</th>
                <th style={{ textAlign: 'right' }}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id}>
                  <td><span className="strong">{c.numero}</span></td>
                  <td>{c.razao_social}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.cnpj}</td>
                  <td>{formatBRL(c.fee_mensal)}</td>
                  <td>{formatDate(c.data_inicio)}</td>
                  <td>{c.vigencia_meses}m</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.created_by_name || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(c)} title="Baixar PDF" style={{ marginRight: 4 }}>
                      <Download size={12} />
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} title="Editar" style={{ marginRight: 4 }}>
                      <Edit3 size={12} />
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)} title="Apagar">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalMode !== null && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 760, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 16 }}>
              <FileSignature size={18} style={{ verticalAlign: -3, marginRight: 6 }} />
              {isEditing ? 'Editar Contrato' : 'Novo Contrato'}
            </h2>

            {/* Bloco 1 — Cliente */}
            <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: '12px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dados do Cliente (CONTRATANTE)</h3>
            <div className="form-group">
              <label>Razao Social *</label>
              <input className="input" value={form.razao_social} onChange={e => setForm({ ...form, razao_social: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>CNPJ *</label>
                <input className="input" value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              </div>
              <div className="form-group">
                <label>Inscricao Estadual</label>
                <input className="input" value={form.inscricao_estadual || ''} onChange={e => setForm({ ...form, inscricao_estadual: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Endereco (Logradouro + Numero) *</label>
              <input className="input" value={form.endereco_logradouro} onChange={e => setForm({ ...form, endereco_logradouro: e.target.value })} placeholder="Rua X, nº 123" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Bairro *</label>
                <input className="input" value={form.endereco_bairro} onChange={e => setForm({ ...form, endereco_bairro: e.target.value })} />
              </div>
              <div className="form-group">
                <label>CEP *</label>
                <input className="input" value={form.endereco_cep} onChange={e => setForm({ ...form, endereco_cep: e.target.value })} placeholder="00000-000" />
              </div>
              <div className="form-group">
                <label>Cidade *</label>
                <input className="input" value={form.endereco_cidade} onChange={e => setForm({ ...form, endereco_cidade: e.target.value })} />
              </div>
            </div>
            <div className="form-group" style={{ maxWidth: 100 }}>
              <label>Estado (UF) *</label>
              <input className="input" maxLength={2} value={form.endereco_estado} onChange={e => setForm({ ...form, endereco_estado: e.target.value.toUpperCase() })} placeholder="SP" />
            </div>

            {/* Bloco 2 — Comercial */}
            <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Comercial</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Fee Mensal (R$) *</label>
                <input className="input" type="number" step="0.01" value={form.fee_mensal} onChange={e => setForm({ ...form, fee_mensal: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label>Comissao (%) *</label>
                <input className="input" type="number" step="0.1" value={form.comissao_percent} onChange={e => setForm({ ...form, comissao_percent: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label>Vigencia (meses) *</label>
                <input className="input" type="number" value={form.vigencia_meses} onChange={e => setForm({ ...form, vigencia_meses: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Data Inicio *</label>
                <input className="input" type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Data Fim (auto)</label>
                <input className="input" type="date" value={dataFimCalc} disabled style={{ opacity: 0.7 }} />
              </div>
              <div className="form-group">
                <label>Aviso Previo (dias)</label>
                <input className="input" type="number" value={form.aviso_previo_dias} onChange={e => setForm({ ...form, aviso_previo_dias: parseInt(e.target.value) || 30 })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Renovacao (meses)</label>
                <input className="input" type="number" value={form.renovacao_meses} onChange={e => setForm({ ...form, renovacao_meses: parseInt(e.target.value) || 12 })} />
              </div>
              <div className="form-group">
                <label>Reajuste (indice)</label>
                <input className="input" value={form.reajuste_indice} onChange={e => setForm({ ...form, reajuste_indice: e.target.value })} />
              </div>
            </div>

            {/* Bloco 3 — Escopo */}
            <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Escopo (Frentes Inclusas)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.frente_diagnostico} onChange={e => setForm({ ...form, frente_diagnostico: e.target.checked })} />
                <span>Frente 1 — Diagnostico Estrutural</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.frente_estruturacao} onChange={e => setForm({ ...form, frente_estruturacao: e.target.checked })} />
                <span>Frente 2 — Estruturacao Comercial</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.frente_aquisicao} onChange={e => setForm({ ...form, frente_aquisicao: e.target.checked })} />
                <span>Frente 3 — Aquisicao e Expansao</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.frente_editorial} onChange={e => setForm({ ...form, frente_editorial: e.target.checked })} />
                <span>Frente 4 — Linha Editorial e Conteudo</span>
              </label>
            </div>
            {form.frente_editorial && (
              <div style={{ marginTop: 8, padding: 12, background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 6 }}>
                <p style={{ fontSize: 11, color: '#FFCB45', marginBottom: 8 }}>
                  Sera adicionado no contrato: "Serao postados nas redes sociais (Instagram e Facebook) do CONTRATANTE X videos e X imagens por mes pela CONTRATADA."
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="form-group">
                    <label>Videos por mes</label>
                    <input className="input" type="number" min={0} value={form.videos_por_mes ?? 0} onChange={e => setForm({ ...form, videos_por_mes: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="form-group">
                    <label>Imagens por mes</label>
                    <input className="input" type="number" min={0} value={form.imagens_por_mes ?? 0} onChange={e => setForm({ ...form, imagens_por_mes: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>
            )}
            <div className="form-group" style={{ marginTop: 8 }}>
              <label>Exclusoes extras (HTML de &lt;li&gt;...&lt;/li&gt;, opcional)</label>
              <textarea className="input" rows={2} value={form.exclusoes_extras || ''} onChange={e => setForm({ ...form, exclusoes_extras: e.target.value })} placeholder="<li>Ex: SEO organico</li>" />
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Adicionado abaixo das exclusoes padrao no contrato.</p>
            </div>

            {/* Bloco 4 — Anexo I */}
            <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Anexo I — Faturamento Base (opcional)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Mes 1 (Ex: 11/2025)</label>
                <input className="input" value={form.fat_mes1_ref || ''} onChange={e => setForm({ ...form, fat_mes1_ref: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Valor R$</label>
                <input className="input" type="number" step="0.01" value={form.fat_mes1_valor ?? ''} onChange={e => setForm({ ...form, fat_mes1_valor: e.target.value === '' ? null : parseFloat(e.target.value) })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Mes 2</label>
                <input className="input" value={form.fat_mes2_ref || ''} onChange={e => setForm({ ...form, fat_mes2_ref: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Valor R$</label>
                <input className="input" type="number" step="0.01" value={form.fat_mes2_valor ?? ''} onChange={e => setForm({ ...form, fat_mes2_valor: e.target.value === '' ? null : parseFloat(e.target.value) })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Mes 3</label>
                <input className="input" value={form.fat_mes3_ref || ''} onChange={e => setForm({ ...form, fat_mes3_ref: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Valor R$</label>
                <input className="input" type="number" step="0.01" value={form.fat_mes3_valor ?? ''} onChange={e => setForm({ ...form, fat_mes3_valor: e.target.value === '' ? null : parseFloat(e.target.value) })} />
              </div>
            </div>
            {fatBase != null && (
              <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>
                <span className="strong">Media (Faturamento Base):</span> {formatBRL(fatBase)}
              </p>
            )}

            {/* Bloco 5 — Assinatura */}
            <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Assinatura</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Local *</label>
                <input className="input" value={form.local_assinatura} onChange={e => setForm({ ...form, local_assinatura: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Data Assinatura *</label>
                <input className="input" type="date" value={form.data_assinatura} onChange={e => setForm({ ...form, data_assinatura: e.target.value })} />
              </div>
            </div>
            {!isEditing && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                O numero do contrato (ex: 001/2026) e gerado automaticamente ao salvar.
              </p>
            )}

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : (isEditing ? 'Salvar Alteracoes' : 'Criar Contrato')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
