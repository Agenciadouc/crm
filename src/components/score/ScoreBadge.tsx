import { ArrowUp, ArrowDown } from 'lucide-react'
import { BAND_META, isScoreBand, type ScoreBand } from '../../lib/score'

// Selo do termometro (ex.: [chama] 72 com seta): cor da faixa; seta compara com a nota anterior
interface Props {
  score: number | null | undefined
  band?: ScoreBand | string | null
  prev?: number | null
  size?: 'sm' | 'md'
}

const bandOf = (score: number): ScoreBand => (score >= 86 ? 'pronto' : score >= 61 ? 'quente' : score >= 31 ? 'morno' : 'frio')

export default function ScoreBadge({ score, band, prev, size = 'sm' }: Props) {
  const fs = size === 'md' ? 13 : 11
  const icon = size === 'md' ? 13 : 11
  if (score == null) {
    return (
      <span title="Ainda sem termômetro" style={{ fontSize: fs, color: 'var(--text-subtle)', fontWeight: 600, whiteSpace: 'nowrap' }}>—</span>
    )
  }
  const b = isScoreBand(band) ? band : bandOf(score)
  const meta = BAND_META[b]
  const Icon = meta.icon
  const up = prev != null && score > prev
  const down = prev != null && score < prev
  return (
    <span
      title={`Termômetro ${score} — ${meta.label}. Abra o lead para ver o porquê.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', flexShrink: 0,
        fontSize: fs, fontWeight: 700, color: meta.color, background: `${meta.color}1F`,
        padding: size === 'md' ? '2px 8px' : '1px 6px', borderRadius: 10, fontVariantNumeric: 'tabular-nums', lineHeight: 1.4,
      }}
    >
      <Icon size={icon} aria-hidden />
      {score}
      {up && <ArrowUp size={icon - 1} aria-label="subiu" />}
      {down && <ArrowDown size={icon - 1} aria-label="caiu" />}
    </span>
  )
}
