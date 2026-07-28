// Banner exibido pra atendente sem instancia WhatsApp atribuida.
// Usado em Integrations, Chat, Leads (Novo Lead), etc.
export function BlockedBanner({ message }: { message?: string }) {
  const text = message ?? 'Sua conta ainda nao foi vinculada a um WhatsApp. Peca pro gerente atribuir uma instancia em Equipe > Editar.'
  return (
    <div style={{
      padding: '16px 20px',
      margin: '20px 0',
      background: '#fef3c7',
      border: '1px solid #f59e0b',
      borderRadius: 8,
      color: '#78350f',
      fontSize: 14,
      lineHeight: 1.5,
    }}>
      <strong>Aguarde atribuicao</strong>
      <div style={{ marginTop: 4 }}>{text}</div>
    </div>
  )
}
