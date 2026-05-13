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
