import { z } from 'zod'
import { contextSchema, moneySchema, nonNegativeMoneySchema, uuidSchema } from './common'

export const processStep1BodySchema = z.object({
  context: contextSchema,
})

export type ProcessStep1Body = z.infer<typeof processStep1BodySchema>

/**
 * POST /api/monthly-recap/auto-balance and /balance share the simplest body:
 * a single `context` discriminant.
 */
export const autoBalanceBodySchema = z.object({
  context: contextSchema,
})
export const balanceBodySchema = z.object({
  context: contextSchema,
})
export type AutoBalanceBody = z.infer<typeof autoBalanceBodySchema>
export type BalanceBody = z.infer<typeof balanceBodySchema>

/**
 * POST /api/monthly-recap/accumulate-piggy-bank — amount can be 0 (route
 * short-circuits the no-op case). nonNegativeMoneySchema mirrors the existing
 * manual check `typeof amount !== 'number' || amount < 0`.
 */
export const accumulatePiggyBankBodySchema = z.object({
  context: contextSchema,
  amount: nonNegativeMoneySchema,
})
export type AccumulatePiggyBankBody = z.infer<typeof accumulatePiggyBankBodySchema>

/**
 * POST /api/monthly-recap/transfer — manual budget→budget transfer in the
 * recap UI. `monthly_recap_id` is best-effort optional (cf. CLAUDE.md §5
 * note on its nullability). Refine enforces same-id rejection.
 */
export const manualTransferBodySchema = z
  .object({
    context: contextSchema,
    from_budget_id: uuidSchema,
    to_budget_id: uuidSchema,
    amount: moneySchema,
    monthly_recap_id: uuidSchema.nullable().optional(),
  })
  .refine((d) => d.from_budget_id !== d.to_budget_id, {
    message: 'Les budgets source et destination doivent être différents',
    path: ['to_budget_id'],
  })
export type ManualTransferBody = z.infer<typeof manualTransferBodySchema>

/**
 * POST /api/monthly-recap/complete — finalize the month's recap.
 *
 * The `remaining_to_live_choice` field is a nested discriminated union on
 * `action`. `deduct_from_budget` requires `budget_id` (uuid); `carry_forward`
 * has no extra fields. TS narrows downstream consumers correctly.
 *
 * `final_amount` is strengthened from the pre-existing `typeof !== 'number'`
 * check to `z.number().finite()` (rejects NaN/Infinity). Per the brief
 * "preserve the stricter of (preexisting check, proposed schema)".
 */
const remainingToLiveChoiceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('carry_forward'),
    final_amount: z.number().finite(),
  }),
  z.object({
    action: z.literal('deduct_from_budget'),
    budget_id: uuidSchema,
    final_amount: z.number().finite(),
  }),
])

export const completeBodySchema = z.object({
  context: contextSchema,
  session_id: z.string().min(1, 'session_id requis'),
  remaining_to_live_choice: remainingToLiveChoiceSchema,
})

export type CompleteBody = z.infer<typeof completeBodySchema>

/**
 * Query schema for /api/monthly-recap/refresh GET and /update-step GET.
 * Both take `?context=` + `?session_id=` (string-min-1). Used as the
 * baseline shape for the recap-with-session GET family.
 */
export const refreshRecapQuerySchema = z.object({
  context: contextSchema.optional().default('profile'),
  session_id: z.string().min(1, 'session_id requis'),
})
export type RefreshRecapQuery = z.infer<typeof refreshRecapQuerySchema>

/**
 * POST /api/monthly-recap/initialize body — kicks off a new monthly recap
 * for the current month. Defaults to profile context.
 */
export const initializeRecapBodySchema = z.object({
  context: contextSchema.optional().default('profile'),
})
export type InitializeRecapBody = z.infer<typeof initializeRecapBodySchema>

/**
 * POST /api/monthly-recap/recover body — restores a snapshot. `confirm` MUST
 * be literal `true` (the existing route check `if (!confirm)` is preserved
 * + tightened to reject any value other than `true`). `snapshot_id` optional
 * — if absent, the route picks the most recent.
 *
 * NOTE: The POST handler has a CLEANUP-ATTEMPT CRITIQUE at L297-306
 * (rollback partiel can leave snapshot active). Migration touches only
 * the top of the function — that block stays verbatim.
 */
export const recoverRecapBodySchema = z.object({
  context: contextSchema.optional().default('profile'),
  snapshot_id: uuidSchema.optional(),
  confirm: z.literal(true, {
    errorMap: () => ({
      message: 'La confirmation est requise pour effectuer une récupération',
    }),
  }),
})
export type RecoverRecapBody = z.infer<typeof recoverRecapBodySchema>

/**
 * session_id format: `{context}_{contextId}_{month}_{year}_{ts}`
 * (5 parts, ctx ∈ {profile,group}, month 1-12, year 4-digit, ts numeric).
 * The route still does a runtime cross-check that sessionContext/Id match
 * the current user/context (needs profile.id/group_id, out of schema reach).
 */
const sessionIdSchema = z
  .string()
  .min(1, 'session_id requis')
  .refine(
    (s) => {
      const parts = s.split('_')
      if (parts.length < 5) return false
      const [ctx, , monthStr, yearStr, tsStr] = parts
      if (ctx !== 'profile' && ctx !== 'group') return false
      const month = Number(monthStr)
      const year = Number(yearStr)
      const ts = Number(tsStr)
      return (
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        Number.isInteger(year) &&
        year >= 1900 &&
        year <= 9999 &&
        Number.isFinite(ts) &&
        ts > 0
      )
    },
    { message: 'Format de session_id invalide' },
  )

/**
 * POST /api/monthly-recap/update-step body. current_step 1-3 (in-range
 * mirror of the pre-Zod check). session_id structural check is tighter
 * than the original (which only checked `.length < 5`).
 */
export const updateRecapStepBodySchema = z.object({
  context: contextSchema.optional().default('profile'),
  session_id: sessionIdSchema,
  current_step: z.number().int().min(1).max(3, 'current_step doit être entre 1 et 3'),
})
export type UpdateRecapStepBody = z.infer<typeof updateRecapStepBodySchema>
