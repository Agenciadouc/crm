import type { ScoreBand } from './score'
export interface ScoreFilter { bands: ScoreBand[]; min: number | null; fit: boolean; engagement: boolean }
export interface ScoreParams { score_bands?: string; score_min?: number; fit?: 'AB'; engagement?: 'high' }
export const EMPTY_SCORE_FILTER: Readonly<ScoreFilter>
export function isScoreFilterActive(filter: ScoreFilter | null | undefined): boolean
export function countScoreFilters(filter: ScoreFilter | null | undefined): number
export function encodeScoreFilter(filter: ScoreFilter | null | undefined): string
export function parseScoreFilter(str: string | null | undefined): ScoreFilter
export function scoreParams(filter: ScoreFilter | null | undefined): ScoreParams
export function scoreFilterLabel(filter: ScoreFilter | null | undefined): string
export function leadMatchesScore(lead: { score?: number | null; score_band?: string | null; score_fit_grade?: string | null; score_engagement?: number | null } | null | undefined, filter: ScoreFilter | null | undefined): boolean
