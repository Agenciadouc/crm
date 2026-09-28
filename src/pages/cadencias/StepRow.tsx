import { ArrowDown, ArrowUp, Lock, MessageCircle, Phone, Mail, Video, MapPin, HelpCircle, Trash2, type LucideIcon } from 'lucide-react'
import type { CadenceStep, StepMetric } from '../../lib/cadenceApi'
import { stepLabel, stepShortText, stepDayText, metricBadge, metricWhy } from '../../lib/stageCadence.js'

export const STEP_ICONS: Record<string, LucideIcon> = { pergunta: HelpCircle, mensagem: MessageCircle, whatsapp: MessageCircle, ligacao: Phone, email: Mail, reuniao: Video, visita: MapPin }
const TONE = { good: 'var(--positive)', bad: 'var(--negative)', muted: 'var(--text-muted)' } as const

export interface StepRowProps {
  step: CadenceStep; index: number; metric: StepMetric | undefined; windowH: number; minRate: number
  selected: boolean; first: boolean; last: boolean
  onSelect: () => void; onMove: (dir: -1 | 1) => void
  onDragStart: () => void; onDropHere: () => void
  onDeleteOrphan: () => void // pergunta que saiu do roteiro: so da para apagar
}

// Uma linha por passo: numero, tipo, texto curto, obrigatoria, dia, selo da metrica, subir/descer.
export default function StepRow({ step, index, metric, windowH, minRate, selected, first, last, onSelect, onMove, onDragStart, onDropHere, onDeleteOrphan }: StepRowProps) {
  const Icon = STEP_ICONS[step.action_type] || MessageCircle
  const badge = step.orphan ? null : metricBadge(metric)
  const open = () => { if (!step.orphan) onSelect() }
  return (
    <div
      role="button" tabIndex={0} draggable
      aria-pressed={selected}
      onDragStart={onDragStart} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onDropHere() }}
      onClick={open} onKeyDown={e => { if (e.key === 'Enter') open() }}
      style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: step.orphan ? 'default' : 'pointer',
        background: selected ? 'var(--bg-hover)' : 'transparent', border: `1px solid ${selected ? 'var(--border-accent)' : 'var(--border-subtle)'}`, fontSize: 13 }}
    >
      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</span>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)', fontSize: 12, flexShrink: 0 }}><Icon size={13} /> {stepLabel(step.action_type)}</span>
        {step.orphan ? (
          <span style={{ color: 'var(--warning)' }}>Pergunta removida do roteiro</span>
        ) : (
          <span style={{ minWidth: 0, flex: '1 1 160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
            {stepShortText(step)}
          </span>
        )}
        {step.action_type === 'pergunta' && step.question?.required && (
          <span title="Obrigatória: trava a mudança de etapa até ter resposta" style={{ fontSize: 11, color: 'var(--negative)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Lock size={11} /> obrigatória
          </span>
        )}
        <span title="Quantos dias depois de entrar na etapa este passo vira tarefa" style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{stepDayText(step)}</span>
        {badge && <span title={metricWhy(metric, { windowH, minRate })} style={{ fontSize: 11, whiteSpace: 'nowrap', color: TONE[badge.tone] }}>{badge.text}</span>}
      </span>
      <span style={{ display: 'inline-flex', gap: 2 }} onClick={e => e.stopPropagation()}>
        {step.orphan ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onDeleteOrphan}><Trash2 size={12} /> Apagar</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" disabled={first} aria-label="Subir passo" title="Subir" onClick={() => onMove(-1)}><ArrowUp size={12} /></button>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" disabled={last} aria-label="Descer passo" title="Descer" onClick={() => onMove(1)}><ArrowDown size={12} /></button>
          </>
        )}
      </span>
    </div>
  )
}
