import { z } from 'zod'

/**
 * POST /api/debug/reset-all body — no input expected. Empty object schema
 * pinned for visual consistency with the rest of the repo's Zod coverage.
 * The handler tolerates an absent body (inline try/catch + safeParse).
 */
export const resetAllBodySchema = z.object({}).strict()
export type ResetAllBody = z.infer<typeof resetAllBodySchema>

/**
 * POST /api/debug/reset-budgets body — no input expected. Same pattern as
 * `resetAllBodySchema`.
 */
export const resetBudgetsBodySchema = z.object({}).strict()
export type ResetBudgetsBody = z.infer<typeof resetBudgetsBodySchema>
