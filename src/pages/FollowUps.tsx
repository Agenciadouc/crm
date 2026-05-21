import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchFollowUps, createFollowUp, updateFollowUp, deleteFollowUp,
  fetchWhatsAppInstances, fetchFunnels,
  type FollowUp, type FollowUpStep, type WhatsAppInstance, type Funnel,
} from '../lib/api'
import { Zap, Plus, Edit3, Trash2, MessageSquare, Clock, Smartphone, Trash, Calendar, Activity } from 'lucide-react'

type StepDraft = {
  delay_value: number
  delay_unit: 'minutes' | 'hours' | 'days'
  message_template: string
  schedule_mode: 'relative' | 'absolute'
  scheduled_at: string  // datetime-local string
}

type FollowUpType = 'sequence' | 'inactivity'

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

// Converte UTC ISO ('YYYY-MM-DD HH:MM:SS') pra datetime-local ('YYYY-MM-DDTHH:MM') no horario do navegador
function utcToLocalInput(utcStr: string | null | undefined): string {
  if (!utcStr) return ''
  const d = new Date(utcStr.replace(' ', 'T') + (utcStr.endsWith('Z') ? '' : 'Z'))
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Converte datetime-local (local) pra ISO UTC
function localInputToUtcIso(localStr: string): string {
  if (!localStr) return ''
  const d = new Date(localStr)
  return d.toISOString()
}

const BLANK_STEP_SEQ: StepDraft = { delay_value: 10, delay_unit: 'minutes', message_template: '', schedule_mode: 'relative', scheduled_at: '' }
const BLANK_STEP_INACT: StepDraft = { delay_value: 0, delay_unit: 'minutes', message_template: '', schedule_mode: 'relative', scheduled_at: '' }

export default function FollowUps() {
  const { accountId } = useAccount()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<'new' | number | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [type, setType] = useState<FollowUpType>('sequence')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instanceId, setInstanceId] = useState<number | ''>('')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [steps, setSteps] = useState<StepDraft[]>([{ ...BLANK_STEP_SEQ }])
  // Inactivity specific
  const [inactivityStageId, setInactivityStageId] = useState<number | ''>('')
  const [inactivityDays, setInactivityDays] = useState(2)
  const [variationDelay, setVariationDelay] = useState(30)

  const isEditing = typeof modalMode === 'number'

  const load = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchFollowUps(accountId),
      fetchWhatsAppInstances(accountId),
      fetchFunnels(accountId),
    ]).then(([fus, insts, fns]) => {
      setFollowUps(fus)
      setInstances(insts)
      setFunnels(fns)
    }).finally(() => setLoading(false))
  }
  useEffect(load, [accountId])

  const resetForm = () => {
    setType('sequence')
    setName(''); setDescription(''); setInstanceId(''); setStopOnReply(true)
    setSteps([{ ...BLANK_STEP_SEQ }])
    setInactivityStageId(''); setInactivityDays(2); setVariationDelay(30)
    setModalMode(null)
  }

  const openNew = () => {
    resetForm()
    const connected = instances.find(i => i.status === 'connected')
    if (connected) setInstanceId(connected.id)
    setModalMode('new')
  }

  const openEdit = (fu: FollowUp) => {
    const fuType: FollowUpType = (fu.type === 'inactivity') ? 'inactivity' : 'sequence'
    setType(fuType)
    setName(fu.name)
    setDescription(fu.description || '')
    setInstanceId(fu.instance_id)
    setStopOnReply(fu.stop_on_reply === 1)
    setInactivityStageId(fu.inactivity_stage_id || '')
    setInactivityDays(fu.inactivity_days || 2)
    setVariationDelay(fu.variation_delay_seconds || 30)
    if (fu.steps && fu.steps.length > 0) {
      setSteps(fu.steps.map(s => {
        const { value, unit } = fromMinutes(s.delay_minutes)
        return {
          delay_value: value,
          delay_unit: unit,
          message_template: s.message_template,
          schedule_mode: (s.schedule_mode === 'absolute') ? 'absolute' : 'relative',
          scheduled_at: utcToLocalInput(s.scheduled_at),
        }
      }))
    } else {
      setSteps([fuType === 'inactivity' ? { ...BLANK_STEP_INACT } : { ...BLANK_STEP_SEQ }])
    }
    setModalMode(fu.id)
  }

  const addStep = () => setSteps(prev => [...prev, type === 'inactivity' ? { ...BLANK_STEP_INACT } : { delay_value: 1, delay_unit: 'days', message_template: '', schedule_mode: 'relative', scheduled_at: '' }])
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, j) => j !== i))
  const updateStep = (i: number, patch: Partial<StepDraft>) => setSteps(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s))

  // Quando troca tipo, ajusta steps
  const handleTypeChange = (newType: FollowUpType) => {
    setType(newType)
    if (newType === 'inactivity') {
      // Garante 3 variações no mínimo
      setSteps(prev => {
        const out = prev.map(s => ({ ...s, schedule_mode: 'relative' as const, scheduled_at: '' }))
        while (out.length < 3) out.push({ ...BLANK_STEP_INACT })
        return out
      })
    }
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Nome obrigatório'
    if (!instanceId) return 'Instância obrigatória'
    if (steps.length === 0 || steps.some(s => !s.message_template.trim())) return 'Toda etapa precisa de mensagem'
    if (type === 'inactivity') {
      if (steps.length < 3) return 'Inatividade exige mínimo 3 variações de mensagem'
      if (!inactivityStageId) return 'Selecione a etapa do funil pra monitorar'
      if (inactivityDays < 1) return 'Dias de inatividade mínimo 1'
      if (variationDelay < 30) return 'Intervalo entre envios mínimo 30 segundos'
    } else {
      for (const s of steps) {
        if (s.schedule_mode === 'absolute') {
          if (!s.scheduled_at) return 'Data fixa precisa ser preenchida'
          const target = new Date(s.scheduled_at)
          if (isNaN(target.getTime())) return 'Data fixa inválida'
          if (!isEditing && target.getTime() < Date.now() + 60_000) return 'Data fixa precisa ser pelo menos 1min no futuro'
        }
      }
    }
    return null
  }

  const handleSave = async () => {
    if (!accountId) return
    const err = validate()
    if (err) return alert(err)
    setSaving(true)
    try {
      const payload: any = {
        type,
        name: name.trim(),
        description: description.trim() || undefined,
        instance_id: Number(instanceId),
        stop_on_reply: type === 'inactivity' ? false : stopOnReply,
        steps: steps.map(s => ({
          delay_minutes: type === 'inactivity' ? 0 : toMinutes(s.delay_value, s.delay_unit),
          message_template: s.message_template.trim(),
          schedule_mode: type === 'inactivity' ? 'relative' : s.schedule_mode,
          scheduled_at: (type === 'sequence' && s.schedule_mode === 'absolute') ? localInputToUtcIso(s.scheduled_at) : null,
        })),
      }
      if (type === 'inactivity') {
        payload.inactivity_stage_id = Number(inactivityStageId)
        payload.inactivity_days = inactivityDays
        payload.variation_delay_seconds = variationDelay
      }
      if (isEditing) await updateFollowUp(modalMode as number, accountId, payload)
      else await createFollowUp(accountId, payload)
      resetForm(); load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSaving(false)
  }

  const handleDelete = async (fu: FollowUp) => {
    if (!accountId) return
    if (!confirm(`Apagar follow-up "${fu.name}"? ${fu.active_leads ? `Tem ${fu.active_leads} lead(s) ativos — serão cancelados.` : ''}`)) return
    try { await deleteFollowUp(fu.id, accountId, !!fu.active_leads); load() }
    catch (e: any) { alert('Erro: ' + (e?.message || '')) }
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

  // Lista de stages pra select de inatividade
  const allStages = funnels.flatMap(f => (f.stages || []).map(s => ({ ...s, funnel_name: f.name })))

  return (
    <div>
      <div className="page-header">
        <h1><Zap size={22} style={{ verticalAlign: -4, marginRight: 6 }} />Follow-ups</h1>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={14} /> Novo Follow-up
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Sequências de mensagens automáticas. <strong>Sequência</strong>: atendente atribui lead e sistema envia em ordem. <strong>Inatividade</strong>: sistema scan-eia leads inativos numa etapa e envia automaticamente.
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
                <th>Tipo</th>
                <th>Instância</th>
                <th>Etapas/Variações</th>
                <th>Leads ativos</th>
                <th>Criado por</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map(fu => (
                <tr key={fu.id}>
                  <td><strong>{fu.name}</strong></td>
                  <td style={{ fontSize: 11 }}>
                    {fu.type === 'inactivity' ? (
                      <span style={{ color: '#FF8A2B' }}><Activity size={10} style={{ verticalAlign: -1 }} /> Inatividade</span>
                    ) : (
                      <span style={{ color: '#5DADE2' }}><Clock size={10} style={{ verticalAlign: -1 }} /> Sequência</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    <Smartphone size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                    {fu.instance_name || '—'}
                    {fu.instance_status && fu.instance_status !== 'connected' && <span style={{ color: '#FF6B6B', marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td>{fu.steps_count}</td>
                  <td>{fu.active_leads || 0}</td>
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
          <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2><Zap size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{isEditing ? 'Editar Follow-up' : 'Novo Follow-up'}</h2>

            {/* Tipo do follow-up */}
            {!isEditing && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>Tipo de follow-up</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ flex: 1, padding: 12, border: `2px solid ${type === 'sequence' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 8, cursor: 'pointer', background: type === 'sequence' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                    <input type="radio" checked={type === 'sequence'} onChange={() => handleTypeChange('sequence')} style={{ marginRight: 6 }} />
                    <strong><Clock size={12} style={{ verticalAlign: -2 }} /> Sequência</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Atribui lead → envia mensagens em ordem (cada uma com seu delay ou data fixa)</div>
                  </label>
                  <label style={{ flex: 1, padding: 12, border: `2px solid ${type === 'inactivity' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 8, cursor: 'pointer', background: type === 'inactivity' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                    <input type="radio" checked={type === 'inactivity'} onChange={() => handleTypeChange('inactivity')} style={{ marginRight: 6 }} />
                    <strong><Activity size={12} style={{ verticalAlign: -2 }} /> Inatividade</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Scan automático: leads numa etapa que ficaram N dias sem responder recebem uma variação de msg</div>
                  </label>
                </div>
              </div>
            )}
            {isEditing && (
              <div style={{ padding: 8, background: 'rgba(255,179,0,0.05)', borderRadius: 6, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Tipo: <strong>{type === 'inactivity' ? 'Inatividade' : 'Sequência'}</strong> (não pode mudar — crie outro se precisar de tipo diferente)
              </div>
            )}

            <div className="form-group">
              <label>Nome *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'inactivity' ? 'Ex: Reativação 2 dias' : 'Ex: Welcome 3 passos'} />
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

            {/* Campos específicos de inactivity */}
            {type === 'inactivity' && (
              <>
                <div className="form-group" style={{ padding: 12, background: 'rgba(255,138,43,0.05)', border: '1px solid rgba(255,138,43,0.2)', borderRadius: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#FF8A2B' }}><Activity size={12} style={{ verticalAlign: -2 }} /> Configuração de Inatividade</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div>
                      <label style={{ fontSize: 11 }}>Etapa do funil monitorada *</label>
                      <select className="select" value={inactivityStageId} onChange={e => setInactivityStageId(e.target.value ? +e.target.value : '')}>
                        <option value="">— escolha —</option>
                        {allStages.map(s => (
                          <option key={s.id} value={s.id}>{s.funnel_name} · {s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Dias de inatividade *</label>
                      <input className="input" type="number" min={1} value={inactivityDays} onChange={e => setInactivityDays(parseInt(e.target.value) || 2)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Intervalo entre envios (s)</label>
                      <input className="input" type="number" min={30} value={variationDelay} onChange={e => setVariationDelay(Math.max(30, parseInt(e.target.value) || 30))} />
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                    Sistema vai mandar UMA das variações abaixo (rotação) pra cada lead da etapa que ficar {inactivityDays} dia(s) sem responder. {variationDelay}s mínimo entre envios pra não floodar.
                  </p>
                </div>
              </>
            )}

            {type === 'sequence' && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={stopOnReply} onChange={e => setStopOnReply(e.target.checked)} />
                  <span>Pausar follow-up se o lead responder</span>
                </label>
              </div>
            )}

            <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 13, color: 'var(--accent)', margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {type === 'inactivity' ? `Variações de mensagem (mínimo 3)` : 'Etapas (mensagens automáticas)'}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={addStep}><Plus size={12} /> Adicionar {type === 'inactivity' ? 'variação' : 'etapa'}</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                      {type === 'inactivity' ? `Variação ${i + 1}` : `Etapa ${i + 1}`}
                    </span>
                    {steps.length > (type === 'inactivity' ? 3 : 1) && (
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStep(i)} title="Remover">
                        <Trash size={11} />
                      </button>
                    )}
                  </div>

                  {/* Modo de timing — só pra sequence */}
                  {type === 'sequence' && (
                    <>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <label style={{ flex: 1, padding: 6, border: `1px solid ${s.schedule_mode === 'relative' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, textAlign: 'center', background: s.schedule_mode === 'relative' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                          <input type="radio" checked={s.schedule_mode === 'relative'} onChange={() => updateStep(i, { schedule_mode: 'relative' })} style={{ marginRight: 4 }} />
                          🔄 Relativo (após {i === 0 ? 'atribuir lead' : 'etapa anterior'})
                        </label>
                        <label style={{ flex: 1, padding: 6, border: `1px solid ${s.schedule_mode === 'absolute' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, textAlign: 'center', background: s.schedule_mode === 'absolute' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                          <input type="radio" checked={s.schedule_mode === 'absolute'} onChange={() => updateStep(i, { schedule_mode: 'absolute' })} style={{ marginRight: 4 }} />
                          📅 Data fixa
                        </label>
                      </div>

                      {s.schedule_mode === 'relative' ? (
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 11 }}><Clock size={10} style={{ verticalAlign: -1 }} /> Quanto tempo após {i === 0 ? 'atribuir' : 'etapa anterior'}</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input className="input" type="number" min={1} value={s.delay_value} onChange={e => updateStep(i, { delay_value: parseInt(e.target.value) || 1 })} style={{ width: 100 }} />
                            <select className="select" value={s.delay_unit} onChange={e => updateStep(i, { delay_unit: e.target.value as any })} style={{ width: 130 }}>
                              <option value="minutes">minutos</option>
                              <option value="hours">horas</option>
                              <option value="days">dias</option>
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 11 }}><Calendar size={10} style={{ verticalAlign: -1 }} /> Data e hora exatas</label>
                          <input
                            className="input"
                            type="datetime-local"
                            value={s.scheduled_at}
                            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                            onChange={e => updateStep(i, { scheduled_at: e.target.value })}
                            style={{ width: 240 }}
                          />
                          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Horário local do seu navegador. Sistema vai disparar exatamente nesse momento.</p>
                        </div>
                      )}
                    </>
                  )}

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 11 }}><MessageSquare size={10} style={{ verticalAlign: -1 }} /> Mensagem</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={s.message_template}
                      onChange={e => updateStep(i, { message_template: e.target.value })}
                      placeholder={type === 'inactivity' ? 'Variação de mensagem...' : 'Oi {{primeiro_nome}}! Tudo bem?'}
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
