// Filtro de cliente (curva/selo/atrasado na recompra) do botao "Mais filtros..." em Leads/Pipeline
// e da tela Clientes (spec LTV/Recompra §10.5/§12). Fica guardado no navegador por conta
// (customerFilter:<accountId>) como JSON — mesmo padrao do scoreFilter.js.
import { useEffect, useState } from 'react'

const CURVES = ['A', 'B', 'C', 'D', '1a']

export const EMPTY_CUSTOMER_FILTER = Object.freeze({ curve: null, tierId: null, late: false })

function normalize(raw) {
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const curve = CURVES.includes(f.curve) ? f.curve : null
  const tierIdNum = Number(f.tierId)
  const tierId = Number.isInteger(tierIdNum) && tierIdNum > 0 ? tierIdNum : null
  const late = f.late === true
  return { curve, tierId, late }
}

export function isCustomerFilterActive(filter) {
  const f = normalize(filter)
  return f.curve !== null || f.tierId !== null || f.late
}

// Quantos filtros de cliente estao ligados
export function countCustomerFilters(filter) {
  const f = normalize(filter)
  return (f.curve !== null ? 1 : 0) + (f.tierId !== null ? 1 : 0) + (f.late ? 1 : 0)
}

export function encodeCustomerFilter(filter) {
  if (!isCustomerFilterActive(filter)) return ''
  return JSON.stringify(normalize(filter))
}

export function parseCustomerFilter(str) {
  if (!str) return { ...EMPTY_CUSTOMER_FILTER }
  try { return normalize(JSON.parse(str)) } catch { return { ...EMPTY_CUSTOMER_FILTER } }
}

// Parametros da API (GET /api/leads e GET /api/customers/*, server/services/ltv/filters.js
// customerWhere): so os que existem.
export function customerParams(filter) {
  const f = normalize(filter)
  const out = {}
  if (f.curve) out.curve = f.curve
  if (f.tierId) out.tier_id = f.tierId
  if (f.late) out.repurchase_late = '1'
  return out
}

export function customerFilterLabel(filter, tiers = []) {
  const f = normalize(filter)
  const parts = []
  if (f.curve) parts.push(f.curve === '1a' ? '1ª compra' : `Curva ${f.curve}`)
  if (f.tierId) { const t = (tiers || []).find(x => x.id === f.tierId); if (t) parts.push(t.name) }
  if (f.late) parts.push('atrasado')
  return parts.join(' · ')
}

const storageKey = accountId => `customerFilter:${accountId}`

// Filtro de cliente guardado no navegador por conta
const readCustomerFilter = accountId => {
  if (!accountId) return { ...EMPTY_CUSTOMER_FILTER }
  try { return parseCustomerFilter(localStorage.getItem(storageKey(accountId))) } catch { return { ...EMPTY_CUSTOMER_FILTER } }
}

export function useCustomerFilter(accountId) {
  // Ja nasce com o filtro salvo: evita buscar a lista sem filtro e depois de novo com filtro
  const [filter, setFilterState] = useState(() => readCustomerFilter(accountId))
  useEffect(() => {
    // Troca de conta: le o filtro da outra conta; mesmo valor mantem o objeto (sem nova busca)
    const next = readCustomerFilter(accountId)
    setFilterState(prev => (encodeCustomerFilter(prev) === encodeCustomerFilter(next) ? prev : next))
  }, [accountId])
  const setFilter = f => {
    setFilterState(f)
    if (!accountId) return
    try {
      const enc = encodeCustomerFilter(f)
      if (enc) localStorage.setItem(storageKey(accountId), enc)
      else localStorage.removeItem(storageKey(accountId))
    } catch {}
  }
  return [filter, setFilter]
}
