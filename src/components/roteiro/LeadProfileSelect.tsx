import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import HelpTip from '../HelpTip'
import { useSSE } from '../../context/SSEContext'
import { fetchLeadProfile, saveLeadProfile, type LeadProfileView } from '../../lib/roteiroApi'

// Perfil de cliente ideal do lead (spec 2026-10-02 §6, §9): a IA identifica pelas mensagens,
// o vendedor confere e troca. Some quando a conta nao cadastrou perfis.
export default function LeadProfileSelect({ leadId, accountId, style }: { leadId: number; accountId: number; style?: CSSProperties }) {
  const [view, setView] = useState<LeadProfileView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchLeadProfile(leadId, accountId).then(setView).catch(() => setView(null))
  }, [leadId, accountId])
  useEffect(() => { load() }, [load])
  // IA marcou o perfil ou outra tela trocou: recarrega
  useSSE('lead:cadence', useCallback((d: any) => { if (Number(d?.lead_id) === leadId) load() }, [leadId, load]))

  if (!view || !view.profiles.length) return null

  const change = async (key: string) => {
    setBusy(true); setError(null)
    try { setView(await saveLeadProfile(leadId, accountId, key || null)) } catch (e) { setError(e instanceof Error ? e.message : 'Erro.') } finally { setBusy(false) }
  }
  const only = !view.profile_key && view.effective_key ? view.profiles.find(p => p.profile_key === view.effective_key) : null
  const id = `lead-profile-${leadId}`

  return (
    <div style={{ display: 'grid', gap: 4, ...style }}>
      <label htmlFor={id} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        Tipo de cliente
        {view.origin === 'ia' && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· identificado pela IA</span>}
        {view.origin === 'herdado' && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }} title="A conta tinha só este tipo de cliente quando o lead chegou. Confira e troque se precisar.">· era o único tipo</span>}
        <HelpTip title="Tipo de cliente">Que tipo de cliente ele é. As perguntas mudam conforme o tipo. Ex.: quem diz "tenho um mercadinho" é Loja. A IA marca sozinha pelas mensagens; se errar, troque aqui.</HelpTip>
      </label>
      <select id={id} className="select" style={{ width: '100%' }} disabled={busy} value={view.profile_key || ''} onChange={e => change(e.target.value)}>
        <option value="">{only ? `${only.name} (único tipo)` : 'Ainda não sei'}</option>
        {view.profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.name}</option>)}
      </select>
      {error && <div role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</div>}
    </div>
  )
}
