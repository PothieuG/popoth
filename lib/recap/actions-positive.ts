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

import type { Json } from '@/lib/database.types'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import type { ContextFilter } from '@/lib/finance/context'
import { ensurePiggyBankRow, updatePiggyBank } from '@/lib/finance/piggy-bank'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { MonthlyRecapRow } from './active-recap'
import type { RecapContext } from './check-status'
import { coerceSnapshot } from './deficit-math'
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
  /** Sprint Bilan-Equals-RavEffectif — montant du reste à vivre effectif positif
   *  balayé vers la tirelire au « Continuer » (0 si bilan ≤ 0 ou sweep échoué). */
  sweptToPiggy: number
}

export interface ExecuteTransferArgs {
  context: RecapContext
  filter: ContextFilter
  profileId: string
  groupId: string | null
  budgetIds: string[]
  /** Sprint Recap-Positive-Consume-Surplus (2026-05-25). The active recap row,
   *  forwarded by the route handler (`getActiveRecap` already fetched it for
   *  the gating checks). We read `piggy_transfers_data` from it so the
   *  pre-transfer surplus computation already discounts what's been moved
   *  before in earlier sessions, and we UPDATE it after the loop to persist
   *  the new transfers so the next /status call returns surplus = 0 for the
   *  budgets just handled. */
  recap: MonthlyRecapRow
}

export async function executeTransferSurplusesToPiggy(args: ExecuteTransferArgs): Promise<{
  outcome: TransferOutcome
  summary: RecapSummary
  piggyTransfersData: Record<string, number>
}> {
  const existingTracker = coerceSnapshot(args.recap.piggy_transfers_data) ?? {}

  const summaryBefore = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
    piggyTransfersData: existingTracker,
  })

  const selected = new Set(args.budgetIds)
  const targets = summaryBefore.budgets.filter((b) => selected.has(b.budgetId) && b.surplus > 0)

  const transferred: BudgetActionResult[] = []
  const failed: BudgetActionFailure[] = []

  // Ensure a piggy_bank row exists before crediting — the underlying RPC
  // RAISEs "row not found" when its UPDATE affects 0 rows (fresh user with
  // no piggy history). One idempotent INSERT (no-op on existing row via the
  // partial unique indexes) covers all per-budget transfers below.
  if (targets.length > 0) {
    try {
      await ensurePiggyBankRow(args.filter)
    } catch (error) {
      // The credit loop below will also fail — propagate the same reason for
      // every selected budget instead of silently masking the issue.
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[recap/positive] piggy row ensure failed', { reason })
      for (const budget of targets) {
        failed.push({ budgetId: budget.budgetId, reason })
      }
      const summaryAfterEnsure = await loadRecapSummary({
        context: args.context,
        profileId: args.profileId,
        groupId: args.groupId,
        piggyTransfersData: existingTracker,
      })
      return {
        outcome: { transferred, failed },
        summary: summaryAfterEnsure,
        piggyTransfersData: existingTracker,
      }
    }
  }

  for (const budget of targets) {
    try {
      // CREDIT the piggy with the monthly surplus. We deliberately do NOT
      // call `transferBudgetToPiggyBank` (which debits cumulated_savings on
      // top of the credit) — the monthly surplus is virtual (estimated -
      // spent for the current month), it has never been credited to
      // cumulated_savings. Trying to debit that would raise "cumulated_savings
      // would become negative" on every fresh recap (the same-test-seed
      // exception aside) and silently route everything into failed[].
      // The piggy_transfers_data tracker UPDATEd below makes loadRecapSummary
      // consume the surplus virtually — the next /status returns surplus=0
      // and the UI list / drawer / button gate naturally.
      await updatePiggyBank(args.filter, budget.surplus)
      transferred.push({ budgetId: budget.budgetId, amount: budget.surplus })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[recap/positive] piggy credit failed', {
        budgetId: budget.budgetId,
        amount: budget.surplus,
        reason,
      })
      failed.push({ budgetId: budget.budgetId, reason })
    }
  }

  // Merge successful transfers into the tracker and persist. We read-modify-write
  // in JS (vs. an atomic Postgres `||` merge) because the screen is mono-initiator
  // and concurrent transfers from the same user on two tabs are not a realistic
  // scenario for this surface. The merged tracker is also forwarded to the
  // second loadRecapSummary call so the returned summary matches the post-write
  // state without an extra round-trip.
  const mergedTracker: Record<string, number> = { ...existingTracker }
  for (const t of transferred) {
    mergedTracker[t.budgetId] = round2((mergedTracker[t.budgetId] ?? 0) + t.amount)
  }
  if (transferred.length > 0) {
    const { error } = await supabaseServer
      .from('monthly_recaps')
      .update({ piggy_transfers_data: mergedTracker as unknown as Json })
      .eq('id', args.recap.id)
    if (error) {
      logger.error('[recap/positive] piggy_transfers_data update failed', {
        recapId: args.recap.id,
        error,
      })
    }
  }

  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
    piggyTransfersData: mergedTracker,
  })

  return {
    outcome: { transferred, failed },
    summary,
    piggyTransfersData: mergedTracker,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
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
  const existingTracker = coerceSnapshot(args.recap.piggy_transfers_data) ?? {}
  const summary = await loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
    piggyTransfersData: existingTracker,
  })
  // `surplus > 0` is already enough — loadRecapSummary subtracted the tracker
  // amounts so budgets fully routed to the piggy bank have `surplus === 0` and
  // are filtered out naturally. Belt-and-braces would add `&& !existingTracker[b.budgetId]`
  // but that would block the legitimate case "partial transfer + remainder
  // still positive" (which our UI doesn't expose today but the logic stays
  // future-proof without it).
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
  // 100% failure on non-empty targets → keep current_step so the user can retry
  // (and we skip the rav sweep below, so a retry doesn't double-credit the piggy).
  const shouldAdvance = targets.length === 0 || transformed.length > 0
  let nextStep: 'salary_update' | null = null
  let sweptToPiggy = 0

  if (shouldAdvance) {
    // Sprint Bilan-Equals-RavEffectif — balayer le reste à vivre effectif positif
    // (= summary.bilan = ravEffectif) vers la tirelire, AVANT d'avancer l'étape.
    // C'est « l'argent en plus » non associé à un budget : disjoint des
    // sous-dépenses budget ci-dessus (qui vivent DANS l'enveloppe budget) et des
    // déficits (déjà soustraits de ravEffectif) → pas de double-comptage. La
    // tirelire n'entre pas dans la formule RAV → pas d'effet boomerang au
    // recalcul du mois suivant. On NE touche PAS `piggy_transfers_data` (réservé
    // au tracking virtuel des sous-dépenses) — ce crédit est indépendant.
    //
    // Idempotence (Option A, pas de colonne dédiée) : même profil de risque que
    // le transform ci-dessus. Le sweep est confiné à la branche `shouldAdvance`
    // et précède l'écriture d'avance ; la gate 409 ALLOWED_STEPS de la route
    // bloque toute ré-entrée une fois `salary_update` atteint. La seule fenêtre
    // de double-crédit (« sweep ok + écriture d'avance échoue ») est identique à
    // celle déjà acceptée pour cumulated_savings.
    if (summary.bilan > 0.01) {
      const filter: ContextFilter =
        args.context === 'profile'
          ? { profile_id: args.profileId }
          : { group_id: args.groupId as string }
      try {
        const amount = round2(summary.bilan)
        await ensurePiggyBankRow(filter)
        await updatePiggyBank(filter, amount)
        sweptToPiggy = amount
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error('[recap/positive] rav-to-piggy sweep failed', {
          recapId: args.recap.id,
          amount: summary.bilan,
          reason,
        })
        // Ne pas avancer : l'utilisateur réessaie « Continuer » (rien n'a été
        // crédité puisque le sweep a échoué).
        return { transformed, failed, nextStep: null, sweptToPiggy: 0 }
      }
    }

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

  return { transformed, failed, nextStep, sweptToPiggy }
}
