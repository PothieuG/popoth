/**
 * Pure algorithm for monthly recap recovery (`/api/monthly-recap/recover`).
 *
 * Sprint Refactor-Recover (2026-05-16): extracted verbatim from
 * app/api/monthly-recap/recover/route.ts (was 385 LOC mixed orchestration /
 * I/O / logging).
 *
 * INVARIANTS (NEVER violate; the unit tests in
 * __tests__/recover-algorithm.test.ts will catch you):
 *  - 0 imports from Supabase, NextResponse, or any I/O module
 *  - 0 `console.*` calls; the per-file ESLint override enforces `no-console: 'error'`
 *  - 0 globals
 *  - 0 calls to `new Date()` / `Date.now()`
 *  - The algorithm NEVER mutates `snapshot` — it returns the new state in
 *    `ProcessRecoveryDecision`
 *
 * ALGORITHM (mirror of route L219-263):
 *   The algorithm walks the SnapshotPayload v1|v2 and produces an ORDERED
 *   list of `RestorationAction`s. The order is FK-safe (parents before
 *   children): estimated_incomes → estimated_budgets → real_income_entries →
 *   real_expenses → bank_balances → piggy_bank → budget_transfers.
 *
 *   For each table the algorithm SKIPS adding an action when the source
 *   array is empty (mirror route's `if (!data || data.length === 0) return`
 *   early-return inside restoreTable). The decision shape therefore only
 *   contains actions that will actually mutate the DB.
 *
 *   Bank balance dispatches via `isSnapshotV2()` (mirror route L233-253):
 *     - V2 with bank_balances non-empty → restore_table (full DELETE+INSERT)
 *     - V2 with bank_balances empty + scalar bank_balance: number → v1 fallback UPDATE
 *     - V1 with scalar bank_balance: number → v1 fallback UPDATE
 *     - Otherwise → skip entirely (bank_balance flag stays at init false)
 *
 *   piggy_bank and budget_transfers are V2-only (the V1 schema didn't
 *   include them). They produce actions only when the snapshot is V2 AND
 *   the corresponding array is non-empty.
 *
 *   The 5 tables NOT restored by the route (profiles / groups /
 *   group_contributions / monthly_recaps / remaining_to_live_snapshots,
 *   present in SnapshotPayloadV2 capture) are NOT visited by the
 *   algorithm — preserved verbatim per Sprint Refactor-Recover decision
 *   (rationale documented in recover-types.ts JSDoc).
 *
 * DETERMINISM: same snapshot → same decision. The algorithm does NOT
 * reorder the rows inside arrays — it passes them through to the persist
 * layer, which DELETEs all owned rows then INSERTs the array as-is.
 */

import { isSnapshotV2 } from '@/lib/recap-snapshot.types'

import type {
  ProcessRecoveryDecision,
  ProcessRecoverySnapshot,
  RestorationAction,
} from './recover-types'

/**
 * Decides the ordered list of restoration actions to apply given a loaded
 * snapshot. Pure: no I/O, no mutation, deterministic.
 */
export function decideRecoveryActions(snapshot: ProcessRecoverySnapshot): ProcessRecoveryDecision {
  const { payload } = snapshot
  const actions: RestorationAction[] = []

  // ------------------------------------------------------------------------
  // 1. estimated_incomes (both v1 and v2)
  // ------------------------------------------------------------------------
  if (payload.estimated_incomes.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'estimated_incomes',
      rows: payload.estimated_incomes,
      resultKey: 'estimated_incomes',
    })
  }

  // ------------------------------------------------------------------------
  // 2. estimated_budgets (both v1 and v2) — FK parent of real_expenses,
  //    budget_transfers. Must come BEFORE those tables.
  // ------------------------------------------------------------------------
  if (payload.estimated_budgets.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'estimated_budgets',
      rows: payload.estimated_budgets,
      resultKey: 'estimated_budgets',
    })
  }

  // ------------------------------------------------------------------------
  // 3. real_income_entries (both v1 and v2) — note: result key is
  //    `real_incomes` (not `real_income_entries`) per route L227-228.
  // ------------------------------------------------------------------------
  if (payload.real_income_entries.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'real_income_entries',
      rows: payload.real_income_entries,
      resultKey: 'real_incomes',
    })
  }

  // ------------------------------------------------------------------------
  // 4. real_expenses (both v1 and v2)
  // ------------------------------------------------------------------------
  if (payload.real_expenses.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'real_expenses',
      rows: payload.real_expenses,
      resultKey: 'real_expenses',
    })
  }

  // ------------------------------------------------------------------------
  // 5. bank balances — dispatch v1/v2 (mirror route L233-253)
  //    - V2 with non-empty bank_balances[] → full DELETE+INSERT
  //    - else if scalar bank_balance: number → v1 fallback UPDATE
  //    - else → skip (bank_balance flag stays at init false)
  // ------------------------------------------------------------------------
  if (isSnapshotV2(payload) && payload.bank_balances.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'bank_balances',
      rows: payload.bank_balances,
      resultKey: 'bank_balance',
    })
  } else if (typeof payload.bank_balance === 'number') {
    actions.push({
      kind: 'update_bank_balance_v1',
      amount: payload.bank_balance,
    })
  }

  // ------------------------------------------------------------------------
  // 6. piggy_bank (v2 only)
  // ------------------------------------------------------------------------
  if (isSnapshotV2(payload) && payload.piggy_bank.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'piggy_bank',
      rows: payload.piggy_bank,
      resultKey: 'piggy_bank',
    })
  }

  // ------------------------------------------------------------------------
  // 7. budget_transfers (v2 only) — FK child of estimated_budgets, must
  //    come AFTER estimated_budgets. The original route does this implicitly
  //    via its sequential numbered steps 1-7.
  // ------------------------------------------------------------------------
  if (isSnapshotV2(payload) && payload.budget_transfers.length > 0) {
    actions.push({
      kind: 'restore_table',
      table: 'budget_transfers',
      rows: payload.budget_transfers,
      resultKey: 'budget_transfers',
    })
  }

  return {
    actions,
    snapshotRowId: snapshot.snapshotRowId,
  }
}
