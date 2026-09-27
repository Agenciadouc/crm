import { Fragment, useCallback, useEffect, useState } from 'react'
import { BarChart3, ChevronDown, ChevronRight, Settings2, AlertTriangle, FlaskConical, Save } from 'lucide-react'
import {
  fetchPerformance, fetchRoteiro, fetchRoteiroSettings, saveRoteiroSettings, fetchSuggestions, suggestionAction,
  type RoteiroPerformance, type RoteiroFunnel, type RoteiroSettings, type RoteiroSuggestion, type QuestionMetric,
} from '../../lib/roteiroApi'
import { fmtPct, findSellerSuggestion, barWidth } from '../../lib/roteiroManager.js'
import { displayQuestionText } from '../../lib/roteiroView.js'
import { BAND_META } from '../../lib/score'
import HelpTip from '../../components/HelpTip'
import { InlineNotice, useInlineNotice } from '../../components/InlineNotice'

// Aba "Desempenho" (spec 3.2): configuracoes, taxa de resposta por pergunta (e por vendedor)
// e taxa de venda por faixa do termometro.

const STATUS_META: Record<QuestionMetric['status'], { color: string; label: string }> = {
  ok: { color: 'var(--positive)', label: 'ok' },
  fraca: { color: 'var(--negative)', label: 'fraca' },
  amostra_pequena: { color: 'var(--text-muted)', label: 'amostra pequena' },
}

function StatusDot({ status }: { status: QuestionMetric['status'] }) {
  const m = STATUS_META[status]
  return <span aria-label={m.label} title={m.label} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
}

interface Props { funnelId: number; accountId: number }

export default function DesempenhoTab({ funnelId, accountId }: Props) {
  const [perf, setPerf] = useState<RoteiroPerformance | null>(null)
  const [roteiro, setRoteiro] = useState<RoteiroFunnel | null>(null)
  const [suggestions, setSuggestions] = useState<RoteiroSuggestion[]>([])
  const [settings, setSettings] = useState<{ min_reply_rate: string; reply_window_h: string; alert_minutes: string } | null>(null)
  const [savedSettings, setSavedSettings] = useState<RoteiroSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { notice, showError, showSuccess, clear } = useInlineNotice()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, r, s, sug] = await Promise.all([
        fetchPerformance(funnelId, accountId), fetchRoteiro(funnelId, accountId), fetchRoteiroSettings(accountId), fetchSuggestions(accountId),
      ])
      setPerf(p); setRoteiro(r); setSavedSettings(s); setSuggestions(sug.suggestions)
      setSettings({ min_reply_rate: String(s.min_reply_rate), reply_window_h: String(s.reply_window_h), alert_minutes: String(s.alert_minutes) })
    } catch (e) { showError('Não foi possível carregar o desempenho', e) } finally { setLoading(false) }
  }, [funnelId, accountId, showError])

  useEffect(() => { load() }, [load])

  const saveSettings = async () => {
    if (!settings) return
    setBusy('settings'); clear()
    try {
      const s = await saveRoteiroSettings(accountId, {
        min_reply_rate: Number(settings.min_reply_rate), reply_window_h: Number(settings.reply_window_h), alert_minutes: Number(settings.alert_minutes),
      })
      setSavedSettings(s)
      showSuccess('Configurações salvas. A cor das perguntas muda na próxima análise da madrugada.')
      setPerf(await fetchPerformance(funnelId, accountId))
    } catch (e) { showError('Não foi possível salvar', e) } finally { setBusy(null) }
  }

  const startSellerTest = async (suggestionId: number, sellerName: string) => {
    setBusy(`test-${suggestionId}`); clear()
    try {
      await suggestionAction(suggestionId, accountId, 'test')
      setSuggestions(list => list.filter(s => s.id !== suggestionId))
      showSuccess(`Teste A/B começou: metade dos leads recebe o jeito de ${sellerName}. Acompanhe em Sugestões e testes.`)
    } catch (e) { showError('Não foi possível começar o teste', e) } finally { setBusy(null) }
  }

  if (loading && !perf) return <div className="loading-container"><div className="spinner" /></div>

  const stageName = (id: number) => roteiro?.stages.find(s => s.id === id)?.name || ''
  const windowH = savedSettings?.reply_window_h ?? 24
  const minRate = savedSettings?.min_reply_rate ?? 70
  const questions = perf?.questions || []
  const bands = perf?.conversion.bands || []
  const settingsDirty = !!settings && !!savedSettings && (
    settings.min_reply_rate !== String(savedSettings.min_reply_rate) || settings.reply_window_h !== String(savedSettings.reply_window_h) || settings.alert_minutes !== String(savedSettings.alert_minutes))

  const th = { textAlign: 'left' as const, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '8px 10px', whiteSpace: 'nowrap' as const }
  const td = { fontSize: 13, padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' as const }

  return (
    <div>
      <InlineNotice notice={notice} onClose={clear} />

      {settings && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Settings2 size={15} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Configurações</h3>
            <HelpTip title="Configurações">
              Valem para todos os funis da conta. Ex.: com mínimo 70% e prazo 24h, uma pergunta enviada 20 vezes que teve resposta em só 12 (60%) fica vermelha.
            </HelpTip>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Taxa mínima de resposta (%)
                <HelpTip title="Taxa mínima">Abaixo disso a pergunta fica "fraca" (vermelha) e o sistema procura um jeito melhor de perguntar. Ex.: 70 = 7 de cada 10 clientes precisam responder.</HelpTip>
              </span>
              <input className="input" type="number" min={10} max={100} value={settings.min_reply_rate} placeholder="ex.: 70" onChange={e => setSettings({ ...settings, min_reply_rate: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Prazo para o cliente responder (horas)
                <HelpTip title="Prazo de resposta">Só conta como resposta se o cliente escrever dentro deste prazo depois da pergunta. Ex.: 24 = perguntou às 10h de segunda, vale resposta até 10h de terça.</HelpTip>
              </span>
              <input className="input" type="number" min={1} max={168} value={settings.reply_window_h} placeholder="ex.: 24" onChange={e => setSettings({ ...settings, reply_window_h: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Aviso de lead quente sem resposta (minutos)
                <HelpTip title="Aviso de lead quente">Lead Quente ou Pronto esperando resposta do vendedor por mais que isso (em horário de atendimento) gera um aviso. Ex.: 60 = cliente quente escreveu às 14h e ninguém respondeu até 15h.</HelpTip>
              </span>
              <input className="input" type="number" min={5} max={1440} value={settings.alert_minutes} placeholder="ex.: 60" onChange={e => setSettings({ ...settings, alert_minutes: e.target.value })} />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={!settingsDirty || !!busy}>
              <Save size={13} /> {busy === 'settings' ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <BarChart3 size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Perguntas (últimos 90 dias)</h3>
          <HelpTip title="Taxa de resposta" width={320}>
            Das vezes que a pergunta foi enviada, em quantas o cliente respondeu em até {windowH}h. Ex.: enviada 45 vezes, respondida 28 = 62%. Clique numa pergunta para ver cada vendedor.
          </HelpTip>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StatusDot status="ok" /> ok</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StatusDot status="fraca" /> fraca</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StatusDot status="amostra_pequena" /> amostra pequena (menos de 20 envios)</span>
          </span>
        </div>
        {!roteiro?.published ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 16px 16px' }}>
            Publique o roteiro na aba Roteiro para começar a medir. Ex.: depois que "Qual o seu orçamento?" for enviada 20 vezes, a taxa de resposta aparece aqui.
          </p>
        ) : !questions.length ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 16px 16px' }}>
            Ainda sem números. Eles aparecem quando os vendedores usam [Perguntar] no Chat. Ex.: 20 envios de "Qual o seu orçamento?" já mostram a taxa.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Pergunta</th>
                  <th style={th}>Envios</th>
                  <th style={th}>Taxa de resposta</th>
                  <th style={th}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      Avançou em 7 dias
                      <HelpTip title="Avançou em 7 dias" size={11}>Dos leads que receberam a pergunta, quantos mudaram de etapa em até 7 dias. Ex.: 20 envios, 9 avançaram = 45%.</HelpTip>
                    </span>
                  </th>
                  <th style={th}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      Comprou em 30 dias
                      <HelpTip title="Comprou em 30 dias" size={11}>Dos leads que receberam a pergunta, quantos compraram em até 30 dias. Ex.: 20 envios, 3 compras = 15%.</HelpTip>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {questions.map(q => {
                  const isOpen = open === q.question_key
                  const meta = STATUS_META[q.status]
                  return (
                    <Fragment key={q.question_key}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : q.question_key)} aria-expanded={isOpen}>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            {isOpen ? <ChevronDown size={14} style={{ marginTop: 2, flexShrink: 0 }} /> : <ChevronRight size={14} style={{ marginTop: 2, flexShrink: 0 }} />}
                            <div>
                              <div>{displayQuestionText(q.text)}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stageName(q.stage_id)}</div>
                            </div>
                          </div>
                        </td>
                        <td style={td}>{q.sent}</td>
                        <td style={td} title={q.sent ? `Dos ${q.sent} envios, ${fmtPct(q.reply_rate)} tiveram resposta do cliente em até ${windowH}h. Mínimo: ${minRate}%.` : 'Ainda não foi enviada.'}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: meta.color, fontWeight: 600 }}>
                            <StatusDot status={q.status} /> {fmtPct(q.reply_rate)}
                            <span style={{ fontWeight: 400, fontSize: 11 }}>{meta.label}</span>
                          </span>
                        </td>
                        <td style={td}>{fmtPct(q.advanced_rate)}</td>
                        <td style={td}>{fmtPct(q.bought_rate)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ ...td, background: 'var(--bg-secondary)' }}>
                            <SellerDetail
                              q={q}
                              suggestions={suggestions}
                              windowH={windowH}
                              busy={busy}
                              onTest={startSellerTest}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <BarChart3 size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Taxa de venda por faixa do termômetro</h3>
          <HelpTip title="Taxa de venda por faixa" width={320}>
            Pega os leads de cada faixa de 30 dias atrás e mostra quantos compraram depois. Se o termômetro funciona, Pronto vende mais que Quente, que vende mais que Morno. Ex.: 10 leads Pronto, 4 compraram = 40%.
          </HelpTip>
        </div>
        {perf?.conversion.warning && (
          <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', marginBottom: 10, borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 13 }}>
            <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
            O termômetro não está separando bem quem compra. Revise os pontos das opções.
          </div>
        )}
        {!bands.some(b => b.leads > 0) ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Ainda sem dados. O quadro precisa de 30 dias de termômetro guardado. Ex.: se hoje 10 leads estão Quentes, daqui a 30 dias você vê quantos deles compraram.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {bands.map(b => {
              const meta = BAND_META[b.band]
              const Icon = meta.icon
              return (
                <div key={b.band} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) 1fr auto', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14} style={{ color: meta.color }} /> {meta.label}</span>
                  <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${barWidth(b.rate)}%`, height: '100%', background: meta.color }} />
                  </div>
                  <span title={`${b.bought} de ${b.leads} leads ${meta.label} de 30 dias atrás compraram depois`} style={{ whiteSpace: 'nowrap' }}>
                    {fmtPct(b.rate)} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({b.bought} de {b.leads})</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface DetailProps {
  q: QuestionMetric
  suggestions: RoteiroSuggestion[]
  windowH: number
  busy: string | null
  onTest: (suggestionId: number, sellerName: string) => void
}

function SellerDetail({ q, suggestions, windowH, busy, onTest }: DetailProps) {
  if (!q.by_seller.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum envio com vendedor identificado ainda. Ex.: quando a Ana usar [Perguntar] no Chat, a taxa dela aparece aqui.</div>
  }
  const best = q.by_seller[0]
  const withSuggestion = q.by_seller.map(s => ({ s, sug: findSellerSuggestion(suggestions, q.question_key, s) }))
  const anySuggestion = withSuggestion.some(x => x.sug)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Por vendedor (resposta em até {windowH}h)</div>
        <div style={{ display: 'grid', gap: 4 }}>
          {withSuggestion.map(({ s, sug }) => (
            <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ minWidth: 120 }}>{s.name || 'Sem nome'}</span>
              <span title={`Dos ${s.sent} envios de ${s.name || 'este vendedor'}, ${fmtPct(s.reply_rate)} tiveram resposta`}>{fmtPct(s.reply_rate)} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>em {s.sent} envios</span></span>
              {sug && (
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => onTest(sug.id, s.name || 'este vendedor')}>
                  <FlaskConical size={12} /> {busy === `test-${sug.id}` ? 'Começando...' : `Usar o jeito de ${s.name || 'este vendedor'} como versão B`}
                </button>
              )}
            </div>
          ))}
        </div>
        {!anySuggestion && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>A sugestão aparece depois da análise da madrugada.</div>
        )}
      </div>
      {best.examples.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Como {best.name || 'o melhor vendedor'} perguntou</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 2 }}>
            {best.examples.map((ex, i) => <li key={i}><em>"{ex}"</em></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
