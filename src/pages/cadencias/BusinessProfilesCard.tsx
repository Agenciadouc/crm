import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, Plus, Sparkles, X } from 'lucide-react'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import { fetchBusiness, saveBusiness, suggestBusiness, suggestionAction, type RoteiroSuggestion } from '../../lib/roteiroApi'
import { isAiOff, AI_OFF_TEXT, applySuggestionLive } from '../../lib/cadenceApi'
import { suggestionWhy } from '../../lib/roteiroManager.js'
import { labelStyle } from './StepPanel'

const MAX_PROFILES = 6
type ProfileForm = { profile_key?: string; name: string; description: string }

// Negocio e clientes ideais (spec 2026-10-02 §9): objetivo + ate 6 perfis. A IA usa isso para
// montar as perguntas SPIN de cada tipo de cliente e para reconhecer o perfil do lead.
export default function BusinessProfilesCard({ accountId, onSaved, suggestions = [] }: { accountId: number; onSaved?: () => void; suggestions?: RoteiroSuggestion[] }) {
  const [objective, setObjective] = useState('')
  const [profiles, setProfiles] = useState<ProfileForm[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'ia' | null>(null)
  const [saved, setSaved] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stored, setStored] = useState<{ profile_key: string; name: string }[]>([]) // perfis gravados no servidor
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null)

  const load = useCallback((first: boolean) => {
    let alive = true
    fetchBusiness(accountId).then(b => {
      if (!alive) return
      setObjective(b.business_objective || '')
      setProfiles(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name, description: p.description || '' })))
      setStored(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name })))
      if (first) setOpen(!b.profiles.length && !b.business_objective)
      setLoaded(true)
    }).catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'Erro.'); setLoaded(true) } })
    return () => { alive = false }
  }, [accountId])
  useEffect(() => load(true), [load])

  // Perfil novo sugerido pela revisao semanal: [Criar perfil] grava na hora; [Ignorar] recusa.
  const [sugBusy, setSugBusy] = useState<number | null>(null)
  const decide = async (id: number, apply: boolean) => {
    setSugBusy(id); setError(null)
    try {
      if (apply) await applySuggestionLive(id, accountId)
      else await suggestionAction(id, accountId, 'reject')
      load(false)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSugBusy(null)
    }
  }

  const setProfile = (i: number, patch: Partial<ProfileForm>) => { setSaved(false); setProfiles(list => list.map((p, idx) => idx === i ? { ...p, ...patch } : p)) }

  // Perfil gravado que saiu da lista sera apagado e os leads dele ficam sem perfil: confirma antes.
  const askSave = () => {
    const kept = new Set(profiles.filter(p => p.name.trim()).map(p => p.profile_key).filter(Boolean))
    const removed = stored.filter(p => !kept.has(p.profile_key)).map(p => p.name)
    if (removed.length) setConfirmRemove(removed)
    else save()
  }

  const save = async () => {
    setConfirmRemove(null)
    setBusy('save'); setError(null); setSaved(false)
    try {
      const b = await saveBusiness(accountId, {
        business_objective: objective.trim() || null,
        profiles: profiles.filter(p => p.name.trim()).map(p => ({ ...(p.profile_key ? { profile_key: p.profile_key } : {}), name: p.name.trim(), description: p.description.trim() || null })),
      })
      setObjective(b.business_objective || '')
      setProfiles(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name, description: p.description || '' })))
      setStored(b.profiles.map(p => ({ profile_key: p.profile_key, name: p.name })))
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
          Sobre o seu negócio
          <HelpTip title="Sobre o seu negócio" width={340}>Conte o que a empresa vende e quais tipos de cliente compram de você. A IA usa isso para montar as perguntas certas para cada tipo de cliente e para reconhecer o tipo de cada lead pelas mensagens. Ex.: Ustulimp — objetivo "revender produtos de limpeza"; tipos de cliente "Loja" (mercadinho, comércio, compra pra prateleira) e "Vendedor porta a porta" (renda extra, vende de casa em casa).</HelpTip>
        </strong>
        {!open && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 200px' }}>
              {objective || 'Sem objetivo'} · {named.length} {named.length === 1 ? 'tipo de cliente' : 'tipos de cliente'}{named.length ? `: ${named.map(p => p.name).join(', ')}` : ''}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Pencil size={12} /> Editar</button>
          </>
        )}
      </div>

      {suggestions.map(s => (
        <div key={s.id} style={{ border: '1px dashed var(--border-accent)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'grid', gap: 6, fontSize: 13 }}>
          <strong style={{ fontSize: 12, color: 'var(--accent)' }}>A IA sugere um tipo de cliente novo: {String(s.payload.name || '')}{s.payload.description ? ` — ${s.payload.description}` : ''}</strong>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{suggestionWhy(s)}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={sugBusy !== null || busy !== null} onClick={() => decide(s.id, true)}>Criar tipo de cliente</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={sugBusy !== null || busy !== null} onClick={() => decide(s.id, false)}>Ignorar</button>
          </span>
        </div>
      ))}

      {open && (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle} htmlFor="biz-objective">Objetivo do negócio</label>
            <input id="biz-objective" className="input" maxLength={300} value={objective} placeholder="ex.: revender produtos de limpeza"
              onChange={e => { setSaved(false); setObjective(e.target.value) }} />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>
              Tipos de cliente
              <HelpTip title="Tipos de cliente">Cada tipo de cliente que compra de você, com o jeito de reconhecer pelas mensagens. Ex.: "Loja" — tem mercadinho ou comércio, compra pra prateleira. Até 6 tipos.</HelpTip>
            </span>
            {profiles.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum tipo de cliente ainda. Sem tipos, as perguntas valem para todos os leads.</div>}
            {profiles.map((p, i) => (
              <div key={p.profile_key || `novo-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: '1 1 140px', minWidth: 0 }} maxLength={60} value={p.name} placeholder="ex.: Loja"
                  aria-label={`Nome do tipo de cliente ${i + 1}`} onChange={e => setProfile(i, { name: e.target.value })} />
                <input className="input" style={{ flex: '3 1 240px', minWidth: 0 }} maxLength={500} value={p.description} placeholder="Como reconhecer: ex.: tem mercadinho ou comércio, compra pra prateleira"
                  aria-label={`Como reconhecer o tipo de cliente ${i + 1}`} onChange={e => setProfile(i, { description: e.target.value })} />
                <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Tirar tipo de cliente" title="Tirar tipo de cliente"
                  onClick={() => { setSaved(false); setProfiles(list => list.filter((_, idx) => idx !== i)) }}><X size={12} /></button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={profiles.length >= MAX_PROFILES}
                title={profiles.length >= MAX_PROFILES ? 'Máximo de 6 tipos de cliente' : undefined}
                onClick={() => { setSaved(false); setProfiles(list => [...list, { name: '', description: '' }]) }}><Plus size={12} /> Tipo de cliente</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={askSave}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</button>
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
      {confirmRemove && (
        <ConfirmDialog title="Apagar tipos de cliente?" danger confirmLabel="Salvar e apagar" onConfirm={save} onCancel={() => setConfirmRemove(null)}>
          {`Estes tipos de cliente saem da conta: ${confirmRemove.join(', ')}. Os leads que estavam neles ficam sem tipo de cliente até a IA ou o vendedor marcar de novo. Ex.: um lead "Loja" passa a "Ainda não sei".`}
        </ConfirmDialog>
      )}
    </div>
  )
}
