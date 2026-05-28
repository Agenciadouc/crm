import { useEffect, useState } from 'react'
import {
  fetchAgent, createAgent, updateAgent, testAgent, fetchAgentUsage,
  fetchWhatsAppInstances, fetchFunnels, fetchUsers, fetchTags,
  fetchAgentInactivityFollowUp, saveAgentInactivityFollowUp,
  type Agent, type AgentInput, type AgentHandoffReason, type AgentActivationMode,
  type AgentHandoffRule,
  type WhatsAppInstance, type Funnel, type User, type Tag,
} from '../lib/api'
import { Bot, X, Save, Send, Activity, BookOpen, Target, ArrowRightLeft, Volume2, DollarSign, Play, AlertCircle, Zap, Plus, Trash2 } from 'lucide-react'

const REQUIRED_FIELDS_OPTS = [
  { key: 'name', label: 'Nome' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Telefone' },
  { key: 'city', label: 'Cidade' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'instagram', label: 'Instagram' },
]

const HANDOFF_REASONS: { key: AgentHandoffReason; label: string; desc: string }[] = [
  { key: 'qualified', label: 'Qualificado', desc: 'Bot coletou todos campos obrigatórios' },
  { key: 'keyword', label: 'Pediu humano', desc: 'Lead disse "humano", "atendente", etc' },
  { key: 'unknown', label: 'Bot não soube', desc: 'Pergunta fora do conhecimento' },
  { key: 'max_messages', label: 'Estourou limite de msgs', desc: 'Passou do max sem qualificar' },
  { key: 'audio_received', label: 'Áudio recebido', desc: 'Lead mandou áudio (se bot não responde áudio)' },
]

const ACTIVATION_MODES: { value: AgentActivationMode; label: string; desc: string }[] = [
  { value: 'default_attendant', label: '🎯 Default Attendant', desc: 'Bot vira default da instância — todo lead novo cai nele' },
  { value: 'roulette', label: '🎲 Roleta', desc: 'Bot entra na roleta da instância — divide com humanos' },
  { value: 'conditional', label: '🔍 Conditional', desc: 'Bot atua quando filtros (etapa + tag) baterem, sem ser atendente designado' },
  { value: 'manual', label: '✋ Manual', desc: 'Só atende se gerente atribuir manualmente' },
]

type Tab = 'identity' | 'when' | 'training' | 'qualification' | 'handoff' | 'audio' | 'followup' | 'cost'

interface Props {
  agentId: 'new' | number
  accountId: number
  onClose: () => void
  onSaved: () => void
}

export default function AgentEditorModal({ agentId, accountId, onClose, onSaved }: Props) {
  const isNew = agentId === 'new'
  const [tab, setTab] = useState<Tab>('identity')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  // Form
  const [name, setName] = useState('')
  const [identifiesAsBot, setIdentifiesAsBot] = useState(true)
  const [isActive, setIsActive] = useState(true)
  // When
  const [activationMode, setActivationMode] = useState<AgentActivationMode>('conditional')
  const [stageIds, setStageIds] = useState<number[]>([])
  const [instanceIds, setInstanceIds] = useState<number[]>([])
  const [requiredTagId, setRequiredTagId] = useState<number | null>(null)
  // Training
  const [persona, setPersona] = useState('')
  const [knowledgeBase, setKnowledgeBase] = useState('')
  const [neverMention, setNeverMention] = useState('')
  // Qualification
  const [qualificationCriteria, setQualificationCriteria] = useState('')
  const [requiredFields, setRequiredFields] = useState<string[]>(['name'])
  const [maxMessages, setMaxMessages] = useState(15)
  const [handoffKeywords, setHandoffKeywords] = useState('humano,atendente,vendedor,corretor,pessoa')
  // Handoff
  const [handoffRules, setHandoffRules] = useState<Record<AgentHandoffReason, AgentHandoffRule>>({} as any)
  // Audio
  const [respondsToAudio, setRespondsToAudio] = useState(false)
  const [audioDeclineMessage, setAudioDeclineMessage] = useState('Oi! Por enquanto só leio mensagens de texto. Pode digitar pra mim?')
  // Welcome msg pra leads de planilha (Haiku-gerada)
  const [welcomeForSheets, setWelcomeForSheets] = useState(false)
  const [welcomeExtraInstructions, setWelcomeExtraInstructions] = useState('')
  // Follow-up de inatividade (bot manda msg se lead parar de responder)
  const [fuEnabled, setFuEnabled] = useState(false)
  const [fuInstanceId, setFuInstanceId] = useState<number | null>(null)
  const [fuInactivityMinutes, setFuInactivityMinutes] = useState(60)
  const [fuStopOnReply, setFuStopOnReply] = useState(true)
  const [fuOnReplyAction, setFuOnReplyAction] = useState<'pause' | 'roulette' | 'assign_user'>('pause')
  const [fuOnReplyUserId, setFuOnReplyUserId] = useState<number | null>(null)
  const [fuSteps, setFuSteps] = useState<Array<{ delay_minutes: number; message_template: string }>>([
    { delay_minutes: 0, message_template: 'Olá {{primeiro_nome}}, ainda está aí? Posso te ajudar com mais alguma dúvida?' },
  ])
  const [fuSaving, setFuSaving] = useState(false)
  const [fuLoaded, setFuLoaded] = useState(false)
  // Cost
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState(500000)

  // External data
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [tags, setTags] = useState<Tag[]>([])

  // Sandbox
  const [sandboxMsg, setSandboxMsg] = useState('')
  const [sandboxHistory, setSandboxHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [sandboxLoading, setSandboxLoading] = useState(false)
  const [sandboxCost, setSandboxCost] = useState(0)
  const [usage, setUsage] = useState<{ tokens: number; limit: number; cost: number; sttSec: number; sttCost: number; audioCount: number; totalCost: number } | null>(null)

  // Carrega dados externos + agente se editando
  useEffect(() => {
    Promise.all([
      fetchWhatsAppInstances(accountId),
      fetchFunnels(accountId),
      fetchUsers(accountId),
      fetchTags(accountId),
    ]).then(([i, f, u, t]) => {
      setInstances(i); setFunnels(f); setUsers(u.filter(x => x.is_active && !(x as any).is_bot)); setTags(t)
    })

    if (!isNew && typeof agentId === 'number') {
      fetchAgent(agentId, accountId).then(a => {
        setName(a.name); setIdentifiesAsBot(a.identifies_as_bot === 1); setIsActive(a.is_active === 1)
        setActivationMode(a.activation_mode)
        setStageIds((a.stages || []).map(s => s.id))
        setInstanceIds((a.instances || []).map(i => i.id))
        setRequiredTagId(a.required_tag_id)
        setPersona(a.persona || '')
        setKnowledgeBase(a.knowledge_base || '')
        setNeverMention(a.never_mention || '')
        setQualificationCriteria(a.qualification_criteria || '')
        setRequiredFields(a.required_fields_arr || [])
        setMaxMessages(a.max_messages_before_handoff)
        setHandoffKeywords(a.handoff_keywords)
        setRespondsToAudio(a.responds_to_audio === 1)
        setAudioDeclineMessage(a.audio_decline_message)
        setWelcomeForSheets(a.send_welcome_for_sheets_leads === 1)
        setWelcomeExtraInstructions(a.welcome_extra_instructions || '')
        setMonthlyTokenLimit(a.monthly_token_limit)
        const map: any = {}
        for (const r of a.handoff_rules || []) map[r.reason] = r
        setHandoffRules(map)
      }).finally(() => setLoading(false))

      // Carrega follow-up de inatividade vinculado ao agente (se houver)
      fetchAgentInactivityFollowUp(agentId, accountId).then((fu) => {
        if (fu && fu.is_active === 1) {
          setFuEnabled(true)
          setFuInstanceId(fu.instance_id)
          setFuInactivityMinutes(fu.inactivity_minutes || 60)
          setFuStopOnReply(fu.stop_on_reply === 1)
          setFuOnReplyAction(fu.on_reply_action || 'pause')
          setFuOnReplyUserId(fu.on_reply_user_id || null)
          if (Array.isArray(fu.steps) && fu.steps.length > 0) {
            setFuSteps(fu.steps.map(s => ({ delay_minutes: s.delay_minutes || 0, message_template: s.message_template || '' })))
          }
        }
        setFuLoaded(true)
      }).catch(() => setFuLoaded(true))

      fetchAgentUsage(agentId, accountId).then((u: any) => {
        setUsage({
          tokens: u.tokens_used_this_month,
          limit: u.monthly_limit,
          cost: u.cost_usd_this_month,
          sttSec: u.stt_seconds_this_month || 0,
          sttCost: u.stt_cost_usd_this_month || 0,
          audioCount: u.audio_count_this_month || 0,
          totalCost: u.total_cost_usd_this_month || u.cost_usd_this_month,
        })
      }).catch(() => {})
    }
  }, [agentId, accountId, isNew])

  const allStages = funnels.flatMap(f => (f.stages || []).map(s => ({ ...s, funnel_name: f.name })))

  const handleSave = async () => {
    if (!name.trim()) return alert('Nome obrigatório')
    setSaving(true)
    try {
      const payload: AgentInput = {
        name: name.trim(),
        identifies_as_bot: identifiesAsBot,
        is_active: isActive,
        activation_mode: activationMode,
        required_tag_id: requiredTagId,
        persona: persona.trim() || undefined,
        knowledge_base: knowledgeBase.trim() || undefined,
        never_mention: neverMention.trim() || undefined,
        qualification_criteria: qualificationCriteria.trim() || undefined,
        required_fields: requiredFields,
        max_messages_before_handoff: maxMessages,
        handoff_keywords: handoffKeywords,
        responds_to_audio: respondsToAudio,
        audio_decline_message: audioDeclineMessage,
        send_welcome_for_sheets_leads: welcomeForSheets,
        welcome_extra_instructions: welcomeExtraInstructions.trim() || undefined,
        monthly_token_limit: monthlyTokenLimit,
        stage_ids: stageIds,
        instance_ids: instanceIds,
        handoff_rules: Object.values(handoffRules).filter(r => r),
      }
      let savedAgentId: number
      if (isNew) {
        const created = await createAgent(accountId, payload)
        savedAgentId = (created as any).id
      } else {
        await updateAgent(agentId as number, accountId, payload)
        savedAgentId = agentId as number
      }

      // Salva tambem a config de follow-up de inatividade (so se agente ja existe ou acabou de ser criado)
      if (savedAgentId && fuLoaded) {
        try {
          if (fuEnabled) {
            if (!fuInstanceId) { alert('Aba Follow-up: escolha a instância antes de salvar.'); setSaving(false); return }
            if (fuSteps.some(s => !s.message_template.trim())) { alert('Aba Follow-up: todos os steps precisam de mensagem.'); setSaving(false); return }
            await saveAgentInactivityFollowUp(savedAgentId, accountId, {
              enabled: true,
              instance_id: fuInstanceId,
              inactivity_minutes: fuInactivityMinutes,
              stop_on_reply: fuStopOnReply,
              on_reply_action: fuOnReplyAction,
              on_reply_user_id: fuOnReplyUserId,
              steps: fuSteps,
            })
          } else {
            // Desativa se houver follow-up salvo
            await saveAgentInactivityFollowUp(savedAgentId, accountId, { enabled: false, steps: [] }).catch(() => {})
          }
        } catch (e: any) {
          alert('Agente salvo, mas Follow-up falhou: ' + (e?.message || ''))
          setSaving(false)
          return
        }
      }

      onSaved()
    } catch (e: any) { alert('Erro: ' + (e?.message || '')) }
    setSaving(false)
  }

  const handleSandbox = async () => {
    if (!sandboxMsg.trim() || isNew) return
    setSandboxLoading(true)
    const userMsg = sandboxMsg.trim()
    const newHist = [...sandboxHistory, { role: 'user' as const, content: userMsg }]
    setSandboxHistory(newHist)
    setSandboxMsg('')
    try {
      const r = await testAgent(agentId as number, accountId, userMsg, sandboxHistory)
      setSandboxHistory([...newHist, { role: 'assistant' as const, content: r.response }])
      setSandboxCost(c => c + r.cost_usd)
    } catch (e: any) {
      alert('Erro: ' + (e?.message || ''))
      setSandboxHistory(sandboxHistory)
    }
    setSandboxLoading(false)
  }

  const updateHandoffRule = (reason: AgentHandoffReason, patch: Partial<AgentHandoffRule>) => {
    setHandoffRules(prev => ({
      ...prev,
      [reason]: {
        agent_id: typeof agentId === 'number' ? agentId : undefined,
        reason,
        target_type: 'roulette',
        target_user_id: null,
        fallback_to_roulette: 1,
        move_to_stage_id: null,
        add_tag_id: null,
        ...(prev[reason] || {}),
        ...patch,
      } as AgentHandoffRule,
    }))
  }

  if (loading) return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="loading-container"><div className="spinner" /></div>
      </div>
    </div>
  )

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 900, maxHeight: '92vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            <Bot size={18} style={{ verticalAlign: -3, marginRight: 6, color: '#FFB300' }} />
            {isNew ? 'Novo Agente de IA' : `Editar — ${name}`}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 0, overflowX: 'auto' }}>
          {([
            { id: 'identity', label: 'Identidade', icon: <Bot size={11} /> },
            { id: 'when', label: 'Quando atuar', icon: <Activity size={11} /> },
            { id: 'training', label: 'Treinamento', icon: <BookOpen size={11} /> },
            { id: 'qualification', label: 'Qualificação', icon: <Target size={11} /> },
            { id: 'handoff', label: 'Handoff', icon: <ArrowRightLeft size={11} /> },
            { id: 'audio', label: 'Áudio', icon: <Volume2 size={11} /> },
            { id: 'followup', label: 'Follow-up', icon: <Zap size={11} /> },
            { id: 'cost', label: 'Custo + Sandbox', icon: <DollarSign size={11} /> },
          ] as { id: Tab; label: string; icon: any }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ─── Tab: Identidade ─── */}
        {tab === 'identity' && (
          <>
            <div className="form-group">
              <label>Nome do agente *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Ana Clara" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={identifiesAsBot} onChange={e => setIdentifiesAsBot(e.target.checked)} />
                <span>Identifica como IA (recomendado)</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>
                Bot avisa "sou IA assistente". Reduz expectativa do lead e legitima transferência pra humano.
              </small>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                <span>Ativo</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>Desligue pra pausar o bot sem apagar a configuração.</small>
            </div>
          </>
        )}

        {/* ─── Tab: Quando atuar ─── */}
        {tab === 'when' && (
          <>
            <div className="form-group">
              <label>Modo de ativação *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ACTIVATION_MODES.map(m => (
                  <label key={m.value} style={{ padding: 10, border: `1px solid ${activationMode === m.value ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 8, cursor: 'pointer', background: activationMode === m.value ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                    <input type="radio" checked={activationMode === m.value} onChange={() => setActivationMode(m.value)} style={{ marginRight: 8 }} />
                    <strong>{m.label}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginLeft: 24 }}>{m.desc}</div>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Instâncias WhatsApp (multi-select)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', padding: 8, border: '1px solid var(--border-medium)', borderRadius: 6 }}>
                {instances.map(i => (
                  <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={instanceIds.includes(i.id)}
                      onChange={e => setInstanceIds(prev => e.target.checked ? [...prev, i.id] : prev.filter(x => x !== i.id))}
                    />
                    {i.instance_name} {i.status === 'connected' ? '✓' : '✗ (offline)'}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Etapas do funil (multi-select)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', padding: 8, border: '1px solid var(--border-medium)', borderRadius: 6 }}>
                {allStages.map(s => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={stageIds.includes(s.id)}
                      onChange={e => setStageIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id))}
                    />
                    <span style={{ width: 8, height: 8, background: s.color, borderRadius: '50%', display: 'inline-block' }} />
                    {s.funnel_name} · {s.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Tag obrigatória (opcional)</label>
              <select className="select" value={requiredTagId || ''} onChange={e => setRequiredTagId(e.target.value ? +e.target.value : null)}>
                <option value="">— Sem filtro de tag —</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Se setado, agente só atua em leads que tenham essa tag.</small>
            </div>

            {/* ─── Welcome message pra leads de planilha ─── */}
            <div className="form-group" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={welcomeForSheets}
                  onChange={e => setWelcomeForSheets(e.target.checked)}
                />
                <span>Enviar primeira msg pra leads vindos da planilha</span>
              </label>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 4, marginLeft: 24, fontSize: 11 }}>
                Quando lead novo chega via Google Sheets, o bot dispara uma saudação automática
                via Haiku usando dados do lead (nome, cidade, empresa, tags). Não dispara pra
                leads do WhatsApp orgânico, site form ou Meta Lead Form. Custo: ~$0.0002 por saudação.
              </small>
              {welcomeForSheets && (
                <div style={{ marginTop: 12, marginLeft: 24 }}>
                  <label style={{ fontSize: 12 }}>Instruções extras pra saudação (opcional)</label>
                  <textarea
                    className="input"
                    value={welcomeExtraInstructions}
                    onChange={e => setWelcomeExtraInstructions(e.target.value)}
                    rows={3}
                    placeholder="Ex: Mencione a promoção de 10% pra primeira compra. Sempre pergunte sobre o tipo de produto que ele busca."
                  />
                  <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 4, fontSize: 11 }}>
                    Esse texto vai no system prompt do Haiku junto com a persona. Use pra direcionar
                    tom específico, oferta, ou perguntas chave.
                  </small>
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── Tab: Treinamento ─── */}
        {tab === 'training' && (
          <>
            <div className="form-group">
              <label>Persona (tom de voz)</label>
              <textarea className="input" rows={2} value={persona} onChange={e => setPersona(e.target.value)}
                placeholder="Ex: Cordial, objetiva, PT-BR informal mas profissional. Máx 2 frases por resposta. Sem emoji excessivo." />
            </div>
            <div className="form-group">
              <label>Knowledge base (conhecimento da empresa)</label>
              <textarea className="input" rows={10} value={knowledgeBase} onChange={e => setKnowledgeBase(e.target.value)}
                placeholder="Tudo que o bot precisa saber pra responder. Quanto mais detalhado, melhor. Ex: produtos, regiões de entrega, quem atende, FAQ..."
              />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Bot só responde sobre o que está aqui. Quando perguntarem algo fora, ele transfere pra humano.</small>
            </div>
            <div className="form-group">
              <label>NUNCA mencione (proibições)</label>
              <textarea className="input" rows={3} value={neverMention} onChange={e => setNeverMention(e.target.value)}
                placeholder="Ex: preços específicos, descontos, prazos exatos, frete, disponibilidade em estoque" />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Mesmo se o lead insistir, bot redireciona pra atendente em vez de mencionar isso.</small>
            </div>
          </>
        )}

        {/* ─── Tab: Qualificação ─── */}
        {tab === 'qualification' && (
          <>
            <div className="form-group">
              <label>Critério de qualificação</label>
              <textarea className="input" rows={3} value={qualificationCriteria} onChange={e => setQualificationCriteria(e.target.value)}
                placeholder="Ex: Qualificado quando souber nome, cidade, se é PF ou CNPJ, e categoria de produto" />
            </div>
            <div className="form-group">
              <label>Campos obrigatórios (bot coleta antes de qualificar)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {REQUIRED_FIELDS_OPTS.map(f => (
                  <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={requiredFields.includes(f.key)}
                      onChange={e => setRequiredFields(prev => e.target.checked ? [...prev, f.key] : prev.filter(x => x !== f.key))}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Limite de mensagens antes de handoff automático</label>
              <input className="input" type="number" min={3} max={100} value={maxMessages} onChange={e => setMaxMessages(parseInt(e.target.value) || 15)} style={{ width: 100 }} />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Se passar disso sem qualificar, bot transfere pra humano (motivo: max_messages).</small>
            </div>
            <div className="form-group">
              <label>Palavras de handoff (CSV)</label>
              <input className="input" value={handoffKeywords} onChange={e => setHandoffKeywords(e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Quando lead disser uma dessas, bot transfere imediatamente.</small>
            </div>
          </>
        )}

        {/* ─── Tab: Handoff ─── */}
        {tab === 'handoff' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Configure por motivo o que acontece quando o bot transfere o lead pra um humano. Cada linha é independente.
            </p>
            {HANDOFF_REASONS.map(r => {
              const rule = handoffRules[r.key]
              const enabled = !!rule
              return (
                <div key={r.key} style={{ padding: 12, marginBottom: 8, border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 8, background: enabled ? 'rgba(255,179,0,0.03)' : 'transparent' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: enabled ? 8 : 0 }}>
                    <input type="checkbox"
                      checked={enabled}
                      onChange={e => {
                        if (e.target.checked) updateHandoffRule(r.key, {})
                        else setHandoffRules(prev => { const cp = { ...prev }; delete cp[r.key]; return cp })
                      }}
                    />
                    <strong style={{ fontSize: 13 }}>{r.label}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {r.desc}</span>
                  </label>
                  {enabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: 11 }}>Pra quem transfere</label>
                        <select className="select" value={rule.target_type} onChange={e => updateHandoffRule(r.key, { target_type: e.target.value as any, target_user_id: e.target.value === 'roulette' ? null : rule.target_user_id })}>
                          <option value="roulette">Roleta humana</option>
                          <option value="specific_user">Atendente fixo</option>
                        </select>
                        {rule.target_type === 'specific_user' && (
                          <select className="select" style={{ marginTop: 4 }} value={rule.target_user_id || ''} onChange={e => updateHandoffRule(r.key, { target_user_id: e.target.value ? +e.target.value : null })}>
                            <option value="">— escolha —</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <label style={{ fontSize: 11 }}>Mover pra etapa (opcional)</label>
                        <select className="select" value={rule.move_to_stage_id || ''} onChange={e => updateHandoffRule(r.key, { move_to_stage_id: e.target.value ? +e.target.value : null })}>
                          <option value="">— não mover —</option>
                          {allStages.map(s => <option key={s.id} value={s.id}>{s.funnel_name} · {s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11 }}>Adicionar tag (opcional)</label>
                        <select className="select" value={rule.add_tag_id || ''} onChange={e => updateHandoffRule(r.key, { add_tag_id: e.target.value ? +e.target.value : null })}>
                          <option value="">— não adicionar —</option>
                          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ─── Tab: Áudio ─── */}
        {tab === 'audio' && (
          <>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={respondsToAudio} onChange={e => setRespondsToAudio(e.target.checked)} />
                <span>Responde áudio</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block', lineHeight: 1.5 }}>
                Quando ativo: bot transcreve o áudio do lead via Deepgram (~$0.002 por áudio de 30s) e responde como se fosse texto.
                Se a transcrição falhar (Deepgram offline, áudio corrompido), cai automaticamente na mensagem de recusa abaixo + transfere pra humano.
                <br />Quando desativo: bot recusa o áudio com a mensagem abaixo e transfere pra humano.
              </small>
            </div>
            <div className="form-group">
              <label>Mensagem de recusa (quando bot não responde áudio ou transcrição falha)</label>
              <textarea className="input" rows={3} value={audioDeclineMessage} onChange={e => setAudioDeclineMessage(e.target.value)} />
            </div>
          </>
        )}

        {/* ─── Tab: Follow-up (bot manda msg se lead parar de responder) ─── */}
        {tab === 'followup' && (
          <>
            {isNew ? (
              <div style={{ padding: 16, background: 'var(--bg-hover)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                Crie o agente primeiro (salve), depois volte aqui pra configurar o follow-up de inatividade.
              </div>
            ) : !fuLoaded ? (
              <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>Carregando...</div>
            ) : (
              <>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={fuEnabled} onChange={e => setFuEnabled(e.target.checked)} />
                    <span>Enviar follow-up se lead parar de responder</span>
                  </label>
                  <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block', lineHeight: 1.5 }}>
                    Quando ativo: se um lead que o bot está atendendo ficar sem responder por X minutos, o sistema envia automaticamente
                    a sequência de mensagens abaixo. Se o lead responder a qualquer momento, a sequência cancela.
                  </small>
                </div>

                {fuEnabled && (
                  <>
                    <div className="form-group">
                      <label>Instância WhatsApp pra envio</label>
                      <select className="select" value={fuInstanceId || ''} onChange={e => setFuInstanceId(e.target.value ? +e.target.value : null)}>
                        <option value="">— Selecione —</option>
                        {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name}</option>)}
                      </select>
                      <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Geralmente a mesma instância do bot.</small>
                    </div>

                    <div className="form-group">
                      <label>Tempo sem resposta antes do primeiro envio (minutos)</label>
                      <input type="number" className="input" min={30} value={fuInactivityMinutes}
                        onChange={e => setFuInactivityMinutes(Math.max(30, parseInt(e.target.value) || 30))} />
                      <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Mínimo 30 min. Sugestão: 60 (1h) pra leads quentes, 1440 (1 dia) pra leads frios.</small>
                    </div>

                    {/* Steps */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Steps de follow-up ({fuSteps.length}/5)</span>
                        {fuSteps.length < 5 && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFuSteps([...fuSteps, { delay_minutes: 1440, message_template: '' }])}>
                            <Plus size={11} /> Adicionar step
                          </button>
                        )}
                      </label>
                      <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginBottom: 8 }}>
                        Variáveis disponíveis: <code>{'{{primeiro_nome}}'}</code>, <code>{'{{nome}}'}</code>
                      </small>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {fuSteps.map((s, i) => (
                          <div key={i} style={{ background: 'var(--bg-hover)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <strong style={{ fontSize: 12 }}>Step {i + 1}</strong>
                              {fuSteps.length > 1 && (
                                <button type="button" className="btn btn-danger btn-sm" onClick={() => setFuSteps(fuSteps.filter((_, idx) => idx !== i))}>
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                            <textarea
                              className="input"
                              rows={2}
                              placeholder="Olá {{primeiro_nome}}, ainda está aí?"
                              value={s.message_template}
                              onChange={e => setFuSteps(fuSteps.map((x, idx) => idx === i ? { ...x, message_template: e.target.value } : x))}
                              style={{ marginBottom: 6 }}
                            />
                            {i < fuSteps.length - 1 && (
                              <div>
                                <label style={{ fontSize: 11 }}>Aguardar antes do próximo step (minutos)</label>
                                <input type="number" className="input" min={30}
                                  value={s.delay_minutes}
                                  onChange={e => setFuSteps(fuSteps.map((x, idx) => idx === i ? { ...x, delay_minutes: Math.max(30, parseInt(e.target.value) || 30) } : x))}
                                />
                                <small style={{ color: 'var(--text-muted)', fontSize: 10 }}>Sugestão: 120 (2h) entre steps próximos / 1440 (1 dia) entre tentativas distantes.</small>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stop on reply + on-reply action */}
                    <div className="form-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={fuStopOnReply} onChange={e => setFuStopOnReply(e.target.checked)} />
                        <span>Cancelar sequência se o lead responder</span>
                      </label>
                    </div>

                    {fuStopOnReply && (
                      <>
                        <div className="form-group">
                          <label>O que fazer quando o lead responder?</label>
                          <select className="select" value={fuOnReplyAction} onChange={e => setFuOnReplyAction(e.target.value as any)}>
                            <option value="pause">Apenas pausar (bot continua atendendo)</option>
                            <option value="roulette">Reatribuir pela roleta da conta</option>
                            <option value="assign_user">Reatribuir pra um atendente específico</option>
                          </select>
                        </div>
                        {fuOnReplyAction === 'assign_user' && (
                          <div className="form-group">
                            <label>Atendente</label>
                            <select className="select" value={fuOnReplyUserId || ''} onChange={e => setFuOnReplyUserId(e.target.value ? +e.target.value : null)}>
                              <option value="">— Selecione —</option>
                              {users.filter(u => u.is_active === 1).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </div>
                        )}
                      </>
                    )}

                    {/* Botão salvar dedicado da aba */}
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={fuSaving}
                      onClick={async () => {
                        if (!fuInstanceId) { alert('Escolha a instância de envio'); return }
                        if (fuSteps.some(s => !s.message_template.trim())) { alert('Todos os steps precisam de mensagem'); return }
                        setFuSaving(true)
                        try {
                          await saveAgentInactivityFollowUp(agentId as number, accountId, {
                            enabled: true,
                            instance_id: fuInstanceId,
                            inactivity_minutes: fuInactivityMinutes,
                            stop_on_reply: fuStopOnReply,
                            on_reply_action: fuOnReplyAction,
                            on_reply_user_id: fuOnReplyUserId,
                            steps: fuSteps,
                          })
                          alert('Follow-up salvo!')
                        } catch (e: any) {
                          alert('Erro: ' + (e?.message || 'falha ao salvar'))
                        }
                        setFuSaving(false)
                      }}
                    >
                      <Save size={14} /> {fuSaving ? 'Salvando...' : 'Salvar follow-up'}
                    </button>
                  </>
                )}

                {!fuEnabled && fuLoaded && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      setFuSaving(true)
                      try {
                        await saveAgentInactivityFollowUp(agentId as number, accountId, { enabled: false, steps: [] })
                      } catch {}
                      setFuSaving(false)
                    }}
                    style={{ marginTop: 8 }}
                    disabled={fuSaving}
                  >
                    Desativar follow-up salvo
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ─── Tab: Custo + Sandbox ─── */}
        {tab === 'cost' && (
          <>
            <div className="form-group">
              <label>Limite mensal de tokens</label>
              <input className="input" type="number" min={1000} step={10000} value={monthlyTokenLimit} onChange={e => setMonthlyTokenLimit(parseInt(e.target.value) || 500000)} style={{ width: 200 }} />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Quando atingir, bot para de responder e transfere pra humano. Default 500k tokens (~R$ 100/mês a uso médio).
              </small>
            </div>

            {usage && !isNew && (
              <div className="form-group">
                <label>Uso este mês</label>
                <div style={{ padding: 10, background: 'rgba(255,179,0,0.05)', borderRadius: 6 }}>
                  {/* Haiku (texto) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span>📝 {usage.tokens.toLocaleString()} / {usage.limit.toLocaleString()} tokens (Haiku)</span>
                    <span style={{ color: 'var(--accent-light)' }}>~US$ {usage.cost.toFixed(4)}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 3 }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (usage.tokens / usage.limit) * 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
                  </div>

                  {/* STT (audio) — só mostra se houve algum áudio */}
                  {usage.audioCount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                      <span>🔊 {usage.audioCount} áudios · {usage.sttSec.toFixed(0)}s transcritos (Deepgram)</span>
                      <span style={{ color: 'var(--accent-light)' }}>~US$ {usage.sttCost.toFixed(4)}</span>
                    </div>
                  )}

                  {/* Total */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-medium)', fontWeight: 700 }}>
                    <span>Total mês</span>
                    <span style={{ color: 'var(--accent)' }}>US$ {usage.totalCost.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* SANDBOX */}
            {!isNew ? (
              <div className="form-group" style={{ padding: 12, border: '1px solid rgba(91,173,226,0.3)', borderRadius: 8, background: 'rgba(91,173,226,0.04)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#5DADE2', fontWeight: 600 }}>
                  <Play size={12} /> Sandbox — testa o agente sem disparar WhatsApp
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Mesma engine real (Haiku 4.5), mesma persona/KB, mas nenhuma msg vai pra WhatsApp.
                  Pra calibrar antes de ativar pra leads reais.
                </p>

                <div style={{ maxHeight: 250, overflowY: 'auto', padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginBottom: 8 }}>
                  {sandboxHistory.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Sem mensagens ainda — manda algo abaixo pra testar.</div>}
                  {sandboxHistory.map((m, i) => (
                    <div key={i} style={{ marginBottom: 6, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '75%', padding: 8, background: m.role === 'user' ? 'rgba(91,173,226,0.15)' : 'rgba(255,179,0,0.10)', borderRadius: 8, fontSize: 12 }}>
                        <div style={{ fontSize: 9, color: m.role === 'user' ? '#5DADE2' : '#FFCB45', marginBottom: 2, fontWeight: 600 }}>
                          {m.role === 'user' ? 'Você (simulando lead)' : '🤖 ' + (name || 'Bot')}
                        </div>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sandboxLoading && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Bot pensando...</div>}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    value={sandboxMsg}
                    onChange={e => setSandboxMsg(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSandbox()}
                    placeholder="Simula uma mensagem do lead..."
                    style={{ flex: 1 }}
                    disabled={sandboxLoading}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSandbox} disabled={sandboxLoading || !sandboxMsg.trim()}>
                    <Send size={12} />
                  </button>
                </div>
                {sandboxCost > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
                    Custo desta sessão: ~US$ {sandboxCost.toFixed(6)}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 10, background: 'rgba(91,173,226,0.05)', borderRadius: 6, fontSize: 12, color: '#5DADE2', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={14} />
                Salve o agente primeiro pra testar no sandbox.
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={12} /> {saving ? 'Salvando...' : (isNew ? 'Criar Agente' : 'Salvar Alterações')}
          </button>
        </div>
      </div>
    </div>
  )
}
