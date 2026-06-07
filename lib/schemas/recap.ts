import { z } from 'zod'
import { contextSchema, hasAtMostTwoDecimals, uuidSchema } from './common'

/**
 * Positive amount with at-most-2-decimals constraint. Mirrors the refine
 * used by `moneySchema` in common.ts but kept local because the refloat
 * inputs come from the wizard (not the standard money forms).
 */
const positiveAmountSchema = z
  .number()
  .finite('Montant invalide')
  .positive('Le montant doit être positif')
  .refine(hasAtMostTwoDecimals, {
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
  .refine(hasAtMostTwoDecimals, {
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
 * Body POST /api/monthly-recap/refloat-from-projects — virtual refund of
 * each savings project's monthly allocation, proportional to its share of
 * the total pool. The server computes the allocation via
 * `computeProportionalProjectsRefloat` and OVERWRITES
 * `monthly_recaps.project_snapshot_data` (deferred — applied to
 * `savings_projects.amount_saved` + `pending_delay_fraction` at finalize,
 * sprint 10). Sprint Projets-Épargne 08.
 */
export const refloatFromProjectsBodySchema = z.object({
  context: contextSchema,
})
export type RefloatFromProjectsBody = z.infer<typeof refloatFromProjectsBodySchema>

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

/**
 * Enum miroir de `RecapStep` (`lib/recap/state.ts`). Dupliqué côté schema
 * pour découpler le runtime Zod du module pure d'état. Toute évolution doit
 * être appliquée aux deux endroits.
 */
export const recapStepSchema = z.enum([
  'welcome',
  'complete_month',
  'summary',
  'manage_bilan',
  'salary_update',
  'final_recap',
  'completed',
])
export type RecapStepInput = z.infer<typeof recapStepSchema>

/**
 * Body POST /api/monthly-recap/advance-step — endpoint générique de
 * transition explicite du wizard (sprint 11). Utilisé par les écrans Welcome
 * (welcome→summary) et Summary (summary→manage_bilan). Le serveur valide
 * via `isAdvanceAllowed(fromStep, toStep)` + cohérence avec `current_step`.
 */
export const advanceStepBodySchema = z.object({
  context: contextSchema,
  fromStep: recapStepSchema,
  toStep: recapStepSchema,
})
export type AdvanceStepBody = z.infer<typeof advanceStepBodySchema>
