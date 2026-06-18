import { useState, useEffect } from 'react'
import { fetchInstanceAutoMessages, saveInstanceAutoMessages, type InstanceAutoMessageConfig, type WhatsAppInstance } from '../lib/api'
import { X, MessageSquare, Moon, Save, AlertTriangle, Smartphone } from 'lucide-react'

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terca' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sabado' },
  { key: 'sun', label: 'Domingo' },
]

type ScheduleSlot = { start: string; end: string }
type Schedule = Record<string, ScheduleSlot[]>

const DEFAULT_SCHEDULE: Schedule = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
  sat: [],
  sun: [],
}

const VARS_HELP = '{{name}} = nome  ·  {{primeiro_nome}} = primeiro nome  ·  {{empresa}}  ·  {{cidade}}  ·  {{instance}}  ·  {{atendente}}'

interface Props {
  instance: WhatsAppInstance
  accountId: number
  onClose: () => void
}

export default function InstanceAutoMessagesModal({ instance, accountId, onClose }: Props) {
  const [tab, setTab] = useState<'greeting' | 'away'>('greeting')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<InstanceAutoMessageConfig>({
    instance_id: instance.id,
    greeting_enabled: 0,
    greeting_text: '',
    greeting_cooldown_hours: 24,
    away_enabled: 0,
    away_mode: 'manual',
    away_manual_active: 0,
    away_text: '',
    away_schedule_json: null,
    away_cooldown_hours: 4,
  })
  const [schedule, setSchedule] = useState<Schedule>(DEFAULT_SCHEDULE)

  useEffect(() => {
    setLoading(true)
    fetchInstanceAutoMessages(instance.id, accountId)
      .then(({ config: c }) => {
        setConfig({ ...config, ...c })
        if (c.away_schedule_json) {
          try { setSchedule(JSON.parse(c.away_schedule_json)) } catch {}
        }
      })
      .catch(e => setError(e?.message || 'Falha ao carregar'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, accountId])

  const update = (patch: Partial<InstanceAutoMessageConfig>) => setConfig(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const payload: any = {
        ...config,
        away_mode: 'schedule',
        away_manual_active: 0,
        away_schedule_json: JSON.stringify(schedule),
      }
      await saveInstanceAutoMessages(instance.id, accountId, payload)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const updateSlot = (day: string, idx: number, field: 'start' | 'end', value: string) => {
    setSchedule(prev => ({ ...prev, [day]: prev[day].map((s, i) => i === idx ? { ...s, [field]: value } : s) }))
  }
  const addSlot = (day: string) => {
    setSchedule(prev => ({ ...prev, [day]: [...(prev[day] || []), { start: '09:00', end: '18:00' }] }))
  }
  const removeSlot = (day: string, idx: number) => {
    setSchedule(prev => ({ ...prev, [day]: prev[day].filter((_, i) => i !== idx) }))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Smartphone size={18} style={{ color: '#FFB300' }} /> Mensagens Automaticas — {instance.instance_name}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 4 }}>
          <button className={`btn btn-sm ${tab === 'greeting' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('greeting')}>
            <MessageSquare size={12} /> Saudacao
          </button>
          <button className={`btn btn-sm ${tab === 'away' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('away')}>
            <Moon size={12} /> Ausencia
          </button>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12, display: 'flex', gap: 8 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : (
          <>
            {/* TAB: SAUDAÇÃO */}
            {tab === 'greeting' && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!config.greeting_enabled} onChange={e => update({ greeting_enabled: e.target.checked ? 1 : 0 })} />
                  <span><strong>Ativar saudacao automatica</strong></span>
                </label>
                <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
                  Enviada UMA vez quando um lead novo manda a primeira mensagem nesse WhatsApp. Cooldown anti-flood configuravel abaixo.
                </p>
                <div className="form-group">
                  <label>Texto da saudacao</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={config.greeting_text || ''}
                    onChange={e => update({ greeting_text: e.target.value })}
                    placeholder="Oi {{primeiro_nome}}! Tudo bem? Vi que voce entrou em contato, em breve um de nossos atendentes vai te responder."
                  />
                  <p style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>{VARS_HELP}</p>
                </div>
                <div className="form-group">
                  <label>Cooldown da saudacao (horas)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={720}
                    style={{ width: 100 }}
                    value={config.greeting_cooldown_hours || 24}
                    onChange={e => update({ greeting_cooldown_hours: parseInt(e.target.value) || 24 })}
                  />
                  <p style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>
                    Tempo minimo entre saudacoes pro mesmo lead. Default 24h. Em pratica raramente eh ativado (saudacao so dispara em lead novo).
                  </p>
                </div>
              </div>
            )}

            {/* TAB: AUSÊNCIA */}
            {tab === 'away' && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!config.away_enabled} onChange={e => update({ away_enabled: e.target.checked ? 1 : 0 })} />
                  <span><strong>Ativar resposta de ausencia</strong></span>
                </label>
                <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
                  Resposta automatica enviada quando lead mandar mensagem fora do horario, ou quando atendente marcar como ausente.
                </p>

                <div className="form-group">
                  <label>Horarios de DISPONIBILIDADE (fora deles dispara ausencia)</label>
                  <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
                    Sem horario num dia = ausente o dia todo. Sabado/Domingo vazios = sempre ausente fim de semana.
                  </p>
                  {DAYS.map(d => (
                    <div key={d.key} style={{ background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 12, color: '#C8C2D8' }}>{d.label}</strong>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => addSlot(d.key)}>+ Adicionar horario</button>
                      </div>
                      {(schedule[d.key] || []).length === 0 ? (
                        <span style={{ fontSize: 10, color: '#FF6B6B', fontStyle: 'italic' }}>Ausente o dia todo</span>
                      ) : (
                        (schedule[d.key] || []).map((slot, idx) => (
                          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                            <input type="time" className="input" value={slot.start} onChange={e => updateSlot(d.key, idx, 'start', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                            <span style={{ color: '#9B96B0', fontSize: 11 }}>ate</span>
                            <input type="time" className="input" value={slot.end} onChange={e => updateSlot(d.key, idx, 'end', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                            <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeSlot(d.key, idx)}><X size={10} /></button>
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label>Texto da resposta de ausencia</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={config.away_text || ''}
                    onChange={e => update({ away_text: e.target.value })}
                    placeholder="Estamos fora do horario de atendimento. Retornamos em breve! Atendimento: Seg-Sex 9h-18h."
                  />
                  <p style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>{VARS_HELP}</p>
                </div>

                <div className="form-group">
                  <label>Cooldown (horas) — nao reenvia ausencia pro mesmo lead dentro desse periodo</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={48}
                    value={config.away_cooldown_hours || 4}
                    onChange={e => update({ away_cooldown_hours: parseInt(e.target.value) || 4 })}
                    style={{ width: 100 }}
                  />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
