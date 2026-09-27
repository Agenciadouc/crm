// Casca de producao das rotas do roteiro: injeta o banco real no router. Toda a
// logica (e os testes HTTP) vive em roteiroRouter.js, que nao importa server/db.js
// justamente para poder rodar com banco em memoria (ver agentBriefings.js).
// `ai` fica null ate a Task 13 ligar a chamada real de IA na rota /ai-draft.
import db from '../db.js'
import { createRoteiroRouter } from './roteiroRouter.js'

export default createRoteiroRouter(db)
