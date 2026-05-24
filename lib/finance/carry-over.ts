import { supabaseServer } from '@/lib/supabase-server'

/**
 * Sprint 15 Monthly Recap V3 (2026-05-27) — Carry-Over UI.
 *
 * Helpers around the 3 composite RPCs from migration 20260527000000:
 *
 *   - toggle_carry_over_and_apply(id, validate)
 *   - toggle_carry_over_and_apply_income(id, validate)
 *   - delete_carried_expense_to_piggy(id)
 *
 * The two toggle RPCs are bidirectional :
 *   - validate=true  : carried+unapplied → validated+applied (bank balance
 *                      debited for expense, credited for income).
 *                      `carried_from_recap_id` is preserved as memory so the
 *                      reverse direction stays open.
 *   - validate=false : validated+applied (was-carried) → carried+unapplied
 *                      (bank balance reverted).
 *
 * The delete RPC is one-way : it removes a carry-over expense row and credits
 * the matching piggy_bank by the same amount, atomically. Inlined piggy-row
 * ensure handles the fresh-account edge case.
 *
 * Result shape mirrors json_build_object returned by the RPCs (carry-over
 * toggles return the extra `is_carried_over` flag; the delete RPC returns
 * the piggy delta info).
 *
 * Errors :
 *   - Postgres P0002 ("no-op rejected" or "not carried" guard) → wrapped into
 *     `CarryOverToggleNoOpError`. The API handler maps it to HTTP 409 / silent
 *     UI no-op (the optimistic update already reflects the target state).
 *   - Any other PG error is re-thrown unchanged for the handler's 500 path.
 */

export interface CarryOverToggleResult {
  balance: number
  appliedToBalanceAt: string | null
  isCarriedOver: boolean
}

export interface DeleteCarriedExpenseResult {
  expenseId: string
  piggyCredited: number
  piggyNewAmount: number
}

export class CarryOverToggleNoOpError extends Error {
  readonly code = 'CARRY_OVER_TOGGLE_NO_OP' as const

  constructor(message: string) {
    super(message)
    this.name = 'CarryOverToggleNoOpError'
  }
}

function isNoOpPgError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code } = error as { code?: unknown }
  return code === 'P0002'
}

function parseToggleResult(data: unknown): CarryOverToggleResult {
  if (typeof data !== 'object' || data === null) {
    throw new Error('carry-over toggle RPC returned non-object payload')
  }
  const obj = data as {
    balance?: unknown
    applied_to_balance_at?: unknown
    is_carried_over?: unknown
  }
  if (typeof obj.balance !== 'number') {
    throw new Error('carry-over toggle RPC payload missing numeric balance')
  }
  const at = obj.applied_to_balance_at
  if (at !== null && typeof at !== 'string') {
    throw new Error('carry-over toggle RPC payload has invalid applied_to_balance_at')
  }
  if (typeof obj.is_carried_over !== 'boolean') {
    throw new Error('carry-over toggle RPC payload missing boolean is_carried_over')
  }
  return { balance: obj.balance, appliedToBalanceAt: at, isCarriedOver: obj.is_carried_over }
}

function parseDeleteResult(data: unknown): DeleteCarriedExpenseResult {
  if (typeof data !== 'object' || data === null) {
    throw new Error('delete_carried_expense_to_piggy RPC returned non-object payload')
  }
  const obj = data as {
    expense_id?: unknown
    piggy_credited?: unknown
    piggy_new_amount?: unknown
  }
  if (typeof obj.expense_id !== 'string') {
    throw new Error('delete_carried_expense_to_piggy payload missing string expense_id')
  }
  if (typeof obj.piggy_credited !== 'number') {
    throw new Error('delete_carried_expense_to_piggy payload missing numeric piggy_credited')
  }
  if (typeof obj.piggy_new_amount !== 'number') {
    throw new Error('delete_carried_expense_to_piggy payload missing numeric piggy_new_amount')
  }
  return {
    expenseId: obj.expense_id,
    piggyCredited: obj.piggy_credited,
    piggyNewAmount: obj.piggy_new_amount,
  }
}

export async function toggleCarryOverAndApply(
  expenseId: string,
  validate: boolean,
): Promise<CarryOverToggleResult> {
  const { data, error } = await supabaseServer.rpc('toggle_carry_over_and_apply', {
    p_expense_id: expenseId,
    p_validate: validate,
  })
  if (error) {
    if (isNoOpPgError(error)) throw new CarryOverToggleNoOpError(error.message)
    throw error
  }
  return parseToggleResult(data)
}

export async function toggleCarryOverAndApplyIncome(
  incomeId: string,
  validate: boolean,
): Promise<CarryOverToggleResult> {
  const { data, error } = await supabaseServer.rpc('toggle_carry_over_and_apply_income', {
    p_income_id: incomeId,
    p_validate: validate,
  })
  if (error) {
    if (isNoOpPgError(error)) throw new CarryOverToggleNoOpError(error.message)
    throw error
  }
  return parseToggleResult(data)
}

export async function deleteCarriedExpenseToPiggy(
  expenseId: string,
): Promise<DeleteCarriedExpenseResult> {
  const { data, error } = await supabaseServer.rpc('delete_carried_expense_to_piggy', {
    p_expense_id: expenseId,
  })
  if (error) throw error
  return parseDeleteResult(data)
}
