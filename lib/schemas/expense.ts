import { z } from 'zod'
import { contextSchema, isoDateSchema, moneySchema, uuidSchema } from './common'

const descriptionSchema = z.string().trim().min(1, 'La description est requise')

/**
 * Real-expense create body. estimated_budget_id absent (or undefined) means
 * the expense is treated as exceptional (is_exceptional = !estimated_budget_id
 * in the route). is_for_group defaults to false at the route level.
 */
export const createRealExpenseBodySchema = z.object({
  amount: moneySchema,
  description: descriptionSchema,
  expense_date: isoDateSchema.optional(),
  estimated_budget_id: uuidSchema.optional(),
  is_for_group: z.boolean().optional(),
})

/**
 * Real-expense update body. id is required, everything else optional.
 * estimated_budget_id accepts null (untie from a budget → exceptional).
 * Refine: at least one update field must be defined (mirror L302 check).
 */
export const updateRealExpenseBodySchema = z
  .object({
    id: uuidSchema,
    amount: moneySchema.optional(),
    description: descriptionSchema.optional(),
    expense_date: isoDateSchema.optional(),
    estimated_budget_id: uuidSchema.nullable().optional(),
  })
  .refine(
    (d) =>
      d.amount !== undefined ||
      d.description !== undefined ||
      d.expense_date !== undefined ||
      d.estimated_budget_id !== undefined,
    { message: 'Aucune donnée à mettre à jour' },
  )

export type CreateRealExpenseBody = z.infer<typeof createRealExpenseBodySchema>
export type UpdateRealExpenseBody = z.infer<typeof updateRealExpenseBodySchema>

/**
 * Smart-allocation expense body. Same shape as createRealExpenseBodySchema —
 * the route dispatches on `estimated_budget_id` presence (absent =
 * exceptional path with direct INSERT; present = atomic RPC with piggy →
 * savings → budget breakdown). The dispatch is route-internal, not a
 * schema concern.
 */
export const addExpenseWithLogicBodySchema = createRealExpenseBodySchema
export type AddExpenseWithLogicBody = CreateRealExpenseBody

/**
 * Query schema for /api/finance/expenses/preview-breakdown GET. Computes
 * how an expense will be allocated without creating it. `expense_id`
 * optional (edit-mode reverses the existing allocation first).
 */
export const previewBreakdownQuerySchema = z.object({
  amount: z.coerce
    .number()
    .finite('Montant invalide')
    .positive('Le montant doit être positif')
    .refine((v) => Math.round(v * 100) === v * 100, {
      message: 'Au maximum 2 décimales',
    }),
  budget_id: uuidSchema,
  context: contextSchema.optional().default('profile'),
  expense_id: uuidSchema.optional(),
})
export type PreviewBreakdownQuery = z.infer<typeof previewBreakdownQuerySchema>
