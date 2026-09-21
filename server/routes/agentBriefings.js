// Casca de producao das rotas da entrevista: injeta o banco real no router.
// Toda a logica (e os testes HTTP) vive em agentBriefingsRouter.js, que nao
// importa server/db.js justamente para poder rodar com banco em memoria.

import db from '../db.js'
import { createAgentBriefingsRouter, statusForError } from './agentBriefingsRouter.js'

export { statusForError }

export default createAgentBriefingsRouter(db)
