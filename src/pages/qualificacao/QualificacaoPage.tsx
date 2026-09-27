import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, ListChecks, BarChart3, Lightbulb } from 'lucide-react'
import { useAccount } from '../../context/AccountContext'
import { fetchFunnels, type Funnel } from '../../lib/api'
import { parseTab, type QualificacaoTab } from '../../lib/roteiroManager.js'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import RoteiroEditor from './RoteiroEditor'
import DesempenhoTab from './DesempenhoTab'
import SugestoesTab from './SugestoesTab'

// Tela do gestor "Qualificacao" (spec 3): roteiro por funil, desempenho das perguntas e sugestoes/testes A/B.
// A aba fica em ?tab= para o link abrir direto na aba certa.
const TABS: { key: QualificacaoTab; label: string; icon: typeof ListChecks }[] = [
  { key: 'roteiro', label: 'Roteiro', icon: ListChecks },
  { key: 'desempenho', label: 'Desempenho', icon: BarChart3 },
  { key: 'sugestoes', label: 'Sugestões e testes', icon: Lightbulb },
]

type Pending = { kind: 'tab'; tab: QualificacaoTab } | { kind: 'funnel'; funnelId: number }

export default function QualificacaoPage() {
  const { accountId } = useAccount()
  const location = useLocation()
  const navigate = useNavigate()
  const tab = parseTab(location.search)

  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  // Editor com mudancas nao salvas: trocar de aba/funil pede confirmacao
  const [editorDirty, setEditorDirty] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    if (!accountId) return
    let alive = true
    setLoading(true); setLoadError(''); setFunnels([]); setFunnelId(null); setEditorDirty(false)
    fetchFunnels(accountId)
      .then(list => {
        if (!alive) return
        const active = list.filter(f => f.is_active !== 0)
        setFunnels(active)
        const def = active.find(f => f.is_default) || active[0]
        setFunnelId(def ? def.id : null)
      })
      .catch(e => { if (alive) setLoadError(e?.message || 'Não foi possível carregar os funis.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [accountId])

  const goTab = (t: QualificacaoTab) => {
    const params = new URLSearchParams(location.search)
    params.set('tab', t)
    navigate({ search: `?${params.toString()}` }, { replace: true })
  }

  const requestTab = (t: QualificacaoTab) => {
    if (t === tab) return
    if (tab === 'roteiro' && editorDirty) { setPending({ kind: 'tab', tab: t }); return }
    goTab(t)
  }

  const requestFunnel = (id: number) => {
    if (id === funnelId) return
    if (tab === 'roteiro' && editorDirty) { setPending({ kind: 'funnel', funnelId: id }); return }
    setFunnelId(id)
  }

  const confirmLeave = () => {
    if (!pending) return
    setEditorDirty(false)
    if (pending.kind === 'tab') goTab(pending.tab)
    else setFunnelId(pending.funnelId)
    setPending(null)
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClipboardList size={20} /> Qualificação
          <HelpTip title="Qualificação" size={15} width={320}>
            O roteiro diz ao vendedor o que perguntar em cada etapa. As respostas alimentam o termômetro do lead. Ex.: na etapa Qualificando, pergunte orçamento, prazo e quem decide.
          </HelpTip>
        </h1>
        {funnels.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            Funil
            <select
              className="select"
              style={{ width: 'auto', minWidth: 180 }}
              value={funnelId ?? ''}
              onChange={e => requestFunnel(Number(e.target.value))}
              aria-label="Escolha o funil"
            >
              {funnels.map(f => <option key={f.id} value={f.id}>{f.name}{f.is_default ? ' (padrão)' : ''}</option>)}
            </select>
          </label>
        )}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
        {TABS.map(t => {
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              className="btn btn-sm"
              style={{ background: active ? '#FFB300' : 'transparent', color: active ? '#000' : '#9B96B0', border: 'none', borderBottom: active ? '2px solid #FFB300' : 'none', borderRadius: 0, whiteSpace: 'nowrap' }}
              onClick={() => requestTab(t.key)}
            >
              <Icon size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> {t.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : loadError ? (
        <div className="card" style={{ color: 'var(--negative)' }}>{loadError}</div>
      ) : !accountId || !funnelId ? (
        <div className="card">
          <div className="empty-state">
            <ClipboardList size={32} style={{ color: 'var(--text-muted)' }} />
            <h3>Nenhum funil ainda</h3>
            <p style={{ maxWidth: 440, textAlign: 'center' }}>
              O roteiro é montado por funil. Crie um funil em Funis (ex.: "Vendas" com as etapas Novo, Qualificando, Proposta, Venda) e volte aqui para dizer o que perguntar em cada etapa.
            </p>
          </div>
        </div>
      ) : tab === 'roteiro' ? (
        <RoteiroEditor key={`${accountId}-${funnelId}`} funnelId={funnelId} accountId={accountId} onDirtyChange={setEditorDirty} />
      ) : tab === 'desempenho' ? (
        <DesempenhoTab key={`${accountId}-${funnelId}`} funnelId={funnelId} accountId={accountId} />
      ) : (
        <SugestoesTab key={`${accountId}-${funnelId}`} funnelId={funnelId} accountId={accountId} />
      )}

      {pending && (
        <ConfirmDialog
          title="Sair sem salvar?"
          confirmLabel="Sair sem salvar"
          cancelLabel="Continuar editando"
          danger
          onConfirm={confirmLeave}
          onCancel={() => setPending(null)}
        >
          Você mudou o roteiro e ainda não salvou. Se sair agora, essas mudanças se perdem. Para guardar, clique em "Continuar editando" e depois em "Salvar rascunho".
        </ConfirmDialog>
      )}
    </div>
  )
}
