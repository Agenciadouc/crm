import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import { fetchAllTransferRequests, acceptTransferRequest, rejectTransferRequest, cancelTransferRequest, type TransferRequest } from '../lib/api'
import { ArrowRightLeft, Check, X, Clock, RefreshCw, Inbox, Send } from 'lucide-react'
import { parseSqlDate } from '../lib/dates'

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pendente',  color: '#FBBC04' },
  accepted:  { label: 'Aceito',    color: '#34C759' },
  rejected:  { label: 'Recusado',  color: '#FF6B6B' },
  cancelled: { label: 'Cancelado', color: '#9B96B0' },
}

function timeAgo(s: string) {
  const d = parseSqlDate(s)
  const diff = Date.now() - d.getTime()
  const mins = Math.max(0, Math.floor(diff / 60000))
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function TransferRequests() {
  const { user } = useAuth()
  const [received, setReceived] = useState<TransferRequest[]>([])
  const [sent, setSent] = useState<TransferRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'received' | 'sent'>('received')
  const [actingId, setActingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchAllTransferRequests()
      .then(d => { setReceived(d.received || []); setSent(d.sent || []) })
      .catch(e => setError(e?.message || 'Falha ao carregar'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useSSE('lead:transfer-requested', useCallback((data: TransferRequest) => {
    if (user && data.to_attendant_id === user.id) load()
  }, [user, load]))
  useSSE('lead:transfer-accepted', load)
  useSSE('lead:transfer-rejected', load)

  const handleAccept = async (id: number) => {
    setActingId(id); setError(null)
    try { await acceptTransferRequest(id); load() }
    catch (e: any) { setError(e?.message || 'Falha ao aceitar') }
    finally { setActingId(null) }
  }
  const handleReject = async (id: number) => {
    if (!confirm('Recusar este pedido?')) return
    setActingId(id); setError(null)
    try { await rejectTransferRequest(id); load() }
    catch (e: any) { setError(e?.message || 'Falha ao recusar') }
    finally { setActingId(null) }
  }
  const handleCancel = async (id: number) => {
    if (!confirm('Cancelar seu pedido?')) return
    setActingId(id); setError(null)
    try { await cancelTransferRequest(id); load() }
    catch (e: any) { setError(e?.message || 'Falha ao cancelar') }
    finally { setActingId(null) }
  }

  const list = tab === 'received' ? received : sent
  const pendingReceived = received.filter(r => r.status === 'pending').length
  const pendingSent = sent.filter(r => r.status === 'pending').length

  return (
    <div>
      <div className="page-header">
        <h1><ArrowRightLeft size={20} style={{ marginRight: 8 }} /> Transferencias de Leads</h1>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spinning' : ''} /> Atualizar
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          className={`btn btn-sm ${tab === 'received' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('received')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Inbox size={12} /> Recebidos
          {pendingReceived > 0 && <span style={{ background: '#FF6B6B', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{pendingReceived}</span>}
        </button>
        <button
          className={`btn btn-sm ${tab === 'sent' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('sent')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Send size={12} /> Enviados
          {pendingSent > 0 && <span style={{ background: '#FBBC04', color: '#000', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{pendingSent}</span>}
        </button>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <ArrowRightLeft size={32} style={{ color: '#6B6580' }} />
          <h3>Nenhum pedido {tab === 'received' ? 'recebido' : 'enviado'}</h3>
          <p style={{ fontSize: 12, color: '#9B96B0' }}>
            {tab === 'received'
              ? 'Quando outro atendente pedir um lead seu, aparece aqui.'
              : 'Quando voce pedir transferencia de algum lead, aparece aqui.'}
          </p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Telefone</th>
                <th>{tab === 'received' ? 'Solicitado por' : 'Para'}</th>
                <th>Mensagem</th>
                <th>Status</th>
                <th className="right">Quando</th>
                <th className="right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => {
                const st = STATUS_LABEL[r.status] || { label: r.status, color: '#9B96B0' }
                const isPending = r.status === 'pending'
                return (
                  <tr key={r.id}>
                    <td className="name">{r.lead_name || '(sem nome)'}</td>
                    <td style={{ fontSize: 11, color: '#9B96B0' }}>{r.lead_phone || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {tab === 'received' ? r.from_attendant_name : (r.to_attendant_name || '(sem atendente)')}
                    </td>
                    <td style={{ fontSize: 11, color: '#9B96B0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.message || '—'}
                    </td>
                    <td>
                      <span className="stage-badge" style={{ background: `${st.color}20`, color: st.color }}>{st.label}</span>
                    </td>
                    <td className="right" style={{ fontSize: 11, color: '#9B96B0' }}>
                      <span title={parseSqlDate(r.created_at).toLocaleString('pt-BR')}>
                        <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />{timeAgo(r.created_at)}
                      </span>
                    </td>
                    <td className="right">
                      {tab === 'received' && isPending && (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleReject(r.id)}
                            disabled={actingId === r.id}
                            style={{ fontSize: 11 }}
                          >
                            <X size={11} /> Recusar
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleAccept(r.id)}
                            disabled={actingId === r.id}
                            style={{ fontSize: 11 }}
                          >
                            <Check size={11} /> Aceitar
                          </button>
                        </div>
                      )}
                      {tab === 'sent' && isPending && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleCancel(r.id)}
                          disabled={actingId === r.id}
                          style={{ fontSize: 11 }}
                        >
                          Cancelar
                        </button>
                      )}
                      {!isPending && <span style={{ fontSize: 10, color: '#6B6580' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
