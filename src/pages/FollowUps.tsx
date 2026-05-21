import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchFollowUps, createFollowUp, updateFollowUp, deleteFollowUp,
  fetchWhatsAppInstances,
  type FollowUp, type FollowUpStep, type WhatsAppInstance,
} from '../lib/api'
import { Zap, Plus, Edit3, Trash2, MessageSquare, Clock, Smartphone, Trash } from 'lucide-react'

type StepDraft = { delay_value: number; delay_unit: 'minutes' | 'hours' | 'days'; message_template: string }

function toMinutes(value: number, unit: 'minutes' | 'hours' | 'days'): number {
  if (unit === 'hours') return value * 60
  if (unit === 'days') return value * 60 * 24
  return value
}

function fromMinutes(minutes: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) return { value: minutes / (60 * 24), unit: 'days' }
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' }
  return { value: minutes, unit: 'minutes' }
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60 * 10) / 10}h`
  return `${Math.round(minutes / (60 * 24) * 10) / 10}d`
}

export default function FollowUps() {
  const { accountId } = useAccount()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<'new' | number | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instanceId, setInstanceId] = useState<number | ''>('')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [steps, setSteps] = useState<StepDraft[]>([{ delay_value: 10, delay_unit: 'minutes', message_template: '' }])

  const isEditing = typeof modalMode === 'number'

  const load = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchFollowUps(accountId),
      fetchWhatsAppInstances(accountId),
    ]).then(([fus, insts]) => {
      setFollowUps(fus)
      setInstances(insts)
    }).finally(() => setLoading(false))
  }
  useEffect(load, [accountId])

  const resetForm = () => {
    setName(''); setDescription(''); setInstanceId(''); setStopOnReply(true)
    setSteps([{ delay_value: 10, delay_unit: 'minutes', message_template: '' }])
    setModalMode(null)
  }

  const openNew = () => {
    resetForm()
    const connected = instances.find(i => i.status === 'connected')
    if (connected) setInstanceId(connected.id)
    setModalMode('new')
  }

  const openEdit = (fu: FollowUp) => {
    setName(fu.name)
    setDescription(fu.description || '')
    setInstanceId(fu.instance_id)
    setStopOnReply(fu.stop_on_reply === 1)
    if (fu.steps && fu.steps.length > 0) {
      setSteps(fu.steps.map(s => {
        const { value, unit } = fromMinutes(s.delay_minutes)
        return { delay_value: value, delay_unit: unit, message_template: s.message_template }
      }))
    }
    setModalMode(fu.id)
  }

  const addStep = () => setSteps(prev => [...prev, { delay_value: 1, delay_unit: 'days', message_template: '' }])
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, j) => j !== i))
  const updateStep = (i: number, patch: Partial<StepDraft>) => setSteps(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s))

  const handleSave = async () => {
    if (!accountId || !name.trim() || !instanceId) return alert('Nome e instancia obrigatorios')
    if (steps.length === 0 || steps.some(s => !s.message_template.trim())) return alert('Toda etapa precisa de mensagem')
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        instance_id: Number(instanceId),
        stop_on_reply: stopOnReply,
        steps: steps.map(s => ({
          delay_minutes: toMinutes(s.delay_value, s.delay_unit),
          message_template: s.message_template.trim(),
        })),
      }
      if (isEditing) await updateFollowUp(modalMode as number, accountId, payload as any)
      else await createFollowUp(accountId, payload)
      resetForm(); load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSaving(false)
  }

  const handleDelete = async (fu: FollowUp) => {
    if (!accountId) return
    if (!confirm(`Apagar follow-up "${fu.name}"? ${fu.active_leads ? `Tem ${fu.active_leads} lead(s) ativos — serao cancelados.` : ''}`)) return
    try {
      await deleteFollowUp(fu.id, accountId, !!fu.active_leads)
      load()
    } catch (e: any) { alert('Erro: ' + (e?.message || '')) }
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

  return (
    <div>
      <div className="page-header">
        <h1><Zap size={22} style={{ verticalAlign: -4, marginRight: 6 }} />Follow-ups</h1>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={14} /> Novo Follow-up
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Sequências de mensagens enviadas <strong>automaticamente</strong> pelo sistema. Diferente das Cadências (manuais), aqui o sistema envia sozinho conforme os tempos definidos.
      </p>

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : followUps.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <Zap size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p>Nenhum follow-up. Clica em <strong>+ Novo Follow-up</strong> pra começar.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Instância</th>
                <th>Etapas</th>
                <th>Leads ativos</th>
                <th>Parar se responder?</th>
                <th>Criado por</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map(fu => (
                <tr key={fu.id}>
                  <td><strong>{fu.name}</strong></td>
                  <td style={{ fontSize: 11 }}>
                    <Smartphone size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                    {fu.instance_name || '—'}
                    {fu.instance_status && fu.instance_status !== 'connected' && <span style={{ color: '#FF6B6B', marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td>{fu.steps_count} etapas</td>
                  <td>{fu.active_leads || 0}</td>
                  <td>{fu.stop_on_reply ? '✓ Sim' : 'Não'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fu.created_by_name || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(fu)} title="Editar" style={{ marginRight: 4 }}>
                      <Edit3 size={12} />
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(fu)} title="Apagar">
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
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2><Zap size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{isEditing ? 'Editar Follow-up' : 'Novo Follow-up'}</h2>

            <div className="form-group">
              <label>Nome do follow-up *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Welcome 3 passos" />
            </div>

            <div className="form-group">
              <label>Descrição (opcional)</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Anotação interna" />
            </div>

            <div className="form-group">
              <label>WhatsApp de envio *</label>
              <select className="select" value={instanceId} onChange={e => setInstanceId(e.target.value ? +e.target.value : '')}>
                <option value="">— escolha —</option>
                {instances.map(i => (
                  <option key={i.id} value={i.id}>{i.instance_name}{i.status === 'connected' ? ' ✓' : ' ✗ (offline)'}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={stopOnReply} onChange={e => setStopOnReply(e.target.checked)} />
                <span>Pausar follow-up se o lead responder</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 2 }}>
                Recomendado. Quando lead responde, atendente decide se continua ou para.
              </small>
            </div>

            <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>Etapas (mensagens automáticas)</h3>
              <button className="btn btn-secondary btn-sm" onClick={addStep}><Plus size={12} /> Adicionar etapa</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Etapa {i + 1}</span>
                    {steps.length > 1 && (
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStep(i)} title="Remover etapa">
                        <Trash size={11} />
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}><Clock size={10} style={{ verticalAlign: -1 }} /> Enviar após {i === 0 ? 'atribuir lead' : 'etapa anterior'}</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" type="number" min={1} value={s.delay_value} onChange={e => updateStep(i, { delay_value: parseInt(e.target.value) || 1 })} style={{ width: 100 }} />
                        <select className="select" value={s.delay_unit} onChange={e => updateStep(i, { delay_unit: e.target.value as any })} style={{ width: 130 }}>
                          <option value="minutes">minutos</option>
                          <option value="hours">horas</option>
                          <option value="days">dias</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 11 }}><MessageSquare size={10} style={{ verticalAlign: -1 }} /> Mensagem</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={s.message_template}
                      onChange={e => updateStep(i, { message_template: e.target.value })}
                      placeholder="Oi {{primeiro_nome}}! Tudo bem?"
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                      Variáveis: <code>{'{{primeiro_nome}}'}</code>, <code>{'{{nome}}'}</code>
                    </small>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={resetForm} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Criar Follow-up')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
