import { supabaseServer } from '@/lib/supabase-server'
import { resolveContextIds, type ContextFilter } from './context'

export async function updateBankBalance(filter: ContextFilter, delta: number): Promise<number> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('update_bank_balance', {
    p_delta: delta,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as number
}
