import { supabaseServer } from '@/lib/supabase-server'
import { resolveContextIds, type ContextFilter } from './context'

export async function updatePiggyBank(filter: ContextFilter, delta: number): Promise<number> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('update_piggy_bank_amount', {
    p_delta: delta,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as number
}

export async function transferFromPiggyToBudget(
  filter: ContextFilter,
  budgetId: string,
  amount: number,
): Promise<{ piggy_bank: number; cumulated_savings: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('transfer_from_piggy_to_budget', {
    p_amount: amount,
    p_budget_id: budgetId,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as { piggy_bank: number; cumulated_savings: number }
}

/**
 * Atomic piggy_bank debit + budget_transfers INSERT (from_budget_id=NULL).
 *
 * Composes `update_piggy_bank_amount(-amount)` with an INSERT into
 * `budget_transfers` in one Postgres transaction via the composite RPC
 * `transfer_piggy_to_budget_with_insert`. Closes the audit-trail orphan
 * risk of the pre-Sprint Auto-Balance-Atomic-Phase-B pattern where a
 * successful piggy debit followed by a failing INSERT left untraceable
 * money movements.
 *
 * On insufficient piggy (CHECK piggy_bank.amount >= 0), the RPC RAISEs
 * and the whole tx rolls back — piggy stays at its pre-call value.
 *
 * Mirror of `transferWithSavingsDebit` (lib/finance/budget-transfers.ts,
 * Sprint Refactor-I5-followup-v2). Direct submodule import per C3
 * convention (not exposed in `lib/finance/index.ts` barrel).
 */
export async function transferPiggyToBudgetWithInsert(
  filter: ContextFilter,
  params: {
    toBudgetId: string
    amount: number
    reason?: string
    recapId?: string | null
  },
): Promise<{ transfer_id: string; piggy_bank_amount: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('transfer_piggy_to_budget_with_insert', {
    p_to_budget_id: params.toBudgetId,
    p_amount: params.amount,
    p_profile_id: profile_id,
    p_group_id: group_id,
    p_reason: params.reason ?? 'Auto-balance via monthly recap (tirelire)',
    p_recap_id: params.recapId ?? undefined,
  })
  if (error) throw error
  return data as { transfer_id: string; piggy_bank_amount: number }
}
