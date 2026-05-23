import { z } from 'zod'
import { contextSchema, uuidSchema } from './common'

/**
 * Positive amount with at-most-2-decimals constraint. Mirrors the refine
 * used by `moneySchema` in common.ts but kept local because the refloat
 * inputs come from the wizard (not the standard money forms).
 */
const positiveAmountSchema = z
  .number()
  .finite('Montant invalide')
  .positive('Le montant doit être positif')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

/**
 * Salary update entry — non-negative (a member can declare zero salary
 * for the month) with at-most-2-decimals.
 */
const salaryAmountSchema = z
  .number()
  .finite('Salaire invalide')
  .nonnegative('Le salaire doit être positif ou nul')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

/** Body POST /api/monthly-recap/start — claim the recap row + lock. */
export const startRecapBodySchema = z.object({
  context: contextSchema,
})
export type StartRecapBody = z.infer<typeof startRecapBodySchema>

/**
 * Body POST /api/monthly-recap/transfer-surpluses-to-piggy — sweep the
 * given budgets' positive surplus into the piggy bank. The list must be
 * non-empty (the endpoint refuses no-op calls).
 */
export const transferSurplusesBodySchema = z.object({
  context: contextSchema,
  budgetIds: z.array(uuidSchema).min(1, 'Au moins un budget requis'),
})
export type TransferSurplusesBody = z.infer<typeof transferSurplusesBodySchema>

/**
 * Body POST /api/monthly-recap/transform-remaining-surpluses-to-savings —
 * convert every remaining positive surplus into the budgets' cumulated_savings.
 * No id list: the endpoint sweeps whatever surplus is left at call time.
 */
export const transformRemainingBodySchema = z.object({
  context: contextSchema,
})
export type TransformRemainingBody = z.infer<typeof transformRemainingBodySchema>

/** Body POST /api/monthly-recap/refloat-from-piggy — debit piggy by `amount`. */
export const refloatFromPiggyBodySchema = z.object({
  context: contextSchema,
  amount: positiveAmountSchema,
})
export type RefloatFromPiggyBody = z.infer<typeof refloatFromPiggyBodySchema>

/**
 * Body POST /api/monthly-recap/refloat-from-savings — debit savings proportionally
 * across budgets up to the current deficit. The server computes the per-budget
 * allocation via `computeProportionalSavingsRefloat`, so the body carries the
 * context only.
 */
export const refloatFromSavingsBodySchema = z.object({
  context: contextSchema,
})
export type RefloatFromSavingsBody = z.infer<typeof refloatFromSavingsBodySchema>

/**
 * Body POST /api/monthly-recap/save-budget-snapshot — record the per-budget
 * proportional drawdown plan. The server computes the allocation via
 * `computeProportionalBudgetSnapshot` (proportional to `estimated_amount`) and
 * overwrites `monthly_recaps.budget_snapshot_data` JSONB. Application is
 * deferred to finalize (sprint 08), so the body only carries the context.
 */
export const saveBudgetSnapshotBodySchema = z.object({
  context: contextSchema,
})
export type SaveBudgetSnapshotBody = z.infer<typeof saveBudgetSnapshotBodySchema>

/**
 * Body POST /api/monthly-recap/update-salaries — push salary updates for
 * the given members. Structural validation only — the endpoint enforces
 * group membership + initiator authority.
 */
export const updateSalariesBodySchema = z.object({
  context: contextSchema,
  salaries: z
    .array(
      z.object({
        profileId: uuidSchema,
        salary: salaryAmountSchema,
      }),
    )
    .min(1, 'Au moins un salaire requis'),
})
export type UpdateSalariesBody = z.infer<typeof updateSalariesBodySchema>

/** Body POST /api/monthly-recap/complete — finalize the recap. */
export const completeRecapBodySchema = z.object({
  context: contextSchema,
})
export type CompleteRecapBody = z.infer<typeof completeRecapBodySchema>

/** Query GET /api/monthly-recap/status — read state for the given context. */
export const statusQuerySchema = z.object({
  context: contextSchema,
})
export type StatusQuery = z.infer<typeof statusQuerySchema>
