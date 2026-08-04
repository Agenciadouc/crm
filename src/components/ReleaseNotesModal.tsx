// Modal de release notes — aparece 1x por usuario (persiste dispensa em localStorage).
// Ao adicionar uma nova release, incrementar RELEASE_KEY (ex: 'dros_crm_release_v424')
// pra reabrir pra todos os usuarios da proxima vez que logarem.
import { useEffect, useState } from 'react'
import { X, Sparkles, ChevronRight, Info } from 'lucide-react'

const RELEASE_KEY = 'dros_crm_release_v423_seen'
const RELEASE_VERSION = 'v.423'
const RELEASE_DATE = '04/08/2026'
const RELEASE_AUTHOR = 'João Luiz Soares de Mattos'

export default function ReleaseNotesModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const seen = localStorage.getItem(RELEASE_KEY)
      if (!seen) setOpen(true)
    } catch { /* localStorage pode estar bloqueado; ignora */ }
  }, [])

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
          {/* Bloco 1: novidades */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              O que mudou
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FeatureLi title="Novo painel Funil &amp; ROI Mensal no Dashboard">
                Cascata Leads → Qualificados → Reunioes → Vendas do mes, com taxas de conversao entre etapas e cards de CPL, CAC, faturamento, ROAS e progresso da meta.
              </FeatureLi>
              <FeatureLi title="Nova aba Projecao no menu (Gestao)">
                Tabela de 3 meses passados + 3 meses futuros. Meses passados mostram dados reais. Meses futuros sao projetados usando as taxas medias historicas + investimento planejado.
              </FeatureLi>
              <FeatureLi title="Mensagens prontas preservam quebras de linha">
                O campo de mensagem do chat agora e uma area de texto. Ready messages com varias linhas aparecem certas. Use Shift+Enter pra quebrar linha manualmente, Enter continua enviando.
              </FeatureLi>
              <FeatureLi title="Chat: so quem manda mensagem pra voce sobe pro topo">
                Antes, qualquer mensagem (recebida ou enviada) subia o contato pro topo. Agora, so mensagens do cliente reordenam a lista. Suas respostas nao mexem na ordem.
              </FeatureLi>
            </ul>
          </div>

          {/* Bloco 2: como configurar */}
          <div style={{ marginBottom: 22, padding: 14, background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Info size={14} style={{ color: '#FFB300' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#FFB300' }}>
                Passo obrigatorio pra o funil funcionar
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text, #EBEBF5)', marginBottom: 12, lineHeight: 1.5 }}>
              O painel novo precisa saber quais etapas do seu funil sao Qualificado e Reuniao/Visita.
              Sem isso o painel mostra um aviso amarelo e nao calcula as taxas.
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.7 }}>
              <li>No menu, va em <strong>Funis</strong></li>
              <li>Edita o funil da sua conta (o funil padrao)</li>
              <li>Marca o checkbox <strong>Qual.</strong> na etapa "Qualificado" (ou equivalente)</li>
              <li>Marca o checkbox <strong>Reun.</strong> na etapa "Reuniao/Visita" (ou equivalente)</li>
              <li>Confere que <strong>Conv.</strong> esta marcado na etapa de "Venda"</li>
              <li>Salva</li>
            </ol>
          </div>

          {/* Bloco 3: como usar o ROAS */}
          <div style={{ marginBottom: 22, padding: 14, background: 'rgba(93,173,226,0.06)', border: '1px solid rgba(93,173,226,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Info size={14} style={{ color: '#5DADE2' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#5DADE2' }}>
                Pra ver CAC, ROAS e faturamento no dashboard
              </div>
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.7 }}>
              <li>No <strong>Dashboard</strong>, dentro do painel "Funil &amp; ROI Mensal", clica em <strong>Configurar mes</strong> (canto direito, so aparece pra super_admin e gerente)</li>
              <li>Preenche o <strong>investimento em ads</strong> gasto no mes (R$)</li>
              <li>Preenche a <strong>meta de vendas</strong> do mes (numero)</li>
              <li>Preenche o <strong>ticket medio</strong> por venda (R$)</li>
              <li>Salva. Os cards CPL/CAC/ROAS/Faturamento/Meta atualizam automaticamente</li>
            </ol>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #9B96B0)', marginTop: 10, lineHeight: 1.5 }}>
              Dica: o ticket medio salvo no mes sobrescreve o default da conta so pra aquele mes. Util quando o mix de vendas muda temporariamente.
            </div>
          </div>

          {/* Bloco 4: onde ver a projecao */}
          <div style={{ padding: 14, background: 'rgba(155,89,182,0.06)', border: '1px solid rgba(155,89,182,0.25)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Info size={14} style={{ color: '#9B59B6' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#9B59B6' }}>
                Onde ver a projecao dos proximos meses
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text, #EBEBF5)', lineHeight: 1.5 }}>
              No menu lateral, secao <strong>Gestao</strong>, clica em <strong>Projecao</strong>.
              Voce ve uma tabela com os ultimos 3 meses (dados reais) e os proximos 3 meses (projetados
              com base nas taxas medias historicas). Pra editar o investimento planejado dos meses
              futuros, navega ate o mes no Dashboard e clica "Configurar mes".
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
