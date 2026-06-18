import { useState, useEffect } from 'react'
import { fetchProposals, createProposal, updateProposal, deleteProposal, type Proposal, type ProposalInput } from '../lib/api'
import { FileText, Plus, Edit3, Trash2, Copy, ExternalLink, Check } from 'lucide-react'

// Title Case PT-BR: 1ª letra de cada palavra maiuscula, exceto conectores (de, da, do, e)
const LOWER_PT = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
function titleCase(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).toLowerCase().split(/\s+/).map((w, i) => {
    if (!w) return ''
    if (i > 0 && LOWER_PT.has(w)) return w
    return w[0].toUpperCase() + w.slice(1)
  }).join(' ')
}

const BLANK: ProposalInput & { has_production: boolean } = {
  client_name: '',
  phone: '',
  segmento: '',
  has_production: true,
  num_videos: 4,
  num_images: 8,
  valor: 3500,
  contrato_meses: 3,
  observacoes: '',
  has_comissao: false,
  comissao_percent: 1,
}

const PROPOSAL_BASE_URL = `${window.location.protocol}//${window.location.host}/crm/proposta`

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch {}
  document.body.removeChild(ta)
  return Promise.resolve()
}

export default function Propostas() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<'new' | number | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const isEditing = typeof modalMode === 'number'

  const load = () => { setLoading(true); fetchProposals().then(setProposals).finally(() => setLoading(false)) }
  useEffect(load, [])

  const openNew = () => { setForm(BLANK); setModalMode('new') }

  const openEdit = (p: Proposal) => {
    setForm({
      client_name: p.client_name,
      phone: p.phone || '',
      segmento: p.segmento || '',
      has_production: p.has_production === 1,
      num_videos: p.num_videos,
      num_images: p.num_images,
      valor: p.valor,
      contrato_meses: p.contrato_meses,
      observacoes: p.observacoes || '',
      has_comissao: p.has_comissao === 1,
      comissao_percent: p.comissao_percent || 1,
    })
    setModalMode(p.id)
  }

  const closeModal = () => { setModalMode(null); setForm(BLANK) }

  const handleSave = async () => {
    if (!form.client_name.trim()) return alert('Nome do cliente obrigatorio')
    setSaving(true)
    try {
      if (isEditing) await updateProposal(modalMode as number, form)
      else await createProposal(form)
      closeModal(); load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSaving(false)
  }

  const handleDelete = async (p: Proposal) => {
    if (!confirm(`Apagar proposta de "${p.client_name}"?`)) return
    try { await deleteProposal(p.id); load() }
    catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleCopy = (p: Proposal) => {
    const url = `${PROPOSAL_BASE_URL}/${p.slug}`
    copyToClipboard(url)
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleOpen = (p: Proposal) => {
    window.open(`${PROPOSAL_BASE_URL}/${p.slug}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      <div className="page-header">
        <h1><FileText size={20} style={{ marginRight: 8, verticalAlign: -3 }} /> Propostas</h1>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Nova Proposta</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th className="right">Valor</th>
                <th className="right">Meses</th>
                <th>Link</th>
                <th>Criado</th>
                <th className="right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => (
                <tr key={p.id}>
                  <td className="name">
                    <div style={{ fontWeight: 600 }}>{titleCase(p.client_name)}</div>
                    {p.segmento && <div style={{ fontSize: 11, color: '#9B96B0' }}>{titleCase(p.segmento)}</div>}
                  </td>
                  <td>
                    {p.has_production
                      ? <span style={{ fontSize: 11, color: '#FFB300' }}>{p.num_videos} vídeos · {p.num_images} imgs</span>
                      : <span style={{ fontSize: 11, color: '#9B96B0' }}>Sem produção</span>}
                  </td>
                  <td className="right" style={{ fontWeight: 700 }}>R$ {Number(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="right">{p.contrato_meses}m</td>
                  <td>
                    <code style={{ fontSize: 11, color: '#9B96B0' }}>/{p.slug}</code>
                  </td>
                  <td style={{ fontSize: 12, color: '#9B96B0' }}>{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleOpen(p)} title="Abrir proposta"><ExternalLink size={12} /></button>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleCopy(p)} title="Copiar link" style={copiedId === p.id ? { color: '#34C759' } : undefined}>
                      {copiedId === p.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(p)} title="Editar"><Edit3 size={12} /></button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(p)} title="Apagar"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhuma proposta criada ainda. Clique em "Nova Proposta" para começar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalMode !== null && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2>{isEditing ? 'Editar Proposta' : 'Nova Proposta'}</h2>

            <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '12px 0 6px' }}>Cliente</div>
            <div className="form-group"><label>Nome do Cliente *</label><input className="input" value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Ex: Serrano Distribuidora" /></div>
            <div className="form-row">
              <div className="form-group"><label>Telefone</label><input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="(00) 00000-0000" /></div>
              <div className="form-group"><label>Segmento</label><input className="input" value={form.segmento} onChange={e => setForm(p => ({ ...p, segmento: e.target.value }))} placeholder="Ex: Distribuição, Indústria" /></div>
            </div>

            <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Escopo</div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.has_production} onChange={e => setForm(p => ({ ...p, has_production: e.target.checked }))} />
                <span>Inclui produção de conteúdo (vídeos + imagens)</span>
              </label>
            </div>

            {form.has_production && (
              <div className="form-row">
                <div className="form-group"><label>Vídeos / mês</label><input className="input" type="number" min="0" value={form.num_videos} onChange={e => setForm(p => ({ ...p, num_videos: parseInt(e.target.value) || 0 }))} /></div>
                <div className="form-group"><label>Imagens / mês</label><input className="input" type="number" min="0" value={form.num_images} onChange={e => setForm(p => ({ ...p, num_images: parseInt(e.target.value) || 0 }))} /></div>
              </div>
            )}

            <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Comercial</div>
            <div className="form-row">
              <div className="form-group"><label>Mensalidade (R$) *</label><input className="input" type="number" step="0.01" min="0" value={form.valor} onChange={e => setForm(p => ({ ...p, valor: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="form-group"><label>Contrato (meses) *</label><input className="input" type="number" min="1" max="60" value={form.contrato_meses} onChange={e => setForm(p => ({ ...p, contrato_meses: parseInt(e.target.value) || 3 }))} /></div>
            </div>

            <div className="form-group" style={{ padding: 10, background: form.has_comissao ? 'rgba(255,179,0,0.06)' : 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
                <input type="checkbox" checked={!!form.has_comissao} onChange={e => setForm(p => ({ ...p, has_comissao: e.target.checked }))} />
                <span style={{ fontWeight: 600 }}>+ Comissão sobre faturamento</span>
              </label>
              {form.has_comissao && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: '#9B96B0' }}>Percentual (%) sobre faturamento excedente</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={form.comissao_percent ?? 1}
                    onChange={e => setForm(p => ({ ...p, comissao_percent: parseFloat(e.target.value) || 0 }))}
                    style={{ width: 100, marginTop: 4 }}
                  />
                  <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 6, lineHeight: 1.4 }}>
                    Vai aparecer na proposta como: <em>"Comissão de performance: {form.comissao_percent || 0}% sobre o faturamento bruto mensal que exceder o faturamento base."</em>
                  </p>
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Observações (nota interna, opcional)</label>
              <textarea className="input" value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={3} style={{ resize: 'vertical', fontFamily: 'inherit' }} placeholder="Anotações internas — não aparecem na proposta gerada" />
            </div>

            {isEditing && (
              <div style={{ padding: '10px 12px', background: 'rgba(52, 199, 89, 0.06)', borderRadius: 8, fontSize: 12, color: '#34C759', marginTop: 4 }}>
                A URL da proposta não muda ao editar — o link já enviado continua válido com os dados atualizados.
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (isEditing ? 'Salvar' : 'Gerar Proposta')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
