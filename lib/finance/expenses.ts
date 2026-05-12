import { supabaseServer } from '@/lib/supabase-server'

import { resolveContextIds, type ContextFilter } from './context'

/**
 * Composite atomic helper for the smart-allocation expense path —
 * combines the piggy_bank debit, the cumulated_savings debit and the
 * real_expenses INSERT into a single Postgres transaction. Closes the
 * pre-Sprint Atomicity-Expenses gap where the route performed the 3
 * ops separately and a failed INSERT left both debits committed
 * (user perceived a money loss with no expense row to show for it).
 *
 * On overdraft (piggy or savings would go negative) the underlying
 * RPCs raise and the whole tx (including any prior debit) rolls back —
 * no partial state.
 *
 * Pattern mirrors `transferWithSavingsDebit` in budget-transfers.ts.
 * Not exposed via the `lib/finance` barrel — consumers import directly
 * (convention C3, same as the other RPC helpers).
 */
export async function addExpenseWithBreakdown(
  filter: ContextFilter,
  args: {
    amount: number
    description: string
    expenseDate: string
    estimatedBudgetId: string
    amountFromPiggyBank: number
    amountFromBudgetSavings: number
    amountFromBudget: number
  },
): Promise<{ expense_id: string }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('add_expense_with_breakdown', {
    p_amount: args.amount,
    p_description: args.description,
    p_expense_date: args.expenseDate,
    p_estimated_budget_id: args.estimatedBudgetId,
    p_amount_from_piggy_bank: args.amountFromPiggyBank,
    p_amount_from_budget_savings: args.amountFromBudgetSavings,
    p_amount_from_budget: args.amountFromBudget,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as { expense_id: string }
}
