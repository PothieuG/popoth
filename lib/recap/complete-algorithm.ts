/**
 * Pure algorithm for monthly recap completion (`/api/monthly-recap/complete`).
 *
 * Sprint Refactor-I6 (2026-05-14): extracted verbatim from
 * app/api/monthly-recap/complete/route.ts (was 703 LOC mixed
 * algorithm/I/O/logging with 4 declare-global slots).
 *
 * INVARIANTS (NEVER violate; the unit tests in __tests__/complete-algorithm.test.ts
 * will catch you):
 *  - 0 imports from Supabase, NextResponse, or any I/O module
 *  - 0 `console.*` calls; the per-file ESLint override enforces `no-console: 'error'`
 *  - 0 globals
 *  - 0 calls to `new Date()` / `Date.now()` (callers inject `input.currentDate`)
 *  - The algorithm NEVER mutates `snapshot` or `input` — it returns the
 *    new state in `ProcessCompleteDecision`
 *
 * ALGORITHM (mirror of the 5 sub-flows in the original route):
 *   Block 3  — deficit processing: per-budget post-transfer deficit →
 *              carryoverUpdates[] entries + preTransferBudgetDeficit / postTransferBudgetDeficit
 *   Block 4  — RAV difference: bankCurrentRtl − baseRtl + deficitCoveredByTransfers →
 *              optional exceptionalExpense (if adjustedDifference < 0)
 *   Block 5  — savings processing: per-budget surplus → surplusTransfers[]
 *              (persist layer applies via atomic updateBudgetCumulatedSavings RPC,
 *              fixing the original L484 SELECT-then-UPDATE race condition)
 *   recapData — composed from input.action (carry_forward | deduct_from_budget)
 *              and the snapshot's bank/budget state. For deduct_from_budget,
 *              the budget existence is pre-validated by the snapshot loader
 *              (throws RecapBudgetNotFoundError) — algorithm assumes the
 *              budget is present.
 *   totalSurplus / totalDeficit — sum of `estimated_budgets.monthly_surplus|deficit`
 *              fields at request time (reset to 0 by the persist layer post-flow).
 *
 * The 4 globals from the original route (carryoverUpdates,
 * preTransferBudgetDeficit, postTransferBudgetDeficit, exceptionalExpenseToInsert)
 * become explicit fields on the returned `ProcessCompleteDecision`.
 */

import type { TablesInsert } from '@/lib/database.types'

import type {
  BudgetSnapshot,
  BudgetTransferSnapshot,
  ProcessCompleteDecision,
  ProcessCompleteInput,
  ProcessCompleteSnapshot,
} from './complete-types'

/**
 * Decides everything that needs to happen to finalize the monthly recap.
 * Pure: no I/O, no Date.now(), no mutation of inputs, deterministic.
 */
export function decideCompleteAllocation(
  snapshot: ProcessCompleteSnapshot,
  input: ProcessCompleteInput,
): ProcessCompleteDecision {
  // Tri déterministe (Supabase select sans .order() ne garantit pas l'ordre)
  const sortedBudgets = [...snapshot.budgets].sort((a, b) => a.id.localeCompare(b.id))

  const currentMonth = input.currentDate.getMonth() + 1
  const currentYear = input.currentDate.getFullYear()

  // ------------------------------------------------------------------------
  // recapData header — month/year/initial+final RAV/current_step + completed_at
  // ------------------------------------------------------------------------
  const totalSurplus = sortedBudgets.reduce((sum, b) => sum + (b.monthly_surplus ?? 0), 0)
  const totalDeficit = sortedBudgets.reduce((sum, b) => sum + (b.monthly_deficit ?? 0), 0)

  const recapData: TablesInsert<'monthly_recaps'> = {
    recap_month: currentMonth,
    recap_year: currentYear,
    initial_remaining_to_live: snapshot.initialRemainingToLive,
    final_remaining_to_live: input.finalAmount,
    total_surplus: totalSurplus,
    total_deficit: totalDeficit,
    current_step: 3,
    completed_at: input.currentDate.toISOString(),
  }

  // Owner column
  if (input.context === 'profile') {
    recapData.profile_id = input.contextId
  } else {
    recapData.group_id = input.contextId
  }

  // ------------------------------------------------------------------------
  // Action-specific fields (remaining_to_live_source + amount)
  // The deduct_from_budget budget existence is pre-validated by the loader.
  // ------------------------------------------------------------------------
  let selectedBudgetName: string | null = null
  if (input.action === 'carry_forward') {
    recapData.remaining_to_live_source = 'carried_forward'
    recapData.remaining_to_live_amount = snapshot.initialRemainingToLive
  } else {
    // 'deduct_from_budget' — input.budgetId is guaranteed present by the schema
    // and the budget itself is guaranteed in snapshot.budgets by the loader.
    const selected = sortedBudgets.find((b) => b.id === input.budgetId)
    if (!selected) {
      // Defensive: should never happen if the loader did its job. Throw a
      // generic Error here (NOT RecapBudgetNotFoundError) because at this
      // point it's an invariant violation, not user input error.
      throw new Error(
        `decideCompleteAllocation invariant violation: budget ${input.budgetId} not in snapshot`,
      )
    }
    recapData.remaining_to_live_source = `from_budget_${selected.name}`
    recapData.remaining_to_live_amount = input.finalAmount
    selectedBudgetName = selected.name
  }

  // ------------------------------------------------------------------------
  // Block 3 — deficit processing: per-budget adjusted spent + carryover
  // ------------------------------------------------------------------------
  let preTransferBudgetDeficit = 0
  const carryoverUpdates: ProcessCompleteDecision['carryoverUpdates'] = []

  for (const budget of sortedBudgets) {
    const realExpensesThisMonth = snapshot.realExpensesByBudget.get(budget.id) ?? 0
    const preDeficit = Math.max(0, realExpensesThisMonth - budget.estimated_amount)
    preTransferBudgetDeficit += preDeficit

    const transfersFrom = sumTransferAmounts(snapshot.transfers, 'from_budget_id', budget.id)
    const transfersTo = sumTransferAmounts(snapshot.transfers, 'to_budget_id', budget.id)
    const adjustedSpentAmount = realExpensesThisMonth + transfersFrom - transfersTo
    const deficit = Math.max(0, adjustedSpentAmount - budget.estimated_amount)

    carryoverUpdates.push({
      budget_id: budget.id,
      budget_name: budget.name,
      carryover_amount: deficit,
    })
  }

  const postTransferBudgetDeficit = carryoverUpdates.reduce((sum, u) => sum + u.carryover_amount, 0)

  // ------------------------------------------------------------------------
  // Block 4 — RAV difference: compute optional exceptionalExpense
  // ------------------------------------------------------------------------
  const baseRemainingToLive = snapshot.totalEstimatedIncome - snapshot.totalEstimatedBudgets
  const difference = snapshot.bankCurrentRemainingToLive - baseRemainingToLive
  const deficitCoveredByTransfers = preTransferBudgetDeficit - postTransferBudgetDeficit
  const adjustedDifference = difference + deficitCoveredByTransfers

  let exceptionalExpense: TablesInsert<'real_expenses'> | undefined
  if (adjustedDifference < 0) {
    const exceptionalExpenseAmount = Math.abs(adjustedDifference)
    exceptionalExpense = {
      amount: exceptionalExpenseAmount,
      description: `Écart de reste à vivre reporté du récap ${currentMonth}/${currentYear}`,
      // currentDate.toISOString().split('T')[0]! is safe — toISOString always
      // includes 'T'. The `!` is for noUncheckedIndexedAccess strictness.
      expense_date: input.currentDate.toISOString().split('T')[0]!,
      is_exceptional: true,
      estimated_budget_id: null,
      created_at: input.currentDate.toISOString(),
      profile_id: input.context === 'profile' ? input.contextId : null,
      group_id: input.context === 'group' ? input.contextId : null,
    }
  }

  // ------------------------------------------------------------------------
  // Block 5 — savings processing: per-budget surplus → cumulated_savings delta
  // ------------------------------------------------------------------------
  const surplusTransfers: ProcessCompleteDecision['surplusTransfers'] = []
  for (const budget of sortedBudgets) {
    const realExpenses = snapshot.realExpensesByBudget.get(budget.id) ?? 0
    const transfersFrom = sumTransferAmounts(snapshot.transfers, 'from_budget_id', budget.id)
    const transfersTo = sumTransferAmounts(snapshot.transfers, 'to_budget_id', budget.id)
    const adjustedSpent = realExpenses + transfersFrom - transfersTo
    const surplus = Math.max(0, budget.estimated_amount - adjustedSpent)

    if (surplus > 0) {
      const oldSavings = budget.cumulated_savings ?? 0
      surplusTransfers.push({
        budget_id: budget.id,
        budget_name: budget.name,
        surplus,
        old_savings: oldSavings,
        new_savings: oldSavings + surplus,
      })
    }
  }

  return {
    recapOperation: snapshot.existingRecapId === null ? 'insert' : 'update',
    recapData,
    existingRecapId: snapshot.existingRecapId,
    carryoverUpdates,
    preTransferBudgetDeficit,
    postTransferBudgetDeficit,
    surplusTransfers,
    exceptionalExpense,
    totalSurplus,
    totalDeficit,
    selectedBudgetName,
  }
}

// ---------------------------------------------------------------------------
// Helper: sum transfer amounts matching a specific from/to budget id
// ---------------------------------------------------------------------------
function sumTransferAmounts(
  transfers: BudgetTransferSnapshot[],
  field: 'from_budget_id' | 'to_budget_id',
  budgetId: string,
): number {
  return transfers
    .filter((t) => t[field] === budgetId)
    .reduce((sum, t) => sum + t.transfer_amount, 0)
}

// Type used internally for clarity (re-export the snapshot type for testing)
export type { BudgetSnapshot }
