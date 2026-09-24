export interface Geo { uf: string; city: string }
export function parseGeo(value: string | null | undefined): Geo
export function encodeGeo(uf: string | null | undefined, city: string | null | undefined): string
export function geoParams(value: string | null | undefined): { city?: string; uf?: string }
export function geoQuery(value: string | null | undefined): string
export function geoLabel(value: string | null | undefined): string
export function leadMatchesGeo(lead: { uf?: string | null; city?: string | null } | null | undefined, value: string | null | undefined): boolean
