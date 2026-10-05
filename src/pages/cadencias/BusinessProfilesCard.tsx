import { useEffect, useState } from 'react'
import { Check, Pencil, Plus, Sparkles, X } from 'lucide-react'
import HelpTip from '../../components/HelpTip'
import { fetchBusiness, saveBusiness, suggestBusiness } from '../../lib/roteiroApi'
import { isAiOff, AI_OFF_TEXT } from '../../lib/cadenceApi'
import { labelStyle } from './StepPanel'

const MAX_PROFILES = 6
type ProfileForm = { profile_key?: string; name: string; description: string }

// Negocio e clientes ideais (spec 2026-10-02 §9): objetivo + ate 6 perfis. A IA usa isso para
// montar as perguntas SPIN de cada tipo de cliente e para reconhecer o perfil do lead.
export default function BusinessProfilesCard({ accountId, onSaved }: { accountId: number; onSaved?: () => void }) {
  const [objective, setObjective] = useState('')
  const [profiles, setProfiles] = useState<ProfileForm[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'ia' | null>(null)
  const [saved, setSaved] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchBusiness(accountId).then(b => {
      if (!alive) return
      setObjective(b.business_objective || '')
      setProfiles(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name, description: p.description || '' })))
      setOpen(!b.profiles.length && !b.business_objective)
      setLoaded(true)
    }).catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'Erro.'); setLoaded(true) } })
    return () => { alive = false }
  }, [accountId])

  const setProfile = (i: number, patch: Partial<ProfileForm>) => { setSaved(false); setProfiles(list => list.map((p, idx) => idx === i ? { ...p, ...patch } : p)) }

  const save = async () => {
    setBusy('save'); setError(null); setSaved(false)
    try {
      const b = await saveBusiness(accountId, {
        business_objective: objective.trim() || null,
        profiles: profiles.filter(p => p.name.trim()).map(p => ({ ...(p.profile_key ? { profile_key: p.profile_key } : {}), name: p.name.trim(), description: p.description.trim() || null })),
      })
      setObjective(b.business_objective || '')
      setProfiles(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name, description: p.description || '' })))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setBusy(null)
    }
  }

  // Preenche o formulario; so grava quando o gestor clicar em Salvar. Perfis com o mesmo nome
  // mantem a chave (as perguntas desse perfil continuam ligadas a ele).
  const suggest = async () => {
    setBusy('ia'); setError(null); setSaved(false)
    try {
      const s = await suggestBusiness(accountId)
      if (s.business_objective) setObjective(s.business_objective)
      setProfiles(prev => {
        const byName = new Map(prev.map(p => [p.name.trim().toLowerCase(), p.profile_key]))
        return s.profiles.map(p => ({ profile_key: byName.get(p.name.trim().toLowerCase()), name: p.name, description: p.description }))
      })
    } catch (e) {
      if (isAiOff(e)) setAiOff(true)
      else setError(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setBusy(null)
    }
  }

  if (!loaded) return null
  const named = profiles.filter(p => p.name.trim())

  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Negócio e clientes ideais
          <HelpTip title="Negócio e clientes ideais" width={340}>Conte o que a empresa vende e quem são os clientes ideais. A IA usa isso para montar as perguntas certas para cada tipo de cliente e para reconhecer o perfil de cada lead pelas mensagens. Ex.: Ustulimp — objetivo "revender produtos de limpeza"; perfis "Loja" (mercadinho, comércio, compra pra prateleira) e "Vendedor porta a porta" (renda extra, vende de casa em casa).</HelpTip>
        </strong>
        {!open && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 200px' }}>
              {objective || 'Sem objetivo'} · {named.length} {named.length === 1 ? 'perfil' : 'perfis'}{named.length ? `: ${named.map(p => p.name).join(', ')}` : ''}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Pencil size={12} /> Editar</button>
          </>
        )}
      </div>

      {open && (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle} htmlFor="biz-objective">Objetivo do negócio</label>
            <input id="biz-objective" className="input" maxLength={300} value={objective} placeholder="ex.: revender produtos de limpeza"
              onChange={e => { setSaved(false); setObjective(e.target.value) }} />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>
              Perfis de cliente ideal
              <HelpTip title="Perfis de cliente ideal">Cada tipo de cliente que compra de você, com o jeito de reconhecer pelas mensagens. Ex.: "Loja" — tem mercadinho ou comércio, compra pra prateleira. Até 6 perfis.</HelpTip>
            </span>
            {profiles.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum perfil ainda. Sem perfis, as perguntas valem para todos os leads.</div>}
            {profiles.map((p, i) => (
              <div key={p.profile_key || `novo-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: '1 1 140px', minWidth: 0 }} maxLength={60} value={p.name} placeholder="ex.: Loja"
                  aria-label={`Nome do perfil ${i + 1}`} onChange={e => setProfile(i, { name: e.target.value })} />
                <input className="input" style={{ flex: '3 1 240px', minWidth: 0 }} maxLength={500} value={p.description} placeholder="Como reconhecer: ex.: tem mercadinho ou comércio, compra pra prateleira"
                  aria-label={`Como reconhecer o perfil ${i + 1}`} onChange={e => setProfile(i, { description: e.target.value })} />
                <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Tirar perfil" title="Tirar perfil"
                  onClick={() => { setSaved(false); setProfiles(list => list.filter((_, idx) => idx !== i)) }}><X size={12} /></button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={profiles.length >= MAX_PROFILES}
                title={profiles.length >= MAX_PROFILES ? 'Máximo de 6 perfis' : undefined}
                onClick={() => { setSaved(false); setProfiles(list => [...list, { name: '', description: '' }]) }}><Plus size={12} /> Perfil</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={save}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || aiOff} title={aiOff ? AI_OFF_TEXT : 'A IA lê as conversas da conta e propõe. Nada é salvo até você clicar em Salvar.'} onClick={suggest}>
              <Sparkles size={12} /> {busy === 'ia' ? 'A IA está lendo as conversas…' : 'Sugerir com IA'}
            </button>
            {named.length > 0 && <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => setOpen(false)}>Fechar</button>}
            {saved && <span style={{ fontSize: 12, color: 'var(--positive)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={12} /> Salvo</span>}
          </div>
          {aiOff && <div style={{ fontSize: 12, color: 'var(--warning)' }}>{AI_OFF_TEXT}</div>}
        </>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</div>}
    </div>
  )
}
