import { z } from 'zod'
import { contextSchema } from './common'

/**
 * POST /api/debug/retrigger-recap body — optional `context` (defaults to
 * profile). The route accepts an empty body (no JSON at all) and falls
 * back to defaults; the handler does inline empty-body tolerance before
 * calling safeParse on the parsed-or-empty body.
 *
 * Note: All /api/debug/* routes are gated by `blockInProduction()` (404
 * in prod). Schemas exist for dev parity + future-proof.
 */
export const retriggerRecapBodySchema = z.object({
  context: contextSchema.optional().default('profile'),
})
export type RetriggerRecapBody = z.infer<typeof retriggerRecapBodySchema>

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
