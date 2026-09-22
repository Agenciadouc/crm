export type WhatsAppProviderId = 'uzapi' | 'evolution'
export declare const PROVIDER_LABELS: Record<WhatsAppProviderId, string>
export declare function providerLabel(p?: string | null): string
export declare function normalizeProviders(raw: unknown): WhatsAppProviderId[]
export declare function defaultProvider(list: WhatsAppProviderId[] | null | undefined): WhatsAppProviderId
export declare function qrImageSrc(qr?: string | null): string | null
