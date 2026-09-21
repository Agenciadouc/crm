import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader, Check, MessageSquare, Settings } from 'lucide-react'
import { compileBriefing, activateBriefing, fetchBriefing, type CompiledAgent } from '../lib/api'

export default function AgentBriefingSummary() {
  const navigate = useNavigate()
  const { briefingId } = useParams()
  const id = Number(briefingId)
  const [compiled, setCompiled] = useState<CompiledAgent | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ativando, setAtivando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        // Se ja foi compilado antes, aproveita; senao compila agora.
        const b = await fetchBriefing(id)
        if (cancelado) return
        if (b.compiled_json) {
          setCompiled(JSON.parse(b.compiled_json))
        } else {
          const r = await compileBriefing(id)
          if (cancelado) return
          setCompiled(r.compiled)
        }
      } catch (e: any) {
        if (!cancelado) setErro(e.message || 'Não consegui montar o resumo.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [id])

  async function ativar() {
    setAtivando(true)
    setErro(null)
    try {
      await activateBriefing(id, 'copilot')
      navigate('/agents')
    } catch (e: any) {
      setErro(e.message || 'Não consegui ativar o atendente.')
      setAtivando(false)
    }
  }

  if (carregando) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Loader size={20} className="spin" />
        <p>Montando seu atendente com o que você contou...</p>
      </div>
    )
  }

  if (erro && !compiled) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 48 }}>
        <div style={{ padding: 16, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080' }}>{erro}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => navigate(`/agents/interview/${id}`)}>
            <MessageSquare size={16} /> Voltar para a conversa
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/agents')}>
            <Settings size={16} /> Ir para ajustes avançados
          </button>
        </div>
      </div>
    )
  }

  const c = compiled!
  const bloco = (titulo: string, corpo: React.ReactNode) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 15, lineHeight: 1.6 }}>{corpo}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
      <h1>Pronto, montei seu atendente</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: 32 }}>
        Confira se ficou do jeito que você quer. Se algo estiver errado, é só me falar.
      </p>

      {bloco('Quem eu sou', c.resumo.quem_sou)}
      {bloco('O que eu sei', c.resumo.o_que_sei)}
      {bloco('O que vou descobrir do lead', (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {c.resumo.o_que_descubro.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ))}
      {bloco('O que eu nunca falo', (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {c.resumo.o_que_nunca_falo.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ))}

      {erro && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080', marginBottom: 16 }}>{erro}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={ativar} disabled={ativando}>
          {ativando ? <Loader size={16} className="spin" /> : <Check size={16} />} Tá certo, ativar
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(`/agents/interview/${id}`)} disabled={ativando}>
          <MessageSquare size={16} /> Corrigir algo
        </button>
      </div>

      <p style={{ marginTop: 24, fontSize: 13 }}>
        <a href="#" onClick={e => { e.preventDefault(); navigate('/agents') }} style={{ color: 'var(--text-secondary)' }}>
          ajustes avançados &gt;
        </a>
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        O atendente nasce em modo Copiloto: ele só sugere a resposta no Chat, o vendedor revisa e envia.
        Nada é enviado sozinho enquanto você não trocar o modo.
      </p>
    </div>
  )
}
