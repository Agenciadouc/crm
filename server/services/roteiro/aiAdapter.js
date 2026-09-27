// Casca de producao da IA do roteiro: liga orcamento (canAnalyze), chave da conta e
// callHaiku ao adaptador puro (aiCall.js). Importa db.js indiretamente, por isso fica
// fora dos servicos testados com banco em memoria.
import { callHaiku, resolveAnthropicKey } from '../anthropicClient.js'
import { canAnalyze } from '../conversationAnalyzer.js'
import { buildRoteiroAi } from './aiCall.js'

export function createRoteiroAi(db) {
  return buildRoteiroAi({ db, canAnalyze, resolveKey: resolveAnthropicKey, callModel: callHaiku })
}
