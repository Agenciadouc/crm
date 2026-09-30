import { useState, type ReactNode } from 'react'
import { addLeadSale, REMIND_DAYS, type SaleKind } from '../lib/api'
import { DollarSign, X, AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  leadId: number
  accountId: number
  leadName?: string | null
  /** Texto de contexto opcional (ex.: "Movendo X pra Y"), mostrado acima do formulario. */
  note?: ReactNode
  defaultDays?: number
  aiEnabled?: boolean
  onClose: () => void
  onSaved: (total: number) => void
}

// Janela unica de registro de venda (spec LTV/Recompra §5): valor, data, produto, tipo
// (pode recomprar / compra unica) e lembrete. Usada por Chat, LeadDetail e Pipeline.
export default function SaleModal({ open, leadId, accountId, leadName, note, defaultDays = 30, aiEnabled = false, onClose, onSaved }: Props) {
  const [value, setValue] = useState('')
  const [date, setDate] = useState('')
  const [product, setProduct] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState<SaleKind>('recompra')
  const [days, setDays] = useState<number>(defaultDays)
  const [cross, setCross] = useState(false)
  const [offer, setOffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function save() {
    setError(null)
    const v = parseFloat(value.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) { setError('Informe o valor da venda.'); return }
    setSaving(true)
    try {
      const r = await addLeadSale(leadId, accountId, {
        value: v,
        sale_date: date ? `${date}T12:00:00` : undefined,
        notes: notes.trim() || undefined,
        product: product.trim() || undefined,
        sale_kind: kind,
        remind_days: kind === 'recompra' || cross ? days : undefined,
        cross_sell: kind === 'unica' ? cross : undefined,
        cross_sell_offer: kind === 'unica' && cross ? (offer.trim() || undefined) : undefined,
      })
      onSaved(r.total)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar a venda.')
    } finally {
      setSaving(false)
    }
  }

  const DaysPicker = (
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
  )

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: note ? 6 : 12 }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={18} style={{ color: '#34C759' }} /> Registrar venda{leadName ? ` — ${leadName}` : ''}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose} disabled={saving}><X size={14} /></button>
        </div>
        {note && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>{note}</p>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 2, minWidth: 160, marginBottom: 10 }}>
            <label>Valor (R$)</label>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              className="input"
              value={value}
              onChange={e => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter' && !saving) save() }}
              placeholder="0,00"
              disabled={saving}
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 10 }}>
            <label>Data da venda</label>
            <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} disabled={saving} />
            <small style={{ fontSize: 10, color: 'var(--text-muted)' }}>Deixe vazio = hoje</small>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>Produto/serviço vendido</label>
          <input
            className="input"
            maxLength={200}
            value={product}
            onChange={e => setProduct(e.target.value)}
            placeholder="Ex.: Churrasqueira a bafo 60cm"
            disabled={saving}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>Tipo da venda</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className={`btn btn-sm ${kind === 'recompra' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind('recompra')} disabled={saving}>
              Pode recomprar
            </button>
            <button type="button" className={`btn btn-sm ${kind === 'unica' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind('unica')} disabled={saving}>
              Compra única
            </button>
          </div>
        </div>

        {kind === 'recompra' && (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Lembrar em</label>
            {DaysPicker}
            <small style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ex.: pacote de pilates → lembrar em 30 dias para renovar.</small>
          </div>
        )}

        {kind === 'unica' && (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input type="checkbox" checked={cross} onChange={e => setCross(e.target.checked)} disabled={saving} />
              <span>Oferecer produtos relacionados depois</span>
            </label>
            {cross && (
              <>
                <div style={{ marginTop: 8 }}>Oferecer em:</div>
                {DaysPicker}
                <label style={{ marginTop: 6 }}>O que oferecer</label>
                <input
                  className="input"
                  maxLength={500}
                  value={offer}
                  onChange={e => setOffer(e.target.value)}
                  placeholder="Ex.: espetos, tábuas, avental"
                  disabled={saving}
                />
                {aiEnabled && <small style={{ fontSize: 10, color: 'var(--text-muted)' }}>Deixe vazio e a IA sugere na hora do lembrete.</small>}
              </>
            )}
            <small style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginTop: 6 }}>Ex.: vendeu uma churrasqueira → ofereça espetos e tábuas em 15 dias.</small>
          </div>
        )}

        <div className="form-group" style={{ marginBottom: 4 }}>
          <label>Observação</label>
          <textarea className="input" rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {error && (
          <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginTop: 10, fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !value.trim()}>
            {saving ? 'Salvando…' : 'Salvar venda'}
          </button>
        </div>
      </div>
    </div>
  )
}
