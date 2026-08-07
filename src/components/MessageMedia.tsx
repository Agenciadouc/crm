import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMessageMedia, createLeadOrFindExisting, type Message } from '../lib/api'
import { useAccount } from '../context/AccountContext'
import { Image as ImageIcon, Film, Mic, FileText, Sticker, Eye, Loader, Download, User, Phone, MessageSquarePlus } from 'lucide-react'

interface Props {
  message: Message
  leadId: number
}

// Extrai (nome, telefone) do content salvo pelo backend pra media_type='contact'.
// Formatos possiveis:
//   "👤 Nome do contato — 5511999999999"  (1 contato com phone)
//   "👤 Contato: Nome do contato"          (1 contato sem phone)
//   "👤 3 contatos: A (551...) | B | ..."  (multi)
//   "👤 Contato compartilhado"             (fallback)
// media_url tem o phone limpo (so digitos) quando disponivel.
function parseContactContent(content: string, mediaUrl: string | null) {
  const clean = (content || '').replace(/^👤\s*/, '').trim()
  const phone = (mediaUrl || '').replace(/\D/g, '')
  if (!clean) return { name: 'Contato compartilhado', phone: '', isMulti: false, extra: '' }
  // Multi
  const multiMatch = clean.match(/^(\d+)\s+contatos:\s*(.+)$/i)
  if (multiMatch) {
    return { name: `${multiMatch[1]} contatos`, phone, isMulti: true, extra: multiMatch[2] }
  }
  // "Contato: Nome" (sem phone)
  const semTelMatch = clean.match(/^Contato:\s*(.+)$/i)
  if (semTelMatch) return { name: semTelMatch[1].trim(), phone: '', isMulti: false, extra: '' }
  // "Nome — phone"
  const emdashMatch = clean.match(/^(.+?)\s+[—-]\s*(.+)$/)
  if (emdashMatch) return { name: emdashMatch[1].trim(), phone: phone || emdashMatch[2].replace(/\D/g, ''), isMulti: false, extra: '' }
  return { name: clean, phone, isMulti: false, extra: '' }
}

function formatPhoneBR(digits: string) {
  if (!digits) return ''
  const d = digits.replace(/\D/g, '')
  // 55 + 11 + 9XXXXYYYY = 13 digitos (celular BR com DDI)
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return d
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  document: FileText,
  sticker: Sticker,
}

const LABEL_MAP: Record<string, string> = {
  image: 'Imagem',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
  sticker: 'Sticker',
}

export default function MessageMedia({ message, leadId }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [mime, setMime] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const navigate = useNavigate()
  const { accountId } = useAccount()

  // Caso especial: mensagem tipo "contact" — nao tem midia binaria, renderiza card com nome + telefone
  if (message.media_type === 'contact') {
    return <ContactCard message={message} accountId={accountId} navigate={navigate} />
  }

  const Icon = ICON_MAP[message.media_type] || FileText
  const label = LABEL_MAP[message.media_type] || 'Arquivo'

  const handleLoad = async () => {
    if (dataUrl || loading) return
    setLoading(true); setError(false)
    try {
      const data = await fetchMessageMedia(leadId, message.id)
      setDataUrl(data.dataUrl); setMime(data.mime)
    } catch { setError(true) }
    setLoading(false)
  }

  const [zoomed, setZoomed] = useState(false)

  // Render loaded media
  if (dataUrl) {
    if (mime.startsWith('image/')) {
      return (
        <>
          <img src={dataUrl} alt={label} onClick={() => setZoomed(true)} style={{ maxWidth: 280, maxHeight: 280, borderRadius: 8, display: 'block', cursor: 'zoom-in' }} />
          {zoomed && (
            <div onClick={() => setZoomed(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 20 }}>
              <img src={dataUrl} alt={label} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', borderRadius: 8 }} />
              <a href={dataUrl} download={`${label.toLowerCase()}.jpg`} onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 20, right: 20, padding: '8px 16px', background: 'rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Download size={14} /> Baixar
              </a>
            </div>
          )}
        </>
      )
    }
    if (mime.startsWith('video/')) {
      return <video src={dataUrl} controls style={{ maxWidth: 280, borderRadius: 8 }} />
    }
    if (mime.startsWith('audio/')) {
      return <audio src={dataUrl} controls style={{ maxWidth: 280 }} />
    }
    // Document/other → download link
    return (
      <a href={dataUrl} download={message.content || 'arquivo'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, color: 'inherit', textDecoration: 'none' }}>
        <Download size={14} /> {message.content || label}
      </a>
    )
  }

  // Placeholder with click-to-load
  return (
    <button
      onClick={handleLoad}
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.2)',
        color: 'inherit', cursor: loading ? 'wait' : 'pointer', fontSize: 13, minWidth: 180,
      }}
    >
      {loading ? <Loader size={14} className="spinning" /> : error ? <Icon size={14} /> : <Eye size={14} />}
      <span>{loading ? 'Carregando...' : error ? `Erro ao carregar ${label.toLowerCase()}` : `Ver ${label.toLowerCase()}`}</span>
      {message.content && message.content !== `[${label}]` && <span style={{ opacity: 0.7, fontSize: 11 }}>· {message.content}</span>}
    </button>
  )
}

// ─── ContactCard ────────────────────────────────────────────────────────────
// Renderiza msg de contato compartilhado (media_type='contact') como card com
// nome, telefone formatado e acoes: copiar numero + abrir/criar lead.
interface ContactCardProps {
  message: Message
  accountId: number | null
  navigate: ReturnType<typeof useNavigate>
}
function ContactCard({ message, accountId, navigate }: ContactCardProps) {
  const parsed = parseContactContent(message.content || '', message.media_url || null)
  const [busy, setBusy] = useState<null | 'copy' | 'open'>(null)
  const [msg, setMsg] = useState('')

  const handleCopy = async () => {
    if (!parsed.phone) return
    setBusy('copy')
    try {
      await navigator.clipboard.writeText(parsed.phone)
      setMsg('Numero copiado!')
      setTimeout(() => setMsg(''), 2000)
    } catch {
      setMsg('Nao foi possivel copiar')
    }
    setBusy(null)
  }

  const handleOpen = async () => {
    if (!parsed.phone || !accountId) return
    setBusy('open')
    setMsg('')
    try {
      // Upsert por phone: se ja existe, abre; se nao, cria e abre. Handler oficial do CRM.
      const { lead, alreadyExisted } = await createLeadOrFindExisting(accountId, {
        name: parsed.name || 'Contato do vCard',
        phone: parsed.phone,
      })
      if (lead?.id) {
        navigate(`/chat?lead=${lead.id}`)
      } else {
        setMsg(alreadyExisted ? 'Lead existente — recarregue' : 'Lead criado — recarregue')
      }
    } catch (e: any) {
      setMsg(e?.message || 'Erro ao abrir/criar lead')
    }
    setBusy(null)
  }

  const isMulti = parsed.isMulti
  const phoneFormatted = formatPhoneBR(parsed.phone)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 12, minWidth: 240, maxWidth: 320,
      background: 'rgba(0,0,0,0.18)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'rgba(255,179,0,0.15)', color: '#FFB300',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <User size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parsed.name}</div>
          {phoneFormatted && (
            <div style={{ fontSize: 12, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Phone size={11} /> {phoneFormatted}
            </div>
          )}
          {isMulti && parsed.extra && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{parsed.extra}</div>
          )}
        </div>
      </div>
      {parsed.phone && !isMulti && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={handleOpen}
            disabled={busy !== null}
            style={{
              flex: 1, minWidth: 120,
              padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: '#FFB300', color: '#130A24', cursor: busy ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              border: 'none',
            }}
          >
            {busy === 'open' ? <Loader size={12} className="spinning" /> : <MessageSquarePlus size={12} />}
            Abrir conversa
          </button>
          <button
            onClick={handleCopy}
            disabled={busy !== null}
            style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: 'rgba(255,255,255,0.08)', color: 'inherit', cursor: busy ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            Copiar numero
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 11, color: '#34C759', marginTop: 2 }}>{msg}</div>}
    </div>
  )
}
