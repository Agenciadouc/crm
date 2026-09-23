export declare function whatsappTileStatus(args: { instances: { status: string }[]; loadError: boolean }): string
export interface LatestRequest<K = unknown> {
  begin(key: K): number
  isLatest(ticket: number, currentKey: K): boolean
}
export declare function createLatestRequest<K = unknown>(): LatestRequest<K>
