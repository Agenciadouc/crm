export interface SplitQuestionLike { question_key: string; required: boolean; answer: unknown }
export function splitCurrentStage<Q extends SplitQuestionLike>(
  stage: { questions: Q[] } | null | undefined,
  nextKey: string | null | undefined,
): { next: Q | null; pending: Q[]; answered: Q[] }
export function progressText(progress: { answered: number; total: number } | null | undefined): string
export function bulkMoveSummary(result: { moved?: number; blocked?: unknown[] } | null | undefined): string
export function displayQuestionText(text: string | null | undefined): string
export function stageName(roteiro: { stages: { id: number; name: string }[] } | null | undefined, stageId: number | null | undefined): string
