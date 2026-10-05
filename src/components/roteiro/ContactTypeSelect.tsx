import { useState, type CSSProperties } from 'react'
import HelpTip from '../HelpTip'
import { updateLead, type Lead } from '../../lib/api'

type ContactType = 'lead' | 'cliente' | 'revendedor' | 'interno'
const OPTIONS: { value: ContactType; label: string }[] = [
  { value: 'lead', label: 'Lead (cliente em potencial)' },
  { value: 'cliente', label: 'Cliente (já comprou)' },
  { value: 'revendedor', label: 'Revendedor ou representante' },
  { value: 'interno', label: 'Interno (funcionário, empresa)' },
]
const OUT = new Set<ContactType>(['revendedor', 'interno'])

// Tipo de contato (spec 2026-10-05 crm simples §2): quem nao e cliente em potencial sai do
// funil e dos numeros, e interno/revendedor nao recebem automacao.
export default function ContactTypeSelect({ lead, onChanged, style }: { lead: Pick<Lead, 'id' | 'contact_type'>; onChanged?: (type: ContactType) => void; style?: CSSProperties }) {
  const [value, setValue] = useState<ContactType>((lead.contact_type as ContactType) || 'lead')
  const [prev, setPrev] = useState<ContactType | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (next: ContactType, undo = false) => {
    setBusy(true); setError(null)
    const before = value
    try {
      await updateLead(lead.id, { contact_type: next })
      setValue(next)
      setPrev(!undo && OUT.has(next) && !OUT.has(before) ? before : null)
      onChanged?.(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setBusy(false)
    }
  }
  const id = `contact-type-${lead.id}`
  return (
    <div style={{ display: 'grid', gap: 4, ...style }}>
      <label htmlFor={id} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Tipo de contato
        <HelpTip title="Tipo de contato">Quem não é cliente em potencial sai do funil e dos números, e não recebe mensagem automática. Ex.: o celular de um funcionário = Interno; um representante da empresa = Revendedor.</HelpTip>
      </label>
      <select id={id} className="select" style={{ width: '100%' }} disabled={busy} value={value} onChange={e => save(e.target.value as ContactType)}>
        {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {prev && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
          Este contato saiu do funil e dos números.
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save(prev, true)}>Desfazer</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</div>}
    </div>
  )
}
