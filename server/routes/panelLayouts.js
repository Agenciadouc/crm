// Casca de producao das rotas do "Arrumar": injeta o banco real.
// Toda a logica (e os testes HTTP) vive em panelLayoutsRouter.js, que recebe db.
import db from '../db.js'
import { createPanelLayoutsRouter } from './panelLayoutsRouter.js'

export default createPanelLayoutsRouter(db)
