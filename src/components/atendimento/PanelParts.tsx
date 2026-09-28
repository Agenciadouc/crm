import type { CSSProperties, ReactNode } from 'react'
import HelpTip from '../HelpTip'

// Peças comuns dos blocos da aba Atendimento do Chat: mesmo titulo pequeno em maiusculas com "?",
// mesmo cartao (padding e borda), um botao principal laranja e acoes secundarias como link.

// Cartao de um bloco (use com className="card")
export const PANEL_CARD: CSSProperties = { padding: 12, marginBottom: 12 }
// Cartao dentro do bloco Cadencia (etapa e avulsa, um embaixo do outro)
export const CADENCE_CARD: CSSProperties = { padding: 12, marginBottom: 8 }
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
