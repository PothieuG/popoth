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

/**
 * POST /api/debug/recap-v2/reset body — Sprint Recap-V2-Dev-Tools
 * (2026-05-22). Drops the V2 recap row for the current month so the gating
 * redirects to /monthly-recap on next nav. Optional `context` (defaults to
 * profile) — mirror of retriggerRecapBodySchema.
 */
export const resetRecapV2BodySchema = z.object({
  context: contextSchema.optional().default('profile'),
})
export type ResetRecapV2Body = z.infer<typeof resetRecapV2BodySchema>

/**
 * POST /api/debug/recap-v2/seed body — Sprint Recap-V2-Dev-Tools
 * (2026-05-22). Applies a declarative scenario (see
 * `lib/dev/recap-v2-scenarios.ts`) to the user's finances. The scenario
 * literal is validated against the known keys to fail fast on typos.
 */
export const seedRecapV2BodySchema = z.object({
  scenario: z.enum([
    'fresh',
    'happy-surplus',
    'deficit-light',
    'deficit-cascade',
    'with-group',
    'edge-empty-piggy',
  ]),
})
export type SeedRecapV2Body = z.infer<typeof seedRecapV2BodySchema>
