import { z } from 'zod'
import {
  contextSchema,
  isoDateSchema,
  moneySchema,
  nonNegativeMoneySchema,
  uuidSchema,
} from './common'

const descriptionSchema = z.string().trim().min(1, 'La description est requise')

/**
 * Single entry in the P4 Phase 2 cross-budget cascade array.
 * `budget_id` is the FROM budget (its cumulated_savings will be debited);
 * `amount` is how much to draw from that budget's savings. Must be > 0.
 *
 * The route handler validates that the sum of `amount` across all entries
 * does not exceed the overflow (which it should match exactly per UI).
 */
const crossBudgetCascadeEntrySchema = z.object({
  budget_id: uuidSchema,
  amount: moneySchema,
})

export type CrossBudgetCascadeEntry = z.infer<typeof crossBudgetCascadeEntrySchema>

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
 * Smart-allocation expense body. Extends createRealExpenseBodySchema with
 * Sprint P4-P5-P6 fields:
 *
 * - `use_savings` (P5): client toggle "Utiliser les économies de ce budget".
 *   When `true`, the breakdown algorithm consumes the budget's local
 *   `cumulated_savings` BEFORE the budget itself. Default `false` → P4 strict
 *   (budget first, savings cascade only on overflow).
 *
 * - `cross_budget_cascade` (P4 Phase 2): when local budget + savings are
 *   insufficient, the UI proposes drawing from OTHER budgets' savings.
 *   Each entry specifies the source budget + amount. The handler dispatches
 *   to the composite RPC `add_expense_with_cross_budget_cascade` for atomic
 *   multi-budget debit + INSERT in one Postgres tx.
 *
 * Dispatch rules (route-internal, not schema-enforced):
 * - No `estimated_budget_id` + `amount_from_piggy_bank > 0` → exceptional financée
 *   par tirelire via RPC `add_exceptional_expense_with_piggy` (Sprint Exceptional-
 *   Expense-Piggy-Funding). Sinon (sans piggy) → INSERT exceptionnel direct.
 * - With `estimated_budget_id`, no cross_budget → `add_expense_with_breakdown`
 * - With `estimated_budget_id` + cross_budget → `add_expense_with_cross_budget_cascade`
 *
 * `amount_from_piggy_bank` (Sprint Exceptional-Expense-Piggy-Funding) : montant
 * prélevé dans la tirelire pour financer une dépense EXCEPTIONNELLE (hors budget).
 * Optionnel, default 0. Ignoré pour les dépenses budgétées (la cascade auto
 * pilote la tirelire elle-même).
 */
export const addExpenseWithLogicBodySchema = z.object({
  amount: moneySchema,
  description: descriptionSchema,
  expense_date: isoDateSchema.optional(),
  estimated_budget_id: uuidSchema.optional(),
  is_for_group: z.boolean().optional(),
  use_savings: z.boolean().optional().default(false),
  cross_budget_cascade: z.array(crossBudgetCascadeEntrySchema).optional(),
  amount_from_piggy_bank: nonNegativeMoneySchema.optional(),
})
export type AddExpenseWithLogicBody = z.infer<typeof addExpenseWithLogicBodySchema>

/**
 * Query schema for /api/finance/expenses/preview-breakdown GET. Computes
 * how an expense will be allocated without creating it. `expense_id`
 * optional (edit-mode reverses the existing allocation first).
 *
 * `use_savings` (Sprint P4-P5-P6 / P5 toggle): when 'true', preview reflects
 * savings consumed BEFORE budget. Default 'false' → P4 strict preview
 * (budget first, savings cascade only on overflow).
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
  use_savings: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Sprint Fix-Recap-Preview-Month (2026-05-27) : permet au wizard récap de
  // filtrer les dépenses existantes par le mois recapé plutôt que par
  // `today.month`. Les deux doivent être présents pour activer le filtre ; un
  // seul des deux retombe sur le fallback today côté route.
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(3000).optional(),
})
export type PreviewBreakdownQuery = z.infer<typeof previewBreakdownQuerySchema>
