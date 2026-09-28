import { useState } from 'react'
import { ListChecks, Plus, Sparkles } from 'lucide-react'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import { stageTemplate, isAiOff, AI_OFF_TEXT, type StageCadence, type StageViewStage, type StepType } from '../../lib/cadenceApi'
import { STEP_TYPES } from '../../lib/stageCadence.js'

// Menu de tipos do [+ Passo] (cabecalho da lista e etapa vazia)
export function AddStepMenu({ onAddStep, label = 'Passo' }: { onAddStep: (type: StepType) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-primary btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><Plus size={12} /> {label}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 41, minWidth: 160, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)', padding: 4, display: 'grid' }}>
            {STEP_TYPES.map(t => (
              <button key={t.value} type="button" role="menuitem" onClick={() => { setOpen(false); onAddStep(t.value) }}
                style={{ background: 'none', border: 'none', textAlign: 'left', padding: '7px 10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 13, borderRadius: 'var(--radius-xs)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }} onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

export interface TemplateButtonsProps {
  accountId: number; funnelId: number; stage: StageViewStage
  onCadence: (cadence: StageCadence) => void
  compact?: boolean // cabecalho da lista (etapa com passos): botoes menores, sem HelpTip
}

// [Comecar com modelo] (BANT) e [Montar com IA]. Etapa que ja tem passos pede confirmacao antes.
export function TemplateButtons({ accountId, funnelId, stage, onCadence, compact = false }: TemplateButtonsProps) {
  const [busy, setBusy] = useState<'bant' | 'ia' | null>(null)
  const [confirm, setConfirm] = useState<'bant' | 'ia' | null>(null)
  const [aiOff, setAiOff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (mode: 'bant' | 'ia') => {
    setConfirm(null)
    setBusy(mode); setError(null)
    try {
      onCadence(await stageTemplate(funnelId, stage.id, accountId, mode))
    } catch (e) {
      if (mode === 'ia' && isAiOff(e)) setAiOff(true)
      else setError(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setBusy(null)
    }
  }
  const ask = (mode: 'bant' | 'ia') => { if (stage.summary.steps > 0) setConfirm(mode); else run(mode) }

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => ask('bant')}>
          <ListChecks size={12} /> {busy === 'bant' ? 'Montando…' : 'Começar com modelo'}
        </button>
        {!compact && <HelpTip title="Começar com modelo">Coloca as 4 perguntas clássicas de venda: necessidade, orçamento, quem decide e prazo (só as que o funil ainda não tem).</HelpTip>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || aiOff} title={aiOff ? AI_OFF_TEXT : undefined} onClick={() => ask('ia')}>
          <Sparkles size={12} /> {busy === 'ia' ? 'A IA está montando…' : 'Montar com IA'}
        </button>
      </span>
      {aiOff && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6, width: '100%' }}>{AI_OFF_TEXT}</div>}
      {error && <div style={{ fontSize: 12, color: 'var(--negative)', marginTop: 6, width: '100%' }}>{error}</div>}
      {confirm && (
        <ConfirmDialog title="Somar perguntas a esta etapa?" confirmLabel={confirm === 'ia' ? 'Montar com IA' : 'Começar com modelo'}
          onConfirm={() => run(confirm)} onCancel={() => setConfirm(null)}>
          {`A etapa ${stage.name} já tem ${stage.summary.steps} ${stage.summary.steps === 1 ? 'passo' : 'passos'}. As perguntas novas entram no fim da lista e nada é apagado. Ex.: se já existe "Para quando é o evento?", confira depois se não ficou repetida.`}
        </ConfirmDialog>
      )}
    </>
  )
}

export interface StageEmptyProps {
  accountId: number; funnelId: number; stage: StageViewStage
  onCadence: (cadence: StageCadence) => void // modelo/IA criaram os passos
  onAddStep: (type: StepType) => void // abre o painel de passo novo
}

export default function StageEmpty({ accountId, funnelId, stage, onCadence, onAddStep }: StageEmptyProps) {
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Esta etapa ainda não tem passos.</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Exemplo: 1º Pergunta "Para quando é o seu evento, {'{nome}'}?" · 2º Mensagem "Segue o catálogo" · 3º Ligação no dia 2.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TemplateButtons accountId={accountId} funnelId={funnelId} stage={stage} onCadence={onCadence} />
        <AddStepMenu onAddStep={onAddStep} />
      </div>
    </div>
  )
}
