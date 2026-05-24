/**
 * Monthly Recap V3 — negative flow (4.B) actions. Sprint 07.
 *
 * Three helpers consumed by the matching POST routes:
 *
 *  - `executeRefloatFromPiggy` : debits `piggy_bank.amount` by `amount` via
 *    the atomic RPC `update_piggy_bank_amount(-amount)`, then increments
 *    `monthly_recaps.refloated_from_piggy` in a separate statement. The pair
 *    is NOT composite-atomic — accepted trade-off (cf. sprint plan). User
 *    chooses the amount (typically `min(piggy, deficit_remaining)`).
 *
 *  - `executeRefloatFromSavings` : computes a proportional allocation across
 *    the budgets' `cumulated_savings` via `computeProportionalSavingsRefloat`
 *    targeting the current `deficitRemaining`. Loop debits each budget via
 *    `update_budget_cumulated_savings(-share)` (fail-soft per budget), then
 *    bumps `monthly_recaps.refloated_from_savings` by the actually-applied
 *    total.
 *
 *  - `executeSaveBudgetSnapshot` : computes a proportional snapshot via
 *    `computeProportionalBudgetSnapshot` (pool = `estimated_amount`) and
 *    OVERWRITES `monthly_recaps.budget_snapshot_data` JSONB. No write to
 *    `estimated_budgets.carryover_spent_amount` — the snapshot is deferred,
 *    applied at finalize (sprint 08). Advances `current_step` to
 *    `'salary_update'` iff the new deficit reaches 0.
 *
 * Two pure helpers (`sumSnapshotValues`, `computeDeficitRemaining`) are also
 * exported for client-side reuse in sprint 13 (live deficit counter).
 *
 * Business errors surface as `RecapActionError(code, status, extras)` so the
 * three routes can serialize them via a single catch branch instead of
 * duplicating the validation gates.
 */

import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import type { ContextFilter } from '@/lib/finance/context'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'
import type { Database, Json } from '@/lib/database.types'

import type { MonthlyRecapRow } from './active-recap'
import {
  computeProportionalBudgetSnapshot,
  computeProportionalSavingsRefloat,
} from './calculations'
import type { RecapContext } from './check-status'
import { coerceSnapshot, computeDeficitRemaining } from './deficit-math'
import { loadRecapSummary } from './load-summary'
import type { RecapSummary } from './types'

// ---------------------------------------------------------------------------
// Pure helpers — extracted to `./deficit-math` (sprint 13) so client
// components can import them without dragging `supabaseServer` into the
// browser bundle. Re-exported here to preserve the public API and the
// existing test surface (`__tests__/actions-negative.test.ts`).
// ---------------------------------------------------------------------------

export { computeDeficitRemaining, sumSnapshotValues } from './deficit-math'
export type { ComputeDeficitArgs } from './deficit-math'

// ---------------------------------------------------------------------------
// Typed business errors (deserialized to HTTP by the routes)
// ---------------------------------------------------------------------------

export class RecapActionError extends Error {
  readonly code: string
  readonly status: number
  readonly extras: Record<string, unknown>

  constructor(code: string, status: number, extras: Record<string, unknown> = {}) {
    super(code)
    this.code = code
    this.status = status
    this.extras = extras
    this.name = 'RecapActionError'
  }
}

// ---------------------------------------------------------------------------
// executeRefloatFromPiggy
// ---------------------------------------------------------------------------

export interface ExecuteRefloatFromPiggyArgs {
  context: RecapContext
  filter: ContextFilter
  profileId: string
  groupId: string | null
  recap: MonthlyRecapRow
  amount: number
}

export interface RefloatFromPiggyOutcome {
  newDeficit: number
  refloatedFromPiggy: number
  summary: RecapSummary
}

export async function executeRefloatFromPiggy(
  args: ExecuteRefloatFromPiggyArgs,
): Promise<RefloatFromPiggyOutcome> {
  const summaryBefore = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })
  if (summaryBefore.bilanSign !== 'negative') {
    throw new RecapActionError('no_deficit', 409)
  }

  const deficitRemaining = computeDeficitRemaining({
    initialBilan: summaryBefore.bilan,
    refloatedFromPiggy: Number(args.recap.refloated_from_piggy),
    refloatedFromSavings: Number(args.recap.refloated_from_savings),
    snapshotData: coerceSnapshot(args.recap.budget_snapshot_data),
  })
  if (deficitRemaining <= 0.01) {
    throw new RecapActionError('no_deficit', 409)
  }

  if (args.amount > deficitRemaining + 0.01) {
    throw new RecapActionError('overflow', 400, { deficitRemaining })
  }
  if (args.amount > summaryBefore.piggyAmount + 0.01) {
    throw new RecapActionError('piggy_insufficient', 400, {
      available: summaryBefore.piggyAmount,
    })
  }

  await updatePiggyBank(args.filter, -args.amount)

  const nextRefloated = round2(Number(args.recap.refloated_from_piggy) + args.amount)
  const { error: updateError } = await supabaseServer
    .from('monthly_recaps')
    .update({ refloated_from_piggy: nextRefloated })
    .eq('id', args.recap.id)
  if (updateError) {
    logger.error('[recap/negative] refloat-from-piggy: tracker update failed', {
      recapId: args.recap.id,
      amount: args.amount,
      error: updateError,
    })
  }

  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })

  return {
    newDeficit: round2(deficitRemaining - args.amount),
    refloatedFromPiggy: nextRefloated,
    summary,
  }
}

// ---------------------------------------------------------------------------
// executeRefloatFromSavings
// ---------------------------------------------------------------------------

export interface ExecuteRefloatFromSavingsArgs {
  context: RecapContext
  profileId: string
  groupId: string | null
  recap: MonthlyRecapRow
}

export interface RefloatFromSavingsOutcome {
  newDeficit: number
  refloatedFromSavings: number
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  failed: ReadonlyArray<{ budgetId: string; reason: string }>
  shortfall: number
  summary: RecapSummary
}

export async function executeRefloatFromSavings(
  args: ExecuteRefloatFromSavingsArgs,
): Promise<RefloatFromSavingsOutcome> {
  const summaryBefore = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })
  if (summaryBefore.bilanSign !== 'negative') {
    throw new RecapActionError('no_deficit', 409)
  }

  const deficitRemaining = computeDeficitRemaining({
    initialBilan: summaryBefore.bilan,
    refloatedFromPiggy: Number(args.recap.refloated_from_piggy),
    refloatedFromSavings: Number(args.recap.refloated_from_savings),
    snapshotData: coerceSnapshot(args.recap.budget_snapshot_data),
  })
  if (deficitRemaining <= 0.01) {
    throw new RecapActionError('no_deficit', 409)
  }

  const allocation = computeProportionalSavingsRefloat(
    deficitRemaining,
    summaryBefore.budgets.map((b) => ({
      budgetId: b.budgetId,
      cumulatedSavings: b.cumulatedSavings,
    })),
  )

  // Pool empty (no budget has cumulated_savings > 0) — no-op, NOT an error.
  // The UI shows the line as indicatif when totalSavings === 0.
  if (allocation.totalAllocated === 0) {
    return {
      newDeficit: deficitRemaining,
      refloatedFromSavings: 0,
      perBudget: [],
      failed: [],
      shortfall: deficitRemaining,
      summary: summaryBefore,
    }
  }

  const applied: Array<{ budgetId: string; amount: number }> = []
  const failed: Array<{ budgetId: string; reason: string }> = []

  for (const item of allocation.perBudget) {
    try {
      await updateBudgetCumulatedSavings(item.budgetId, -item.amount)
      applied.push(item)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[recap/negative] refloat-from-savings: budget debit failed', {
        budgetId: item.budgetId,
        amount: item.amount,
        reason,
      })
      failed.push({ budgetId: item.budgetId, reason })
    }
  }

  const totalApplied = round2(applied.reduce((s, i) => s + i.amount, 0))

  if (totalApplied > 0) {
    const nextRefloated = round2(Number(args.recap.refloated_from_savings) + totalApplied)
    const { error: updateError } = await supabaseServer
      .from('monthly_recaps')
      .update({ refloated_from_savings: nextRefloated })
      .eq('id', args.recap.id)
    if (updateError) {
      logger.error('[recap/negative] refloat-from-savings: tracker update failed', {
        recapId: args.recap.id,
        totalApplied,
        error: updateError,
      })
    }
  }

  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })

  const newDeficit = round2(deficitRemaining - totalApplied)

  return {
    newDeficit,
    refloatedFromSavings: round2(Number(args.recap.refloated_from_savings) + totalApplied),
    perBudget: applied,
    failed,
    shortfall: round2(Math.max(0, newDeficit)),
    summary,
  }
}

// ---------------------------------------------------------------------------
// executeSaveBudgetSnapshot
// ---------------------------------------------------------------------------

export interface ExecuteSaveBudgetSnapshotArgs {
  context: RecapContext
  profileId: string
  groupId: string | null
  recap: MonthlyRecapRow
}

export interface SaveBudgetSnapshotOutcome {
  newDeficit: number
  snapshot: Record<string, number>
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  shortfall: number
  nextStep: 'salary_update' | null
}

export async function executeSaveBudgetSnapshot(
  args: ExecuteSaveBudgetSnapshotArgs,
): Promise<SaveBudgetSnapshotOutcome> {
  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
  })
  if (summary.bilanSign !== 'negative') {
    throw new RecapActionError('no_deficit', 409)
  }

  const deficitRemaining = computeDeficitRemaining({
    initialBilan: summary.bilan,
    refloatedFromPiggy: Number(args.recap.refloated_from_piggy),
    refloatedFromSavings: Number(args.recap.refloated_from_savings),
    // Re-compute the snapshot from scratch — the existing snapshot (if any)
    // is fully replaced. Excluding it from the target keeps the algorithm
    // idempotent across re-clicks at unchanged piggy/savings state.
    snapshotData: null,
  })
  if (deficitRemaining <= 0.01) {
    throw new RecapActionError('no_deficit', 409)
  }

  const allocation = computeProportionalBudgetSnapshot(
    deficitRemaining,
    summary.budgets.map((b) => ({
      budgetId: b.budgetId,
      estimatedAmount: b.estimatedAmount,
    })),
  )

  const mergedSnapshot: Record<string, number> = {}
  for (const item of allocation.perBudget) {
    mergedSnapshot[item.budgetId] = item.amount
  }

  const snapshotUpdate: Database['public']['Tables']['monthly_recaps']['Update'] = {
    budget_snapshot_data: mergedSnapshot as unknown as Json,
  }
  const { error: snapshotError } = await supabaseServer
    .from('monthly_recaps')
    .update(snapshotUpdate)
    .eq('id', args.recap.id)
  if (snapshotError) {
    logger.error('[recap/negative] save-budget-snapshot: snapshot write failed', {
      recapId: args.recap.id,
      error: snapshotError,
    })
    throw snapshotError
  }

  const newDeficit = round2(deficitRemaining - allocation.totalAllocated)

  let nextStep: 'salary_update' | null = null
  if (newDeficit <= 0.01) {
    const { error: stepError } = await supabaseServer
      .from('monthly_recaps')
      .update({ current_step: 'salary_update' })
      .eq('id', args.recap.id)
    if (stepError) {
      logger.error('[recap/negative] save-budget-snapshot: advance step failed', {
        recapId: args.recap.id,
        error: stepError,
      })
    } else {
      nextStep = 'salary_update'
    }
  }

  return {
    newDeficit,
    snapshot: mergedSnapshot,
    perBudget: allocation.perBudget,
    shortfall: round2(allocation.shortfall),
    nextStep,
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
