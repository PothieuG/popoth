import { z } from 'zod'
import { moneySchema } from './common'

const incomeNameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom du revenu est requis (minimum 2 caractères)')

export const createIncomeBodySchema = z.object({
  name: incomeNameSchema,
  estimatedAmount: moneySchema,
})

/**
 * PUT is full-replacement on (name, estimatedAmount) — same shape as POST.
 * The route enforces ownership before applying the update.
 */
export const updateIncomeBodySchema = z.object({
  name: incomeNameSchema,
  estimatedAmount: moneySchema,
})

export type CreateIncomeBody = z.infer<typeof createIncomeBodySchema>
export type UpdateIncomeBody = z.infer<typeof updateIncomeBodySchema>
