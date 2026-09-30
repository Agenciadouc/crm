// IA de producao da recompra: mesmo adaptador e orcamento do roteiro. Importa db.js indiretamente (so producao).
import { canRoteiroAi } from '../aiBudget.js'
import { createRoteiroAi } from '../roteiro/aiAdapter.js'

export function repurchaseAiFor(db, accountId) {
  try { return canRoteiroAi(db, accountId).ok ? createRoteiroAi(db) : null } catch { return null }
}
