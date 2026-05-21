import { supabaseServer } from '@/lib/supabase-server'

import { resolveContextIds, type ContextFilter } from './context'

/**
 * Composite atomic helper for budget-to-budget transfers that also debit
 * the source budget's cumulated_savings — combines what was previously a
 * two-step `INSERT INTO budget_transfers` + RPC `update_budget_cumulated_savings`
 * sequence into a single Postgres transaction. Used by monthly recap
 * step 2.4.2 (lib/recap/step1-persist.ts).
 *
 * On `cumulated_savings < amount` the underlying RPC raises and the whole
 * transaction (INSERT included) rolls back — no orphaned audit-trail rows.
 */
export async function transferWithSavingsDebit(
  filter: ContextFilter,
  args: {
    fromBudgetId: string
    toBudgetId: string
    amount: number
    reason?: string
  },
): Promise<{ transfer_id: string; cumulated_savings: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('transfer_with_savings_debit', {
    p_from_budget_id: args.fromBudgetId,
    p_to_budget_id: args.toBudgetId,
    p_amount: args.amount,
    p_profile_id: profile_id,
    p_group_id: group_id,
    p_reason: args.reason ?? 'Renflouage déficit depuis économies cumulées (récap)',
  })
  if (error) throw error
  return data as { transfer_id: string; cumulated_savings: number }
}
