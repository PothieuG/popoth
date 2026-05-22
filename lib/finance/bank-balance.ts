import type { Database } from '@/lib/database.types'
import { supabaseServer } from '@/lib/supabase-server'
import { resolveContextIds, type ContextFilter } from './context'

type BankBalanceInsert = Database['public']['Tables']['bank_balances']['Insert']

/**
 * Idempotent INSERT of a bank_balances row with `balance = 0`. No-op if the
 * row already exists (PG unique_violation 23505 caught silently — the partial
 * unique indexes on `profile_id` and `group_id` make this race-safe).
 *
 * Pattern miroir [ensurePiggyBankRow](./piggy-bank.ts) — call this before any
 * `update_bank_balance()` RPC when the caller cannot assume the row exists
 * (e.g. brand-new user who has never set their bank balance manually). The
 * RPC RAISEs "bank_balances row not found for the given context" when its
 * UPDATE affects 0 rows, so the ensure-step is a prerequisite for the first
 * bank balance write of a user lifetime (Sprint Long-Press-Toggle-Apply-To-
 * Balance 2026-05-23 added this — the toggle RPC is the first composite RPC
 * to write `bank_balances.balance` for users who never opened the settings
 * drawer to set it manually).
 */
export async function ensureBankBalanceRow(filter: ContextFilter): Promise<void> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const payload: BankBalanceInsert =
    profile_id !== undefined
      ? { profile_id, group_id: null, balance: 0 }
      : { profile_id: null, group_id: group_id!, balance: 0 }
  const { error } = await supabaseServer.from('bank_balances').insert(payload)
  if (error && error.code !== '23505') {
    throw error
  }
}

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
