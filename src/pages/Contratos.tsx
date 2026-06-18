import { useState, useEffect } from 'react'
import { fetchContracts, createContract, updateContract, deleteContract, approveContract, syncContractHub, type Contract, type ContractInput } from '../lib/api'
import { FileSignature, Plus, Edit3, Trash2, Download, CheckCircle2, RefreshCw } from 'lucide-react'

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
  // Modal de aprovacao
  const [approveModal, setApproveModal] = useState<{ contract: Contract; email: string } | null>(null)
  const [approving, setApproving] = useState(false)
  // Modal de sucesso pós-aprovacao
  const [credentialsModal, setCredentialsModal] = useState<{ email: string; password: string; razao: string; hub?: { created: boolean; client_id?: number; reason?: string } } | null>(null)

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

  const openApprove = (c: Contract) => {
    if (c.approved_at) { alert('Contrato ja aprovado'); return }
    // Sugere email = primeira palavra slugificada
    const firstWord = (c.razao_social || '').trim().split(/\s+/)[0] || ''
    const slug = firstWord.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .substring(0, 20)
    const defaultEmail = slug ? `${slug}@drosagencia.com.br` : ''
    setApproveModal({ contract: c, email: defaultEmail })
  }

  const [syncHubModal, setSyncHubModal] = useState<Contract | null>(null)
  const [syncingHub, setSyncingHub] = useState(false)
  const [syncResultModal, setSyncResultModal] = useState<{ ok: boolean; clientId?: number; reason?: string; razao: string } | null>(null)

  const confirmSyncHub = async () => {
    if (!syncHubModal) return
    setSyncingHub(true)
    try {
      const r = await syncContractHub(syncHubModal.id)
      setSyncResultModal({
        ok: !!r.ok,
        clientId: r.client_id,
        reason: r.reason,
        razao: syncHubModal.razao_social,
      })
      setSyncHubModal(null)
      if (r.ok) load()
    } catch (e: any) {
      setSyncResultModal({
        ok: false,
        reason: e?.message || 'erro desconhecido',
        razao: syncHubModal.razao_social,
      })
      setSyncHubModal(null)
    }
    setSyncingHub(false)
  }

  const handleApprove = async () => {
    if (!approveModal) return
    if (!approveModal.email.trim()) { alert('Email obrigatório'); return }
    setApproving(true)
    try {
      const result = await approveContract(approveModal.contract.id, approveModal.email.trim())
      setCredentialsModal({
        email: result.credentials.email,
        password: result.credentials.password,
        razao: approveModal.contract.razao_social,
        hub: result.hub,
      })
      setApproveModal(null)
      load()
    } catch (e: any) {
      alert('Erro ao aprovar: ' + (e?.message || 'desconhecido'))
    }
    setApproving(false)
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
                <th>Status</th>
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
                  <td>
                    {c.approved_at ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(52,199,89,0.15)', color: '#34C759', fontWeight: 600 }}>
                        ✅ Aprovado
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(155,150,176,0.15)', color: '#9B96B0' }}>
                        Rascunho
                      </span>
                    )}
                  </td>
                  <td>{c.razao_social}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.cnpj}</td>
                  <td>{formatBRL(c.fee_mensal)}</td>
                  <td>{formatDate(c.data_inicio)}</td>
                  <td>{c.vigencia_meses}m</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.created_by_name || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!c.approved_at && (
                      <button className="btn btn-primary btn-sm" onClick={() => openApprove(c)} title="Aprovar contrato (cria cliente no CRM)" style={{ marginRight: 4, background: '#34C759', borderColor: '#2BA84A' }}>
                        <CheckCircle2 size={12} /> Aprovar
                      </button>
                    )}
                    {c.approved_at && !c.hub_client_id && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSyncHubModal(c)}
                        title="Contrato aprovado no CRM mas nao criado no HUB. Clique pra criar agora."
                        style={{ marginRight: 4, background: 'rgba(255,179,0,0.15)', borderColor: 'rgba(255,179,0,0.4)', color: '#FFB300' }}
                      >
                        <RefreshCw size={12} /> Sync HUB
                      </button>
                    )}
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

      {/* Modal de aprovacao */}
      {approveModal && (
        <div className="modal-overlay" onClick={() => !approving && setApproveModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34C759', marginBottom: 4 }}>
              <CheckCircle2 size={20} /> Aprovar contrato
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              <strong>{approveModal.contract.numero}</strong> · {approveModal.contract.razao_social}
            </p>

            <div style={{ padding: 12, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.2)', borderRadius: 8, marginBottom: 16, fontSize: 12, lineHeight: 1.6 }}>
              Isso vai <strong>criar um cliente no CRM</strong> com:
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li>Conta: <strong>{approveModal.contract.razao_social}</strong></li>
                <li>Usuário <strong>gerente</strong></li>
                <li>Senha: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>dros2026</code></li>
              </ul>
              <div style={{ marginTop: 8, color: '#FFB300' }}>⚠ Não pode desfazer pelo botão (precisa apagar conta manualmente).</div>
            </div>

            <div className="form-group">
              <label>Email do gerente *</label>
              <input
                className="input"
                type="email"
                value={approveModal.email}
                onChange={e => setApproveModal({ ...approveModal, email: e.target.value })}
                placeholder="cliente@drosagencia.com.br"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && !approving) handleApprove() }}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Edite se quiser. Sistema bloqueia se email já estiver em uso.
              </small>
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setApproveModal(null)} disabled={approving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleApprove} disabled={approving || !approveModal.email.trim()} style={{ background: '#34C759', borderColor: '#2BA84A' }}>
                {approving ? 'Aprovando...' : '✓ Aprovar e criar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de sucesso com credenciais */}
      {credentialsModal && (
        <div className="modal-overlay" onClick={() => setCredentialsModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34C759', marginBottom: 4 }}>
              <CheckCircle2 size={20} /> Cliente criado!
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {credentialsModal.razao}
            </p>

            <div style={{ padding: 16, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.3)', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Email de acesso</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, fontFamily: 'monospace' }}>{credentialsModal.email}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Senha</div>
              <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'monospace' }}>{credentialsModal.password}</div>
            </div>

            {/* Status sistemas integrados */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, padding: 10, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 6, fontSize: 12 }}>
                ✅ <strong>CRM:</strong> conta criada
              </div>
              <div style={{ flex: 1, padding: 10, background: credentialsModal.hub?.created ? 'rgba(52,199,89,0.08)' : 'rgba(255,179,0,0.08)', border: `1px solid ${credentialsModal.hub?.created ? 'rgba(52,199,89,0.25)' : 'rgba(255,179,0,0.25)'}`, borderRadius: 6, fontSize: 12 }}>
                {credentialsModal.hub?.created
                  ? <>✅ <strong>HUB:</strong> cliente criado (id={credentialsModal.hub.client_id})</>
                  : <>⚠ <strong>HUB:</strong> não criado{credentialsModal.hub?.reason ? ` (${credentialsModal.hub.reason})` : ''}<div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Pode re-tentar via "Re-sync HUB" depois</div></>
                }
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#FFB300', marginBottom: 16 }}>
              📋 Copie e envie pro cliente. Senha pode ser trocada por ele depois.
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => {
                navigator.clipboard?.writeText(`Email: ${credentialsModal.email}\nSenha: ${credentialsModal.password}`)
              }}>📋 Copiar</button>
              <button className="btn btn-primary" onClick={() => setCredentialsModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmacao Sync HUB */}
      {syncHubModal && (
        <div className="modal-overlay" onClick={() => !syncingHub && setSyncHubModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <RefreshCw size={20} style={{ color: '#FFB300' }} /> Sincronizar com HUB
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              <strong>{syncHubModal.numero}</strong> · {syncHubModal.razao_social}
            </p>

            <div style={{ padding: 12, background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 8, marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
              Vai criar o cliente <strong>no HUB</strong> com os mesmos dados que ja foram gerados no CRM:
              <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 12 }}>
                <li>Email: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>{syncHubModal.approved_email || '(usa o do CRM)'}</code></li>
                <li>Senha: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>dros2026</code></li>
                <li>Razão Social, CNPJ, cidade/estado, fee mensal, data início</li>
              </ul>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSyncHubModal(null)} disabled={syncingHub}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmSyncHub} disabled={syncingHub} style={{ background: '#FFB300', borderColor: '#E0A000' }}>
                {syncingHub ? 'Sincronizando...' : 'Confirmar sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de resultado pos-sync */}
      {syncResultModal && (
        <div className="modal-overlay" onClick={() => setSyncResultModal(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            {syncResultModal.ok ? (
              <>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34C759', marginBottom: 4 }}>
                  <CheckCircle2 size={20} /> Cliente criado no HUB!
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{syncResultModal.razao}</p>
                <div style={{ padding: 14, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                  ✅ HUB Client ID: <strong>{syncResultModal.clientId}</strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    O cliente já pode acessar o HUB com as mesmas credenciais do CRM.
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF6B6B', marginBottom: 4 }}>
                  ⚠ Falha ao sincronizar
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{syncResultModal.razao}</p>
                <div style={{ padding: 14, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.25)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                  HUB rejeitou: <strong>{syncResultModal.reason}</strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                    Possíveis causas: HUB offline, credenciais erradas no .env, email já existe no HUB, ou validação rejeitou os dados.
                  </div>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setSyncResultModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
