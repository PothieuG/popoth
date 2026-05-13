import { z } from 'zod'
import { moneySchema } from './common'

const budgetNameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom du budget est requis (minimum 2 caractères)')

export const createBudgetBodySchema = z.object({
  name: budgetNameSchema,
  estimatedAmount: moneySchema,
})

/**
 * PUT is full-replacement on (name, estimatedAmount) — same shape as POST.
 * The route enforces ownership before applying the update.
 */
export const updateBudgetBodySchema = z.object({
  name: budgetNameSchema,
  estimatedAmount: moneySchema,
})

export type CreateBudgetBody = z.infer<typeof createBudgetBodySchema>
export type UpdateBudgetBody = z.infer<typeof updateBudgetBodySchema>
