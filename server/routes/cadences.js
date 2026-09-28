// Casca de producao das rotas de cadencias: injeta o banco real, a IA do roteiro e o SSE.
// Toda a logica (e os testes HTTP) vive em cadencesRouter.js, que recebe db.
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { createCadencesRouter } from './cadencesRouter.js'
import { createRoteiroAi } from '../services/roteiro/aiAdapter.js'

export default createCadencesRouter(db, { ai: createRoteiroAi(db), broadcast: broadcastSSE })
