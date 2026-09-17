import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Send, Loader, ClipboardPaste } from 'lucide-react'
import { startBriefing, answerBriefing, retryNextQuestion, fetchBriefing, pasteIntoBriefing, type BriefingTurn } from '../lib/api'

export default function AgentInterview() {
  const navigate = useNavigate()
  const { briefingId: paramId } = useParams()
  const [briefingId, setBriefingId] = useState<number | null>(paramId ? Number(paramId) : null)
  const [turns, setTurns] = useState<BriefingTurn[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [colando, setColando] = useState(false)
  const [podeTentarDeNovo, setPodeTentarDeNovo] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, carregando])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        if (paramId) {
          const b = await fetchBriefing(Number(paramId))
          if (cancelado) return
          setBriefingId(b.id)
          setTurns(b.turns)
        } else {
          const r = await startBriefing()
          if (cancelado) return
          setBriefingId(r.briefing_id)
          setTurns([{ id: 0, position: 1, role: 'ia', content: r.question, created_at: '' }])
        }
      } catch (e: any) {
        if (!cancelado) setErro(e.message || 'Não consegui começar a entrevista.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [paramId])

  async function enviar() {
    const t = texto.trim()
    if (!t || !briefingId || carregando) return
    setTexto('')
    setErro(null)
    setTurns(prev => [...prev, { id: -Date.now(), position: prev.length + 1, role: 'user', content: t, created_at: '' }])
    setCarregando(true)
    try {
      const r = await answerBriefing(briefingId, t)
      if (r.done) { navigate(`/agents/resumo/${briefingId}`); return }
      setTurns(prev => [...prev, { id: -Date.now() - 1, position: prev.length + 1, role: 'ia', content: r.question || '', created_at: '' }])
    } catch (e: any) {
      // A resposta ja foi gravada no servidor. Reenviar o texto duplicaria o
      // turno, entao o retry pede SO a proxima pergunta.
      setErro(e.message || 'A IA não respondeu. Sua resposta está salva.')
      setPodeTentarDeNovo(true)
    } finally {
      setCarregando(false)
    }
  }

  async function tentarDeNovo() {
    if (!briefingId || carregando) return
    setErro(null)
    setCarregando(true)
    try {
      const r = await retryNextQuestion(briefingId)
      if (r.done) { navigate(`/agents/resumo/${briefingId}`); return }
      setTurns(prev => [...prev, { id: -Date.now() - 2, position: prev.length + 1, role: 'ia', content: r.question || '', created_at: '' }])
      setPodeTentarDeNovo(false)
    } catch (e: any) {
      setErro(e.message || 'A IA continua sem responder. Tente daqui a pouco.')
    } finally {
      setCarregando(false)
    }
  }

  async function colar() {
    const material = texto.trim()
    if (!material || !briefingId) return
    setColando(true)
    try {
      await pasteIntoBriefing(briefingId, material)
      setTexto('')
      setTurns(prev => [...prev, { id: -Date.now(), position: prev.length + 1, role: 'user', content: '(material enviado para a IA ler)', created_at: '' }])
    } catch (e: any) {
      setErro(e.message || 'Não consegui guardar o material.')
    } finally {
      setColando(false)
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: 4 }}>Vamos montar seu atendente</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: 24 }}>
        Responda como você falaria com um funcionário novo. Pode ser informal.
      </p>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {turns.map(t => (
          <div key={t.id} style={{ alignSelf: t.role === 'ia' ? 'flex-start' : 'flex-end', maxWidth: '85%' }}>
            <div style={{
              padding: '12px 16px', borderRadius: 12, fontSize: 15, lineHeight: 1.5,
              background: t.role === 'ia' ? 'var(--bg-elevated)' : 'var(--accent)',
              color: t.role === 'ia' ? 'var(--text-primary)' : '#111',
            }}>{t.content}</div>
          </div>
        ))}
        {carregando && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <Loader size={14} className="spin" /> pensando...
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {erro && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080', marginBottom: 12 }}>
          <div>{erro}</div>
          {podeTentarDeNovo && (
            <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={tentarDeNovo} disabled={carregando}>
              Tentar de novo
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 16 }}>
        <textarea
          className="input"
          rows={3}
          value={texto}
          disabled={carregando}
          placeholder="Escreva sua resposta..."
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button className="btn btn-secondary" onClick={colar} disabled={colando || carregando || !texto.trim()} title="Enviar como material para a IA ler">
          <ClipboardPaste size={16} />
        </button>
        <button className="btn btn-primary" onClick={enviar} disabled={carregando || !texto.trim()}>
          <Send size={16} />
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Enter envia · Shift+Enter quebra linha · o botão da prancheta manda um material inteiro para a IA ler
      </p>
    </div>
  )
}
