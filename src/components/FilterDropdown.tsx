import { useState, useEffect, useRef } from 'react'

// Dropdown de multi-selecao com checkboxes — usado em Pipeline e Chat
export type FilterValue = number | string

export default function FilterDropdown({ label, options, selected, onChange, width = 140 }: {
  label: string
  options: { value: FilterValue; label: string }[]
  selected: FilterValue[]
  onChange: (next: FilterValue[]) => void
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  const toggle = (v: FilterValue) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v))
    else onChange([...selected, v])
  }
  const display = selected.length === 0
    ? `Todas as ${label}`
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label || `1 ${label}`
      : `${selected.length} ${label}`
  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button
        type="button"
        className="select"
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 6,
          maxHeight: 280, overflowY: 'auto', zIndex: 50, padding: 4,
          boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)'
        }}>
          {options.length === 0 && (
            <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>Sem opcoes</div>
          )}
          {options.map(opt => {
            const isSel = selected.includes(opt.value)
            return (
              <label key={String(opt.value)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                cursor: 'pointer', fontSize: 12, borderRadius: 4,
                background: isSel ? 'rgba(255,179,0,0.10)' : 'transparent',
                color: isSel ? 'var(--accent)' : 'var(--text-primary)',
                fontWeight: isSel ? 600 : 400,
              }}>
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(opt.value)}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                {opt.label}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
