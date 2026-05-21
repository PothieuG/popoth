/**
 * Types for the monthly recap finalization (`/api/monthly-recap/complete`).
 *
 * Sprint Refactor-I6 (2026-05-14): extracted from
 * app/api/monthly-recap/complete/route.ts (was 703 LOC mixed
 * algorithm/I/O/logging with 4 globals declared via `declare global`).
 * The algorithm is split into three layers:
 *   - lib/recap/complete-types.ts     — these type definitions
 *   - lib/recap/complete-algorithm.ts — pure decision logic (0 I/O)
 *   - lib/recap/complete-persist.ts   — I/O orchestrator
 *
 * The 4 globals (carryoverUpdates, preTransferBudgetDeficit,
 * postTransferBudgetDeficit, exceptionalExpenseToInsert) were intra-file
 * communication between separate try-blocks of the same handler — audit
 * confirmed 0 cross-route usage. They are eliminated in this refactor:
 * each becomes an explicit field on `ProcessCompleteDecision`, passed
 * from the algorithm to the persist layer.
 */

import type { TablesInsert } from '@/lib/database.types'

/**
 * Inputs accepted by `processComplete`. The HTTP handler resolves the
 * `withAuthAndProfile` context + the parsed body into this shape.
 */
export interface ProcessCompleteInput {
  userId: string
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
  sessionId: string
  /** Final RAV amount chosen by the user (body.remaining_to_live_choice.final_amount) */
  finalAmount: number
  /** Discriminator on body.remaining_to_live_choice.action */
  action: 'carry_forward' | 'deduct_from_budget'
  /** Required iff action === 'deduct_from_budget' (schema enforces) */
  budgetId?: string
  /**
   * Captured at handler-time so the algorithm/persist are deterministic.
   * The pure algorithm reads month/year/iso from this Date without calling
   * `new Date()` itself (mirror step1-algorithm.ts invariant).
   */
  currentDate: Date
}

/**
 * Per-budget snapshot extracted from `estimated_budgets`. Includes the
 * `monthly_surplus`/`monthly_deficit` fields used for the summary's
 * `total_surplus`/`total_deficit` (reset to 0 at the end of the flow).
 */
export interface BudgetSnapshot {
  id: string
  name: string
  estimated_amount: number
  cumulated_savings: number
  monthly_surplus: number | null
  monthly_deficit: number | null
}

/** Subset of `budget_transfers` used for deficit + surplus calculations. */
export interface BudgetTransferSnapshot {
  from_budget_id: string | null
  to_budget_id: string | null
  transfer_amount: number
}

/**
 * Pre-decision snapshot built by the persistence layer. The pure
 * algorithm decides what to do given this snapshot — it never reads
 * from the database.
 */
export interface ProcessCompleteSnapshot {
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
  /** financialData.remainingToLive at request time */
  initialRemainingToLive: number
  /** financialData.totalEstimatedIncome */
  totalEstimatedIncome: number
  /** financialData.totalEstimatedBudgets */
  totalEstimatedBudgets: number
  /** bank_balances.current_remaining_to_live for the owner */
  bankCurrentRemainingToLive: number
  /** All estimated_budgets for the owner */
  budgets: BudgetSnapshot[]
  /** Sum of real_expenses.amount per estimated_budget_id (single-pass load) */
  realExpensesByBudget: Map<string, number>
  /** All budget_transfers for the owner */
  transfers: BudgetTransferSnapshot[]
  /**
   * If a monthly_recaps row already exists for the current month/year,
   * its id (→ UPDATE path). Otherwise null (→ INSERT path).
   */
  existingRecapId: string | null
}

/**
 * One step taken during completion — mostly used for typed tracking in
 * `operations_performed` during tests. The HTTP summary response does
 * not currently expose this array (preserved verbatim from the original
 * route) but the persist layer publishes it through logger.info for
 * observability.
 */
export type AllocationOperation =
  | {
      step: 'recap_persist'
      type: 'monthly_recap_inserted' | 'monthly_recap_updated'
      details: { recap_id: string }
    }
  | {
      step: 'carryover_update'
      type: 'budget_carryover_applied'
      details: {
        budget_id: string
        budget_name: string
        carryover_amount: number
      }
    }
  | {
      step: 'surplus_transfer'
      type: 'surplus_to_savings'
      details: {
        budget_id: string
        budget_name: string
        surplus: number
        old_savings: number
        new_savings: number
      }
    }
  | {
      step: 'exceptional_expense_insert'
      type: 'rav_diff_to_expense'
      details: {
        amount: number
        description: string
      }
    }

/**
 * Decision produced by the pure algorithm. Immutable — the algorithm
 * never mutates `snapshot` or `input`. The persist layer applies these
 * decisions to the database via atomic RPCs / direct INSERT/UPDATE.
 *
 * Pre/post-transfer deficits are kept here verbatim because the
 * exceptionalExpense decision depends on `deficitCoveredByTransfers =
 * preTransferBudgetDeficit - postTransferBudgetDeficit` (mirror route L379).
 * Originally these were 2 separate globals; the refactor folds them
 * into the Decision so the persist layer doesn't need to recompute.
 */
export interface ProcessCompleteDecision {
  /** Discriminator: INSERT a new monthly_recaps row or UPDATE the existing one */
  recapOperation: 'insert' | 'update'
  /**
   * monthly_recaps payload (full Insert shape — for the UPDATE path the
   * persist layer applies `.update(recapData).eq('id', existingRecapId)`).
   */
  recapData: TablesInsert<'monthly_recaps'>
  /** id of an existing recap to update (null on INSERT path) */
  existingRecapId: string | null
  /**
   * Per-budget carryover_spent_amount values to apply post-cleanup.
   * One entry per budget (carryover_amount can be 0 — applied uniformly
   * to mirror the original route's L304-309 push-for-all behaviour).
   */
  carryoverUpdates: Array<{
    budget_id: string
    budget_name: string
    carryover_amount: number
  }>
  /** Sum of preDeficit across all budgets (mirror L283 in original) */
  preTransferBudgetDeficit: number
  /** Sum of deficit (post-transfer) across all budgets (mirror L314) */
  postTransferBudgetDeficit: number
  /** Per-budget surplus → cumulated_savings deltas (only entries with surplus > 0) */
  surplusTransfers: Array<{
    budget_id: string
    budget_name: string
    surplus: number
    old_savings: number
    new_savings: number
  }>
  /**
   * Exceptional expense to insert if adjustedDifference < 0; undefined
   * otherwise. The original route stored this in `global.exceptionalExpenseToInsert`
   * and inserted it at L613-616. Refactor lifts this into the Decision.
   */
  exceptionalExpense?: TablesInsert<'real_expenses'>
  /** Total surplus for summary (sum of estimated_budgets.monthly_surplus pre-reset) */
  totalSurplus: number
  /** Total deficit for summary (sum of estimated_budgets.monthly_deficit pre-reset) */
  totalDeficit: number
  /** The selected budget's name when action === 'deduct_from_budget' (for summary) */
  selectedBudgetName: string | null
}

/**
 * Output returned by `processComplete` to the HTTP handler. Maps 1:1 to
 * the JSON response body of POST /api/monthly-recap/complete (mirror
 * route.ts:684-689 + L667-682 summary). The handler spreads this object
 * into NextResponse.json — the field names must match the pre-refactor
 * response exactly.
 */
export interface ProcessCompleteOutput {
  success: true
  message: string
  summary: {
    recap_id: string
    initial_remaining_to_live: number
    final_remaining_to_live: number
    action_taken: 'carry_forward' | 'deduct_from_budget'
    budget_used: string | null
    total_surplus: number
    total_deficit: number
    incomes_reset: true
    month: number
    year: number
    completed_at: string
  }
  redirect_to_dashboard: true
}

/**
 * Thrown by the snapshot loader when `action === 'deduct_from_budget'`
 * but the requested `budgetId` is not present in `estimated_budgets`.
 * Mirror the original L141-143 404 path. The HTTP handler catches this
 * and maps to NextResponse.json({error}, {status: 404}).
 */
export class RecapBudgetNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecapBudgetNotFoundError'
  }
}

/**
 * Thrown by the snapshot loader / handler when `context === 'group'`
 * but the profile has no `group_id`. Mirror the original L57-62 400 path.
 */
export class RecapContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecapContextError'
  }
}
