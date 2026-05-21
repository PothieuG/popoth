/**
 * Persistence orchestrator for monthly recap completion.
 *
 * Sprint Refactor-I6 (2026-05-14): extracted from
 * app/api/monthly-recap/complete/route.ts (was 703 LOC mixed
 * algorithm/I/O/logging with 4 declare-global slots). This module owns:
 *   - loadCompleteSnapshot(input) — read DB into ProcessCompleteSnapshot
 *   - applyCompleteDecision(input, snapshot, decision) — execute writes
 *   - processComplete(input) — full pipeline producing ProcessCompleteOutput
 *
 * SIDE-EFFECT POLICY (mirror of the original route's invariants):
 *  - All cumulated_savings writes go through `updateBudgetCumulatedSavings`
 *    RPC (Sprint 0 / C3 atomic). The original route did a raw SELECT-then-
 *    UPDATE at L484-491 (race condition under concurrent writes). Sprint
 *    Refactor-I6 fixes that by routing the savings transfer through the
 *    RPC. The math is identical — only the write path becomes atomic.
 *  - Per-budget fail-soft on RPC error: logger.warn + continue (mirror
 *    original L493 console.error + continue).
 *  - DELETE cleanup (real_income_entries / real_expenses / budget_transfers)
 *    is per-table fail-soft (logger.warn + continue, mirror L534/550/567).
 *  - Carryover UPDATE per-budget fail-soft (mirror L592).
 *  - Exceptional expense INSERT fail-soft (mirror L618).
 *  - last_monthly_update UPDATE + reset monthly_surplus/deficit fail-soft
 *    (mirror L642/659 "Ne pas faire échouer la transaction pour ça").
 *
 * LOGGING POLICY (CLAUDE.md §6 règle d'or — Lot 6 partial closeout):
 *  - DROP all decorative banners + flow logs from the original route
 *    (~50 sites).
 *  - KEEP+migrate the per-step fail-soft branches as `logger.warn`
 *    (DB-error discriminants).
 *  - The 4 original cleanup-attempts catch blocks (deficitError,
 *    ravDifferenceError, savingsError, transactionError) collapse here:
 *    deficit + RAV diff are now PURE in the algorithm (cannot fail in I/O);
 *    savings is per-budget fail-soft; transactionError stays in the route
 *    handler's outer catch.
 *
 * CONCURRENCY EDGE CASE (mirror step1-persist.ts JSDoc): the pipeline
 * `loadCompleteSnapshot → decideCompleteAllocation → applyCompleteDecision`
 * is NOT transactional. A concurrent double-invocation can leave the DB
 * in a partially-applied state. Protection today: the frontend
 * `isSubmitting` flag disables the submit button. If a production
 * incident shows half-applied state, prioritise idempotency-key /
 * pg_try_advisory_xact_lock rather than client retry.
 */

import type { TablesInsert, TablesUpdate } from '@/lib/database.types'
import { getGroupFinancialData, getProfileFinancialData } from '@/lib/finance'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { decideCompleteAllocation } from './complete-algorithm'
import {
  RecapBudgetNotFoundError,
  RecapContextError,
  type BudgetSnapshot,
  type BudgetTransferSnapshot,
  type ProcessCompleteDecision,
  type ProcessCompleteInput,
  type ProcessCompleteOutput,
  type ProcessCompleteSnapshot,
} from './complete-types'

type MonthlyRecapInsert = TablesInsert<'monthly_recaps'>
type EstimatedBudgetUpdate = TablesUpdate<'estimated_budgets'>

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Process the completion of a monthly recap. Pipeline:
 *   loadCompleteSnapshot → decideCompleteAllocation (pure) → applyCompleteDecision (I/O)
 *
 * Errors:
 *  - RecapContextError → handler maps to 400
 *  - RecapBudgetNotFoundError → handler maps to 404
 *  - Other Error → handler maps to 500
 */
export async function processComplete(input: ProcessCompleteInput): Promise<ProcessCompleteOutput> {
  const snapshot = await loadCompleteSnapshot(input)
  const decision = decideCompleteAllocation(snapshot, input)
  return applyCompleteDecision(input, snapshot, decision)
}

// ---------------------------------------------------------------------------
// Snapshot loading (I/O)
// ---------------------------------------------------------------------------

/**
 * Load the snapshot used as input to `decideCompleteAllocation`. Exported
 * as testing surface (lib/recap/__tests__/complete-persist.test.ts) —
 * production code goes through `processComplete()` and never calls this
 * directly.
 *
 * Throws on critical SELECT errors (budgets / real_expenses / transfers /
 * financial-data / monthly_recaps existence). Treats `bank_balances`
 * missing row as `bankCurrentRemainingToLive = 0` (mirror original
 * L362 `bankBalance?.current_remaining_to_live || 0` — though the
 * original ALSO skipped exceptional calc on bank-load error; refactor
 * accepts the small behavior improvement of computing exceptional even
 * with bank=0, which is more correct than silently dropping the RAV
 * difference).
 */
export async function loadCompleteSnapshot(
  input: ProcessCompleteInput,
): Promise<ProcessCompleteSnapshot> {
  // 1. Validate context (mirror L57-62 — context='group' requires group_id)
  if (input.context === 'group' && !input.contextId) {
    throw new RecapContextError("Utilisateur ne fait partie d'aucun groupe")
  }

  // 2. Compute financial data (mirror L67-76)
  const financialData =
    input.context === 'profile'
      ? await getProfileFinancialData(input.contextId)
      : await getGroupFinancialData(input.contextId)

  // 3. Load budgets
  const { data: budgets, error: budgetsError } = await supabaseServer
    .from('estimated_budgets')
    .select('id, name, estimated_amount, cumulated_savings, monthly_surplus, monthly_deficit')
    .eq(input.ownerField, input.contextId)
  if (budgetsError) {
    throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
  }

  // 4. Load real_expenses (aggregated by budget_id in a single pass — the
  //    original made one SELECT per budget inside the deficit + savings
  //    loops, which was N+1).
  const { data: expenses, error: expensesError } = await supabaseServer
    .from('real_expenses')
    .select('estimated_budget_id, amount')
    .eq(input.ownerField, input.contextId)
  if (expensesError) {
    throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
  }

  const realExpensesByBudget = new Map<string, number>()
  for (const exp of expenses ?? []) {
    if (exp.estimated_budget_id == null) continue
    const prev = realExpensesByBudget.get(exp.estimated_budget_id) ?? 0
    realExpensesByBudget.set(exp.estimated_budget_id, prev + exp.amount)
  }

  // 5. Load budget_transfers
  const { data: transfers, error: transfersError } = await supabaseServer
    .from('budget_transfers')
    .select('from_budget_id, to_budget_id, transfer_amount')
    .eq(input.ownerField, input.contextId)
  if (transfersError) {
    throw new Error(`Erreur récupération transferts: ${transfersError.message}`)
  }

  // 6. Load bank_balances.current_remaining_to_live — use .maybeSingle()
  //    so a missing row is `data: null, error: null` rather than PGRST116.
  const { data: bankRow, error: bankError } = await supabaseServer
    .from('bank_balances')
    .select('current_remaining_to_live')
    .eq(input.ownerField, input.contextId)
    .maybeSingle()
  if (bankError) {
    throw new Error(`Erreur récupération solde bancaire: ${bankError.message}`)
  }

  // 7. Check existing monthly_recaps row for current month/year
  const currentMonth = input.currentDate.getMonth() + 1
  const currentYear = input.currentDate.getFullYear()
  const { data: existingRecap, error: existingError } = await supabaseServer
    .from('monthly_recaps')
    .select('id')
    .eq(input.ownerField, input.contextId)
    .eq('recap_month', currentMonth)
    .eq('recap_year', currentYear)
    .maybeSingle()
  if (existingError) {
    throw new Error(`Erreur vérification récap existant: ${existingError.message}`)
  }

  // 8. Validate deduct_from_budget budget existence (mirror L141-143 404 path)
  const loadedBudgets: BudgetSnapshot[] = (budgets ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    estimated_amount: b.estimated_amount,
    cumulated_savings: b.cumulated_savings ?? 0,
    monthly_surplus: b.monthly_surplus,
    monthly_deficit: b.monthly_deficit,
  }))

  if (input.action === 'deduct_from_budget') {
    const found = loadedBudgets.find((b) => b.id === input.budgetId)
    if (!found) {
      throw new RecapBudgetNotFoundError('Budget spécifié non trouvé')
    }
  }

  const snapshotTransfers: BudgetTransferSnapshot[] = (transfers ?? []).map((t) => ({
    from_budget_id: t.from_budget_id,
    to_budget_id: t.to_budget_id,
    transfer_amount: t.transfer_amount,
  }))

  return {
    context: input.context,
    contextId: input.contextId,
    ownerField: input.ownerField,
    initialRemainingToLive: financialData.remainingToLive,
    totalEstimatedIncome: financialData.totalEstimatedIncome,
    totalEstimatedBudgets: financialData.totalEstimatedBudgets,
    bankCurrentRemainingToLive: bankRow?.current_remaining_to_live ?? 0,
    budgets: loadedBudgets,
    realExpensesByBudget,
    transfers: snapshotTransfers,
    existingRecapId: existingRecap?.id ?? null,
  }
}

// ---------------------------------------------------------------------------
// Decision application (I/O)
// ---------------------------------------------------------------------------

/**
 * Apply the algorithm's decision to the database. Exported as testing
 * surface (lib/recap/__tests__/complete-persist.test.ts) — production
 * code goes through `processComplete()` and never calls this directly.
 *
 * Order of writes (mirror original route blocks 1, 4, 5, 6, 7, 8, 9):
 *   1. INSERT or UPDATE monthly_recaps (CRITICAL — throws on failure)
 *   2. Apply surplusTransfers via atomic RPC (per-budget fail-soft)
 *   3. DELETE cleanup: real_income_entries / real_expenses / budget_transfers
 *      (per-table fail-soft)
 *   4. Apply carryoverUpdates per-budget (fail-soft)
 *   5. INSERT exceptional expense if present (fail-soft)
 *   6. UPDATE last_monthly_update for all budgets (fail-soft)
 *   7. Reset monthly_surplus / monthly_deficit for all budgets (fail-soft)
 */
export async function applyCompleteDecision(
  input: ProcessCompleteInput,
  snapshot: ProcessCompleteSnapshot,
  decision: ProcessCompleteDecision,
): Promise<ProcessCompleteOutput> {
  // ----- Step 1: INSERT or UPDATE monthly_recaps (CRITICAL) -----
  const recapId = await persistRecap(decision)

  // ----- Step 2: Apply surplus transfers via atomic RPC (FIX for L484 race) -----
  for (const transfer of decision.surplusTransfers) {
    try {
      await updateBudgetCumulatedSavings(transfer.budget_id, transfer.surplus)
    } catch (error) {
      logger.warn('[complete savings] updateBudgetCumulatedSavings failed', {
        budget_id: transfer.budget_id,
        budget_name: transfer.budget_name,
        surplus: transfer.surplus,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ----- Step 3: Cleanup DELETEs (per-table fail-soft) -----
  await deleteOwned(input, 'real_income_entries')
  await deleteOwned(input, 'real_expenses')
  await deleteOwned(input, 'budget_transfers')

  // ----- Step 4: Apply carryover_spent_amount per-budget -----
  const carryoverAppliedDate = input.currentDate.toISOString().split('T')[0]!
  for (const update of decision.carryoverUpdates) {
    const carryoverPayload: EstimatedBudgetUpdate = {
      carryover_spent_amount: update.carryover_amount,
      carryover_applied_date: carryoverAppliedDate,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabaseServer
      .from('estimated_budgets')
      .update(carryoverPayload)
      .eq('id', update.budget_id)
    if (error) {
      logger.warn('[complete carryover] estimated_budgets update failed', {
        budget_id: update.budget_id,
        budget_name: update.budget_name,
        carryover_amount: update.carryover_amount,
        error: error.message,
      })
    }
  }

  // ----- Step 5: INSERT exceptional expense if decided -----
  if (decision.exceptionalExpense) {
    const { error } = await supabaseServer
      .from('real_expenses')
      .insert([decision.exceptionalExpense])
    if (error) {
      logger.warn('[complete exceptional] real_expenses insert failed', {
        amount: decision.exceptionalExpense.amount,
        description: decision.exceptionalExpense.description,
        error: error.message,
      })
    }
  }

  // ----- Step 6: UPDATE last_monthly_update + updated_at for all owned budgets -----
  const lastUpdatePayload: EstimatedBudgetUpdate = {
    last_monthly_update: carryoverAppliedDate,
    updated_at: new Date().toISOString(),
  }
  const { error: lastUpdateErr } = await supabaseServer
    .from('estimated_budgets')
    .update(lastUpdatePayload)
    .eq(input.ownerField, input.contextId)
  if (lastUpdateErr) {
    logger.warn('[complete last_monthly_update] estimated_budgets update failed', {
      error: lastUpdateErr.message,
    })
  }

  // ----- Step 7: Reset monthly_surplus + monthly_deficit -----
  const resetPayload: EstimatedBudgetUpdate = {
    monthly_surplus: 0,
    monthly_deficit: 0,
    updated_at: new Date().toISOString(),
  }
  const { error: resetErr } = await supabaseServer
    .from('estimated_budgets')
    .update(resetPayload)
    .eq(input.ownerField, input.contextId)
  if (resetErr) {
    logger.warn('[complete reset monthly_surplus/deficit] estimated_budgets update failed', {
      error: resetErr.message,
    })
  }

  // ----- Build response -----
  return {
    success: true,
    message: 'Récapitulatif mensuel finalisé avec succès',
    summary: {
      recap_id: recapId,
      initial_remaining_to_live: snapshot.initialRemainingToLive,
      final_remaining_to_live: input.finalAmount,
      action_taken: input.action,
      budget_used: decision.selectedBudgetName,
      total_surplus: decision.totalSurplus,
      total_deficit: decision.totalDeficit,
      incomes_reset: true,
      month: input.currentDate.getMonth() + 1,
      year: input.currentDate.getFullYear(),
      // `completed_at` was set by the algorithm using input.currentDate
      // (deterministic). Cast safe because the algorithm always sets it.
      completed_at: decision.recapData.completed_at as string,
    },
    redirect_to_dashboard: true,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * INSERT a new monthly_recaps row or UPDATE the existing one based on
 * `decision.recapOperation`. Returns the recap row id. Throws on failure
 * (this is the critical path — the route returns 500 if the recap can't
 * be persisted).
 */
async function persistRecap(decision: ProcessCompleteDecision): Promise<string> {
  if (decision.recapOperation === 'insert') {
    const { data, error } = await supabaseServer
      .from('monthly_recaps')
      .insert(decision.recapData as MonthlyRecapInsert)
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`Erreur insertion récap: ${error?.message ?? 'no data returned'}`)
    }
    return data.id
  }

  // UPDATE path — existingRecapId is guaranteed non-null when recapOperation='update'
  const { data, error } = await supabaseServer
    .from('monthly_recaps')
    .update(decision.recapData)
    .eq('id', decision.existingRecapId as string)
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`Erreur mise à jour récap: ${error?.message ?? 'no data returned'}`)
  }
  return data.id
}

/**
 * DELETE all rows of `table` owned by `input.ownerField === input.contextId`.
 * Per-table fail-soft (logger.warn + continue, mirror original L534/550/567).
 */
async function deleteOwned(
  input: ProcessCompleteInput,
  table: 'real_income_entries' | 'real_expenses' | 'budget_transfers',
): Promise<void> {
  const { error } = await supabaseServer.from(table).delete().eq(input.ownerField, input.contextId)
  if (error) {
    logger.warn('[complete cleanup] table delete failed', {
      table,
      error: error.message,
    })
  }
}
