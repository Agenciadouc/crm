// Chamadas de /api/panel-layouts ("Arrumar" a aba Atendimento). Todas levam ?account_id=.
// Formatos conferidos em server/routes/panelLayoutsRouter.js.
import { apiFetch } from './api'
import type { PanelBlock, SavedLayouts } from './panelLayout.js'

const url = (accountId: number, suffix = '') => `/api/panel-layouts/atendimento${suffix}?account_id=${accountId}`
const put = (layout: PanelBlock[]): RequestInit => ({ method: 'PUT', body: JSON.stringify({ layout }) })

export const fetchAtendimentoLayouts = (accountId: number) => apiFetch<SavedLayouts>(url(accountId))
export const saveMyAtendimentoLayout = (accountId: number, layout: PanelBlock[]) =>
  apiFetch<{ layout: PanelBlock[] }>(url(accountId, '/me'), put(layout)).then(d => d.layout)
export const resetMyAtendimentoLayout = (accountId: number) => apiFetch(url(accountId, '/me'), { method: 'DELETE' })
export const saveAccountAtendimentoLayout = (accountId: number, layout: PanelBlock[]) =>
  apiFetch<{ layout: PanelBlock[] }>(url(accountId, '/account'), put(layout)).then(d => d.layout)
