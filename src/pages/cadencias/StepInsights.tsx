import { useState } from 'react'
import HelpTip from '../../components/HelpTip'
import { applySuggestionLive, confirmVariantLive, type CadenceStep, type StepMetric } from '../../lib/cadenceApi'
import { suggestionAction, variantAction, type RoteiroSuggestion, type RoteiroTest } from '../../lib/roteiroApi'
import { suggestionWhy, SUGGESTION_TITLES, testRemainingText, testResultText, fmtPct } from '../../lib/roteiroManager.js'
import { metricBadge, metricWhy } from '../../lib/stageCadence.js'

export interface StepInsightsProps {
  accountId: number; step: CadenceStep; metric: StepMetric | undefined; windowH: number; minRate: number
  suggestions: RoteiroSuggestion[] // ja filtradas por suggestionsForStep
  test: RoteiroTest | null // testForStep
  onChanged: () => void // recarrega visao + sugestoes
}

const TONE = { good: 'var(--positive)', bad: 'var(--negative)', muted: 'var(--text-muted)' } as const
const box = { border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'grid', gap: 6, fontSize: 13 } as const
const quote = { background: 'var(--bg-secondary)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', fontSize: 13 } as const

// Metrica, sugestoes da IA e teste A/B dentro do proprio passo.
export default function StepInsights({ accountId, metric, windowH, minRate, suggestions, test, onChanged }: StepInsightsProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pick, setPick] = useState<Record<number, number>>({})
  const badge = metricBadge(metric)

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setErrors(m => ({ ...m, [key]: '' }))
    try {
      await fn()
      onChanged()
    } catch (e) {
      setErrors(m => ({ ...m, [key]: e instanceof Error ? e.message : 'Erro.' }))
    } finally {
      setBusy(null)
    }
  }

  if (!metric && !suggestions.length && !test) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        Ainda sem números. Eles aparecem quando os vendedores usarem os botões do Chat. Ex.: 20 envios desta pergunta já mostram a taxa de resposta.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
      {metric && (
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Como este passo está indo
            <HelpTip title="Como este passo está indo">Resposta = o cliente respondeu em até {windowH}h depois do envio. Ex.: 45% quer dizer que de cada 20 clientes, 9 responderam.</HelpTip>
          </strong>
          {badge && <span style={{ fontSize: 13, color: TONE[badge.tone] }}>{badge.text}</span>}
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{metricWhy(metric, { windowH, minRate })}</span>
          {metric.kind === 'resposta' && metric.by_seller.length > 0 && (
            <div style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--text-secondary)' }}>
              {metric.by_seller.slice(0, 3).map(s => (
                <span key={s.user_id}>{s.name || 'Vendedor'}: {fmtPct(s.reply_rate)} em {s.sent} envios</span>
              ))}
            </div>
          )}
        </div>
      )}

      {suggestions.map(s => {
        const p = s.payload || {}
        const key = `s${s.id}`
        const versions: string[] = s.type === 'rewrite' && Array.isArray(p.versions) ? p.versions : []
        const text: string | undefined = p.text || versions[0] || p.label
        return (
          <div key={s.id} style={box}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{SUGGESTION_TITLES[s.type]}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{suggestionWhy(s)}</div>
            {versions.length > 1 ? (
              <div role="radiogroup" aria-label="Versão para testar" style={{ display: 'grid', gap: 4 }}>
                {versions.map((v, i) => (
                  <label key={i} style={{ ...quote, display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="radio" name={`sug-${s.id}`} checked={(pick[s.id] ?? 0) === i} onChange={() => setPick(m => ({ ...m, [s.id]: i }))} />
                    <em>"{v}"</em>
                  </label>
                ))}
              </div>
            ) : text ? <div style={quote}><em>"{text}"</em></div> : null}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(s.type === 'rewrite' || s.type === 'seller_phrasing') && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null}
                  onClick={() => run(key, () => suggestionAction(s.id, accountId, 'test', s.type === 'rewrite' ? { version_index: pick[s.id] ?? 0 } : undefined))}>Testar A/B</button>
              )}
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => run(key, () => applySuggestionLive(s.id, accountId))}>Aplicar</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => run(key, () => suggestionAction(s.id, accountId, 'reject'))}>Ignorar</button>
            </div>
            {errors[key] && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{errors[key]}</div>}
          </div>
        )
      })}

      {test && (
        <div style={box}>
          {test.status === 'testing' ? (
            <>
              <div>Testando a versão B: "{test.text}"</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{testResultText(test)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{testRemainingText(test)}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{testResultText(test)}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {test.status === 'won' && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => run('t', () => confirmVariantLive(test.id, accountId))}>Usar a vencedora</button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => run('t', () => variantAction(test.id, accountId, 'keep'))}>Manter a atual</button>
              </div>
            </>
          )}
          {errors.t && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{errors.t}</div>}
        </div>
      )}
    </div>
  )
}
