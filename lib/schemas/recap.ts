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
