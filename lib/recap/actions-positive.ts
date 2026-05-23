/**
 * Monthly Recap V3 — positive flow (4.A) actions. Sprint 06.
 *
 * Two helpers consumed by the matching POST routes:
 *
 *  - `executeTransferSurplusesToPiggy` : sweeps the selected budgets' surplus
 *    into the piggy bank via the existing atomic RPC `transfer_budget_to_piggy_bank`.
 *    Loop is fail-soft per budget — each RPC is its own transaction, so
 *    successful transfers persist while failures are reported in `failed[]`.
 *    Re-loads the summary at the end so the UI can show what's still left.
 *
 *  - `executeTransformRemainingToSavings` : for every remaining positive
 *    surplus, increments `cumulated_savings` on the budget itself via
 *    `update_budget_cumulated_savings`. Advances the recap state machine to
 *    `'salary_update'` once at least one transform succeeded (or no targets
 *    existed) — when 100% of attempts failed against a non-empty target set,
 *    the step is preserved so the user can retry.
 *
 * Both helpers re-use the already-atomic per-row RPCs; no new SQL needed.
 */

import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import type { ContextFilter } from '@/lib/finance/context'
import { transferBudgetToPiggyBank } from '@/lib/finance/savings'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { MonthlyRecapRow } from './active-recap'
import type { RecapContext } from './check-status'
import { loadRecapSummary } from './load-summary'
import type { RecapSummary } from './types'

export interface BudgetActionResult {
  budgetId: string
  amount: number
}

export interface BudgetActionFailure {
  budgetId: string
  reason: string
}

export interface TransferOutcome {
  transferred: BudgetActionResult[]
  failed: BudgetActionFailure[]
}

export interface TransformOutcome {
  transformed: BudgetActionResult[]
  failed: BudgetActionFailure[]
  /** `'salary_update'` when the state machine advanced; `null` when retry needed. */
  nextStep: 'salary_update' | null
}

export interface ExecuteTransferArgs {
  context: RecapContext
  filter: ContextFilter
  profileId: string
  groupId: string | null
  budgetIds: string[]
}

export async function executeTransferSurplusesToPiggy(
  args: ExecuteTransferArgs,
): Promise<{ outcome: TransferOutcome; summary: RecapSummary }> {
  const summaryBefore = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })

  const selected = new Set(args.budgetIds)
  const targets = summaryBefore.budgets.filter((b) => selected.has(b.budgetId) && b.surplus > 0)

  const transferred: BudgetActionResult[] = []
  const failed: BudgetActionFailure[] = []

  for (const budget of targets) {
    try {
      await transferBudgetToPiggyBank(args.filter, {
        fromBudgetId: budget.budgetId,
        amount: budget.surplus,
      })
      transferred.push({ budgetId: budget.budgetId, amount: budget.surplus })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[recap/positive] transfer-to-piggy failed', {
        budgetId: budget.budgetId,
        amount: budget.surplus,
        reason,
      })
      failed.push({ budgetId: budget.budgetId, reason })
    }
  }

  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })

  return { outcome: { transferred, failed }, summary }
}

export interface ExecuteTransformArgs {
  context: RecapContext
  recap: MonthlyRecapRow
  profileId: string
  groupId: string | null
}

export async function executeTransformRemainingToSavings(
  args: ExecuteTransformArgs,
): Promise<TransformOutcome> {
  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })
  const targets = summary.budgets.filter((b) => b.surplus > 0)

  const transformed: BudgetActionResult[] = []
  const failed: BudgetActionFailure[] = []

  for (const budget of targets) {
    try {
      await updateBudgetCumulatedSavings(budget.budgetId, budget.surplus)
      transformed.push({ budgetId: budget.budgetId, amount: budget.surplus })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[recap/positive] transform-to-savings failed', {
        budgetId: budget.budgetId,
        amount: budget.surplus,
        reason,
      })
      failed.push({ budgetId: budget.budgetId, reason })
    }
  }

  // Advance only when something succeeded OR there was nothing to do.
  // 100% failure on non-empty targets → keep current_step so the user can retry.
  const shouldAdvance = targets.length === 0 || transformed.length > 0
  let nextStep: 'salary_update' | null = null
  if (shouldAdvance) {
    const { error } = await supabaseServer
      .from('monthly_recaps')
      .update({ current_step: 'salary_update' })
      .eq('id', args.recap.id)
    if (error) {
      logger.error('[recap/positive] advance step failed', { recapId: args.recap.id, error })
    } else {
      nextStep = 'salary_update'
    }
  }

  return { transformed, failed, nextStep }
}
