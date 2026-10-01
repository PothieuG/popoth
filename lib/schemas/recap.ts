import { z } from 'zod'
import { contextSchema, hasAtMostTwoDecimals, nonNegativeMoneySchema, uuidSchema } from './common'

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

/**
 * Body POST /api/monthly-recap/prepare-deficit — à l'arrivée sur l'écran
 * « Gestion du déficit », verse le surplus de chaque budget dans ses
 * économies (une seule fois par récap). Sprint Recap-Manual-Refloat.
 */
export const prepareDeficitBodySchema = z.object({
  context: contextSchema,
})
export type PrepareDeficitBody = z.infer<typeof prepareDeficitBodySchema>

/** `{ id: montant }` — montants ≥ 0, 2 décimales max. Les 0 sont ignorés. */
const refloatAllocationsSchema = z.record(uuidSchema, nonNegativeMoneySchema)

/**
 * Body POST /api/monthly-recap/save-refloat-plan — enregistre le choix de
 * l'utilisateur pour UNE source du renflouement (remplace la valeur
 * précédente de cette source). Rien n'est débité : le plan est appliqué à la
 * finalisation du récap. Sprint Recap-Manual-Refloat (2026-10-01).
 *
 *  - `piggy`    : montant pris dans la tirelire ;
 *  - `budgets`  : `{ budgetId: montant }` — pris d'abord dans les économies du
 *                 budget, puis dans son budget du mois suivant ;
 *  - `projects` : `{ projectId: montant }` — pris sur la mensualité du projet.
 */
export const saveRefloatPlanBodySchema = z.discriminatedUnion('source', [
  z.object({
    context: contextSchema,
    source: z.literal('piggy'),
    amount: nonNegativeMoneySchema,
  }),
  z.object({
    context: contextSchema,
    source: z.literal('budgets'),
    allocations: refloatAllocationsSchema,
  }),
  z.object({
    context: contextSchema,
    source: z.literal('projects'),
    allocations: refloatAllocationsSchema,
  }),
])
export type SaveRefloatPlanBody = z.infer<typeof saveRefloatPlanBodySchema>

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
 * transition explicite du wizard (sprint 11). Utilisé par les 5 boutons
 * "Continuer" du wizard, dont les transitions sont toutes ADJACENTES :
 * welcome→complete_month→summary→manage_bilan→salary_update→final_recap.
 *
 * Le schéma accepte les 7 valeurs de `recapStepSchema`, mais la route
 * resserre à `nextRequiredStep(fromStep)` et refuse `toStep='completed'`
 * (sprint Advance-Step-Adjacency) — cf. l'en-tête de
 * `app/api/monthly-recap/advance-step/route.ts` pour le pourquoi.
 */
export const advanceStepBodySchema = z.object({
  context: contextSchema,
  fromStep: recapStepSchema,
  toStep: recapStepSchema,
})
export type AdvanceStepBody = z.infer<typeof advanceStepBodySchema>
