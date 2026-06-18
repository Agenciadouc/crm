import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchFollowUps, createFollowUp, updateFollowUp, deleteFollowUp,
  fetchWhatsAppInstances, fetchFunnels, fetchUsers, fetchTags,
  type FollowUp, type FollowUpStep, type WhatsAppInstance, type Funnel, type User, type Tag,
} from '../lib/api'
import { Zap, Plus, Edit3, Trash2, MessageSquare, Clock, Smartphone, Trash, Calendar, Activity } from 'lucide-react'

type StepDraft = {
  delay_value: number
  delay_unit: 'minutes' | 'hours' | 'days'
  message_template: string
  schedule_mode: 'relative' | 'absolute'
  scheduled_at: string  // datetime-local string
  variations: string[]  // variações alternativas (sequence-inactivity); sender sorteia uma
}

type InactivityMode = 'rotation' | 'sequence'
type OnReplyAction = 'pause' | 'roulette' | 'assign_user'

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

const BLANK_STEP_SEQ: StepDraft = { delay_value: 10, delay_unit: 'minutes', message_template: '', schedule_mode: 'relative', scheduled_at: '', variations: [] }
const BLANK_STEP_INACT: StepDraft = { delay_value: 0, delay_unit: 'minutes', message_template: '', schedule_mode: 'relative', scheduled_at: '', variations: [] }
const BLANK_STEP_INACT_SEQ: StepDraft = { delay_value: 0, delay_unit: 'hours', message_template: '', schedule_mode: 'relative', scheduled_at: '', variations: ['', '', ''] }

export default function FollowUps() {
  const { accountId } = useAccount()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [tags, setTags] = useState<Tag[]>([])
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
  const [inactivityValue, setInactivityValue] = useState(2)
  const [inactivityUnit, setInactivityUnit] = useState<'days' | 'hours'>('days')
  const [inactivityMode, setInactivityMode] = useState<InactivityMode>('sequence')  // default novo = sequence
  const [variationDelay, setVariationDelay] = useState(60)  // default 60s (era 30)
  // On-reply
  const [onReplyAction, setOnReplyAction] = useState<OnReplyAction>('pause')
  const [onReplyUserId, setOnReplyUserId] = useState<number | ''>('')
  const [onReplyStageId, setOnReplyStageId] = useState<number | ''>('')
  const [onReplyTagId, setOnReplyTagId] = useState<number | ''>('')

  const isEditing = typeof modalMode === 'number'

  const load = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchFollowUps(accountId),
      fetchWhatsAppInstances(accountId),
      fetchFunnels(accountId),
      fetchUsers(accountId),
      fetchTags(accountId),
    ]).then(([fus, insts, fns, usrs, tgs]) => {
      setFollowUps(fus)
      setInstances(insts)
      setFunnels(fns)
      setUsers(usrs.filter(u => u.is_active === 1))
      setTags(tgs)
    }).finally(() => setLoading(false))
  }
  useEffect(load, [accountId])

  const resetForm = () => {
    setType('sequence')
    setName(''); setDescription(''); setInstanceId(''); setStopOnReply(true)
    setSteps([{ ...BLANK_STEP_SEQ }])
    setInactivityStageId(''); setInactivityValue(2); setInactivityUnit('days')
    setInactivityMode('sequence'); setVariationDelay(60)
    setOnReplyAction('pause'); setOnReplyUserId('')
    setOnReplyStageId(''); setOnReplyTagId('')
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
    // Carrega tempo: prefere inactivity_minutes; fallback days
    if (fu.inactivity_minutes != null) {
      if (fu.inactivity_minutes >= 60 * 24 && fu.inactivity_minutes % (60 * 24) === 0) {
        setInactivityValue(fu.inactivity_minutes / (60 * 24)); setInactivityUnit('days')
      } else {
        setInactivityValue(Math.max(1, Math.round(fu.inactivity_minutes / 60))); setInactivityUnit('hours')
      }
    } else {
      setInactivityValue(fu.inactivity_days || 2); setInactivityUnit('days')
    }
    setInactivityMode((fu.inactivity_mode === 'sequence') ? 'sequence' : 'rotation')
    setVariationDelay(fu.variation_delay_seconds || 60)
    setOnReplyAction((fu.on_reply_action as OnReplyAction) || 'pause')
    setOnReplyUserId(fu.on_reply_user_id || '')
    setOnReplyStageId(fu.on_reply_move_to_stage_id || '')
    setOnReplyTagId(fu.on_reply_add_tag_id || '')
    if (fu.steps && fu.steps.length > 0) {
      setSteps(fu.steps.map(s => {
        const { value, unit } = fromMinutes(s.delay_minutes)
        let vars: string[] = []
        if (s.variations) {
          if (Array.isArray(s.variations)) vars = s.variations.filter(v => typeof v === 'string')
          else if (typeof s.variations === 'string') {
            try { const parsed = JSON.parse(s.variations); if (Array.isArray(parsed)) vars = parsed.filter((v: any) => typeof v === 'string') } catch {}
          }
        }
        return {
          delay_value: value,
          delay_unit: unit,
          message_template: s.message_template,
          schedule_mode: (s.schedule_mode === 'absolute') ? 'absolute' : 'relative',
          scheduled_at: utcToLocalInput(s.scheduled_at),
          variations: vars,
        }
      }))
    } else {
      setSteps([fuType === 'inactivity' ? { ...BLANK_STEP_INACT } : { ...BLANK_STEP_SEQ }])
    }
    setModalMode(fu.id)
  }

  const addStep = () => setSteps(prev => {
    if (type === 'inactivity' && inactivityMode === 'sequence') return [...prev, { ...BLANK_STEP_INACT_SEQ }]
    if (type === 'inactivity') return [...prev, { ...BLANK_STEP_INACT }]
    return [...prev, { delay_value: 1, delay_unit: 'days', message_template: '', schedule_mode: 'relative', scheduled_at: '', variations: [] }]
  })
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, j) => j !== i))
  const updateStep = (i: number, patch: Partial<StepDraft>) => setSteps(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s))

  // Helpers de variações por step (sequence-inactivity)
  const addVariation = (stepIdx: number) => updateStep(stepIdx, { variations: [...(steps[stepIdx].variations || []), ''] })
  const updateVariation = (stepIdx: number, varIdx: number, value: string) => updateStep(stepIdx, {
    variations: (steps[stepIdx].variations || []).map((v, j) => j === varIdx ? value : v),
  })
  const removeVariation = (stepIdx: number, varIdx: number) => updateStep(stepIdx, {
    variations: (steps[stepIdx].variations || []).filter((_, j) => j !== varIdx),
  })

  // Quando troca tipo, ajusta steps
  const handleTypeChange = (newType: FollowUpType) => {
    setType(newType)
    if (newType === 'inactivity') {
      // Default novo = mode sequence (1 step com 3 variações)
      setInactivityMode('sequence')
      setSteps([{ ...BLANK_STEP_INACT_SEQ }])
    }
  }

  // Quando troca o modo de inactivity, reformata steps
  const handleInactivityModeChange = (mode: InactivityMode) => {
    setInactivityMode(mode)
    if (mode === 'sequence') {
      // 1 step com 3 variações iniciais
      setSteps([{ ...BLANK_STEP_INACT_SEQ }])
    } else {
      // rotation: 3 steps (variações tradicionais)
      setSteps([{ ...BLANK_STEP_INACT }, { ...BLANK_STEP_INACT }, { ...BLANK_STEP_INACT }])
    }
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Nome obrigatório'
    if (!instanceId) return 'Instância obrigatória'
    if (steps.length === 0) return 'Pelo menos 1 etapa obrigatória'
    if (type === 'inactivity') {
      if (!inactivityStageId) return 'Selecione a etapa do funil pra monitorar'
      if (inactivityValue < 1) return 'Tempo de inatividade mínimo 1'
      if (variationDelay < 30) return 'Intervalo entre envios mínimo 30 segundos'
      if (inactivityMode === 'rotation') {
        if (steps.length < 3) return 'Modo rotation: mínimo 3 variações'
        if (steps.some(s => !s.message_template.trim())) return 'Toda variação precisa de mensagem'
      } else {
        // sequence: cada step precisa de variações (>=3) OU message_template
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i]
          const validVars = (s.variations || []).filter(v => v.trim()).length
          const hasMain = !!s.message_template.trim()
          if (!hasMain && validVars < 3) return `Step ${i + 1}: mensagem principal ou mínimo 3 variações`
        }
      }
      if (onReplyAction === 'assign_user' && !onReplyUserId) return 'Selecione o atendente alvo'
    } else {
      if (steps.some(s => !s.message_template.trim())) return 'Toda etapa precisa de mensagem'
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
        stop_on_reply: type === 'inactivity' ? true : stopOnReply,  // inactivity sempre pausa (precisa pra on-reply funcionar)
        steps: steps.map(s => ({
          delay_minutes: type === 'inactivity' ? toMinutes(s.delay_value, s.delay_unit) : toMinutes(s.delay_value, s.delay_unit),
          message_template: s.message_template.trim(),
          schedule_mode: type === 'inactivity' ? 'relative' : s.schedule_mode,
          scheduled_at: (type === 'sequence' && s.schedule_mode === 'absolute') ? localInputToUtcIso(s.scheduled_at) : null,
          variations: (s.variations && s.variations.filter(v => v.trim()).length > 0) ? s.variations.map(v => v.trim()).filter(Boolean) : undefined,
        })),
      }
      if (type === 'inactivity') {
        payload.inactivity_stage_id = Number(inactivityStageId)
        payload.inactivity_mode = inactivityMode
        // Sempre manda inactivity_minutes (back-compat: inactivity_days fica como histórico)
        payload.inactivity_minutes = inactivityUnit === 'hours' ? inactivityValue * 60 : inactivityValue * 60 * 24
        payload.inactivity_days = inactivityUnit === 'days' ? inactivityValue : Math.max(1, Math.round((inactivityValue * 60) / (60 * 24)))
        payload.variation_delay_seconds = variationDelay
        payload.on_reply_action = onReplyAction
        payload.on_reply_user_id = onReplyAction === 'assign_user' ? Number(onReplyUserId) : null
        payload.on_reply_move_to_stage_id = onReplyStageId ? Number(onReplyStageId) : null
        payload.on_reply_add_tag_id = onReplyTagId ? Number(onReplyTagId) : null
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

                  {/* Modo: rotation (legacy) vs sequence (cadência) */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 8 }}>
                    <label style={{ flex: 1, padding: 8, border: `1px solid ${inactivityMode === 'sequence' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, background: inactivityMode === 'sequence' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                      <input type="radio" checked={inactivityMode === 'sequence'} onChange={() => handleInactivityModeChange('sequence')} style={{ marginRight: 4 }} />
                      <strong>Cadência</strong> — múltiplos passos. Se lead não responde ao 1º, envia 2º depois de X tempo, etc. Cada step pode ter variações.
                    </label>
                    <label style={{ flex: 1, padding: 8, border: `1px solid ${inactivityMode === 'rotation' ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, background: inactivityMode === 'rotation' ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                      <input type="radio" checked={inactivityMode === 'rotation'} onChange={() => handleInactivityModeChange('rotation')} style={{ marginRight: 4 }} />
                      <strong>Rotação (legacy)</strong> — manda 1 msg por lead, rotacionando entre as variações.
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
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
                      <label style={{ fontSize: 11 }}>Tempo inativo *</label>
                      <input className="input" type="number" min={1} value={inactivityValue} onChange={e => setInactivityValue(parseInt(e.target.value) || 1)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Unidade</label>
                      <select className="select" value={inactivityUnit} onChange={e => setInactivityUnit(e.target.value as 'days' | 'hours')}>
                        <option value="days">Dias</option>
                        <option value="hours">Horas</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Intervalo envios (s)</label>
                      <input className="input" type="number" min={30} value={variationDelay} onChange={e => setVariationDelay(Math.max(30, parseInt(e.target.value) || 30))} />
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                    {inactivityMode === 'sequence'
                      ? `Lead que ficar ${inactivityValue} ${inactivityUnit === 'days' ? 'dia(s)' : 'hora(s)'} sem responder na etapa recebe o Step 1. Se não responder, recebe Step 2 depois do tempo configurado nele, etc.`
                      : `Sistema vai mandar UMA das variações (rotação) pra cada lead da etapa inativo há ${inactivityValue} ${inactivityUnit === 'days' ? 'dia(s)' : 'hora(s)'}. ${variationDelay}s entre envios pra não floodar.`}
                  </p>
                </div>

                {/* On-reply action */}
                <div className="form-group" style={{ padding: 12, background: 'rgba(93,173,226,0.05)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5DADE2' }}><MessageSquare size={12} style={{ verticalAlign: -2 }} /> Quando o lead responder a uma msg desse follow-up:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" checked={onReplyAction === 'pause'} onChange={() => setOnReplyAction('pause')} />
                      <span>Só pausar follow-up (mantém atendente atual)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" checked={onReplyAction === 'roulette'} onChange={() => setOnReplyAction('roulette')} />
                      <span>Pausar + jogar na roleta de atendentes</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input type="radio" checked={onReplyAction === 'assign_user'} onChange={() => setOnReplyAction('assign_user')} />
                      <span>Pausar + atribuir pra atendente específico:</span>
                    </label>
                    {onReplyAction === 'assign_user' && (
                      <select className="select" value={onReplyUserId} onChange={e => setOnReplyUserId(e.target.value ? +e.target.value : '')} style={{ marginLeft: 22, maxWidth: 320 }}>
                        <option value="">— escolha atendente —</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.is_bot === 1 ? '🤖 (IA)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Ações adicionais opcionais — independentes do action escolhido */}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(93,173,226,0.2)' }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#5DADE2' }}>Ações adicionais ao responder (opcionais)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                      <div>
                        <label style={{ fontSize: 11 }}>Mover lead pra etapa</label>
                        <select className="select" value={onReplyStageId} onChange={e => setOnReplyStageId(e.target.value ? +e.target.value : '')}>
                          <option value="">— não move —</option>
                          {allStages.map(s => <option key={s.id} value={s.id}>{s.funnel_name} · {s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11 }}>Adicionar tag</label>
                        <select className="select" value={onReplyTagId} onChange={e => setOnReplyTagId(e.target.value ? +e.target.value : '')}>
                          <option value="">— sem tag —</option>
                          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
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
                {type === 'inactivity'
                  ? (inactivityMode === 'sequence' ? 'Steps da cadência (cada um com variações)' : 'Variações de mensagem (mín. 3)')
                  : 'Etapas (mensagens automáticas)'}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={addStep}>
                <Plus size={12} /> Adicionar {type === 'inactivity' ? (inactivityMode === 'sequence' ? 'step' : 'variação') : 'etapa'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map((s, i) => {
                const isInactSeq = type === 'inactivity' && inactivityMode === 'sequence'
                const isInactRot = type === 'inactivity' && inactivityMode === 'rotation'
                const minSteps = isInactRot ? 3 : 1
                return (
                <div key={i} style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                      {isInactRot ? `Variação ${i + 1}` : `Step ${i + 1}`}
                    </span>
                    {steps.length > minSteps && (
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStep(i)} title="Remover">
                        <Trash size={11} />
                      </button>
                    )}
                  </div>

                  {/* Modo de timing — só pra sequence type */}
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

                  {/* Delay pra inactivity-sequence steps 2+ (step 1 dispara quando inatividade bate) */}
                  {isInactSeq && i > 0 && (
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 11 }}><Clock size={10} style={{ verticalAlign: -1 }} /> Quanto tempo após Step {i} (se lead não responder)</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" type="number" min={1} value={s.delay_value} onChange={e => updateStep(i, { delay_value: parseInt(e.target.value) || 1 })} style={{ width: 100 }} />
                        <select className="select" value={s.delay_unit} onChange={e => updateStep(i, { delay_unit: e.target.value as any })} style={{ width: 130 }}>
                          <option value="minutes">minutos</option>
                          <option value="hours">horas</option>
                          <option value="days">dias</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {isInactSeq && i === 0 && (
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
                      Step 1 dispara assim que o lead bate o tempo de inatividade configurado acima ({inactivityValue} {inactivityUnit === 'days' ? 'dia(s)' : 'hora(s)'}).
                    </p>
                  )}

                  {/* Mensagem principal */}
                  <div className="form-group" style={{ marginBottom: isInactSeq ? 8 : 0 }}>
                    <label style={{ fontSize: 11 }}>
                      <MessageSquare size={10} style={{ verticalAlign: -1 }} /> {isInactSeq ? 'Mensagem principal (opcional se tiver 3+ variações)' : 'Mensagem'}
                    </label>
                    <textarea
                      className="input"
                      rows={3}
                      value={s.message_template}
                      onChange={e => updateStep(i, { message_template: e.target.value })}
                      placeholder={isInactRot ? 'Variação de mensagem...' : (isInactSeq ? 'Mensagem padrão se você não criar variações' : 'Oi {{primeiro_nome}}! Tudo bem?')}
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                      Variáveis: <code>{'{{primeiro_nome}}'}</code>, <code>{'{{nome}}'}</code>
                    </small>
                  </div>

                  {/* Variações pra inactivity-sequence (cada step pode ter N variações) */}
                  {isInactSeq && (
                    <div style={{ padding: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>Variações desse step (mín. 3 — sistema sorteia uma)</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => addVariation(i)} type="button">
                          <Plus size={10} /> Variação
                        </button>
                      </div>
                      {(s.variations || []).length === 0 && (
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Sem variações ainda — usa a msg principal acima. Clica em "Variação" pra adicionar.</p>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(s.variations || []).map((v, vi) => (
                          <div key={vi} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, minWidth: 28 }}>#{vi + 1}</span>
                            <textarea
                              className="input"
                              rows={2}
                              value={v}
                              onChange={e => updateVariation(i, vi, e.target.value)}
                              placeholder={`Variação ${vi + 1}...`}
                              style={{ flex: 1, fontSize: 12 }}
                            />
                            <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeVariation(i, vi)} title="Remover variação" type="button">
                              <Trash size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )})}
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
