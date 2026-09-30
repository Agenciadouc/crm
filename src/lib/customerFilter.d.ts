export interface CustomerFilter { curve: 'A' | 'B' | 'C' | 'D' | '1a' | null; tierId: number | null; late: boolean }
export interface CustomerFilterParams { curve?: string; tier_id?: number; repurchase_late?: '1' }
export const EMPTY_CUSTOMER_FILTER: Readonly<CustomerFilter>
export function isCustomerFilterActive(filter: CustomerFilter | null | undefined): boolean
export function countCustomerFilters(filter: CustomerFilter | null | undefined): number
export function encodeCustomerFilter(filter: CustomerFilter | null | undefined): string
export function parseCustomerFilter(str: string | null | undefined): CustomerFilter
export function customerParams(filter: CustomerFilter | null | undefined): CustomerFilterParams
export function customerFilterLabel(filter: CustomerFilter | null | undefined, tiers?: { id: number; name: string }[]): string
export function useCustomerFilter(accountId: number | null | undefined): [CustomerFilter, (f: CustomerFilter) => void]
