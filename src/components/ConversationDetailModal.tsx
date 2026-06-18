import { useEffect, useState } from 'react'
import { fetchConversationDetailV2, type ConversationDetailV2 } from '../lib/api'
import { X, AlertCircle, CheckCircle, MessageSquare, ExternalLink, Copy } from 'lucide-react'

function score100Color(s: number | null): string {
  if (s == null) return 'var(--text-muted)'
  if (s >= 80) return 'var(--positive)'
  if (s >= 60) return 'var(--accent)'
  if (s >= 40) return 'var(--warning)'
  return 'var(--negative)'
}

function severityColor(s: string): string {
  if (s === 'critica') return 'var(--negative)'
  if (s === 'alta') return 'var(--warning)'
  if (s === 'media') return 'var(--accent)'
  return 'var(--text-muted)'
}

export default function ConversationDetailModal({
  leadId, accountId, onClose,
}: { leadId: number; accountId: number; onClose: () => void }) {
  const [data, setData] = useState<ConversationDetailV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchConversationDetailV2(leadId, accountId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [leadId, accountId])

  const handleCopyRetomada = () => {
    const msg = data?.insight?.mensagem_retomada
    if (!msg) return
    navigator.clipboard.writeText(msg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 8, width: 800, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Análise da conversa</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>}

          {!loading && !data?.insight && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              Esta conversa ainda não foi analisada pela IA.
            </div>
          )}

          {!loading && data?.insight && (
            <>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{data.insight.lead_name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {data.insight.lead_phone} · Atendente: {data.insight.attendant_name || '—'}
                  </div>
                </div>
                <a href={`/crm/chat?lead_id=${leadId}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                  <ExternalLink size={12} /> Abrir conversa
                </a>
              </div>

              {/* Score grande */}
              {data.insight.conversation_score != null && (
                <div style={{ background: 'var(--bg-hover)', borderRadius: 6, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <strong>Score comercial</strong>
                    <span style={{ fontSize: 28, fontWeight: 700, color: score100Color(data.insight.conversation_score) }}>
                      {data.insight.conversation_score}/100
                    </span>
                  </div>
                  <SubScoreBar label="Velocidade SLA" value={data.insight.score_velocidade_sla} max={15} />
                  <SubScoreBar label="Abertura" value={data.insight.score_abertura} max={10} />
                  <SubScoreBar label="Diagnóstico" value={data.insight.score_diagnostico} max={20} />
                  <SubScoreBar label="Qualificação" value={data.insight.score_qualificacao} max={15} />
                  <SubScoreBar label="Condução comercial" value={data.insight.score_conducao} max={15} />
                  <SubScoreBar label="Objeções" value={data.insight.score_objecoes} max={10} />
                  <SubScoreBar label="Próximo passo" value={data.insight.score_proximo_passo} max={10} />
                  <SubScoreBar label="Organização CRM" value={data.insight.score_organizacao_crm} max={5} />
                </div>
              )}

              {/* Resumo + próxima ação */}
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 13 }}>Resumo</strong>
                <p style={{ fontSize: 13, marginTop: 4 }}>{data.insight.summary}</p>
              </div>

              {data.insight.suggested_next_step && (
                <div style={{ background: 'rgba(76,175,80,0.1)', borderLeft: '3px solid var(--positive)', borderRadius: 4, padding: 12, marginBottom: 16 }}>
                  <strong style={{ fontSize: 12, color: 'var(--positive)' }}>🎯 Próxima ação recomendada</strong>
                  <p style={{ fontSize: 13, marginTop: 4 }}>{data.insight.suggested_next_step}</p>
                </div>
              )}

              {/* Mensagem de retomada */}
              {data.insight.mensagem_retomada && (
                <div style={{ background: 'rgba(33,150,243,0.1)', borderLeft: '3px solid var(--info)', borderRadius: 4, padding: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 12, color: 'var(--info)' }}>💬 IA sugere mensagem de retomada</strong>
                    <button className="btn btn-secondary btn-sm" onClick={handleCopyRetomada}>
                      <Copy size={12} /> {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <p style={{ fontSize: 13, marginTop: 8, fontStyle: 'italic' }}>"{data.insight.mensagem_retomada}"</p>
                </div>
              )}

              {/* Erros */}
              {data.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ fontSize: 13, color: 'var(--negative)' }}>
                    <AlertCircle size={12} style={{ verticalAlign: 'middle' }} /> Erros detectados ({data.errors.length})
                  </strong>
                  {data.errors.map(e => (
                    <div key={e.id} style={{ background: 'var(--bg-hover)', borderRadius: 4, padding: 10, marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${severityColor(e.gravity)}20`, color: severityColor(e.gravity), fontWeight: 600 }}>{e.gravity}</span>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)' }}>{e.actor_type}</span>
                        {e.code && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.code}</span>}
                      </div>
                      <p style={{ margin: 0, fontSize: 12 }}>{e.description}</p>
                      {e.how_to_fix && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}><strong>Como corrigir:</strong> {e.how_to_fix}</p>}
                      {e.evidence_message_ids.length > 0 && (
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                          Evidência: msgs #{e.evidence_message_ids.join(', #')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Acertos */}
              {data.strengths.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ fontSize: 13, color: 'var(--positive)' }}>
                    <CheckCircle size={12} style={{ verticalAlign: 'middle' }} /> Acertos ({data.strengths.length})
                  </strong>
                  {data.strengths.map(s => (
                    <div key={s.id} style={{ background: 'var(--bg-hover)', borderRadius: 4, padding: 10, marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)' }}>{s.actor_type}</span>
                        {s.code && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.code}</span>}
                      </div>
                      <p style={{ margin: 0, fontSize: 12 }}>{s.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Participantes */}
              {data.participants.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ fontSize: 13 }}>Análise por participante</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 8 }}>
                    {data.participants.map((p, i) => (
                      <div key={i} style={{ background: 'var(--bg-hover)', borderRadius: 4, padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong style={{ fontSize: 12 }}>{p.actor_name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({p.actor_type})</span></strong>
                          <span style={{ fontSize: 14, fontWeight: 700, color: score100Color(p.score) }}>{p.score ?? '—'}</span>
                        </div>
                        {p.acertos_summary && <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--positive)' }}>✓ {p.acertos_summary}</p>}
                        {p.erros_summary && <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--negative)' }}>✗ {p.erros_summary}</p>}
                        {p.recomendacao && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{p.recomendacao}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bot analysis + Handoff */}
              {data.insight.bot_analysis && (
                <div style={{ marginBottom: 16, padding: 10, background: 'var(--bg-hover)', borderRadius: 4 }}>
                  <strong style={{ fontSize: 12 }}>🤖 Análise do bot</strong>
                  <p style={{ fontSize: 11, margin: '4px 0', color: 'var(--text-muted)' }}>
                    Score: <strong style={{ color: score100Color(data.insight.bot_analysis.score) }}>{data.insight.bot_analysis.score}/100</strong> ·
                    Respondeu OK: {data.insight.bot_analysis.respondeu_corretamente ? '✓' : '✗'} ·
                    Deveria transferir: {data.insight.bot_analysis.deveria_transferir ? '⚠ Sim' : 'Não'}
                  </p>
                  <p style={{ fontSize: 12, margin: 0 }}>{data.insight.bot_analysis.summary}</p>
                </div>
              )}

              {data.insight.handoff_analysis && data.insight.handoff_analysis.houve_handoff && (
                <div style={{ marginBottom: 16, padding: 10, background: 'var(--bg-hover)', borderRadius: 4 }}>
                  <strong style={{ fontSize: 12 }}>🔄 Análise do handoff</strong>
                  <p style={{ fontSize: 11, margin: '4px 0', color: 'var(--text-muted)' }}>
                    Com contexto: {data.insight.handoff_analysis.com_contexto ? '✓' : '✗'} ·
                    Info perdida: {data.insight.handoff_analysis.info_perdida ? '⚠ Sim' : 'Não'}
                  </p>
                  <p style={{ fontSize: 12, margin: 0 }}>{data.insight.handoff_analysis.summary}</p>
                </div>
              )}

              {/* Coaching */}
              {data.insight.coaching_recomendado && (
                <div style={{ padding: 10, background: 'rgba(33,150,243,0.1)', borderLeft: '3px solid var(--info)', borderRadius: 4, fontSize: 12 }}>
                  <strong style={{ color: 'var(--info)' }}>📚 Coaching recomendado:</strong> {data.insight.coaching_recomendado}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SubScoreBar({ label, value, max }: { label: string; value: number | null; max: number }) {
  const pct = value != null ? (value / max) * 100 : 0
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <strong>{value ?? '—'}/{max}</strong>
      </div>
      <div style={{ height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: score100Color(value != null ? (value / max) * 100 : null) }} />
      </div>
    </div>
  )
}
