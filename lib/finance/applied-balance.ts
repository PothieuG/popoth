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

/**
 * Sprint Contribution-Income-Mirror (2026-06-05). Result of the orchestrator
 * RPC `toggle_contribution_pair_applied`. Both sides (expense user perso +
 * income group mirror) toggle atomically. Balance values are exposed for both
 * contexts when their side changed (null otherwise).
 */
export interface ToggleContributionPairResult {
  expenseId: string
  incomeId: string
  expenseChanged: boolean
  incomeChanged: boolean
  expenseBalance: number | null
  incomeBalance: number | null
  applied: boolean
}

function parsePairRpcResult(data: unknown): ToggleContributionPairResult {
  if (typeof data !== 'object' || data === null) {
    throw new Error('toggle_contribution_pair_applied returned non-object payload')
  }
  const obj = data as {
    expense_id?: unknown
    income_id?: unknown
    expense_changed?: unknown
    income_changed?: unknown
    expense_balance?: unknown
    income_balance?: unknown
    applied?: unknown
  }
  if (typeof obj.expense_id !== 'string' || typeof obj.income_id !== 'string') {
    throw new Error('toggle_contribution_pair_applied payload missing string ids')
  }
  if (typeof obj.expense_changed !== 'boolean' || typeof obj.income_changed !== 'boolean') {
    throw new Error('toggle_contribution_pair_applied payload missing boolean changed flags')
  }
  if (typeof obj.applied !== 'boolean') {
    throw new Error('toggle_contribution_pair_applied payload missing applied flag')
  }
  return {
    expenseId: obj.expense_id,
    incomeId: obj.income_id,
    expenseChanged: obj.expense_changed,
    incomeChanged: obj.income_changed,
    expenseBalance: typeof obj.expense_balance === 'number' ? obj.expense_balance : null,
    incomeBalance: typeof obj.income_balance === 'number' ? obj.income_balance : null,
    applied: obj.applied,
  }
}

export async function toggleContributionPairApplied(
  contributionId: string,
  apply: boolean,
): Promise<ToggleContributionPairResult> {
  const { data, error } = await supabaseServer.rpc('toggle_contribution_pair_applied', {
    p_contribution_id: contributionId,
    p_apply: apply,
  })
  if (error) {
    if (isNoOpPgError(error)) throw new AppliedToggleNoOpError(error.message)
    throw error
  }
  return parsePairRpcResult(data)
}
