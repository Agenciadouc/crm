// Liga os servicos de entrada (leadIntake, inboundHandler) as dependencias reais (banco, SSE, CAPI, IA).
// Nao importar nos testes.
import db from '../db.js'
import { triggerCapiForStageChange } from './metaCapi.js'
import { pickFromRoulette } from './roulette.js'
import { notifyAndOpenLead } from './leadHandoff.js'
import { createLeadIntake } from './leadIntake.js'

export const leadIntake = createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange })
