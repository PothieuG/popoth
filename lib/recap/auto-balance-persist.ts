/**
 * Persistence orchestrator for monthly recap auto-balance.
 *
 * Sprint Refactor-Auto-Balance (2026-05-16): extracted from
 * app/api/monthly-recap/auto-balance/route.ts (god file ~533 LOC). This
 * module owns:
 *   - loadAutoBalanceSnapshot(input)               — read DB into snapshot
 *   - applyAutoBalanceDecision(input, decision)    — execute writes via RPCs
 *   - processAutoBalance(input)                    — full pipeline → output
 *
 * SIDE-EFFECT POLICY (mirror of the original route's invariants):
 *  - Savings transfers via `transferWithSavingsDebit` composite RPC. Each
 *    call composes INSERT budget_transfers + debit cumulated_savings in
 *    one Postgres transaction — Sprint Auto-Balance-Atomic (2026-05-15).
 *    Per-pair fail-soft: logger.warn + continue (the failed pair's tx
 *    rolls back atomically — no orphan rows).
 *  - Piggy transfers via `transferPiggyToBudgetWithInsert` composite RPC.
 *    Each call composes update_piggy_bank_amount(-amount) + INSERT
 *    budget_transfers (from=NULL) in one Postgres transaction — Sprint
 *    Auto-Balance-Atomic-Phase-B (2026-05-15). Per-pair fail-soft.
 *  - Surplus transfers via single batched INSERT. No debit because surplus
 *    is computed (real_expenses + transfers vs estimated), NOT stored. The
 *    batched INSERT is NOT per-pair fail-soft — if it errors, 500 is
 *    returned. This mirrors the pre-extraction route verbatim.
 *
 * PIPELINE CONCURRENCY (mirror process-step1):
 *  The pipeline `loadSnapshot → decide → apply` is NOT transactional. A
 *  concurrent double-invocation can leave the DB partially applied (the
 *  composite RPCs are individually atomic, but the pipeline is not).
 *  Protection today: the frontend `isSubmitting` flag disables the submit
 *  button during the request. See process-step1/route.ts comments for the
 *  full concurrency note.
 */

import type { Database } from '@/lib/database.types'
import { transferWithSavingsDebit } from '@/lib/finance/budget-transfers'
import { asContextFilter } from '@/lib/finance/context'
import { transferPiggyToBudgetWithInsert } from '@/lib/finance/piggy-bank'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { decideAutoBalanceAllocation } from './auto-balance-algorithm'
import {
  RecapNoBudgetsError,
  type AutoBalanceTransfer,
  type BudgetAnalysis,
  type ProcessAutoBalanceDecision,
  type ProcessAutoBalanceInput,
  type ProcessAutoBalanceOutput,
  type ProcessAutoBalanceSnapshot,
} from './auto-balance-types'

type BudgetTransferInsert = Database['public']['Tables']['budget_transfers']['Insert']

/**
 * Build a typed budget_transfers payload with the ownership column set based
 * on the input's context. The conditional spread gives TypeScript a literal
 * type the Insert schema accepts (a computed-key form `[ownerField]: contextId`
 * produces an opaque polymorphic shape TS can't narrow). Pattern mirror
 * step1-persist.ts:buildTransferPayload.
 */
function buildTransferPayload(
  input: ProcessAutoBalanceInput,
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
 * Auto-balance the monthly recap deficits using the proportional 3-phase
 * algorithm: piggy bank → savings → surplus.
 *
 * Pipeline: loadSnapshot → decideAutoBalanceAllocation (pure) → apply
 * (composite RPCs + batched INSERT).
 */
export async function processAutoBalance(
  input: ProcessAutoBalanceInput,
): Promise<ProcessAutoBalanceOutput> {
  const snapshot = await loadAutoBalanceSnapshot(input)
  const result = decideAutoBalanceAllocation(snapshot)

  if (result.kind !== 'decision') {
    // Early-return paths: no_deficit / no_resources / no_transfers
    return { message: result.message, transfers: [] }
  }

  return applyAutoBalanceDecision(input, result.decision)
}

// ---------------------------------------------------------------------------
// Snapshot loading (I/O)
// ---------------------------------------------------------------------------

/**
 * Load the snapshot used as input to `decideAutoBalanceAllocation`. Exported
 * as testing surface (lib/recap/__tests__/auto-balance-persist.test.ts) —
 * production code goes through `processAutoBalance()` and never calls this
 * directly.
 *
 * Throws:
 *   - `RecapNoBudgetsError` if `estimated_budgets` returns an empty array
 *     for the owner (mirror route 404 path)
 *   - generic `Error` on Supabase query failures (mirror route 500 path)
 */
export async function loadAutoBalanceSnapshot(
  input: ProcessAutoBalanceInput,
): Promise<ProcessAutoBalanceSnapshot> {
  // 1. Load budgets — empty array = 404
  const { data: budgets, error: budgetsError } = await supabaseServer
    .from('estimated_budgets')
    .select('id, name, estimated_amount, cumulated_savings')
    .eq(input.ownerField, input.contextId)
  if (budgetsError) {
    throw new Error(`Erreur lors de la récupération des budgets: ${budgetsError.message}`)
  }
  if (!budgets || budgets.length === 0) {
    throw new RecapNoBudgetsError('Aucun budget trouvé')
  }

  // 2. Load expenses (non-null estimated_budget_id)
  const { data: expenses, error: expensesError } = await supabaseServer
    .from('real_expenses')
    .select('estimated_budget_id, amount')
    .eq(input.ownerField, input.contextId)
    .not('estimated_budget_id', 'is', null)
  if (expensesError) {
    throw new Error(`Erreur lors de la récupération des dépenses: ${expensesError.message}`)
  }

  // 3. Load existing budget_transfers (to compute adjusted spent)
  const { data: existingTransfers, error: transfersError } = await supabaseServer
    .from('budget_transfers')
    .select('from_budget_id, to_budget_id, transfer_amount')
    .eq(input.ownerField, input.contextId)
  if (transfersError) {
    throw new Error(`Erreur lors de la récupération des transferts: ${transfersError.message}`)
  }

  // 4. Load piggy_bank — fail-soft (mirror route L182-184)
  const { data: piggyBankData, error: piggyBankError } = await supabaseServer
    .from('piggy_bank')
    .select('amount')
    .eq(input.ownerField, input.contextId)
    .maybeSingle()

  let piggyBank = 0
  if (piggyBankData && !piggyBankError) {
    piggyBank = piggyBankData.amount || 0
  } else if (piggyBankError) {
    logger.warn('[Auto Balance] Erreur récupération tirelire (fail-soft)', piggyBankError)
  }

  // 5. Compute BudgetAnalysis array (mirror route L143-170)
  const budgetAnalyses: BudgetAnalysis[] = budgets.map((budget) => {
    const spentAmount = (expenses ?? [])
      .filter((e) => e.estimated_budget_id === budget.id)
      .reduce((sum, e) => sum + e.amount, 0)

    const transfersFrom = (existingTransfers ?? [])
      .filter((t) => t.from_budget_id === budget.id)
      .reduce((sum, t) => sum + t.transfer_amount, 0)

    const transfersTo = (existingTransfers ?? [])
      .filter((t) => t.to_budget_id === budget.id)
      .reduce((sum, t) => sum + t.transfer_amount, 0)

    const adjustedSpentAmount = spentAmount + transfersFrom - transfersTo
    const difference = budget.estimated_amount - adjustedSpentAmount

    return {
      id: budget.id,
      name: budget.name,
      estimated_amount: budget.estimated_amount,
      spent_amount: adjustedSpentAmount,
      cumulated_savings: budget.cumulated_savings || 0,
      monthly_surplus: Math.max(0, difference),
      monthly_deficit: Math.max(0, -difference),
    }
  })

  return {
    context: input.context,
    contextId: input.contextId,
    ownerField: input.ownerField,
    piggyBank,
    budgetAnalyses,
  }
}

// ---------------------------------------------------------------------------
// Decision application (I/O)
// ---------------------------------------------------------------------------

/**
 * Apply the pure algorithm's decision to the database. Exported as testing
 * surface (lib/recap/__tests__/auto-balance-persist.test.ts) — production
 * code goes through `processAutoBalance()` and never calls this directly.
 *
 * Returns the full success output ready for NextResponse.json. The route
 * just spreads this into the response.
 */
export async function applyAutoBalanceDecision(
  input: ProcessAutoBalanceInput,
  decision: ProcessAutoBalanceDecision,
): Promise<ProcessAutoBalanceOutput> {
  const filter = asContextFilter(
    input.ownerField === 'profile_id'
      ? { profile_id: input.contextId }
      : { group_id: input.contextId },
  )

  // -------------------------------------------------------------------------
  // 1. Savings transfers — composite RPC atomic per-pair, fail-soft
  // -------------------------------------------------------------------------
  const savingsTransfers = decision.transfers.filter(
    (t): t is AutoBalanceTransfer & { from_budget_id: string } =>
      t.source === 'savings' && t.from_budget_id !== null,
  )
  for (const transfer of savingsTransfers) {
    try {
      await transferWithSavingsDebit(filter, {
        fromBudgetId: transfer.from_budget_id,
        toBudgetId: transfer.to_budget_id,
        amount: transfer.amount,
        reason: 'Auto-balance via monthly recap (économies cumulées)',
      })
    } catch (error) {
      logger.warn('[Auto Balance] transferWithSavingsDebit failed (fail-soft)', {
        fromBudgetId: transfer.from_budget_id,
        toBudgetId: transfer.to_budget_id,
        amount: transfer.amount,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // -------------------------------------------------------------------------
  // 2. Piggy transfers — composite RPC atomic per-pair, fail-soft
  // -------------------------------------------------------------------------
  const piggyTransfers = decision.transfers.filter((t) => t.from_budget_id === null)
  for (const transfer of piggyTransfers) {
    try {
      await transferPiggyToBudgetWithInsert(filter, {
        toBudgetId: transfer.to_budget_id,
        amount: transfer.amount,
        reason: `Tirelire → ${transfer.to_budget_name} (auto-balance récap)`,
      })
    } catch (error) {
      logger.warn('[Auto Balance] transferPiggyToBudgetWithInsert failed (fail-soft)', {
        toBudgetId: transfer.to_budget_id,
        amount: transfer.amount,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // -------------------------------------------------------------------------
  // 3. Surplus transfers — batched INSERT (no debit, surplus is computed).
  //    Hard error if INSERT fails (mirror route L483-498) — surplus is the
  //    last phase, so a hard 500 here is the cleanest signal that something
  //    is wrong upstream. Per-pair fail-soft would require breaking the
  //    batch into individual INSERTs.
  // -------------------------------------------------------------------------
  const surplusTransfers = decision.transfers.filter(
    (t): t is AutoBalanceTransfer & { from_budget_id: string } =>
      t.source === 'surplus' && t.from_budget_id !== null,
  )

  if (surplusTransfers.length > 0) {
    const transferInserts: BudgetTransferInsert[] = surplusTransfers.map((transfer) =>
      buildTransferPayload(input, {
        from_budget_id: transfer.from_budget_id,
        to_budget_id: transfer.to_budget_id,
        transfer_amount: transfer.amount,
        transfer_reason: 'Auto-balance via monthly recap (surplus mensuel)',
        transfer_date: new Date().toISOString().split('T')[0]!,
      }),
    )

    const { error: insertError } = await supabaseServer
      .from('budget_transfers')
      .insert(transferInserts)

    if (insertError) {
      logger.error('[Auto Balance] Erreur enregistrement transferts surplus', {
        transfersAttempted: transferInserts.length,
        transfers: transferInserts,
        error: insertError,
      })
      throw new Error(
        `Erreur lors de l'enregistrement des transferts surplus: ${insertError.message}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // 4. Build success output (mirror route L500-527 verbatim)
  // -------------------------------------------------------------------------
  const totalTransferred =
    decision.totalPiggyBankUsed + decision.totalSavingsUsed + decision.totalSurplusUsed

  const remainingDeficit = Math.max(0, decision.totalDeficit - totalTransferred)
  const remainingSavings = Math.max(0, decision.totalSavings - decision.totalSavingsUsed)
  const remainingSurplus = Math.max(0, decision.totalSurplus - decision.totalSurplusUsed)
  const remainingPiggyBank = Math.max(0, decision.totalPiggyBank - decision.totalPiggyBankUsed)

  const messageParts: string[] = []
  if (decision.totalPiggyBankUsed > 0) messageParts.push(`${decision.totalPiggyBankUsed}€ tirelire`)
  if (decision.totalSavingsUsed > 0) messageParts.push(`${decision.totalSavingsUsed}€ économies`)
  if (decision.totalSurplusUsed > 0) messageParts.push(`${decision.totalSurplusUsed}€ surplus`)

  logger.info('[Auto Balance] Répartition terminée', {
    total_transferred: totalTransferred,
    piggy_bank_used: decision.totalPiggyBankUsed,
    savings_used: decision.totalSavingsUsed,
    surplus_used: decision.totalSurplusUsed,
    transfers_count: decision.transfers.length,
    remaining_deficit: remainingDeficit,
  })

  return {
    success: true,
    message: `Répartition automatique effectuée: ${totalTransferred}€ répartis équitablement (${messageParts.join(' + ')})`,
    transfers: decision.transfers,
    total_transferred: totalTransferred,
    piggy_bank_used: decision.totalPiggyBankUsed,
    savings_used: decision.totalSavingsUsed,
    surplus_used: decision.totalSurplusUsed,
    transfers_count: decision.transfers.length,
    remaining_piggy_bank: remainingPiggyBank,
    remaining_savings: remainingSavings,
    remaining_surplus: remainingSurplus,
    remaining_deficit: remainingDeficit,
  }
}
