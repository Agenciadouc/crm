export function isSendProvider(provider: string | null | undefined): boolean
export function roleLabel(role: 'leitura' | 'disparo' | string | null | undefined): 'Leitura' | 'Disparo'
export function sendStatusMessage(reason: string | null | undefined): string | null
export function lacksQuestion(text: string | null | undefined): boolean
export function needsVariety(step: { message_template?: string | null; variations?: string[] | string | null }): boolean
export function formatReplyRate(rr: { reached: number; replied: number; rate: number | null } | null | undefined): string | null
