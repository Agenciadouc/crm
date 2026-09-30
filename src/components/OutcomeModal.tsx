import { useState } from 'react'
import { postRepurchaseOutcome, REMIND_DAYS } from '../lib/api'
import { X, AlertTriangle, RotateCcw, Ban } from 'lucide-react'

interface Props {
  open: boolean
  outcome: 'nao_agora' | 'nao_quer'
  leadId: number
  accountId: number
  leadName?: string | null
  reasons: { id: number; label: string }[]
  defaultDays: number
  onClose: () => void
  onDone: () => void
}

// Janela de desfecho de recompra (spec LTV/Recompra §6.3): "Não comprou agora" (motivo + próxima
// tentativa) e "Não quer mais" (motivo, encerra o ciclo). Aberta pelo Pipeline quando o card e
// arrastado pra uma dessas duas etapas do funil Recompra — segue o mesmo padrão visual do SaleModal.
export default function OutcomeModal({ open, outcome, leadId, accountId, leadName, reasons, defaultDays, onClose, onDone }: Props) {
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [days, setDays] = useState<number>(defaultDays)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const isNaoAgora = outcome === 'nao_agora'

  async function save() {
    if (!reasonId) { setError('Escolha o motivo.'); return }
    setError(null)
    setSaving(true)
    try {
      await postRepurchaseOutcome(leadId, accountId, {
        outcome,
        reason_id: reasonId,
        next_days: isNaoAgora ? days : undefined,
      })
      onDone()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {isNaoAgora ? <RotateCcw size={18} style={{ color: '#FF7043' }} /> : <Ban size={18} style={{ color: '#8D6E63' }} />}
            {isNaoAgora ? 'Não comprou agora' : 'Não quer mais comprar'}{leadName ? ` — ${leadName}` : ''}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose} disabled={saving}><X size={14} /></button>
        </div>

        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>Por quê?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {reasons.map(r => (
              <button
                key={r.id}
                type="button"
                className={`btn btn-sm ${reasonId === r.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => setReasonId(r.id)}
                disabled={saving}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {isNaoAgora ? (
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label>Tentar de novo em</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, marginBottom: 6 }}>
              {REMIND_DAYS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDays(d)}
                  disabled={saving}
                >
                  {d} dias
                </button>
              ))}
            </div>
            <small style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ex.: o cliente disse "me chama mês que vem" → 30 dias.</small>
          </div>
        ) : (
          <div className="form-group" style={{ marginBottom: 4 }}>
            <small style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Este cliente não vai mais receber lembretes nem ofertas. Dá para desfazer depois na ficha dele.
            </small>
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginTop: 10, fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !reasonId}>
            {saving ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
