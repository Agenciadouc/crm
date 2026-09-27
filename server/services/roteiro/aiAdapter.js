// Casca de producao da IA do roteiro: liga orcamento proprio do roteiro (canRoteiroAi),
// chave da conta e callHaiku ao adaptador puro (aiCall.js). Importa anthropicClient (que
// usa db.js), por isso fica fora dos servicos testados com banco em memoria.
import { callHaiku, resolveAnthropicKey } from '../anthropicClient.js'
import { canRoteiroAi } from '../aiBudget.js'
import { buildRoteiroAi } from './aiCall.js'

export function createRoteiroAi(db) {
  return buildRoteiroAi({ db, canAnalyze: accountId => canRoteiroAi(db, accountId), resolveKey: resolveAnthropicKey, callModel: callHaiku })
}
