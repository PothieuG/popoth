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
