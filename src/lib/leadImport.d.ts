export const MAX_ROWS: number
export interface ImportField { key: string; label: string; unique: boolean }
export const FIELDS: ImportField[]
export interface ImportRow { row: number; fields: Record<string, string | number | string[]>; extra: Record<string, string> }
export function suggestField(header: string): string
export function uniqueHeaders(headers: string[]): string[]
export function autoMapping(headers: string[]): string[]
export function setMapping(mapping: string[], index: number, key: string): string[]
export function buildRows(headers: string[], data: unknown[][], mapping: string[]): ImportRow[]
export function parseMoney(v: unknown): number | null
export function cleanInstagram(v: unknown): string
export function maskPhone(v: unknown): string
export function decodeText(bytes: Uint8Array): string
export function skippedCsv(headers: string[], data: unknown[][], skipped: Array<{ row: number; reason: string }>): string
