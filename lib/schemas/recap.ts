import { z } from 'zod'

import { contextSchema } from './common'

/**
 * Body schema for POST /api/monthly-recap/complete — V2 ossature.
 *
 * Marks the current month as closed for the (profile|group). Stub endpoint
 * for the ossature minimale ; the functional V2 flow (step1, transferts,
 * auto-balance, snapshots) will land in follow-up sprints with richer
 * schemas under this same file.
 */
export const completeV2BodySchema = z.object({
  context: contextSchema,
})

export type CompleteV2Body = z.infer<typeof completeV2BodySchema>
