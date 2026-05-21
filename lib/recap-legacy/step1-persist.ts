/**
 * Persistence orchestrator for monthly recap step 1.
 *
 * Sprint Refactor-I5 (2026-05-11): extracted from
 * app/api/monthly-recap/process-step1/route.ts (was 740 LOC mixed
 * algorithm/I/O/logging). This module owns:
 *   - loadSnapshot(input) — read DB into ProcessStep1Snapshot
 *   - applyDecision(input, snapshot, decision) — execute writes via RPCs
 *   - processStep1(input) — full pipeline producing ProcessStep1Output
 *
 * SIDE-EFFECT POLICY (mirror of the original route's invariants):
 *  - All cumulated_savings writes go through `updateBudgetCumulatedSavings`
 *    RPC (Sprint 0 / C3 atomic). The original route used the RPC at step
 *    2.2 (route.ts:362) but did a raw SELECT-then-UPDATE at step 2.4.2
 *    (route.ts:673-679); Sprint Refactor-I5 fixes that race by switching
 *    the 2.4.2 path to the RPC too. The math is identical — only the
 *    write path becomes atomic.
 *  - All piggy_bank writes go through `updatePiggyBank` RPC.
 *  - budget_transfers INSERTs stay direct (no RPC exists; row-level atomic).
 *    Fail-soft: on INSERT error, log via logger.warn and continue (mirror
 *    route.ts:445-449, :521-526, :706-709).
 *  - 3 calls to getProfileFinancialData / getGroupFinancialData are
 *    preserved: initial (route.ts:79), post-CAS1 final (route.ts:272),
 *    post-CAS2 final (route.ts:731). The post-call refetches are legitimate
 *    because piggy_bank / cumulated_savings have been mutated.
 *
 * LOGGING POLICY (CLAUDE.md §6 règle d'or — closes Lot 6 for this file):
 *  - All `logger.warn` / `logger.error` are KEEP+migrate (DB-error
 *    discriminants + cleanup-attempts + final result audit-trail).
 *  - DROP all flow logs / decorative separators from the original route
 *    (~95 sites). The persist layer publishes a single final audit log
 *    via logger.info covering case + gap_residuel + is_fully_balanced.
 */

import { ROUNDING_TOLERANCE } from '@/lib/constants/finance'
import type { Database } from '@/lib/database.types'
import { getGroupFinancialData, getProfileFinancialData } from '@/lib/finance'
import { transferWithSavingsDebit } from '@/lib/finance/budget-transfers'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import { asContextFilter } from '@/lib/finance/context'
import { ensurePiggyBankRow, updatePiggyBank } from '@/lib/finance/piggy-bank'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { decideStep1Allocation } from './step1-algorithm'
import type {
  AllocationOperation,
  BudgetAnalysis,
  ProcessStep1Decision,
  ProcessStep1Input,
  ProcessStep1Output,
  ProcessStep1Snapshot,
} from './types'

type BudgetTransferInsert = Database['public']['Tables']['budget_transfers']['Insert']

/**
 * Builds a typed budget_transfers payload with the ownership column set
 * based on the input's context. The conditional spread gives TypeScript a
 * literal type the Insert schema accepts (a computed-key form `[ownerField]:
 * contextId` produces an opaque polymorphic shape TS can't narrow).
 */
function buildTransferPayload(
  input: ProcessStep1Input,
  fields: Omit<BudgetTransferInsert, 'profile_id' | 'group_id'>,
): BudgetTransferInsert {
  const ownership =
    input.ownerField === 'profile_id'
      ? { profile_id: input.contextId, group_id: null }
      : { profile_id: null, group_id: input.contextId }
  return { ...ownership, ...fields }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Process step 1 of the monthly recap (rééquilibrage).
 *
 * Pipeline: loadSnapshot → decideStep1Allocation (pure) → applyDecision (I/O).
 * Each `applyDecision` RPC is atomic, but the pipeline itself is NOT
 * transactional — there is no DB-level lock between the read (loadSnapshot)
 * and the writes (applyDecision).
 *
 * ⚠️ CONCURRENCY EDGE CASE — known and accepted (Sprint Refactor-I5-followup,
 * 2026-05-11). A concurrent double-invocation for the same user (e.g. fast
 * network retry, curl, or devtools) can leave the DB in a partially-applied
 * state: the first call's RPCs decrement piggy_bank / cumulated_savings,
 * the second call (which loaded the same snapshot before the first call
 * persisted) tries to apply the same delta, and the RPC enforces
 * `>= 0` invariants → RAISE EXCEPTION → 500 to the second caller with no
 * rollback of the inserts/RPCs already committed by either call.
 *
 * Protection today: the frontend `isSubmitting` flag in
 * `components/monthly-recap/MonthlyRecapStep1.tsx` disables the submit
 * button during the request. This covers user double-click but NOT network
 * retries / curl / devtools.
 *
 * If a production incident shows half-applied state, prioritise implementing
 * server-side idempotency (header `Idempotency-Key` + cache table) or a
 * `pg_try_advisory_xact_lock(hashtext(user_id))` rather than client retry.
 * See `prompt/prompt-07-deep-dive-recap-algorithm-v2.md` Axe 3 Options A/B.
 */
export async function processStep1(input: ProcessStep1Input): Promise<ProcessStep1Output> {
  const snapshot = await loadSnapshot(input)
  const decision = decideStep1Allocation(snapshot)
  return applyDecision(input, snapshot, decision)
}

// ---------------------------------------------------------------------------
// Snapshot loading (I/O)
// ---------------------------------------------------------------------------

/**
 * Load the snapshot used as input to `decideStep1Allocation`. Exported as
 * testing surface (lib/recap/__tests__/step1-persist.test.ts) — production
 * code goes through `processStep1()` and never calls this directly.
 */
export async function loadSnapshot(input: ProcessStep1Input): Promise<ProcessStep1Snapshot> {
  // 1. Compute initial financial data (mirror route.ts:79-86)
  const financialData =
    input.context === 'profile'
      ? await getProfileFinancialData(input.contextId)
      : await getGroupFinancialData(input.contextId)

  const ravActuel = financialData.remainingToLive
  const ravBudgetaire = financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets
  const difference = ravActuel - ravBudgetaire

  // 2. Load budgets, expenses, piggy (mirror route.ts:97-126)
  const { data: budgets, error: budgetsError } = await supabaseServer
    .from('estimated_budgets')
    .select('*')
    .eq(input.ownerField, input.contextId)
  if (budgetsError) throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)

  const { data: expenses, error: expensesError } = await supabaseServer
    .from('real_expenses')
    .select('*')
    .eq(input.ownerField, input.contextId)
    .not('estimated_budget_id', 'is', null)
  if (expensesError) throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)

  // `.maybeSingle()` returns `{ data: null, error: null }` when no row exists
  // (brand-new user without an accumulated piggy yet). Only real DB errors
  // bubble up. Defaults to 0 — applyDecision calls `ensurePiggyBankRow` before
  // any RPC write so the missing-row case is handled transparently.
  const { data: piggyBankData, error: piggyBankError } = await supabaseServer
    .from('piggy_bank')
    .select('amount')
    .eq(input.ownerField, input.contextId)
    .maybeSingle()
  if (piggyBankError) throw new Error(`Erreur récupération tirelire: ${piggyBankError.message}`)

  const piggyBank = piggyBankData?.amount ?? 0

  // 3. Build BudgetAnalysis array (mirror route.ts:149-171)
  const budgetAnalyses: BudgetAnalysis[] = (budgets ?? []).map((budget) => {
    const spentAmount =
      (expenses ?? [])
        .filter((e) => e.estimated_budget_id === budget.id)
        .reduce((sum, e) => sum + e.amount, 0) ?? 0
    const diff = budget.estimated_amount - spentAmount
    return {
      id: budget.id,
      name: budget.name,
      estimated_amount: budget.estimated_amount,
      spent_amount: spentAmount,
      surplus: Math.max(0, diff),
      deficit: Math.max(0, -diff),
      cumulated_savings: budget.cumulated_savings ?? 0,
    }
  })

  return {
    context: input.context,
    contextId: input.contextId,
    ownerField: input.ownerField,
    piggyBank,
    ravActuel,
    ravBudgetaire,
    difference,
    budgetAnalyses,
  }
}

// ---------------------------------------------------------------------------
// Decision application (I/O)
// ---------------------------------------------------------------------------

/**
 * Apply the pure algorithm's decision to the database. Exported as
 * testing surface (lib/recap/__tests__/step1-persist.test.ts) — production
 * code goes through `processStep1()` and never calls this directly.
 */
export async function applyDecision(
  input: ProcessStep1Input,
  snapshot: ProcessStep1Snapshot,
  decision: ProcessStep1Decision,
): Promise<ProcessStep1Output> {
  const operationsPerformed: AllocationOperation[] = []
  const filter = asContextFilter(
    input.ownerField === 'profile_id'
      ? { profile_id: input.contextId }
      : { group_id: input.contextId },
  )

  if (decision.case === 'excedent') {
    // CAS 1 — single step 1.1 (piggy push if difference > 0)
    const hasPiggyPush = decision.operations.some(
      (op) => op.step === '1.1' && op.type === 'excedent_to_piggy_bank',
    )
    if (hasPiggyPush) {
      // RPC update_piggy_bank_amount RAISEs when its UPDATE matches 0 rows.
      // Ensure the row exists for first-time users before the RPC fires.
      await ensurePiggyBankRow(filter)
    }
    for (const op of decision.operations) {
      if (op.step === '1.1' && op.type === 'excedent_to_piggy_bank') {
        await updatePiggyBank(filter, op.details.excedent_amount)
        operationsPerformed.push(op)
      }
    }

    // Refetch final RAV (mirror route.ts:271-275)
    const finalFinancialData =
      input.context === 'profile'
        ? await getProfileFinancialData(input.contextId)
        : await getGroupFinancialData(input.contextId)

    logger.info('[process-step1] CAS 1 (excédent) completed', {
      initial_rav: snapshot.ravActuel,
      final_rav: finalFinancialData.remainingToLive,
      operations_count: operationsPerformed.length,
    })

    return {
      success: true,
      case: 'excedent',
      initial_rav: snapshot.ravActuel,
      budgetary_rav: snapshot.ravBudgetaire,
      final_rav: finalFinancialData.remainingToLive,
      difference: snapshot.difference,
      piggy_bank_final: decision.newPiggyBank,
      operations_performed: operationsPerformed,
      budgets_with_deficit_refloated: decision.budgetsWithDeficitRefloated,
      timestamp: Date.now(),
    }
  }

  // CAS 2 — déficit: apply 2.2 + 2.3 + 2.3.1, then refetch + 2.4.1 + 2.4.2
  let piggyBankFinal = snapshot.piggyBank

  for (const op of decision.operations) {
    if (op.step === '2.2' && op.type === 'use_savings') {
      try {
        await updateBudgetCumulatedSavings(op.details.budget_id, -op.details.amount_used)
        operationsPerformed.push(op)
      } catch (error) {
        // RPC errors here are not silently swallowed — the algorithm's
        // assumptions (savings >= amount) are violated. Re-throw to surface
        // as 500.
        throw new Error(
          `Erreur mise à jour économies ${op.details.budget_name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    } else if (op.step === '2.3.1' && op.type === 'transfer_to_deficit') {
      const payload = buildTransferPayload(input, {
        from_budget_id: null,
        to_budget_id: op.details.budget_id,
        transfer_amount: op.details.transfer_amount,
        transfer_reason: 'Renflouage partiel déficit (récap mensuel)',
        transfer_date: new Date().toISOString().split('T')[0]!,
      })
      const { error: transferError } = await supabaseServer.from('budget_transfers').insert(payload)
      if (transferError) {
        // Fail-soft mirror route.ts:521-526
        logger.warn('[process-step1 2.3.1] budget_transfers INSERT failed', {
          step: '2.3.1',
          error: transferError.message,
          details: op.details,
        })
        continue
      }
      operationsPerformed.push(op)
    }
  }

  // ÉTAPE 2.4.1 — residual excess to piggy_bank. Decided HERE (not in the
  // pure algorithm) because it depends on the refetched RAV after the 2.3.1
  // budget_transfers have settled — they don't move money in piggy_bank but
  // change `current_remaining_to_live` indirectly via `getProfileFinancialData`.
  if (decision.isFullyBalanced) {
    const newFinancialData =
      input.context === 'profile'
        ? await getProfileFinancialData(input.contextId)
        : await getGroupFinancialData(input.contextId)
    const newDifference = newFinancialData.remainingToLive - snapshot.ravBudgetaire

    if (newDifference > 0) {
      try {
        // Same guard as CAS 1: ensure the piggy_bank row exists before the RPC.
        await ensurePiggyBankRow(filter)
        await updatePiggyBank(filter, newDifference)
      } catch (error) {
        throw new Error(
          `Erreur mise à jour tirelire: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const oldPiggy = piggyBankFinal
      piggyBankFinal = piggyBankFinal + newDifference
      operationsPerformed.push({
        step: '2.4.1',
        type: 'excedent_to_piggy_bank',
        details: {
          excedent_amount: newDifference,
          old_piggy_bank: oldPiggy,
          new_piggy_bank: piggyBankFinal,
        },
      })
    }

    // ÉTAPE 2.4.2 — apply pre-decided 2nd-pass refloat operations. Both the
    // budget_transfers INSERT and the cumulated_savings debit go through
    // `transferWithSavingsDebit`, which composes them in one Postgres
    // transaction. Sprint Refactor-I5-followup-v2 (2026-05-11) replaced
    // the prior two-step INSERT-then-RPC sequence to close an atomicity
    // gap: a successful INSERT followed by a thrown RPC used to leave an
    // orphaned audit-trail row claiming a debit that never happened.
    // Fail-soft contract preserved — log + continue on any error.
    for (const op of decision.secondPassRefloatOps) {
      if (op.amount <= ROUNDING_TOLERANCE) continue

      try {
        await transferWithSavingsDebit(filter, {
          fromBudgetId: op.fromBudgetId,
          toBudgetId: op.toBudgetId,
          amount: op.amount,
        })
      } catch (error) {
        logger.warn('[process-step1 2.4.2] transferWithSavingsDebit failed', {
          step: '2.4.2.2',
          fromBudgetId: op.fromBudgetId,
          toBudgetId: op.toBudgetId,
          amount: op.amount,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      operationsPerformed.push({
        step: '2.4.2.2',
        type: 'refloat_from_savings',
        details: {
          from_budget_id: op.fromBudgetId,
          from_budget_name: op.fromBudgetName,
          to_budget_id: op.toBudgetId,
          to_budget_name: op.toBudgetName,
          amount: op.amount,
          old_savings: op.oldSavings,
          new_savings: op.newSavings,
        },
      })
    }
  }

  // Final refetch for the response (mirror route.ts:730-736)
  const finalFinancialData =
    input.context === 'profile'
      ? await getProfileFinancialData(input.contextId)
      : await getGroupFinancialData(input.contextId)

  logger.info('[process-step1] CAS 2 (déficit) completed', {
    initial_rav: snapshot.ravActuel,
    final_rav: finalFinancialData.remainingToLive,
    gap_residuel: decision.gapResiduel,
    is_fully_balanced: decision.isFullyBalanced,
    operations_count: operationsPerformed.length,
  })

  return {
    success: true,
    case: 'deficit',
    initial_rav: snapshot.ravActuel,
    budgetary_rav: snapshot.ravBudgetaire,
    final_rav: finalFinancialData.remainingToLive,
    difference: snapshot.difference,
    gap_residuel: decision.gapResiduel,
    is_fully_balanced: decision.isFullyBalanced,
    piggy_bank_final: piggyBankFinal,
    operations_performed: operationsPerformed,
    timestamp: Date.now(),
  }
}
