import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader, Check, MessageSquare, Settings } from 'lucide-react'
import { useAccount } from '../context/AccountContext'
import { compileBriefing, activateBriefing, fetchBriefing, type CompiledAgent, type BriefingAtendimento } from '../lib/api'

export default function AgentBriefingSummary() {
  const navigate = useNavigate()
  const { accountId } = useAccount()
  const { briefingId } = useParams()
  const id = Number(briefingId)
  const [compiled, setCompiled] = useState<CompiledAgent | null>(null)
  const [atendimento, setAtendimento] = useState<BriefingAtendimento | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ativando, setAtivando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [jaAtivo, setJaAtivo] = useState(false)

  useEffect(() => {
    if (!accountId) return
    let cancelado = false
    setCarregando(true)
    ;(async () => {
      try {
        const r = await fetchBriefing(id, accountId)
        if (cancelado) return
        setAtendimento(r.atendimento)
        const b = r.briefing
        setJaAtivo(b.status === 'ativo')
        // So reaproveita o compilado quando ele esta em dia com o briefing.
        // Se a pessoa voltou para a conversa e corrigiu algo depois de compilar,
        // precisa_recompilar vem 1 e a IA roda de novo: sem isso ela aprovaria o
        // resumo VELHO e o agente nasceria sem a correcao.
        if (b.compiled_json && !b.precisa_recompilar) {
          setCompiled(JSON.parse(b.compiled_json))
          return
        }
        try {
          const c = await compileBriefing(id, accountId)
          if (cancelado) return
          setCompiled(c.compiled)
        } catch (e: any) {
          if (cancelado) return
          // Recompilar falhou (IA fora do ar, teto de tokens do briefing).
          // Se existe um resumo anterior, mostra ele com aviso: melhor que
          // prender a pessoa numa tela de erro sem saida.
          if (!b.compiled_json) throw e
          setCompiled(JSON.parse(b.compiled_json))
          setAviso(`Não consegui atualizar o resumo com a sua última correção (${e.message || 'erro'}). O que aparece abaixo é a versão anterior, e só dá para ativar depois de atualizar: recarregue a página para tentar de novo.`)
        }
      } catch (e: any) {
        if (!cancelado) setErro(e.message || 'Não consegui montar o resumo.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [id, accountId])

  async function ativar() {
    if (!accountId) return
    setAtivando(true)
    setErro(null)
    try {
      await activateBriefing(id, accountId, 'copilot')
      navigate('/agents')
    } catch (e: any) {
      setErro(e.message || 'Não consegui ativar o atendente.')
      setAtivando(false)
    }
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

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
  // Agente novo sem numero ou sem etapa nasceria surdo: o servidor recusa, e a
  // tela ja diz o que fazer antes. Agente que ja existe so recebe correcao de
  // texto, entao nao trava.
  const semNumero = !jaAtivo && !!atendimento && atendimento.instancias.length === 0
  const semEtapa = !jaAtivo && !!atendimento && atendimento.etapas.length === 0
  // Com aviso, o que aparece e o resumo VELHO: ativar poria no ar sem a correcao.
  const bloqueado = !!aviso || semNumero || semEtapa
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
      {atendimento && bloco('Onde eu atendo', (
        <div>
          <div>
            <strong>Números de WhatsApp:</strong>{' '}
            {atendimento.instancias.length ? atendimento.instancias.join(', ') : 'Nenhum número de WhatsApp conectado — conecte um em Integrações e volte aqui para ativar.'}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Etapas do funil:</strong>{' '}
            {atendimento.etapas.length ? atendimento.etapas.join(', ') : 'Nenhuma etapa de funil — crie o funil antes de ativar.'}
          </div>
        </div>
      ))}

      {aviso && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,179,0,0.12)', color: '#FBBC04', marginBottom: 16 }}>{aviso}</div>
      )}

      {erro && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080', marginBottom: 16 }}>{erro}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={ativar} disabled={ativando || bloqueado}>
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
