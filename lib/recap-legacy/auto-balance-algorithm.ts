/**
 * Pure decision logic for monthly recap auto-balance.
 *
 * Sprint Refactor-Auto-Balance (2026-05-16): extracted from
 * app/api/monthly-recap/auto-balance/route.ts (god file ~533 LOC). This
 * module contains ZERO I/O: no Supabase reads/writes, no console/logger,
 * no Date.now() — the persist layer is responsible for fetching the
 * snapshot and applying decisions to the database.
 *
 * Determinism: budgetAnalyses are sorted by `id` ASC before processing so
 * the algorithm's output (transfer list + per-source totals) is fully
 * deterministic given the same snapshot, regardless of the order in which
 * Supabase returned rows. Pure-unit tests rely on this property.
 *
 * Algorithm overview (3 phases, mirror the route's JSDoc verbatim):
 *
 *   PHASE 0 — Use the piggy bank in priority absolute:
 *     amountToDistribute = min(piggy_bank, totalDeficit)
 *     For each deficit budget: contribution = amount × (deficit / totalDeficit)
 *     Result: piggy emptied or partially used, remaining deficit reduced.
 *
 *   PHASE 1 — Use cumulated savings if deficit remaining:
 *     remaining_deficits per budget = monthly_deficit - coveredFromPiggyBank
 *     For each deficit budget proportional to its remaining deficit, each
 *     savings budget contributes proportional to its cumulated_savings.
 *     A budget never transfers to itself.
 *     Result: savings emptied or partially used.
 *
 *   PHASE 2 — Use monthly surplus if deficit still remaining:
 *     remaining_deficits per budget = monthly_deficit - coveredFromPiggyBank - coveredFromSavings
 *     Same proportional-distribution as PHASE 1, using monthly_surplus.
 *     Surplus is computed (real_expenses + transfers vs estimated), NOT stored
 *     as a column — so the persist layer just inserts audit-trail rows, no debit.
 *
 * The algorithm preserves a known LATENT BUG from the pre-extraction route
 * (L314): `remainingDeficitToCover = Math.max(0, totalDeficit - totalSavingsUsed)`
 * overstates the value by `totalPiggyBankUsed`. PHASE 2 recomputes per-budget
 * remaining deficits correctly so the bug is benign (gating-only). Preserved
 * verbatim to keep caract tests byte-identical — fix deferred (cosmetic).
 */

import type {
  AllocationOperation,
  AutoBalanceTransfer,
  ProcessAutoBalanceDecision,
  ProcessAutoBalanceSnapshot,
} from './auto-balance-types'

/**
 * Discriminated result of the pure algorithm. The persist layer dispatches:
 *   - `kind: 'decision'` → apply transfers via composite RPCs + batched INSERT
 *   - `kind: 'no_deficit'` → 200 { message, transfers: [] }  (no deficit budget)
 *   - `kind: 'no_resources'` → 200 { message, transfers: [] } (piggy=0 + 0 savings + 0 surplus)
 *   - `kind: 'no_transfers'` → 200 { message, transfers: [] } (algorithm produced 0 transfers,
 *     e.g. when all savings/surplus are self-referential to the same deficit budget)
 */
export type AutoBalanceAlgorithmResult =
  | { kind: 'decision'; decision: ProcessAutoBalanceDecision }
  | { kind: 'no_deficit'; message: string }
  | { kind: 'no_resources'; message: string }
  | { kind: 'no_transfers'; message: string }

/**
 * Decide what transfers to make given the snapshot. Pure function — no I/O,
 * no mutation of inputs. Returns either a Decision (with transfers list) or
 * a short-circuit reason for one of the 3 early-return paths.
 */
export function decideAutoBalanceAllocation(
  snapshot: ProcessAutoBalanceSnapshot,
): AutoBalanceAlgorithmResult {
  // Sort by id ASC for deterministic iteration. Filters preserve order.
  const budgetAnalyses = [...snapshot.budgetAnalyses].sort((a, b) => a.id.localeCompare(b.id))

  const budgetsWithSavings = budgetAnalyses.filter((b) => b.cumulated_savings > 0)
  const budgetsWithSurplus = budgetAnalyses.filter((b) => b.monthly_surplus > 0)
  const budgetsWithDeficit = budgetAnalyses.filter((b) => b.monthly_deficit > 0)

  if (budgetsWithDeficit.length === 0) {
    return { kind: 'no_deficit', message: 'Aucun budget déficitaire à compenser' }
  }

  const piggyBank = snapshot.piggyBank

  if (piggyBank === 0 && budgetsWithSavings.length === 0 && budgetsWithSurplus.length === 0) {
    return {
      kind: 'no_resources',
      message: 'Aucune tirelire, économie ou surplus disponible pour la répartition',
    }
  }

  const totalSavings = budgetsWithSavings.reduce((sum, b) => sum + b.cumulated_savings, 0)
  const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + b.monthly_surplus, 0)
  const totalDeficit = budgetsWithDeficit.reduce((sum, b) => sum + b.monthly_deficit, 0)

  const transfers: AutoBalanceTransfer[] = []
  const operations: AllocationOperation[] = []

  let totalPiggyBankUsed = 0
  let totalSavingsUsed = 0
  let totalSurplusUsed = 0
  let remainingDeficitToCover = totalDeficit

  // -------------------------------------------------------------------------
  // PHASE 0 — Piggy bank distributed proportionally across all deficit budgets
  // -------------------------------------------------------------------------
  if (piggyBank > 0 && remainingDeficitToCover > 0) {
    const amountToDistribute = Math.min(piggyBank, totalDeficit)

    for (const deficitBudget of budgetsWithDeficit) {
      const deficitProportion = deficitBudget.monthly_deficit / totalDeficit
      const contributionAmount = Math.round(amountToDistribute * deficitProportion * 100) / 100

      if (contributionAmount > 0) {
        transfers.push({
          from_budget_id: null,
          from_budget_name: 'Tirelire 🐷',
          to_budget_id: deficitBudget.id,
          to_budget_name: deficitBudget.name,
          amount: contributionAmount,
          source: 'piggy_bank',
        })
        operations.push({
          step: '0.piggy_distribute',
          details: {
            to_budget_id: deficitBudget.id,
            to_budget_name: deficitBudget.name,
            amount: contributionAmount,
            deficit_proportion: deficitProportion,
          },
        })
        totalPiggyBankUsed += contributionAmount
      }
    }

    remainingDeficitToCover = Math.max(0, totalDeficit - totalPiggyBankUsed)
  }

  // -------------------------------------------------------------------------
  // PHASE 1 — Distribute savings proportionally to remaining deficit (per
  // budget). Each savings budget contributes proportionally to its share of
  // total savings. A budget never transfers to itself.
  // -------------------------------------------------------------------------
  if (totalSavings > 0 && remainingDeficitToCover > 0) {
    const remainingDeficitsPhase1 = budgetsWithDeficit
      .map((b) => {
        const coveredFromPiggyBank = transfers
          .filter((t) => t.to_budget_id === b.id && t.source === 'piggy_bank')
          .reduce((sum, t) => sum + t.amount, 0)
        return {
          ...b,
          remaining_deficit: Math.max(0, b.monthly_deficit - coveredFromPiggyBank),
        }
      })
      .filter((b) => b.remaining_deficit > 0)

    const totalRemainingDeficitPhase1 = remainingDeficitsPhase1.reduce(
      (sum, b) => sum + b.remaining_deficit,
      0,
    )

    for (const deficitBudget of remainingDeficitsPhase1) {
      const deficitProportion = deficitBudget.remaining_deficit / totalRemainingDeficitPhase1
      const amountNeededForThisDeficit = Math.min(
        deficitBudget.remaining_deficit,
        totalSavings * deficitProportion,
      )

      for (const savingsBudget of budgetsWithSavings) {
        // A budget cannot transfer to itself
        if (savingsBudget.id === deficitBudget.id) continue

        const savingsProportion = savingsBudget.cumulated_savings / totalSavings
        const contributionAmount =
          Math.round(amountNeededForThisDeficit * savingsProportion * 100) / 100

        if (contributionAmount > 0) {
          transfers.push({
            from_budget_id: savingsBudget.id,
            from_budget_name: savingsBudget.name,
            to_budget_id: deficitBudget.id,
            to_budget_name: deficitBudget.name,
            amount: contributionAmount,
            source: 'savings',
          })
          operations.push({
            step: '1.savings_transfer',
            details: {
              from_budget_id: savingsBudget.id,
              from_budget_name: savingsBudget.name,
              to_budget_id: deficitBudget.id,
              to_budget_name: deficitBudget.name,
              amount: contributionAmount,
            },
          })
          totalSavingsUsed += contributionAmount
        }
      }
    }

    // LATENT BUG preserved (route L314): should be `totalDeficit -
    // totalPiggyBankUsed - totalSavingsUsed`. This overstates by
    // totalPiggyBankUsed but PHASE 2 recomputes per-budget remainings, so
    // the bug is benign (gating-only). Preserved verbatim for byte-identical
    // caract tests.
    remainingDeficitToCover = Math.max(0, totalDeficit - totalSavingsUsed)
  }

  // -------------------------------------------------------------------------
  // PHASE 2 — Distribute surplus proportionally if deficit still remaining.
  // Surplus is computed (estimated - adjustedSpent), NOT stored — so the
  // persist layer just INSERTs audit-trail rows, no debit.
  // -------------------------------------------------------------------------
  if (totalSurplus > 0 && remainingDeficitToCover > 0) {
    const remainingDeficits = budgetsWithDeficit
      .map((b) => {
        const coveredFromPiggyBank = transfers
          .filter((t) => t.to_budget_id === b.id && t.source === 'piggy_bank')
          .reduce((sum, t) => sum + t.amount, 0)
        const coveredFromSavings = transfers
          .filter((t) => t.to_budget_id === b.id && t.source === 'savings')
          .reduce((sum, t) => sum + t.amount, 0)
        return {
          ...b,
          remaining_deficit: Math.max(
            0,
            b.monthly_deficit - coveredFromPiggyBank - coveredFromSavings,
          ),
        }
      })
      .filter((b) => b.remaining_deficit > 0)

    const totalRemainingDeficit = remainingDeficits.reduce((sum, b) => sum + b.remaining_deficit, 0)

    if (remainingDeficits.length > 0) {
      for (const deficitBudget of remainingDeficits) {
        const deficitProportion = deficitBudget.remaining_deficit / totalRemainingDeficit
        const amountNeededForThisDeficit = Math.min(
          deficitBudget.remaining_deficit,
          totalSurplus * deficitProportion,
        )

        for (const surplusBudget of budgetsWithSurplus) {
          // A budget cannot transfer to itself
          if (surplusBudget.id === deficitBudget.id) continue

          const surplusProportion = surplusBudget.monthly_surplus / totalSurplus
          const contributionAmount =
            Math.round(amountNeededForThisDeficit * surplusProportion * 100) / 100

          if (contributionAmount > 0) {
            transfers.push({
              from_budget_id: surplusBudget.id,
              from_budget_name: surplusBudget.name,
              to_budget_id: deficitBudget.id,
              to_budget_name: deficitBudget.name,
              amount: contributionAmount,
              source: 'surplus',
            })
            operations.push({
              step: '2.surplus_transfer',
              details: {
                from_budget_id: surplusBudget.id,
                from_budget_name: surplusBudget.name,
                to_budget_id: deficitBudget.id,
                to_budget_name: deficitBudget.name,
                amount: contributionAmount,
              },
            })
            totalSurplusUsed += contributionAmount
          }
        }
      }
    }
  }

  if (transfers.length === 0) {
    return { kind: 'no_transfers', message: 'Aucun transfert nécessaire ou possible' }
  }

  return {
    kind: 'decision',
    decision: {
      transfers,
      totalPiggyBankUsed,
      totalSavingsUsed,
      totalSurplusUsed,
      totalPiggyBank: piggyBank,
      totalSavings,
      totalSurplus,
      totalDeficit,
      operations,
    },
  }
}
