import { useEffect, useState, type CSSProperties } from 'react'
import {
  fetchInstanceAutoMessages, saveInstanceAutoMessages, updateInstanceFirstMsgTemplate,
  fetchFunnels, fetchAgents, updateFunnelFirstMessage,
  type WhatsAppInstance, type Funnel, type Agent,
} from '../lib/api'
import {
  DAY_KEYS, DAY_LABELS, resolveFirstMessage, buildFirstMessageSave,
  resolveServiceHours, buildServiceHoursSave, scheduleErrors,
  type FirstMessageState, type ServiceHoursState, type DayKey,
} from '../lib/numberSettings.js'
import { X, MessageSquare, Clock, Moon, Save, AlertTriangle, Smartphone, Info } from 'lucide-react'

type SettingsTab = 'primeira' | 'horario' | 'ausencia'

interface Props {
  instance: WhatsAppInstance
  accountId: number
  canEditFirstMessage: boolean
  canManageFunnels: boolean
  onClose: () => void
  onSaved: (instance: WhatsAppInstance) => void
}

const VARS_HELP = 'Variáveis: {{primeiro_nome}} · {{nome}} · {{empresa}} · {{cidade}} · {{atendente}} · {{atendente_nome}}. {{etapa}} e {{funil}} só são preenchidas para leads de formulário ou planilha.'
const HOLD_HELP = 'Ligado: fora do horário, este número não envia follow-ups, disparos, cadências, a primeira mensagem para leads de formulário/planilha nem respostas do agente de IA. Mensagens enviadas pelo Chat, a saudação e a ausência sempre saem.'

const hint: CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }
const infoBox: CSSProperties = { background: 'rgba(91,173,226,0.06)', border: '1px solid rgba(91,173,226,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 12 }
const warnBox: CSSProperties = { background: 'rgba(255,179,0,0.07)', border: '1px solid rgba(255,179,0,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, marginBottom: 12, display: 'flex', gap: 8 }

export default function NumberSettingsModal({ instance, accountId, canEditFirstMessage, canManageFunnels, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<SettingsTab>('primeira')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [first, setFirst] = useState<FirstMessageState>(() => resolveFirstMessage({ first_msg_template: instance.first_msg_template }))
  const [greetingCooldown, setGreetingCooldown] = useState(24)
  const [hours, setHours] = useState<ServiceHoursState>(() => resolveServiceHours({}))
  const [awayEnabled, setAwayEnabled] = useState(false)
  const [awayText, setAwayText] = useState('')
  const [awayCooldown, setAwayCooldown] = useState(4)
  const [funnelOverrides, setFunnelOverrides] = useState<Funnel[]>([])
  const [welcomeAgents, setWelcomeAgents] = useState<Agent[]>([])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchInstanceAutoMessages(instance.id, accountId).then(r => r.config),
      fetchFunnels(accountId).catch(() => [] as Funnel[]),
      fetchAgents(accountId).then(d => d.agents).catch(() => [] as Agent[]),
    ]).then(([cfg, funnels, agents]) => {
      if (!alive) return
      setFirst(resolveFirstMessage({
        first_msg_template: instance.first_msg_template,
        greeting_text: cfg.greeting_text,
        greeting_enabled: cfg.greeting_enabled,
      }))
      setGreetingCooldown(cfg.greeting_cooldown_hours || 24)
      setHours(resolveServiceHours({ away_schedule_json: cfg.away_schedule_json, business_hours_json: cfg.business_hours_json }))
      setAwayEnabled(!!cfg.away_enabled)
      setAwayText(cfg.away_text || '')
      setAwayCooldown(cfg.away_cooldown_hours || 4)
      setFunnelOverrides(funnels.filter(f => (f.first_msg_template || '').trim()))
      setWelcomeAgents(agents.filter(a => a.is_active === 1 && a.send_welcome_for_sheets_leads === 1))
    }).catch(e => {
      if (alive) setError(e?.message || 'Não foi possível carregar as mensagens deste número.')
    }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [instance.id, instance.first_msg_template, accountId])

  const setSlot = (day: DayKey, idx: number, field: 'start' | 'end', value: string) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: h.schedule[day].map((s, i) => i === idx ? { ...s, [field]: value } : s) } }))
  const addSlot = (day: DayKey) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: [...h.schedule[day], { start: '09:00', end: '18:00' }] } }))
  const removeSlot = (day: DayKey, idx: number) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: h.schedule[day].filter((_, i) => i !== idx) } }))

  const swapConflict = () =>
    setFirst(f => f.conflict ? { ...f, text: f.conflict.otherText, conflict: { otherText: f.text } } : f)

  const handleUseNumberMessage = async (f: Funnel) => {
    if (!confirm(`Parar de usar a mensagem própria do funil "${f.name}"?\n\nA partir de agora, os leads desse funil recebem a Primeira mensagem do número que os atende.`)) return
    try {
      await updateFunnelFirstMessage(f.id, accountId, null)
      setFunnelOverrides(prev => prev.filter(x => x.id !== f.id))
    } catch (e: any) {
      setError(e?.message || 'Não foi possível atualizar o funil.')
    }
  }

  const handleSave = async () => {
    const errs = scheduleErrors(hours.schedule)
    if (errs.length > 0) { setError(errs.join(' ')); setTab('horario'); return }
    setSaving(true); setError(null)
    try {
      const firstSave = buildFirstMessageSave(first)
      const hoursSave = buildServiceHoursSave(hours.schedule, hours.holdSends)
      await saveInstanceAutoMessages(instance.id, accountId, {
        greeting_enabled: firstSave.greeting_enabled,
        greeting_text: firstSave.greeting_text,
        greeting_cooldown_hours: greetingCooldown,
        away_enabled: awayEnabled ? 1 : 0,
        away_text: awayText.trim() || null,
        away_cooldown_hours: awayCooldown,
        away_schedule_json: hoursSave.away_schedule_json,
        hold_sends_outside_hours: hoursSave.hold_sends_outside_hours,
      })
      let updated = instance
      if (canEditFirstMessage && (instance.first_msg_template || null) !== firstSave.first_msg_template) {
        updated = await updateInstanceFirstMsgTemplate(instance.id, firstSave.first_msg_template)
      }
      onSaved(updated)
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Smartphone size={18} style={{ color: '#FFB300' }} /> Mensagens do número — {instance.instance_name}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose} disabled={saving}><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'primeira' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('primeira')}><MessageSquare size={12} /> Primeira mensagem</button>
          <button className={`btn btn-sm ${tab === 'horario' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('horario')}><Clock size={12} /> Horário de atendimento</button>
          <button className={`btn btn-sm ${tab === 'ausencia' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('ausencia')}><Moon size={12} /> Ausência</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12, display: 'flex', gap: 8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : (
          <>
            {tab === 'primeira' && (
              <div>
                <p style={hint}>Uma mensagem só para este número, enviada uma vez para cada lead novo. Leads que já existem não recebem. Escolha abaixo em quais situações ela sai.</p>

                {first.conflict && (
                  <div style={warnBox}>
                    <AlertTriangle size={14} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      Este número tinha duas mensagens diferentes. Abaixo está a que vai para leads de formulário e planilha. A outra, que ia para quem manda a primeira mensagem, é:
                      <div style={{ margin: '6px 0', padding: '6px 10px', background: 'var(--bg-hover)', borderRadius: 6, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{first.conflict.otherText}</div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={swapConflict}>Trocar pela outra</button>
                      <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>Ao salvar, as duas situações passam a usar o texto que estiver na caixa.</div>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Mensagem</label>
                  <textarea
                    className="input"
                    rows={5}
                    value={first.text}
                    onChange={e => setFirst(f => ({ ...f, text: e.target.value }))}
                    placeholder="Ex.: Olá, {{primeiro_nome}}! Aqui é {{atendente_nome}}. Recebi seu contato e vou te ajudar."
                    style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
                  />
                  <small style={{ ...hint, display: 'block', marginTop: 4 }}>{VARS_HELP}</small>
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={first.onInbound} onChange={e => setFirst(f => ({ ...f, onInbound: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>Quando um lead novo mandar a primeira mensagem para este número</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 8, cursor: canEditFirstMessage ? 'pointer' : 'default', opacity: canEditFirstMessage ? 1 : 0.5 }}>
                  <input type="checkbox" checked={first.onAssign} disabled={!canEditFirstMessage} onChange={e => setFirst(f => ({ ...f, onAssign: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>Quando um lead de formulário ou planilha for entregue a um vendedor que usa este número</span>
                </label>

                <div className="form-group" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12 }}>Intervalo mínimo entre duas saudações para o mesmo lead (horas)</label>
                  <input className="input" type="number" min={1} max={720} style={{ width: 100 }} value={greetingCooldown} onChange={e => setGreetingCooldown(parseInt(e.target.value) || 24)} />
                </div>

                <div style={infoBox}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Info size={12} /> Qual mensagem sai</div>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Lead de planilha atendido por agente de IA com saudação ligada: a IA escreve a primeira mensagem (esta não sai).</li>
                    <li>Lead de formulário ou planilha de um funil com mensagem própria: sai a do funil.</li>
                    <li>Nos outros casos, sai esta mensagem, nas situações marcadas acima.</li>
                    <li>A mensagem só sai com o número conectado, para lead com telefone válido e não bloqueado.</li>
                  </ol>
                </div>

                {welcomeAgents.length > 0 && (
                  <div style={{ ...infoBox, borderColor: 'rgba(255,179,0,0.3)', background: 'rgba(255,179,0,0.05)' }}>
                    Agentes com saudação por IA para leads de planilha: <strong>{welcomeAgents.map(a => a.name).join(', ')}</strong>. Para ligar ou desligar, abra o agente em Agentes de IA, aba Geral.
                  </div>
                )}

                {funnelOverrides.length > 0 && (
                  <div style={{ ...infoBox, borderColor: 'rgba(255,179,0,0.3)', background: 'rgba(255,179,0,0.05)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Funis com mensagem própria (valem no lugar desta)</div>
                    {funnelOverrides.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                        <div style={{ flex: 1 }}>
                          <strong>{f.name}</strong>
                          <div style={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{f.first_msg_template}</div>
                        </div>
                        {canManageFunnels && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleUseNumberMessage(f)}>Usar a deste número</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'horario' && (
              <div>
                <p style={hint}>Um horário só para este número. A ausência usa este horário e, se você ligar a opção abaixo, os envios automáticos também.</p>

                {hours.conflict && (
                  <div style={warnBox}>
                    <AlertTriangle size={14} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
                    <div>Antes, a trava de envios usava um horário diferente do horário da ausência. Abaixo está o da ausência; ao salvar, os dois passam a usar este horário.</div>
                  </div>
                )}

                {DAY_KEYS.map(day => (
                  <div key={day} style={{ background: 'var(--bg-hover)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 12 }}>{DAY_LABELS[day]}</strong>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => addSlot(day)}>+ Adicionar horário</button>
                    </div>
                    {hours.schedule[day].length === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Fechado</span>
                    ) : hours.schedule[day].map((slot, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                        <input type="time" className="input" value={slot.start} onChange={e => setSlot(day, idx, 'start', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>até</span>
                        <input type="time" className="input" value={slot.end} onChange={e => setSlot(day, idx, 'end', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                        <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeSlot(day, idx)} title="Remover horário"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                ))}

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hours.holdSends} onChange={e => setHours(h => ({ ...h, holdSends: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span><strong>Segurar envios automáticos fora deste horário</strong></span>
                </label>
                <p style={{ ...hint, marginLeft: 24 }}>{HOLD_HELP}</p>

                <div style={infoBox}>
                  Dia marcado como Fechado: com a opção acima ligada, os envios automáticos ficam parados o dia todo. A mensagem de ausência <strong>não</strong> é enviada em dia fechado; ela sai só fora das faixas de horário dos dias que têm horário.
                </div>
              </div>
            )}

            {tab === 'ausencia' && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={awayEnabled} onChange={e => setAwayEnabled(e.target.checked)} />
                  <strong>Responder automaticamente fora do horário de atendimento</strong>
                </label>
                <p style={hint}>Sai quando um lead manda mensagem fora das faixas definidas na aba Horário de atendimento.</p>
                <div className="form-group">
                  <label>Mensagem de ausência</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={awayText}
                    onChange={e => setAwayText(e.target.value)}
                    placeholder="Ex.: Estamos fora do horário de atendimento. Respondemos a partir das 9h."
                  />
                  <small style={{ ...hint, display: 'block', marginTop: 4 }}>{VARS_HELP}</small>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: 12 }}>Não repetir a ausência para o mesmo lead por (horas)</label>
                  <input className="input" type="number" min={1} max={48} style={{ width: 100 }} value={awayCooldown} onChange={e => setAwayCooldown(parseInt(e.target.value) || 4)} />
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
