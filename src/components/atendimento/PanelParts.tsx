import type { CSSProperties, ReactNode } from 'react'
import { Send, Phone, Check, Pencil, ChevronRight } from 'lucide-react'
import HelpTip from '../HelpTip'

// Peças comuns dos blocos da aba Atendimento do Chat: mesmo titulo pequeno em maiusculas com "?",
// mesmo cartao (padding e borda), um botao principal laranja e acoes secundarias como link.

// Cartao de um bloco (use com className="card")
export const PANEL_CARD: CSSProperties = { padding: 12, marginBottom: 12 }
// Titulo pequeno do bloco
export const PANEL_TITLE: CSSProperties = { fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }
// Botao principal (className="btn btn-primary btn-sm")
export const PRIMARY_BTN: CSSProperties = { fontSize: 11, padding: '4px 12px' }
// Botao pequeno do titulo (className="btn btn-secondary btn-sm"), ex.: + tarefa
export const HEAD_BTN: CSSProperties = { padding: '2px 8px', fontSize: 10, textTransform: 'none' }
// Acao secundaria: link discreto
export const LINK_BTN: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 2 }

export function LinkButton({ children, onClick, disabled, title, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...LINK_BTN, color: danger ? 'var(--negative)' : LINK_BTN.color, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      {children}
    </button>
  )
}

// Titulo do bloco: icone + texto + "?" (com exemplo) e, a direita, um botao pequeno
// helpTitle: titulo do balao do "?" sem a contagem (ex.: "Tarefas", nao "Tarefas (2)")
export function PanelTitle({ icon, label, help, helpTitle, right, onClick, style }: { icon?: ReactNode; label: ReactNode; help: ReactNode; helpTitle?: string; right?: ReactNode; onClick?: () => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, ...style }}>
      <div onClick={onClick} style={{ ...PANEL_TITLE, flex: 1, cursor: onClick ? 'pointer' : 'default' }}>
        {icon} {label}
        <HelpTip title={helpTitle ?? (typeof label === 'string' ? label : undefined)}>{help}</HelpTip>
      </div>
      {right}
    </div>
  )
}

// --- Cartoes do bloco Cadencia (etapa e avulsa), no visual do bloco antigo de cadencia ---
// Cartao de dentro do bloco (etapa em cima, avulsa embaixo)
export const CADENCE_INNER: CSSProperties = { padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)', marginTop: 8 }
// Nome em negrito (pode quebrar linha)
export const CARD_NAME: CSSProperties = { flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, overflowWrap: 'anywhere' }
// Linha laranja "Etapa 6/7: MENSAGEM"
export const STEP_LINE: CSSProperties = { fontSize: 11, color: '#FFB300', marginTop: 2 }
// Descricao/instrucoes em cinza italico
export const STEP_DESC: CSSProperties = { fontSize: 11, color: '#9B96B0', marginTop: 2, fontStyle: 'italic' }
// Botoes pequenos do cabecalho do cartao (Editar/Remover/Trocar)
export const PILL_BTN: CSSProperties = { padding: '2px 6px', fontSize: 9 }

// Texto do passo numa caixa creme (previa; editar e na janela Conferir mensagem). ~4 linhas com rolagem.
export function TextPreview({ text, placeholder }: { text: string; placeholder: string }) {
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', minHeight: 44, maxHeight: 82, overflowY: 'auto', fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', borderRadius: 6, background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)', color: text ? 'var(--text-primary)' : '#6B6580', fontStyle: text ? 'normal' : 'italic' }}>
      {text || placeholder}
    </div>
  )
}

type Act = { id: string; label: string }
const ACT_ICON: Record<string, ReactNode> = {
  enviar: <Send size={10} />, perguntar: <Send size={10} />, ligar: <Phone size={10} />, feito: <Check size={10} />, ja_sei: <Pencil size={10} />,
}

// Botao principal (laranja, largura toda), botao secundario (cinza, largura toda, com seta) e links pequenos
export function StepButtons({ primary, secondary, links, run, disabled, busyId, titles }: {
  primary: Act | null; secondary: Act | null; links: Act[]; run: (id: string) => void
  disabled?: boolean; busyId?: string | null; titles?: Record<string, string>
}) {
  const label = (a: Act) => (busyId === a.id ? 'Salvando...' : a.label)
  return (
    <>
      {primary && (
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8, width: '100%', fontSize: 11 }} disabled={disabled} onClick={() => run(primary.id)} title={titles?.[primary.id]}>
          {ACT_ICON[primary.id]} {label(primary)}
        </button>
      )}
      {secondary && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%', fontSize: 10 }} disabled={disabled} onClick={() => run(secondary.id)} title={titles?.[secondary.id]}>
          <ChevronRight size={10} /> {label(secondary)}
        </button>
      )}
      {links.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 6 }}>
          {links.map(a => <LinkButton key={a.id} disabled={disabled} onClick={() => run(a.id)} title={titles?.[a.id]}>{label(a)}</LinkButton>)}
        </div>
      )}
    </>
  )
}
