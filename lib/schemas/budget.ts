import { z } from 'zod'
import { moneyFormSchema, moneySchema, uuidSchema } from './common'

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

/**
 * Estimated budget create body. Snake_case because the handler at
 * `lib/api/finance/budgets-estimated.ts` writes verbatim to
 * `estimated_budgets`. Distinct from `createBudgetBodySchema` which is
 * camelCase + targets a different handler (`lib/api/finance/budgets.ts`,
 * also writes to `estimated_budgets` but with the v1 contract).
 *
 * `is_monthly_recurring` defaults to `true` and `is_for_group` to `false`
 * at the route level (preserved verbatim in the handler destructure).
 */
export const createEstimatedBudgetBodySchema = z.object({
  name: budgetNameSchema,
  estimated_amount: moneySchema,
  is_monthly_recurring: z.boolean().optional(),
  is_for_group: z.boolean().optional(),
})

/**
 * Estimated budget update body. `id` required, every other field optional.
 * Refine: at least one update field must be provided.
 */
export const updateEstimatedBudgetBodySchema = z
  .object({
    id: uuidSchema,
    name: budgetNameSchema.optional(),
    estimated_amount: moneySchema.optional(),
    is_monthly_recurring: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.estimated_amount !== undefined ||
      d.is_monthly_recurring !== undefined,
    { message: 'Aucune donnée à mettre à jour' },
  )

export type CreateEstimatedBudgetBody = z.infer<typeof createEstimatedBudgetBodySchema>
export type UpdateEstimatedBudgetBody = z.infer<typeof updateEstimatedBudgetBodySchema>

/**
 * Client-side factory for AddBudgetDialog + EditBudgetDialog. The refine
 * gate "newBudgetsTotal <= totalEstimatedIncome" depends on parent props
 * (currentBudgetsTotal, totalEstimatedIncome) so the schema must be built
 * at render time. Memoize the result via useMemo on the calling component
 * to keep the resolver identity stable across renders.
 *
 * Add case  : currentBudgetAmount = 0
 * Edit case : currentBudgetAmount = editing.estimated_amount (so the
 *             current value is subtracted from the running total before
 *             adding the new one — net delta is what matters)
 */
export function makeBudgetClientSchema(opts: {
  currentBudgetsTotal: number
  totalEstimatedIncome: number
  currentBudgetAmount?: number
}) {
  const { currentBudgetsTotal, totalEstimatedIncome, currentBudgetAmount = 0 } = opts
  return z
    .object({
      name: budgetNameSchema,
      estimatedAmount: moneyFormSchema,
    })
    .refine(
      (d) => {
        const newTotal = currentBudgetsTotal - currentBudgetAmount + d.estimatedAmount
        return totalEstimatedIncome - newTotal >= 0
      },
      {
        message:
          'Impossible : le reste à vivre (sans économies) deviendrait négatif. Réduisez le montant ou ajoutez des revenus.',
        path: ['estimatedAmount'],
      },
    )
}
