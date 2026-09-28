import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3 } from 'lucide-react'
import { fetchConversionByBand, type ConversionByBand } from '../../lib/roteiroApi'
import { BAND_META } from '../../lib/score'
import { barWidth, fmtPct } from '../../lib/roteiroManager.js'
import HelpTip from '../HelpTip'

// Quadro "Taxa de venda por faixa do termometro" (spec 2026-09-27 §5.2): mora no Dashboard.
export default function ConversionByBandCard({ accountId }: { accountId: number }) {
  const [data, setData] = useState<ConversionByBand | null>(null)
  const [error, setError] = useState(false)
  const load = useCallback(() => {
    setError(false)
    fetchConversionByBand(accountId).then(setData).catch(() => setError(true))
  }, [accountId])
  useEffect(() => { load() }, [load])

  const bands = data?.bands || []
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BarChart3 size={15} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Taxa de venda por faixa do termômetro</h3>
        <HelpTip title="Taxa de venda por faixa" width={320}>
          Pega os leads de cada faixa de 30 dias atrás e mostra quantos compraram depois. Se o termômetro funciona, Pronto vende mais que Quente, que vende mais que Morno. Ex.: 10 leads Pronto, 4 compraram = 40%.
        </HelpTip>
      </div>
      {error && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Não deu para carregar agora. <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Tentar de novo</button>
        </p>
      )}
      {!error && !data && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando...</p>}
      {data?.warning && (
        <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', marginBottom: 10, borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 13 }}>
          <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
          O termômetro não está separando bem quem compra. Revise os pontos das opções.
        </div>
      )}
      {data && !bands.some(b => b.leads > 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Ainda sem dados. O quadro precisa de 30 dias de termômetro guardado. Ex.: se hoje 10 leads estão Quentes, daqui a 30 dias você vê quantos deles compraram.
        </p>
      )}
      {data && bands.some(b => b.leads > 0) && (
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
  )
}
