import { supabaseServer } from '@/lib/supabase-server'

import { resolveContextIds, type ContextFilter } from './context'

/**
 * Composite atomic helper for budget→budget savings transfers — combines
 * the debit FROM + credit TO into a single Postgres transaction. Used by
 * POST /api/savings/transfer (budget-between-budgets path).
 *
 * On overdraft (insufficient cumulated_savings on FROM) the underlying
 * RPC raises and the whole tx rolls back — no orphaned debit-without-credit.
 * Replaces the pre-Sprint Atomicity-Savings sequence of 2 separate RPC
 * calls + manual compensating rollback (that could itself fail) at L122.
 *
 * Pattern mirrors `transferWithSavingsDebit` and `addExpenseWithBreakdown`.
 * Not exposed via the `lib/finance` barrel — consumers import directly
 * (convention C3, same as the other RPC helpers).
 */
export async function transferSavingsBetweenBudgets(
  filter: ContextFilter,
  args: {
    fromBudgetId: string
    toBudgetId: string
    amount: number
  },
): Promise<{ from_savings: number; to_savings: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('transfer_savings_between_budgets', {
    p_from_budget_id: args.fromBudgetId,
    p_to_budget_id: args.toBudgetId,
    p_amount: args.amount,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as { from_savings: number; to_savings: number }
}

/**
 * Composite atomic helper for budget→piggy_bank transfers — combines the
 * budget debit + the piggy_bank UPSERT into a single Postgres transaction.
 * Used by POST /api/savings/transfer (action: 'budget_to_piggy_bank' path).
 *
 * UPSERT uses partial unique index inference (idx_piggy_bank_profile_id_unique
 * or idx_piggy_bank_group_id_unique) — creates a fresh piggy_bank row when
 * none exists, otherwise increments the existing amount in place. Both
 * legs (budget debit + piggy upsert) are tx-bound: a NOT NULL / CHECK
 * violation on either side rolls back the other.
 *
 * Replaces the pre-Sprint Atomicity-Savings sequence of 1 RPC + 1
 * UPDATE-or-INSERT branch + manual compensating rollback (that could
 * itself fail) at L321/L337.
 *
 * Pattern mirrors `transferSavingsBetweenBudgets` and `addExpenseWithBreakdown`.
 * Not exposed via the `lib/finance` barrel.
 */
export async function transferBudgetToPiggyBank(
  filter: ContextFilter,
  args: {
    fromBudgetId: string
    amount: number
  },
): Promise<{ from_savings: number; piggy_bank_amount: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('transfer_budget_to_piggy_bank', {
    p_from_budget_id: args.fromBudgetId,
    p_amount: args.amount,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as { from_savings: number; piggy_bank_amount: number }
}
