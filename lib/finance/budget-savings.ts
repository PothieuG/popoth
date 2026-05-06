import { supabaseServer } from '@/lib/supabase-server'

export async function updateBudgetCumulatedSavings(
  budgetId: string,
  delta: number,
): Promise<number> {
  const { data, error } = await supabaseServer.rpc('update_budget_cumulated_savings', {
    p_budget_id: budgetId,
    p_delta: delta,
  })
  if (error) throw error
  return data as number
}
