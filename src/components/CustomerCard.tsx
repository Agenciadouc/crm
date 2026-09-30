import { useCallback, useEffect, useRef, useState } from 'react'
import { Award, RotateCcw, Ban, ShoppingBag } from 'lucide-react'
import { fetchCustomerCard, undoRepurchaseOptOut, formatBRL, type CustomerCardData } from '../lib/api'
import { useSSE } from '../context/SSEContext'
import { PANEL_CARD, PanelTitle, LinkButton } from './atendimento/PanelParts'
import SaleModal from './SaleModal'
import OutcomeModal from './OutcomeModal'

interface Props {
  leadId: number
  accountId: number
  leadName?: string | null
  // Chat: abre a janela "Conferir mensagem" com o texto da oferta/sugestao da IA (caminho manual)
  onOpenReview?: (text: string) => void
}

// Bloco "Cliente" do painel do lead (Chat e ficha) — spec LTV/Recompra §10: LTV, curva, selo,
// status do ciclo de recompra aberto e acoes rapidas (Comprou de novo / Nao comprou agora / Nao quer mais).
// Nao renderiza nada se o lead nunca comprou (purchases === 0).
export default function CustomerCard({ leadId, accountId, leadName, onOpenReview }: Props) {
  const [data, setData] = useState<CustomerCardData | null>(null)
  const [saleOpen, setSaleOpen] = useState(false)
  const [outcome, setOutcome] = useState<'nao_agora' | 'nao_quer' | null>(null)
  const [undoing, setUndoing] = useState(false)
  // Lead aberto agora: resposta atrasada de outro lead e descartada
  const leadRef = useRef(leadId)
  leadRef.current = leadId

  const load = useCallback(() => {
    fetchCustomerCard(leadId, accountId)
      .then(d => { if (leadRef.current === leadId) setData(d) })
      .catch(() => {})
  }, [leadId, accountId])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSaleOpen(false); setOutcome(null) }, [leadId])

  useSSE('customers:updated', useCallback((d: any) => {
    if (d?.lead_id == null || Number(d.lead_id) === leadId) load()
  }, [leadId, load]))
  useSSE('lead:updated', useCallback((d: any) => {
    if (d?.bulk || Number(d?.id ?? d?.lead_id) === leadId) load()
  }, [leadId, load]))

  if (!data || data.purchases === 0) return null

  const daysSince = data.lastPurchaseAt != null
    ? Math.round((Date.now() - Date.parse(data.lastPurchaseAt + 'T12:00:00Z')) / 86400000)
    : null
  const curveLabel = data.curve === '1a' ? '1ª compra' : data.curve ? `Curva ${data.curve}` : null

  const line: string[] = []
  if (data.tier) line.push(`${data.tier.icon ? `${data.tier.icon} ` : ''}${data.tier.name}`)
  if (curveLabel) line.push(curveLabel)
  line.push(`LTV ${formatBRL(data.ltv)}`)
  line.push(`${data.purchases} ${data.purchases === 1 ? 'compra' : 'compras'}`)
  if (daysSince != null) line.push(`última há ${daysSince} ${daysSince === 1 ? 'dia' : 'dias'}`)

  const cycle = data.cycle
  const cycleLine = (() => {
    if (!cycle) return null
    if (cycle.status === 'aguardando') {
      if (cycle.exhausted) return 'Tentativas esgotadas'
      const days = Math.round((Date.parse(cycle.remind_at + 'T12:00:00Z') - Date.now()) / 86400000)
      const dateStr = new Date(cycle.remind_at + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      return `Próxima recompra em ${days} dias (${dateStr})`
    }
    if (cycle.status === 'a_contatar') return `A contatar — tentativa ${cycle.attempt} de ${data.maxAttempts}`
    if (cycle.status === 'em_conversa') return `Em conversa — tentativa ${cycle.attempt} de ${data.maxAttempts}`
    return null
  })()

  const offerText = cycle?.ai_suggestion?.message || cycle?.offer_text || null

  const handleUndo = async () => {
    setUndoing(true)
    try { await undoRepurchaseOptOut(leadId, accountId); load() } catch {} finally { setUndoing(false) }
  }

  return (
    <div className="card" style={PANEL_CARD}>
      <PanelTitle
        icon={<Award size={10} style={{ color: '#7E57C2' }} />}
        label="Cliente"
        help={<>Histórico de compras deste cliente: quanto já gastou (LTV), a faixa de recência (curva), o selo e o ciclo de recompra em andamento. Ex.: "Ouro · Curva A · LTV R$ 3.200 · 4 compras".</>}
      />

      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{line.join(' · ')}</div>

      {data.optOut ? (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Ban size={11} /> Não quer mais <LinkButton onClick={handleUndo} disabled={undoing}>{undoing ? 'Desfazendo...' : 'Desfazer'}</LinkButton>
        </div>
      ) : cycleLine && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>{cycleLine}</div>
      )}

      {offerText && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>O que oferecer: {offerText}</div>
          {onOpenReview && (
            <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => onOpenReview(offerText)}>
              Revisar e enviar
            </button>
          )}
        </div>
      )}

      {cycle && !data.optOut && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setSaleOpen(true)}>
            <ShoppingBag size={10} /> Comprou de novo
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOutcome('nao_agora')}>
            <RotateCcw size={10} /> Não comprou agora
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOutcome('nao_quer')}>
            <Ban size={10} /> Não quer mais
          </button>
        </div>
      )}

      {saleOpen && (
        <SaleModal
          open
          leadId={leadId}
          accountId={accountId}
          leadName={leadName}
          defaultDays={cycle?.remind_days ?? 30}
          onClose={() => setSaleOpen(false)}
          onSaved={() => load()}
        />
      )}
      {outcome && (
        <OutcomeModal
          open
          outcome={outcome}
          leadId={leadId}
          accountId={accountId}
          leadName={leadName}
          reasons={data.reasons[outcome] || []}
          defaultDays={cycle?.remind_days ?? 30}
          onClose={() => setOutcome(null)}
          onDone={() => load()}
        />
      )}
    </div>
  )
}
