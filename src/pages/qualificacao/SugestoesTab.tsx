import { useCallback, useEffect, useState } from 'react'
import { Lightbulb, FlaskConical, Check, X, Trophy, Timer, CheckCircle2 } from 'lucide-react'
import {
  fetchSuggestions, fetchRoteiro, suggestionAction, variantAction,
  type RoteiroSuggestion, type RoteiroTest, type RoteiroFunnel,
} from '../../lib/roteiroApi'
import {
  suggestionWhy, SUGGESTION_TITLES, testRemainingText, testResultText, barWidth, fmtPct, hasUnpublished,
} from '../../lib/roteiroManager.js'
import { displayQuestionText } from '../../lib/roteiroView.js'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import { InlineNotice, useInlineNotice } from '../../components/InlineNotice'

// Aba "Sugestoes e testes" (spec 3.3, 6.5): cartoes com o numero que justifica, testes A/B
// em andamento e resultados para decidir.

interface Props { funnelId: number; accountId: number }

const AB_TYPES = ['rewrite', 'seller_phrasing']

export default function SugestoesTab({ funnelId, accountId }: Props) {
  const [suggestions, setSuggestions] = useState<RoteiroSuggestion[]>([])
  const [tests, setTests] = useState<RoteiroTest[]>([])
  const [roteiro, setRoteiro] = useState<RoteiroFunnel | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [versionPick, setVersionPick] = useState<Record<number, number>>({})
  const [confirmTest, setConfirmTest] = useState<RoteiroTest | null>(null)
  const { notice, showError, showSuccess, clear } = useInlineNotice()

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([fetchSuggestions(accountId), fetchRoteiro(funnelId, accountId)])
    const mine = (id: number | null) => id == null || id === funnelId
    setSuggestions(s.suggestions.filter(x => mine(x.funnel_id)))
    setTests(s.tests.filter(t => mine(t.funnel_id)))
    setRoteiro(r)
  }, [funnelId, accountId])

  useEffect(() => {
    setLoading(true)
    load().catch(e => showError('Não foi possível carregar as sugestões', e)).finally(() => setLoading(false))
  }, [load, showError])

  const act = async (key: string, fn: () => Promise<string>, errPrefix: string) => {
    setBusy(key); clear()
    try {
      const msg = await fn()
      await load()
      showSuccess(msg)
    } catch (e) { showError(errPrefix, e) } finally { setBusy(null) }
  }

  const questions = roteiro?.published?.questions || roteiro?.draft?.questions || []
  const qText = (key: string | null | undefined) => {
    const q = key ? questions.find(x => x.question_key === key) : null
    return q ? displayQuestionText(q.text) : ''
  }
  const stageName = (id: number) => roteiro?.stages.find(s => s.id === id)?.name || ''

  const doConfirm = (t: RoteiroTest) => act(`confirm-${t.id}`, async () => {
    const r = await variantAction(t.id, accountId, 'confirm')
    return r.published
      ? `Vencedora confirmada: a versão ${r.version?.version ?? ''} foi publicada com o texto novo.`
      : 'A versão atual continua no roteiro.'
  }, 'Não foi possível confirmar')

  const requestConfirm = (t: RoteiroTest) => {
    if (hasUnpublished(roteiro)) setConfirmTest(t)
    else doConfirm(t)
  }

  if (loading && !roteiro) return <div className="loading-container"><div className="spinner" /></div>

  const running = tests.filter(t => t.status === 'testing')
  const results = tests.filter(t => t.status !== 'testing' && !t.decided)

  return (
    <div>
      <InlineNotice notice={notice} onClose={clear} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Lightbulb size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Sugestões</h3>
          <HelpTip title="Sugestões" width={320}>
            Toda madrugada o sistema olha como cada pergunta foi respondida e sugere melhorias, sempre com o número que justifica. Aplicar muda só o rascunho; publicar continua com você. Ex.: "Esta pergunta perde 38% dos clientes" + o jeito que a Ana pergunta.
          </HelpTip>
        </div>
        {!suggestions.length ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Ainda sem sugestões. Elas aparecem depois que as perguntas forem enviadas algumas vezes (a análise roda toda madrugada).
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {suggestions.map(s => {
              const p = s.payload || {}
              const canTest = AB_TYPES.includes(s.type)
              const pick = versionPick[s.id] ?? 0
              const question = qText(s.question_key || p.question_key)
              return (
                <div key={s.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{SUGGESTION_TITLES[s.type]}</div>
                  {question && <div style={{ fontSize: 13 }}>Pergunta: <em>"{question}"</em></div>}
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{suggestionWhy(s)}</div>

                  {s.type === 'seller_phrasing' && p.text && (
                    <div style={{ fontSize: 13, background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}>
                      <em>"{displayQuestionText(p.text)}"</em>
                    </div>
                  )}
                  {s.type === 'rewrite' && Array.isArray(p.versions) && (
                    <div style={{ display: 'grid', gap: 4 }} role="radiogroup" aria-label="Versão para testar">
                      {p.versions.map((v: string, i: number) => (
                        <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                          <input type="radio" name={`sug-${s.id}`} checked={pick === i} onChange={() => setVersionPick(m => ({ ...m, [s.id]: i }))} />
                          <span>Versão {i + 1}: <em>"{displayQuestionText(v)}"</em></span>
                        </label>
                      ))}
                    </div>
                  )}
                  {s.type === 'new_option' && (
                    <div style={{ fontSize: 13 }}>Opção nova: <strong>{p.label}</strong> <span style={{ color: 'var(--text-muted)' }}>(entra com 0 pontos; ajuste no rascunho)</span></div>
                  )}
                  {s.type === 'new_deviation' && (
                    <div style={{ fontSize: 13, display: 'grid', gap: 2 }}>
                      <div>Se o cliente escrever: <strong>{p.triggers}</strong></div>
                      <div>Responda: <em>"{p.reply_text}"</em></div>
                      {p.return_question_key && <div>Volte para: <em>"{qText(p.return_question_key)}"</em></div>}
                    </div>
                  )}
                  {s.type === 'reorder' && (
                    <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
                      {p.explanation && <div style={{ color: 'var(--text-secondary)' }}>{p.explanation}</div>}
                      <div style={{ color: 'var(--text-muted)' }}>Nova ordem em {stageName(p.stage_id) || 'etapa'}:</div>
                      <ol style={{ margin: 0, paddingLeft: 20 }}>
                        {(Array.isArray(p.order) ? p.order : []).map((k: string) => <li key={k}>{qText(k) || 'pergunta'}</li>)}
                      </ol>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {canTest && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!!busy}
                        onClick={() => act(`test-${s.id}`, async () => {
                          await suggestionAction(s.id, accountId, 'test', s.type === 'rewrite' ? { version_index: pick } : undefined)
                          return 'Teste A/B começou: metade dos leads recebe a versão nova. Acompanhe abaixo.'
                        }, 'Não foi possível começar o teste')}
                      >
                        <FlaskConical size={13} /> {busy === `test-${s.id}` ? 'Começando...' : 'Testar A/B'}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={!!busy}
                      title="Muda só o rascunho; publique na aba Roteiro"
                      onClick={() => act(`apply-${s.id}`, async () => {
                        await suggestionAction(s.id, accountId, 'apply')
                        return 'Aplicado no rascunho. Publique na aba Roteiro para os vendedores verem.'
                      }, 'Não foi possível aplicar')}
                    >
                      <Check size={13} /> {busy === `apply-${s.id}` ? 'Aplicando...' : s.type === 'rewrite' ? 'Aplicar versão 1' : 'Aplicar'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={!!busy}
                      onClick={() => act(`reject-${s.id}`, async () => {
                        await suggestionAction(s.id, accountId, 'reject')
                        return 'Sugestão recusada.'
                      }, 'Não foi possível recusar')}
                    >
                      <X size={13} /> Recusar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Timer size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Testes em andamento</h3>
          <HelpTip title="Teste A/B" width={320}>
            Metade dos leads recebe a versão atual (A) e metade a nova (B). O teste termina quando cada versão tiver 30 envios ou depois de 30 dias. Vence quem tiver 5 pontos a mais de resposta. Ex.: A 60% × B 72% = B vence.
          </HelpTip>
        </div>
        {!running.length ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhum teste rodando. Clique em [Testar A/B] numa sugestão de texto para comparar a versão nova com a atual.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {running.map(t => (
              <div key={t.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'grid', gap: 8 }}>
                <AbBars test={t} />
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{testRemainingText(t)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Trophy size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Resultados para decidir</h3>
          <HelpTip title="Resultados">
            Confirmar a vencedora troca o texto no rascunho e publica uma versão nova. Manter a atual deixa o roteiro como está. Ex.: B teve 75% contra 60% da A: confirme e todos passam a usar a B.
          </HelpTip>
        </div>
        {!results.length ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhum resultado esperando você. Quando um teste terminar, ele aparece aqui com os números de A e B.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {results.map(t => (
              <div key={t.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'grid', gap: 8 }}>
                <AbBars test={t} />
                <div style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <CheckCircle2 size={15} style={{ color: t.status === 'won' ? 'var(--positive)' : 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                  {testResultText(t)}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {t.status === 'won' && (
                    <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => requestConfirm(t)}>
                      <Trophy size={13} /> {busy === `confirm-${t.id}` ? 'Publicando...' : 'Confirmar vencedora'}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={!!busy}
                    onClick={() => act(`keep-${t.id}`, async () => {
                      await variantAction(t.id, accountId, 'keep')
                      return 'A versão atual continua no roteiro.'
                    }, 'Não foi possível manter')}
                  >
                    Manter a atual
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmTest && (
        <ConfirmDialog
          title="Publicar junto com o rascunho?"
          confirmLabel="Publicar tudo"
          onConfirm={() => { const t = confirmTest; setConfirmTest(null); doConfirm(t) }}
          onCancel={() => setConfirmTest(null)}
        >
          Seu rascunho tem mudanças que ainda não foram publicadas. Confirmar a vencedora publica o rascunho inteiro, então essas mudanças vão junto para os vendedores. Se não quiser, cancele, revise o rascunho na aba Roteiro e volte aqui.
        </ConfirmDialog>
      )}
    </div>
  )
}

function AbBars({ test }: { test: RoteiroTest }) {
  const rows = [
    { key: 'A', label: 'A — atual', text: test.current_text, data: test.a, color: 'var(--text-muted)' },
    { key: 'B', label: 'B — nova', text: test.text, data: test.b, color: 'var(--accent)' },
  ]
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'grid', gap: 3 }}>
          <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span><strong>{r.label}:</strong> <em>{r.text ? `"${displayQuestionText(r.text)}"` : '(pergunta fora do roteiro publicado)'}</em></span>
            <span
              style={{ whiteSpace: 'nowrap' }}
              title={r.data.sent ? `Dos ${r.data.sent} envios da versão ${r.key}, ${fmtPct(r.data.rate)} tiveram resposta` : 'Ainda sem envios desta versão'}
            >
              {fmtPct(r.data.rate)} <span style={{ color: 'var(--text-muted)' }}>em {r.data.sent} {r.data.sent === 1 ? 'envio' : 'envios'}</span>
            </span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${barWidth(r.data.rate)}%`, height: '100%', background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
