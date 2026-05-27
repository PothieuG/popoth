import { z } from 'zod'
import {
  isoDateSchema,
  moneyFormSchema,
  moneySchema,
  nonNegativeMoneySchema,
  uuidSchema,
} from './common'

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

/**
 * Client-form variants used by AddIncomeDialog + EditIncomeDialog. Same
 * shape as the server schemas but `estimatedAmount` is coerced from
 * string|number (form input is text + inputMode="decimal").
 */
export const createIncomeFormSchema = z.object({
  name: incomeNameSchema,
  estimatedAmount: moneyFormSchema,
})
export const updateIncomeFormSchema = z.object({
  name: incomeNameSchema,
  estimatedAmount: moneyFormSchema,
})
export type CreateIncomeForm = z.infer<typeof createIncomeFormSchema>
export type UpdateIncomeForm = z.infer<typeof updateIncomeFormSchema>

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

/**
 * Sprint Salary-Auto-At-Recap-Complete (2026-06-05).
 * POST /api/finance/income/real/validate-salary body — appelé par la modal
 * SalaryValidationModal (long-press sur une ligne salaire non-validée).
 *
 *   - income_id : id de la ligne salaire (real_income_entries) à valider.
 *     Le serveur vérifie qu'elle a recap_origin_id IS NOT NULL ET
 *     applied_to_balance_at IS NULL avant d'appeler le RPC.
 *   - real_amount : le montant réellement perçu. Si différent de la valeur
 *     pré-remplie (= la ligne.amount), le delta génère un revenu/dépense
 *     exceptionnel "Équilibrage salaire" auto-validé. nonNegative pour
 *     accepter un salaire à 0 (cas du user qui finalement n'a rien touché —
 *     créerait une dépense exceptionnelle pour le full montant).
 */
export const validateSalaryBodySchema = z.object({
  income_id: uuidSchema,
  real_amount: nonNegativeMoneySchema,
})
export type ValidateSalaryBody = z.infer<typeof validateSalaryBodySchema>

/**
 * Sprint Salary-Auto-At-Recap-Complete (2026-06-05). Variante client-form
 * pour SalaryValidationModal. `realAmount` coerce string|number→number (le
 * DecimalFormInput émet du string normalisé). nonNegative comme côté API.
 */
export const validateSalaryFormSchema = z.object({
  realAmount: z.coerce
    .number()
    .finite('Montant invalide')
    .nonnegative('Le montant doit être positif ou nul')
    .refine((v) => Math.round(v * 100) === v * 100, {
      message: 'Au maximum 2 décimales',
    }),
})
export type ValidateSalaryForm = z.infer<typeof validateSalaryFormSchema>

/**
 * Estimated income create body. Snake_case because the handler at
 * `lib/api/finance/income-estimated.ts` writes verbatim to
 * `estimated_incomes`. Mirrors `createEstimatedBudgetBodySchema` in
 * `./budget`.
 *
 * `is_monthly_recurring` defaults to `true` and `is_for_group` to `false`
 * at the route level (preserved verbatim in the handler destructure).
 */
export const createEstimatedIncomeBodySchema = z.object({
  name: incomeNameSchema,
  estimated_amount: moneySchema,
  is_monthly_recurring: z.boolean().optional(),
  is_for_group: z.boolean().optional(),
})

/**
 * Estimated income update body. `id` required, every other field optional.
 * Refine: at least one update field must be provided.
 */
export const updateEstimatedIncomeBodySchema = z
  .object({
    id: uuidSchema,
    name: incomeNameSchema.optional(),
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

export type CreateEstimatedIncomeBody = z.infer<typeof createEstimatedIncomeBodySchema>
export type UpdateEstimatedIncomeBody = z.infer<typeof updateEstimatedIncomeBodySchema>
