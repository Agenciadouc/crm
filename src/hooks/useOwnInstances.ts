import { useEffect, useState } from 'react'
import { fetchWhatsAppInstances, type WhatsAppInstance } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// Retorna as instancias WhatsApp visiveis pro usuario logado.
// Backend (GET /api/integrations/whatsapp) ja aplica o filtro por role:
//   - super_admin/gerente: todas as instancias da conta
//   - atendente: apenas a atribuida via users.primary_instance_id (ou [] se nao atribuido)
// Este hook so consulta e expoe loading/error + flag blocked (atendente sem instancia).
export function useOwnInstances(accountId: number | null | undefined) {
  const { user } = useAuth()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) { setInstances([]); return }
    setLoading(true)
    setError(null)
    fetchWhatsAppInstances(accountId)
      .then(list => setInstances(list || []))
      .catch(e => setError(e?.message || 'Erro ao carregar instancias'))
      .finally(() => setLoading(false))
  }, [accountId])

  const isAtendente = user?.role === 'atendente'
  const isBlocked = isAtendente && !user?.primary_instance_id
  const hasNoInstance = isAtendente && instances.length === 0

  return { instances, loading, error, isBlocked, hasNoInstance }
}
