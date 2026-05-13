import { z } from 'zod'
import { isoDateSchema, moneySchema, uuidSchema } from './common'

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

const incomeDescriptionSchema = z.string().trim().min(1, 'La description est requise')

/**
 * Real-income create body. estimated_income_id absent means the entry is
 * treated as exceptional. is_for_group defaults to false at the route level.
 */
export const createRealIncomeBodySchema = z.object({
  amount: moneySchema,
  description: incomeDescriptionSchema,
  entry_date: isoDateSchema.optional(),
  estimated_income_id: uuidSchema.optional(),
  is_for_group: z.boolean().optional(),
})

/**
 * Real-income update body. id required, everything else optional.
 * estimated_income_id accepts null (untie → exceptional).
 * Refine: at least one update field must be defined.
 */
export const updateRealIncomeBodySchema = z
  .object({
    id: uuidSchema,
    amount: moneySchema.optional(),
    description: incomeDescriptionSchema.optional(),
    entry_date: isoDateSchema.optional(),
    estimated_income_id: uuidSchema.nullable().optional(),
  })
  .refine(
    (d) =>
      d.amount !== undefined ||
      d.description !== undefined ||
      d.entry_date !== undefined ||
      d.estimated_income_id !== undefined,
    { message: 'Aucune donnée à mettre à jour' },
  )

export type CreateRealIncomeBody = z.infer<typeof createRealIncomeBodySchema>
export type UpdateRealIncomeBody = z.infer<typeof updateRealIncomeBodySchema>
