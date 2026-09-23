export type NoticeKind = 'error' | 'success'
export interface Notice { kind: NoticeKind; text: string }
export declare const NOTICE_AUTO_HIDE_MS: number
export declare function errorNotice(prefix: string, err: unknown): Notice
export declare function successNotice(text: string): Notice
export declare function noticeAutoHideMs(notice: Notice | null | undefined): number | null
