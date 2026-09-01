import type { Database } from '@/lib/database.types'
import { supabaseServer } from '@/lib/supabase-server'
import { resolveContextIds, type ContextFilter } from './context'

type PiggyBankInsert = Database['public']['Tables']['piggy_bank']['Insert']

/**
 * Idempotent INSERT of a piggy_bank row with `amount = 0`. No-op if the row
 * already exists (PG unique_violation 23505 caught silently — the partial
 * unique indexes on `profile_id` and `group_id` make this race-safe).
 *
 * Call this before any `updatePiggyBank()` RPC when the caller cannot assume
 * the row exists (e.g. brand-new user has never accumulated a piggy yet).
 * The RPC itself RAISEs "piggy_bank row not found" when its UPDATE affects 0
 * rows, so the upsert-step is a prerequisite for the first piggy write of a
 * user lifetime.
 */
export async function ensurePiggyBankRow(filter: ContextFilter): Promise<void> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const payload: PiggyBankInsert =
    profile_id !== undefined
      ? { profile_id, group_id: null, amount: 0 }
      : { profile_id: null, group_id: group_id!, amount: 0 }
  const { error } = await supabaseServer.from('piggy_bank').insert(payload)
  if (error && error.code !== '23505') {
    throw error
  }
}

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
