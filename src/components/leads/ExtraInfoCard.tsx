import { useState } from 'react'
import { Info, Pencil, X } from 'lucide-react'
import HelpTip from '../HelpTip'
import { updateLead, type Lead } from '../../lib/api'

// Informacoes extras do lead (leads.custom_fields): vindas de uma planilha importada ou de um
// formulario. Some quando nao ha nenhuma. Edita pelo PUT /leads/:id de sempre.
export function parseExtra(v: unknown): Record<string, string> {
  if (!v) return {}
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, val]) => [k, val == null ? '' : String(val)]))
  } catch { return {} }
}

interface Props {
  lead: Pick<Lead, 'id'> & { custom_fields?: string | null }
  canEdit: boolean
  onSaved: (fields: Record<string, string>) => void
  style?: React.CSSProperties
}

export default function ExtraInfoCard({ lead, canEdit, onSaved, style }: Props) {
  const fields = parseExtra(lead.custom_fields)
  const [editing, setEditing] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!Object.keys(fields).length && !editing) return null

  const save = async () => {
    if (!editing) return
    setSaving(true); setError(null)
    try {
      const clean = Object.fromEntries(Object.entries(editing).filter(([, v]) => v.trim() !== ''))
      await updateLead(lead.id, { custom_fields: clean } as unknown as Partial<Lead>)
      onSaved(clean); setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não deu para salvar.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ padding: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 6 }}>
        <Info size={10} /> Informações extras
        <HelpTip title="Informações extras">Informações que vieram de uma planilha importada ou de um formulário. Ex.: Tamanho da loja: 120 m².</HelpTip>
        <span style={{ flex: 1 }} />
        {canEdit && !editing && (
          <button type="button" aria-label="Editar informações extras" onClick={() => setEditing({ ...fields })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <Pencil size={11} />
          </button>
        )}
      </div>
      {!editing ? (
        <div style={{ display: 'grid', gap: 4 }}>
          {Object.entries(fields).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, lineHeight: 1.4 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
              <span style={{ color: 'var(--text-primary)' }}>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(editing).map(([k, v]) => (
            <label key={k} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, alignItems: 'center', fontSize: 11 }}>
              <span style={{ gridColumn: '1 / -1', color: 'var(--text-muted)' }}>{k}</span>
              <input className="input" value={v} onChange={e => setEditing({ ...editing, [k]: e.target.value })} style={{ fontSize: 12 }} />
              <button type="button" aria-label={`Tirar ${k}`} title="Tirar esta informação" onClick={() => { const n = { ...editing }; delete n[k]; setEditing(n) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--negative)' }}><X size={12} /></button>
            </label>
          ))}
          {error && <div style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => { setEditing(null); setError(null) }}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
