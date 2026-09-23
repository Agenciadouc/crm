// Modal de release notes — aparece 1x por usuario (persiste dispensa em localStorage).
// Ao adicionar uma nova release, incrementar RELEASE_KEY (ex: 'dros_crm_release_v425')
// pra reabrir pra todos os usuarios da proxima vez que logarem.
//
// Alem disso, escuta SSE 'system:release' — quando super_admin dispara "Publicar
// nova atualizacao" no Dashboard Global, o modal abre em tempo real pra todos
// os clientes conectados (sem F5), respeitando quem ja dispensou.
import { useCallback, useEffect, useState } from 'react'
import { X, Sparkles, ChevronRight, Info, DollarSign, MessageCircle, Zap } from 'lucide-react'
import { useSSE } from '../context/SSEContext'

const RELEASE_KEY = 'dros_crm_release_v424_seen'
const RELEASE_VERSION = 'v.424'
const RELEASE_DATE = '23/09/2026'
const RELEASE_AUTHOR = 'João Luiz Soares de Mattos'

export default function ReleaseNotesModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const seen = localStorage.getItem(RELEASE_KEY)
      if (!seen) setOpen(true)
    } catch { /* localStorage pode estar bloqueado; ignora */ }
  }, [])

  // Escuta SSE — super_admin pode disparar pra abrir pra todos em tempo real.
  // Ignora localStorage (forca abrir mesmo pra quem ja tinha dispensado antes),
  // pra o disparo manual funcionar como notificacao.
  const onReleaseBroadcast = useCallback((data: { version?: string; force?: boolean } | null) => {
    if (!data) return
    // Se o broadcast e sobre uma versao diferente da que o cliente tem carregada,
    // sugere reload pra pegar o JS novo. Senao, so abre normalmente.
    if (data.version && data.version !== RELEASE_VERSION) {
      // Versao diferente — cliente com JS antigo. Mostra prompt de reload.
      const doReload = window.confirm(`Nova atualização disponível (${data.version}). Recarregar agora pra ver o que mudou?`)
      if (doReload) window.location.reload()
      return
    }
    // Mesma versao (ou sem versao) — abre modal com o conteudo local
    try { localStorage.removeItem(RELEASE_KEY) } catch {}
    setOpen(true)
  }, [])
  useSSE('system:release', onReleaseBroadcast)

  const close = () => {
    try { localStorage.setItem(RELEASE_KEY, new Date().toISOString()) } catch {}
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #1a1030)',
          borderRadius: 12,
          padding: 0,
          maxWidth: 640, width: '100%',
          maxHeight: '90vh',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #FFB300, #FF8A00)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1030', flexShrink: 0 }}>
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>Novidades na atualizacao {RELEASE_VERSION}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #9B96B0)' }}>
                {RELEASE_DATE} · por {RELEASE_AUTHOR}
              </div>
            </div>
          </div>
          <button
            onClick={close}
            title="Fechar"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted, #9B96B0)',
              cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body scrollavel */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {/* Bloco 1: Vendas por lead */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <DollarSign size={16} style={{ color: '#34C759' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#34C759', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Múltiplas vendas por lead
              </div>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FeatureLi title="Registro de venda ao mover pra “Venda”">
                Ao mudar a etapa de um lead pra "Venda" (ou qualquer etapa marcada como conversão), abre um popup pedindo o valor da compra e a data. Você pode confirmar ou pular. Vale tanto no <strong>Chat</strong> quanto na tela detalhes do lead.
              </FeatureLi>
              <FeatureLi title="Nova seção “Vendas” na sidebar do lead">
                Cada lead agora tem uma seção "Vendas" com o total agregado em verde, lista de cada venda (valor + data + quem registrou) e botão <strong>“+”</strong> pra adicionar novas a qualquer momento — recompras, upsells, vendas retroativas.
              </FeatureLi>
              <FeatureLi title="Data personalizada por venda">
                Cada venda tem data própria. O painel <strong>Funil &amp; ROI Mensal</strong> agora agrega faturamento por mês baseado na data da venda, não na data do lead. Vendas retroativas caem no mês correto do histórico.
              </FeatureLi>
              <FeatureLi title="Gerente/Admin pode excluir vendas">
                Ícone de lixeira ao lado de cada venda pra ajustar erros de digitação. Atendente vê a lista mas não exclui.
              </FeatureLi>
            </ul>
          </div>

          {/* Bloco 2: uzapi (validação) */}
          <div style={{ marginBottom: 22, padding: 14, background: 'rgba(52,199,89,0.06)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Zap size={14} style={{ color: '#34C759' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#34C759' }}>
                Integração uzapi (em validação)
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.6 }}>
              Agora o CRM suporta um segundo provider de WhatsApp além do Evolution atual: <strong>uzapi.com.br</strong>. Cada instância pode ser alternada individualmente entre Evolution e uzapi pelo botão <strong>“⇄ Mudar pra uzapi”</strong> na tela de Integrações. A conexão continua sendo por QR code, mas a infra é SaaS gerenciada — menos manutenção do servidor e mais estabilidade em testes.
              <br /><br />
              <strong style={{ color: '#FFB300' }}>Status:</strong> disponível pra testes internos. Boa opção pra <strong>validação e homologação</strong> antes de escalar. Clientes existentes continuam no Evolution sem mudanças.
            </div>
          </div>

          {/* Bloco 3: API oficial (produção) */}
          <div style={{ marginBottom: 22, padding: 14, background: 'rgba(93,173,226,0.06)', border: '1px solid rgba(93,173,226,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <MessageCircle size={14} style={{ color: '#5DADE2' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#5DADE2' }}>
                API Oficial WhatsApp (produção)
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.6 }}>
              A gente está preparando a integração com a <strong>WhatsApp Cloud API oficial da Meta</strong>. Ela vai ser a recomendação pra <strong>produção real</strong> — sem risco de banimento, com CTWA nativo, ligações WhatsApp e maior estabilidade. Custo é por conversa (cobrado pela Meta), mas o benefício em confiabilidade compensa pra números com muito volume.
              <br /><br />
              <strong style={{ color: '#FFB300' }}>Status:</strong> em desenvolvimento. Vai ser habilitada por cliente conforme cada um migrar sua conta Meta Business Manager. Detalhes de custo e passo a passo a gente comunica quando for o momento de cada cliente.
            </div>
          </div>

          {/* Bloco 4: como usar */}
          <div style={{ padding: 14, background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Info size={14} style={{ color: '#FFB300' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#FFB300' }}>
                Como começar a usar as vendas
              </div>
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.7 }}>
              <li>No menu, abre o <strong>Chat</strong> ou <strong>Leads</strong></li>
              <li>Clica num lead qualquer</li>
              <li>Muda a etapa dele pra <strong>Venda</strong> pelo dropdown do topo</li>
              <li>Preenche o valor + data no popup e confirma (ou pula pra mover sem valor)</li>
              <li>Vai aparecer na sidebar do lead na seção <strong>Vendas</strong></li>
              <li>Pra adicionar recompras depois, clica no botão <strong>“+”</strong> nessa seção</li>
            </ol>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #9B96B0)', marginTop: 10, lineHeight: 1.5 }}>
              Requer que a etapa "Venda" (ou equivalente) esteja marcada como <strong>Conv.</strong> no seu funil. Se não estiver, edita o funil em <strong>Funis</strong> e marca o checkbox Conv. na etapa certa.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #6B6580)' }}>
            Este aviso aparece so uma vez.
          </div>
          <button
            onClick={close}
            className="btn btn-primary btn-sm"
            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            Entendi, vamos la <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function FeatureLi({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, background: '#FFB300', marginTop: 8, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #9B96B0)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </li>
  )
}
