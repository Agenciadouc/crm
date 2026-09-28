import { useState } from 'react'
import { GripVertical, ChevronUp, ChevronDown, Eye, EyeOff, Save, RotateCcw, Users, X, AlertTriangle } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import HelpTip from './HelpTip'
import { blockLabel, moveBlock, moveBlockTo, toggleRow, validateLayout, editorRows, expandRows, type PanelBlock, type LayoutSource, type EditorRow } from '../lib/panelLayout.js'

// Modo "Arrumar" da aba Atendimento: arrastar (ou setas) muda a ordem; o olho mostra/esconde.
// Nada e apagado: esconder so tira o bloco da aba Atendimento. No celular nao ha arrastar (so setas).
// Etapa + avulsa aparecem como UMA linha "Cadência" (mover/esconder vale para as duas; salvas juntas).
interface Props {
  initial: PanelBlock[]
  loadFailed?: boolean
  source: LayoutSource
  hasOwn: boolean
  canSaveAccount: boolean
  onSaveMine: (layout: PanelBlock[]) => Promise<void>
  onSaveAccount: (layout: PanelBlock[]) => Promise<void>
  onReset: () => Promise<void>
  onCancel: () => void
}

const SOURCE_TEXT: Record<LayoutSource, string> = {
  user: 'Agora você vê o seu jeito.',
  account: 'Agora você vê o padrão da conta.',
  factory: 'Agora você vê o padrão do sistema.',
}

export default function PanelLayoutEditor({ initial, loadFailed = false, source, hasOwn, canSaveAccount, onSaveMine, onSaveAccount, onReset, onCancel }: Props) {
  const [draft, setDraft] = useState<EditorRow[]>(() => editorRows(initial))
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const canDrag = !isMobile && !busy

  const run = async (fn: () => Promise<void>, needsValid = true) => {
    const layout = expandRows(draft)
    const invalid = needsValid ? validateLayout(layout) : null
    if (invalid) { setError(invalid); return }
    if (needsValid && !layout.some(b => b.visible)) { setError('Deixe pelo menos um bloco visível.'); return }
    setBusy(true); setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Não deu para salvar. Tente de novo.'); setBusy(false) }
  }

  const btn = { padding: '2px 5px', fontSize: 10 }
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 4 }}>
        Arrumar a aba Atendimento
        <HelpTip title="Arrumar">Mude a ordem e escolha o que aparece. Ex.: esconda Vendas e suba Tarefas. Esconder não apaga nada.</HelpTip>
      </div>
      <div style={{ fontSize: 10, color: '#6B6580', marginBottom: 8 }}>{SOURCE_TEXT[source]} {isMobile ? 'Use as setas para mudar a ordem.' : 'Arraste pela alça ou use as setas.'}</div>
      {loadFailed && (
        <div role="status" style={{ fontSize: 10, color: '#FBBC04', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <AlertTriangle size={10} style={{ flexShrink: 0 }} /> Não consegui carregar sua arrumação salva. Se salvar agora, ela será substituída.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {draft.map((b, i) => (
          <div
            key={b.id}
            draggable={canDrag}
            onDragStart={e => { if (!canDrag) return; setDragFrom(i); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={e => { if (dragFrom !== null) e.preventDefault() }}
            onDrop={e => { e.preventDefault(); if (dragFrom !== null) setDraft(d => moveBlockTo(d, dragFrom, i)); setDragFrom(null) }}
            onDragEnd={() => setDragFrom(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${dragFrom === i ? 'var(--border-medium)' : 'var(--border-subtle)'}`,
              background: 'var(--bg-hover)', opacity: b.visible ? 1 : 0.55,
            }}
          >
            {!isMobile && <GripVertical size={14} style={{ color: '#9B96B0', cursor: 'grab', flexShrink: 0 }} aria-hidden />}
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, textDecoration: b.visible ? 'none' : 'line-through' }}>{blockLabel(b.id)}</span>
            <button className="btn btn-secondary btn-sm" style={btn} disabled={busy || i === 0} onClick={() => setDraft(d => moveBlock(d, b.id, -1))} title="Subir" aria-label={`Subir ${blockLabel(b.id)}`}><ChevronUp size={11} /></button>
            <button className="btn btn-secondary btn-sm" style={btn} disabled={busy || i === draft.length - 1} onClick={() => setDraft(d => moveBlock(d, b.id, 1))} title="Descer" aria-label={`Descer ${blockLabel(b.id)}`}><ChevronDown size={11} /></button>
            <button
              className="btn btn-secondary btn-sm" style={btn} disabled={busy}
              onClick={() => setDraft(d => toggleRow(d, b.id))}
              title={b.visible ? 'Esconder' : 'Mostrar'} aria-label={`${b.visible ? 'Esconder' : 'Mostrar'} ${blockLabel(b.id)}`} aria-pressed={b.visible}
            >
              {b.visible ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>
        ))}
      </div>

      {error && <div role="alert" style={{ fontSize: 11, color: '#FF6B6B', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: 11 }} disabled={busy} onClick={() => run(() => onSaveMine(expandRows(draft)))}>
          <Save size={10} /> Salvar para mim
        </button>
        {canSaveAccount && (
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: 11 }} disabled={busy} onClick={() => run(() => onSaveAccount(expandRows(draft)))} title="Todos da conta que não arrumaram do seu jeito passam a ver assim">
            <Users size={10} /> Salvar como padrão da conta
          </button>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 11 }} disabled={busy || !hasOwn} onClick={() => run(onReset, false)} title={hasOwn ? 'Apaga o seu jeito e volta a ver o padrão da conta' : 'Você já está vendo o padrão'}>
            <RotateCcw size={10} /> Voltar ao padrão
          </button>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: 11 }} disabled={busy} onClick={onCancel}>
            <X size={10} /> Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
