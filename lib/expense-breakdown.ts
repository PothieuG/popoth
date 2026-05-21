/**
 * Pure expense breakdown algorithm — no I/O, no Supabase, no React.
 * Extracted from `lib/expense-allocation.ts` so client-side hooks (e.g.
 * `useRavValidation`) can import it without pulling in the service_role
 * Supabase client (security: bundling supabase-server.ts in the client
 * bundle would leak the service_role key).
 *
 * Algorithm (Sprint P4-P5-P6) :
 *   - **Default (toggle off)** : budget first, savings cascade only on overflow.
 *   - **P5 opt-in (toggle on)** : savings first, budget second.
 *   - Piggy NEVER auto-debited.
 *
 * `overflow > 0` signals Phase 2 cross-budget cascade need.
 */

export interface AllocationBreakdown {
  fromPiggyBank: number
  fromBudgetSavings: number
  fromBudget: number
  /**
   * Amount remaining after all local cascades (budget + local savings).
   * `overflow > 0` signals that Phase 2 cross-budget cascade is needed
   * (handled separately by the route handler / UI step). Consumers MUST
   * handle non-zero overflow explicitly — leaving it unhandled means the
   * breakdown doesn't sum to `amount` and downstream RPCs reject the insert.
   */
  overflow: number
}

export interface CalculateBreakdownOptions {
  /**
   * P5 opt-in toggle "Utiliser les économies de ce budget" — when true,
   * the user actively chose to draw from the budget's local savings even
   * if the budget still has room. Savings consumed BEFORE the budget.
   *
   * When false (default): P4 strict — budget consumed first, savings
   * cascade only on overflow (budget remaining < amount).
   */
  useSavingsToggle?: boolean
}

export function calculateBreakdown(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdown {
  const { useSavingsToggle = false } = options
  let remaining = amount
  let fromBudget = 0
  let fromBudgetSavings = 0
  const fromPiggyBank = 0 // P4 strict: tirelire jamais auto-débitée

  if (useSavingsToggle) {
    // P5 opt-in: savings d'abord, budget ensuite
    if (savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
    if (remaining > 0 && budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
  } else {
    // P4 strict default: budget d'abord, savings cascade overflow
    if (budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
    if (remaining > 0 && savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
  }

  return { fromPiggyBank, fromBudgetSavings, fromBudget, overflow: remaining }
}
