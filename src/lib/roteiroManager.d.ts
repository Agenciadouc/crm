export type QualificacaoTab = 'roteiro' | 'desempenho' | 'sugestoes'
export const QUALIFICACAO_TABS: QualificacaoTab[]
export function parseTab(search: string | null | undefined): QualificacaoTab
export function fmtPct(n: number | null | undefined): string

interface OptionLike { label: string; points: number | string; option_key?: string; position?: number }
interface QuestionLike {
  question_key: string; stage_id: number; position: number; text: string; kind: 'text' | 'options'
  required: boolean; spin: string | null; profile_key?: string | null; ai_hint: string | null; options: OptionLike[]
}
interface DeviationLike { triggers: string; reply_text: string; return_question_key: string | null; position?: number }
interface ContentLike { questions: QuestionLike[]; deviations: DeviationLike[] }

export function maxProfilePoints(questions: { kind: string; options: { points: number | string }[] }[] | null | undefined): number
export function profileMaxText(points: number): string
export function newLocalKey(): string
export function stageQuestions<Q extends { stage_id: number; position: number }>(questions: Q[] | null | undefined, stageId: number): Q[]
export function moveQuestion<Q extends QuestionLike>(questions: Q[], key: string, dir: -1 | 1): Q[]
export function moveToStage<Q extends QuestionLike>(questions: Q[], key: string, stageId: number): Q[]
export function addQuestion<Q extends QuestionLike>(questions: Q[], stageId: number, key?: string): Q[]
export function removeQuestion<Q extends QuestionLike, D extends DeviationLike>(questions: Q[], deviations: D[], key: string): { questions: Q[]; deviations: D[] }
export function changeKind<Q extends QuestionLike>(question: Q, kind: 'text' | 'options'): Q
export function sameContent(a: ContentLike | null | undefined, b: ContentLike | null | undefined): boolean
export function hasUnpublished(roteiro: { draft: ContentLike | null; published: ContentLike | null } | null | undefined): boolean
export function hasAnyQuestions(roteiro: { draft: ContentLike | null; published: ContentLike | null } | null | undefined): boolean
export function previousVersions<V extends { status: string; version: number }>(versions: V[] | null | undefined): V[]
export function toDraftInput(content: ContentLike): {
  questions: (Omit<QuestionLike, 'options' | 'spin'> & { spin: any; profile_key: string | null; options: { option_key?: string; label: string; points: number; position: number; sets_profile_key?: string }[] })[]
  deviations: (DeviationLike & { position: number })[]
}

interface SuggestionLike { type: string; question_key?: string | null; payload: Record<string, any>; evidence: Record<string, any> | null }
export function suggestionWhy(s: SuggestionLike): string
export const SUGGESTION_TITLES: Record<'rewrite' | 'seller_phrasing' | 'new_option' | 'new_deviation' | 'reorder', string>
export function findSellerSuggestion<S extends SuggestionLike>(suggestions: S[] | null | undefined, questionKey: string, seller: { user_id: number; name: string | null } | null): S | null

interface TestLike { status: string; days_left?: number; a?: { sent: number; rate: number | null }; b?: { sent: number; rate: number | null } }
export function testRemainingText(test: TestLike): string
export function testResultText(test: TestLike): string
export function barWidth(rate: number | null | undefined): number
