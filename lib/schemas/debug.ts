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
