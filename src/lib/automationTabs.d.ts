export type Aba = 'manuais' | 'automaticas'
export declare const AUTOMATION_PATH: string
export declare const ABAS: Aba[]
export declare function parseAba(search?: string | null): Aba
export declare function automationUrl(aba: Aba, search?: string | null): string
export declare function legacyAutomationRedirect(pathname: string, search?: string | null): string
