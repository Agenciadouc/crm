import { memo } from 'react'
import { User, Archive } from 'lucide-react'
import type { Lead, FunnelStage } from '../lib/api'

// FASE 5 PERFORMANCE — card de lead memoizado.
// Em conta com 500+ leads na lista, evita re-render de TODOS os cards a cada SSE,
// keystroke no search, ou troca de lead selecionado. Só re-renderiza quem mudou.

type Props = {
  lead: Lead
  active: boolean
  stage: FunnelStage | undefined
  onSelect: (leadId: number) => void
  onArchive: (leadId: number, e: React.MouseEvent) => void
  timeAgo: (s: string) => string
}

function LeadListItemInner({ lead: l, active, stage, onSelect, onArchive, timeAgo }: Props) {
  const unread = l.unread_count || 0
  return (
    <div
      className={`chat-contact-item ${active ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`}
      onClick={() => onSelect(l.id)}
      style={{ position: 'relative' }}
    >
      <div className="chat-contact-avatar" style={{ background: stage ? `${stage.color}25` : '#FFB30025', overflow: 'hidden' }}>
        {l.profile_pic_url ? (
          <img src={l.profile_pic_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <User size={16} style={{ color: stage?.color || '#FFB300' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <span className="chat-contact-name" style={{ fontWeight: unread > 0 ? 700 : 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: unread > 0 ? 'var(--text-primary)' : undefined }}>
            {l.name || l.phone || 'Sem nome'}
          </span>
          <span style={{ fontSize: 10, color: unread > 0 ? 'var(--positive)' : 'var(--text-muted)', fontWeight: unread > 0 ? 700 : 400 }}>{timeAgo(l.updated_at)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 2, alignItems: 'center' }}>
          <span className="chat-contact-preview" style={{ fontSize: 11, color: unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {l.last_message || (l.phone ? `📞 ${l.phone}` : 'Sem mensagens')}
          </span>
          {unread > 0 && (
            <span className="chat-contact-unread">{unread > 99 ? '99+' : unread}</span>
          )}
          {stage && unread === 0 && (
            <span style={{ fontSize: 9, color: stage.color, background: `${stage.color}20`, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' }}>{stage.name}</span>
          )}
        </div>
      </div>
      <button
        className="chat-contact-archive"
        title="Arquivar"
        onClick={e => onArchive(l.id, e)}
        style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.35)', border: 'none', color: '#C8C4D4', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'none' }}
      >
        <Archive size={11} />
      </button>
    </div>
  )
}

// Comparador: re-render só quando o lead muda (referencia) OU active troca OU stage muda
export default memo(LeadListItemInner, (prev, next) => {
  return (
    prev.lead === next.lead &&
    prev.active === next.active &&
    prev.stage === next.stage
  )
})
