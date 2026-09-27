import { Snowflake, CloudSun, Flame, Rocket, type LucideIcon } from 'lucide-react'
import { parseSqlDate } from './dates'

// Termometro do lead (spec 5.1): faixas, cores e acao da matriz
export type ScoreBand = 'frio' | 'morno' | 'quente' | 'pronto'
export type ScoreQuadrant = 'atender_agora' | 'reaquecer' | 'qualificar' | 'baixa'

export const SCORE_BANDS: ScoreBand[] = ['frio', 'morno', 'quente', 'pronto']

export const BAND_META: Record<ScoreBand, { label: string; icon: LucideIcon; color: string; range: string }> = {
  frio: { label: 'Frio', icon: Snowflake, color: '#5DADE2', range: '0–30' },
  morno: { label: 'Morno', icon: CloudSun, color: '#FBBC04', range: '31–60' },
  quente: { label: 'Quente', icon: Flame, color: '#FF7A45', range: '61–85' },
  pronto: { label: 'Pronto p/ fechar', icon: Rocket, color: '#34C759', range: '86–100' },
}

export const QUADRANT_META: Record<ScoreQuadrant, string> = {
  atender_agora: 'Atender agora — tem perfil e está conversando',
  reaquecer: 'Reaquecer — tem perfil, mas esfriou',
  qualificar: 'Qualificar melhor — conversa bastante, perfil ainda fraco',
  baixa: 'Baixa prioridade — pouco perfil e pouca conversa',
}

// Explicacao do termometro com exemplo (HelpTip do painel do lead e da coluna em Leads)
export const SCORE_HELP_TEXT = 'A nota soma Perfil (respostas do roteiro), Engajamento (como o cliente está respondendo) e um ajuste da IA. Ex.: orçamento acima de R$20 mil (+30) e respondeu hoje (+20) = 50, Morno. Se ele responder rápido e avançar de etapa, vira Quente.'

export const isScoreBand = (b: unknown): b is ScoreBand => typeof b === 'string' && (SCORE_BANDS as string[]).includes(b)

// "agora", "há 5 min", "há 2 h", "há 3 dias"
export function scoreAgo(at: string | null | undefined, now = Date.now()): string {
  const t = parseSqlDate(at).getTime()
  if (isNaN(t)) return ''
  const m = Math.max(0, Math.floor((now - t) / 60000))
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}
