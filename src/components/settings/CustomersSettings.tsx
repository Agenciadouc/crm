import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Gem, RotateCcw, Plus, Pencil, Trash2, Check, X, ChevronUp, ChevronDown } from 'lucide-react'
import HelpTip from '../HelpTip'
import { InlineNotice, useInlineNotice } from '../InlineNotice'
import { SaveStatusText, labelStyle, hintStyle } from '../../pages/cadencias/StepPanel'
import { createSaveQueue, type SaveStatus } from '../../lib/stageCadence.js'
import {
  fetchCustomerSettings, saveCustomerSettings, type CustomerSettings,
  fetchTiers, createTier, updateTier, deleteTier, type CustomerTier,
  fetchReasons, createReason, updateReason, type RepurchaseReason,
  formatBRL,
} from '../../lib/api'

interface Props { accountId: number }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Erro ao salvar.')

type CurveForm = { a: string; b: string; c: string }
function curvePatch(f: CurveForm): { ok: true; curve: { a: number; b: number; c: number } } | { ok: false; reason: string } {
  const a = Number(f.a), b = Number(f.b), c = Number(f.c)
  if (![a, b, c].every(n => Number.isInteger(n) && n >= 1 && n <= 365)) return { ok: false, reason: 'Use dias inteiros entre 1 e 365.' }
  if (!(a < b && b < c)) return { ok: false, reason: 'A precisa ser menor que B, e B menor que C.' }
  return { ok: true, curve: { a, b, c } }
}
function attemptsPatch(v: string): { ok: true; maxAttempts: number } | { ok: false; reason: string } {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 20) return { ok: false, reason: 'Tentativas: de 1 a 20.' }
  return { ok: true, maxAttempts: n }
}

const GROUPS: { key: 'nao_agora' | 'nao_quer'; label: string }[] = [
  { key: 'nao_agora', label: 'Motivos — Não comprou agora' },
  { key: 'nao_quer', label: 'Motivos — Não quer mais comprar' },
]

const EMPTY_TIER = { id: null as number | null, icon: '', name: '', color: '#7E57C2', min_ltv: '' }

// Configuracoes "Clientes" (spec LTV/Recompra §10.1): curva por ritmo, selos de valor e recompra
// (limite de tentativas + lembretes automaticos + motivos). So gestor/admin ve esta tela (gate no Settings.tsx).
export default function CustomersSettings({ accountId }: Props) {
  const accountIdRef = useRef(accountId)
  accountIdRef.current = accountId

  // ---------- Curva por ritmo ----------
  const [settings, setSettings] = useState<CustomerSettings | null>(null)
  const [curveForm, setCurveForm] = useState<CurveForm>({ a: '30', b: '45', c: '60' })
  const [curveHint, setCurveHint] = useState<string | null>(null)
  const [curveStatus, setCurveStatus] = useState<SaveStatus>('idle')
  const [curveError, setCurveError] = useState<string | null>(null)

  // ---------- Recompra: limite de tentativas + automatico ----------
  const [attemptsForm, setAttemptsForm] = useState('5')
  const [autoSend, setAutoSend] = useState(false)
  const [recompraHint, setRecompraHint] = useState<string | null>(null)
  const [recompraStatus, setRecompraStatus] = useState<SaveStatus>('idle')
  const [recompraError, setRecompraError] = useState<string | null>(null)

  const [curveQueue] = useState(() => createSaveQueue<{ curve: { a: number; b: number; c: number } }>({
    onStatus: setCurveStatus,
    save: async patch => {
      setCurveError(null)
      try { setSettings(await saveCustomerSettings(accountIdRef.current, patch)) }
      catch (e) { setCurveError(errMsg(e)); throw e }
    },
  }))
  const [recompraQueue] = useState(() => createSaveQueue<{ maxAttempts: number; autoSend: boolean }>({
    onStatus: setRecompraStatus,
    save: async patch => {
      setRecompraError(null)
      try { setSettings(await saveCustomerSettings(accountIdRef.current, patch)) }
      catch (e) { setRecompraError(errMsg(e)); throw e }
    },
  }))
  useEffect(() => () => { curveQueue.flush(); recompraQueue.flush() }, [curveQueue, recompraQueue])

  useEffect(() => {
    fetchCustomerSettings(accountId).then(s => {
      setSettings(s)
      setCurveForm({ a: String(s.curve.a), b: String(s.curve.b), c: String(s.curve.c) })
      setAttemptsForm(String(s.maxAttempts))
      setAutoSend(s.autoSend)
    }).catch(() => {})
  }, [accountId])

  const changeCurve = (patch: Partial<CurveForm>) => {
    const next = { ...curveForm, ...patch }
    setCurveForm(next)
    const r = curvePatch(next)
    if (!r.ok) { setCurveHint(r.reason); return }
    setCurveHint(null)
    curveQueue.push({ curve: r.curve })
  }
  const changeAttempts = (v: string) => {
    setAttemptsForm(v)
    const r = attemptsPatch(v)
    if (!r.ok) { setRecompraHint(r.reason); return }
    setRecompraHint(null)
    recompraQueue.push({ maxAttempts: r.maxAttempts, autoSend })
  }
  const changeAutoSend = (checked: boolean) => {
    setAutoSend(checked)
    setRecompraHint(null)
    const r = attemptsPatch(attemptsForm)
    recompraQueue.push({ maxAttempts: r.ok ? r.maxAttempts : (settings?.maxAttempts ?? 5), autoSend: checked })
  }

  // ---------- Selos de valor ----------
  const [tiers, setTiers] = useState<CustomerTier[]>([])
  const tiersNotice = useInlineNotice()
  const [tierForm, setTierForm] = useState(EMPTY_TIER)
  const [tierFormOpen, setTierFormOpen] = useState(false)
  const [savingTier, setSavingTier] = useState(false)

  const loadTiers = useCallback(() => { fetchTiers(accountId).then(setTiers).catch(() => {}) }, [accountId])
  useEffect(() => { loadTiers() }, [loadTiers])

  const startNewTier = () => { setTierForm(EMPTY_TIER); setTierFormOpen(true); tiersNotice.clear() }
  const startEditTier = (t: CustomerTier) => { setTierForm({ id: t.id, icon: t.icon || '', name: t.name, color: t.color, min_ltv: String(t.min_ltv) }); setTierFormOpen(true); tiersNotice.clear() }

  const saveTierForm = async () => {
    const name = tierForm.name.trim()
    const min = Number(tierForm.min_ltv)
    if (!name) { tiersNotice.showError('Dê um nome ao selo'); return }
    if (!Number.isFinite(min) || min <= 0) { tiersNotice.showError('Informe o valor mínimo gasto'); return }
    setSavingTier(true)
    try {
      const body = { name, icon: tierForm.icon.trim() || null, color: tierForm.color, min_ltv: min }
      if (tierForm.id != null) await updateTier(accountId, tierForm.id, body)
      else await createTier(accountId, body)
      setTierFormOpen(false)
      loadTiers()
    } catch (e) { tiersNotice.showError('Erro ao salvar selo', e) }
    setSavingTier(false)
  }
  const removeTier = async (t: CustomerTier) => {
    if (!confirm(`Apagar o selo "${t.name}"? Os clientes com este selo ficam sem selo (o LTV continua igual).`)) return
    try { await deleteTier(accountId, t.id); loadTiers() } catch (e) { tiersNotice.showError('Erro ao apagar selo', e) }
  }

  // ---------- Motivos de recompra ----------
  const [reasons, setReasons] = useState<RepurchaseReason[]>([])
  const reasonsNotice = useInlineNotice()
  const [newReasonLabel, setNewReasonLabel] = useState<Record<'nao_agora' | 'nao_quer', string>>({ nao_agora: '', nao_quer: '' })
  const [editingReasonId, setEditingReasonId] = useState<number | null>(null)
  const [editReasonLabel, setEditReasonLabel] = useState('')

  const loadReasons = useCallback(() => { fetchReasons(accountId).then(setReasons).catch(() => {}) }, [accountId])
  useEffect(() => { loadReasons() }, [loadReasons])

  const addReason = async (grp: 'nao_agora' | 'nao_quer') => {
    const label = newReasonLabel[grp].trim()
    if (!label) return
    try {
      await createReason(accountId, { grp, label })
      setNewReasonLabel(m => ({ ...m, [grp]: '' }))
      loadReasons()
    } catch (e) { reasonsNotice.showError('Erro ao criar motivo', e) }
  }
  const startEditReason = (r: RepurchaseReason) => { setEditingReasonId(r.id); setEditReasonLabel(r.label) }
  const saveEditReason = async () => {
    const label = editReasonLabel.trim()
    if (!label || editingReasonId == null) { setEditingReasonId(null); return }
    try { await updateReason(accountId, editingReasonId, { label }); setEditingReasonId(null); loadReasons() }
    catch (e) { reasonsNotice.showError('Erro ao renomear motivo', e) }
  }
  const toggleReasonActive = async (r: RepurchaseReason) => {
    try { await updateReason(accountId, r.id, { is_active: !r.is_active }); loadReasons() }
    catch (e) { reasonsNotice.showError('Erro ao mudar motivo', e) }
  }
  const moveReason = async (r: RepurchaseReason, dir: -1 | 1) => {
    const group = reasons.filter(x => x.grp === r.grp).sort((a, b) => a.position - b.position)
    const i = group.findIndex(x => x.id === r.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= group.length) return
    const other = group[j]
    try {
      await Promise.all([
        updateReason(accountId, r.id, { position: other.position }),
        updateReason(accountId, other.id, { position: r.position }),
      ])
      loadReasons()
    } catch (e) { reasonsNotice.showError('Erro ao reordenar', e) }
  }

  const autoReasonText = settings?.autoAvailable.reason === 'no_ai'
    ? 'Ligue a IA da conta'
    : 'Conecte um número de disparo (UzAPI ou Oficial)'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Curva por ritmo */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Activity size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Curva por ritmo</h3>
          <HelpTip title="Curva por ritmo" width={320}>
            Define o ritmo de recompra de cada cliente com base no intervalo entre compras. Ex.: cliente que compra a cada 20 dias é A; se parar por 50 dias, vira C até comprar de novo.
          </HelpTip>
          <span style={{ marginLeft: 'auto' }}>
            {curveHint ? <span style={{ fontSize: 12, color: 'var(--warning)' }}>Não salvo</span> : <SaveStatusText status={curveStatus} error={curveError} onRetry={() => curveQueue.retry()} />}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
          <span style={labelStyle}>A até</span>
          <input className="input" type="number" min={1} max={365} style={{ width: 68 }} value={curveForm.a} onChange={e => changeCurve({ a: e.target.value })} />
          <span style={labelStyle}>dias · B até</span>
          <input className="input" type="number" min={1} max={365} style={{ width: 68 }} value={curveForm.b} onChange={e => changeCurve({ b: e.target.value })} />
          <span style={labelStyle}>dias · C até</span>
          <input className="input" type="number" min={1} max={365} style={{ width: 68 }} value={curveForm.c} onChange={e => changeCurve({ c: e.target.value })} />
          <span style={labelStyle}>dias · acima = D</span>
        </div>
        {curveHint && <div style={hintStyle}>{curveHint}</div>}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
          Cliente que compra a cada 20 dias = A. Se parar por 50 dias, vira C até comprar de novo.
        </p>
      </div>

      {/* Selos de valor */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Gem size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Selos de valor</h3>
          <HelpTip title="Selos de valor" width={300}>
            Selos destacam quem mais compra. Cada cliente ganha o selo de maior valor mínimo que o LTV dele alcança.
          </HelpTip>
          {!tierFormOpen && (
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={startNewTier}><Plus size={12} /> Novo selo</button>
          )}
        </div>
        <InlineNotice notice={tiersNotice.notice} onClose={tiersNotice.clear} />

        {tiers.length === 0 && !tierFormOpen && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Crie selos como 💎 Diamante (a partir de R$ 5.000) para destacar quem mais compra.
          </p>
        )}

        {tiers.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: tierFormOpen ? 12 : 0 }}>
            {[...tiers].sort((a, b) => b.min_ltv - a.min_ltv).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: `${t.color}25`, color: t.color, borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
                  {t.icon ? `${t.icon} ` : ''}{t.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>a partir de {formatBRL(t.min_ltv)}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Editar selo" title="Editar" onClick={() => startEditTier(t)}><Pencil size={12} /></button>
                  <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Apagar selo" title="Apagar" style={{ color: 'var(--negative)' }} onClick={() => removeTier(t)}><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        {tierFormOpen && (
          <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px dashed var(--border-accent)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <label style={labelStyle} htmlFor="tier-icon">Ícone</label>
                <input id="tier-icon" className="input" style={{ width: 60, textAlign: 'center' }} maxLength={8} placeholder="💎" value={tierForm.icon} onChange={e => setTierForm(f => ({ ...f, icon: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 140 }}>
                <label style={labelStyle} htmlFor="tier-name">Nome</label>
                <input id="tier-name" className="input" placeholder="ex.: Diamante" value={tierForm.name} onChange={e => setTierForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <label style={labelStyle} htmlFor="tier-color">Cor</label>
                <input id="tier-color" type="color" value={tierForm.color} onChange={e => setTierForm(f => ({ ...f, color: e.target.value }))} style={{ width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'transparent' }} />
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <label style={labelStyle} htmlFor="tier-min">A partir de R$</label>
                <input id="tier-min" className="input" type="number" min={0.01} step="0.01" style={{ width: 120 }} placeholder="5000" value={tierForm.min_ltv} onChange={e => setTierForm(f => ({ ...f, min_ltv: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingTier} onClick={saveTierForm}>{savingTier ? 'Salvando...' : <><Check size={12} /> Salvar</>}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTierFormOpen(false)}><X size={12} /> Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Recompra */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <RotateCcw size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Recompra</h3>
          <span style={{ marginLeft: 'auto' }}>
            {recompraHint ? <span style={{ fontSize: 12, color: 'var(--warning)' }}>Não salvo</span> : <SaveStatusText status={recompraStatus} error={recompraError} onRetry={() => recompraQueue.retry()} />}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="max-attempts">Limite de tentativas</label>
          <input id="max-attempts" className="input" type="number" min={1} max={20} style={{ width: 68 }} value={attemptsForm} onChange={e => changeAttempts(e.target.value)} />
          <HelpTip title="Limite de tentativas">Depois de esgotar as tentativas sem resposta, o ciclo de recompra deste cliente encerra sozinho.</HelpTip>
        </div>
        {recompraHint && <div style={{ ...hintStyle, marginBottom: 12 }}>{recompraHint}</div>}

        <div className="form-group" style={{ marginBottom: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: settings?.autoAvailable.ok ? 'pointer' : 'not-allowed', opacity: settings?.autoAvailable.ok ? 1 : 0.6 }}>
            <input type="checkbox" checked={autoSend} disabled={!settings?.autoAvailable.ok} onChange={e => changeAutoSend(e.target.checked)} />
            <span>Lembretes automáticos</span>
          </label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6, marginBottom: 0 }}>
            Com a chave ligada, a IA escreve e envia a mensagem de recompra sozinha, sem esperar o vendedor. As regras contra bloqueio (rodapé de saída, horário de atendimento, limite de envios) continuam valendo.
          </p>
          {settings && !settings.autoAvailable.ok && (
            <div style={{ ...hintStyle, marginTop: 6 }}>{autoReasonText} para usar lembretes automáticos.</div>
          )}
        </div>

        <InlineNotice notice={reasonsNotice.notice} onClose={reasonsNotice.clear} style={{ marginTop: 12 }} />

        <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
          {GROUPS.map(g => {
            const list = reasons.filter(r => r.grp === g.key).sort((a, b) => a.position - b.position)
            return (
              <div key={g.key}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{g.label}</div>
                {list.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>Nenhum motivo cadastrado ainda.</p>}
                <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                  {list.map((r, idx) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, background: r.is_active ? 'transparent' : 'rgba(255,255,255,0.03)', opacity: r.is_active ? 1 : 0.55 }}>
                      {editingReasonId === r.id ? (
                        <>
                          <input className="input" style={{ flex: 1 }} autoFocus value={editReasonLabel} onChange={e => setEditReasonLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEditReason()} />
                          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Salvar motivo" title="Salvar" onClick={saveEditReason}><Check size={12} /></button>
                          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Cancelar" title="Cancelar" onClick={() => setEditingReasonId(null)}><X size={12} /></button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13, textDecoration: r.is_active ? 'none' : 'line-through' }}>{r.label}</span>
                          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Mover para cima" title="Mover para cima" disabled={idx === 0} onClick={() => moveReason(r, -1)}><ChevronUp size={12} /></button>
                          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Mover para baixo" title="Mover para baixo" disabled={idx === list.length - 1} onClick={() => moveReason(r, 1)}><ChevronDown size={12} /></button>
                          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Renomear" title="Renomear" onClick={() => startEditReason(r)}><Pencil size={12} /></button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleReasonActive(r)}>{r.is_active ? 'Desativar' : 'Ativar'}</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Novo motivo" value={newReasonLabel[g.key]}
                    onChange={e => setNewReasonLabel(m => ({ ...m, [g.key]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addReason(g.key)} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addReason(g.key)}><Plus size={12} /> Motivo</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
