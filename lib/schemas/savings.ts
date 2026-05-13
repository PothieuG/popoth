import { z } from 'zod'
import { contextSchema, moneySchema, uuidSchema } from './common'

/**
 * Discriminate on `action`: when present and equal to `'budget_to_piggy_bank'`,
 * the body shape is the piggy-bank transfer. When absent, it's a budget→budget
 * transfer. We use `z.union` (not `z.discriminatedUnion`) because the
 * budget→budget branch has no `action` field at all — there's no discriminant
 * literal common to both branches.
 *
 * Post Sprint Atomicity-Savings v2 (2026-05-12), the legacy
 * `set_piggy_bank` / `add_to_piggy_bank` / `remove_from_piggy_bank` actions
 * were deleted (0 consumer cross-codebase). Do NOT re-introduce them here
 * without a concrete UX use case — see CLAUDE.md §8 ❌.
 */
export const transferSavingsBodySchema = z.union([
  // Path 1: budget → piggy bank (explicit action literal)
  z.object({
    context: contextSchema,
    action: z.literal('budget_to_piggy_bank'),
    from_budget_id: uuidSchema,
    amount: moneySchema,
  }),
  // Path 2: budget → budget (action absent)
  z
    .object({
      context: contextSchema,
      from_budget_id: uuidSchema,
      to_budget_id: uuidSchema,
      amount: moneySchema,
    })
    .refine((d) => d.from_budget_id !== d.to_budget_id, {
      message: 'Les budgets source et destination doivent être différents',
      path: ['to_budget_id'],
    }),
])

export type TransferSavingsBody = z.infer<typeof transferSavingsBodySchema>

/**
 * Type guard: narrow `body` to the budget→piggy-bank branch when the caller
 * has parsed via `transferSavingsBodySchema`. Use to dispatch in the route
 * handler with full TS narrowing on `from_budget_id` (no `to_budget_id`).
 */
export function isBudgetToPiggyBank(
  body: TransferSavingsBody,
): body is Extract<TransferSavingsBody, { action: 'budget_to_piggy_bank' }> {
  return 'action' in body && body.action === 'budget_to_piggy_bank'
}
