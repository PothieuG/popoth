import { supabaseServer } from '@/lib/supabase-server'

/**
 * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23).
 *
 * Helpers around the two composite RPCs `toggle_real_*_applied_to_balance`
 * (migration 20260523010000) that flip `applied_to_balance_at` on a
 * real_expenses / real_income_entries row and adjust `bank_balances.balance`
 * atomically (single Postgres tx, FOR UPDATE on the source row to serialize
 * concurrent long-press attempts).
 *
 * Result shape mirrors the json_build_object returned by the RPCs:
 *   - balance: the new value of bank_balances.balance after the toggle.
 *   - appliedToBalanceAt: NOW() ISO string if `apply=true`, NULL if unapply.
 *
 * Errors:
 *   - Postgres P0002 ("no-op rejected" — row already in target state) is
 *     wrapped into `AppliedToggleNoOpError`. The API handler maps it to
 *     HTTP 409 / a silent UI no-op (the optimistic update already reflects
 *     the target state).
 *   - Any other PG error is re-thrown unchanged for the handler's generic
 *     500 path.
 */

export interface AppliedToggleResult {
  balance: number
  appliedToBalanceAt: string | null
}

export class AppliedToggleNoOpError extends Error {
  readonly code = 'APPLIED_TOGGLE_NO_OP' as const

  constructor(message: string) {
    super(message)
    this.name = 'AppliedToggleNoOpError'
  }
}

function isNoOpPgError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code } = error as { code?: unknown }
  return code === 'P0002'
}

function parseRpcResult(data: unknown): AppliedToggleResult {
  if (typeof data !== 'object' || data === null) {
    throw new Error('toggle RPC returned non-object payload')
  }
  const obj = data as { balance?: unknown; applied_to_balance_at?: unknown }
  if (typeof obj.balance !== 'number') {
    throw new Error('toggle RPC payload missing numeric balance')
  }
  const at = obj.applied_to_balance_at
  if (at !== null && typeof at !== 'string') {
    throw new Error('toggle RPC payload has invalid applied_to_balance_at')
  }
  return { balance: obj.balance, appliedToBalanceAt: at }
}

export async function toggleRealExpenseAppliedToBalance(
  expenseId: string,
  apply: boolean,
): Promise<AppliedToggleResult> {
  const { data, error } = await supabaseServer.rpc('toggle_real_expense_applied_to_balance', {
    p_expense_id: expenseId,
    p_apply: apply,
  })
  if (error) {
    if (isNoOpPgError(error)) throw new AppliedToggleNoOpError(error.message)
    throw error
  }
  return parseRpcResult(data)
}

export async function toggleRealIncomeAppliedToBalance(
  incomeId: string,
  apply: boolean,
): Promise<AppliedToggleResult> {
  const { data, error } = await supabaseServer.rpc('toggle_real_income_applied_to_balance', {
    p_income_id: incomeId,
    p_apply: apply,
  })
  if (error) {
    if (isNoOpPgError(error)) throw new AppliedToggleNoOpError(error.message)
    throw error
  }
  return parseRpcResult(data)
}
