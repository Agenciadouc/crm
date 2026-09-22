export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface TimeSlot { start: string; end: string }
export type Schedule = Record<DayKey, TimeSlot[]>

export declare const DAY_KEYS: DayKey[]
export declare const DAY_LABELS: Record<DayKey, string>
export declare function defaultSchedule(): Schedule

export interface FirstMessageState {
  text: string
  onAssign: boolean
  onInbound: boolean
  conflict: { otherText: string } | null
}
export declare function resolveFirstMessage(input?: {
  first_msg_template?: string | null
  greeting_text?: string | null
  greeting_enabled?: number | boolean | null
}): FirstMessageState
export declare function buildFirstMessageSave(state: { text: string; onAssign: boolean; onInbound: boolean }): {
  first_msg_template: string | null
  greeting_text: string | null
  greeting_enabled: 0 | 1
}

export interface ServiceHoursState { schedule: Schedule; holdSends: boolean; conflict: boolean }
export declare function resolveServiceHours(input?: {
  away_schedule_json?: string | null
  business_hours_json?: string | null
}): ServiceHoursState
export declare function buildServiceHoursSave(schedule: Schedule, holdSends: boolean): {
  away_schedule_json: string
  hold_sends_outside_hours: boolean
}
export declare function scheduleErrors(schedule: Schedule): string[]
export declare const HOLD_WITHOUT_HOURS_MSG: string
export declare function holdSendsError(schedule: Schedule, holdSends: boolean): string | null
