// Casca de producao das rotas do roteiro: injeta o banco real no router. Toda a
// logica (e os testes HTTP) vive em roteiroRouter.js, que nao importa server/db.js
// justamente para poder rodar com banco em memoria (ver agentBriefings.js).
// `ai` e o adaptador de producao (orcamento, chave da conta e log de tokens).
import db from '../db.js'
import { createRoteiroRouter } from './roteiroRouter.js'
import { createRoteiroAi } from '../services/roteiro/aiAdapter.js'
import { broadcastSSE } from '../sse.js'

export default createRoteiroRouter(db, { ai: createRoteiroAi(db), broadcast: broadcastSSE })
