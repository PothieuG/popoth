/**
 * Pure algorithm for monthly recap step 1: the "rééquilibrage" decision.
 *
 * Sprint Refactor-I5 (2026-05-11): extracted verbatim from
 * app/api/monthly-recap/process-step1/route.ts (was 740 LOC mixed
 * algorithm/I/O/logging). This module is the algorithmic core.
 *
 * INVARIANTS (NEVER violate, the unit tests in __tests__/step1-algorithm.test.ts
 * will catch you):
 *  - 0 imports from Supabase, NextResponse, or any I/O module
 *  - 0 `console.*` calls; the per-file ESLint override enforces `no-console: 'error'`
 *  - 0 globals, no Date.now() (callers may inject timestamps), no Math.random
 *  - The algorithm NEVER mutates `snapshot` — it returns the new state
 *    in `ProcessStep1Decision`
 *
 * ALGORITHM (mirror of CAS 1 / CAS 2 in the original route):
 *  CAS 1 — difference ≥ 0 (excédent ou équilibre):
 *    1.1. Transférer l'excédent → tirelire (`difference` if > 0, else skip)
 *
 *  CAS 2 — difference < 0 (déficit):
 *    2.1. Tirelire préservée pour étape 2 (no-op)
 *    2.2. Utiliser les économies cumulées proportionnellement
 *    2.3. Consommer le surplus proportionnellement
 *    2.3.1. Renflouer les budgets déficitaires depuis les ressources utilisées
 *    2.4. (post-refetch in the persist layer) si excédent résiduel → tirelire
 *    2.4.2. Si budgets en déficit restants + économies restantes → renflouer
 *
 * ORDRE D'UTILISATION DES RESSOURCES (cf. route header comment):
 *   Tirelire (préservée jusqu'à l'étape 2) → Économies → Surplus
 *
 * TOLÉRANCE D'ARRONDI (ROUNDING_TOLERANCE = 0.01€) — asymétrie volontaire :
 *   - `gap > ROUNDING_TOLERANCE` (strict) : décide de SAUTER une étape
 *     (ÉTAPE 2.3 skipped if gap is already small enough). Mirror route L406.
 *   - `gap <= ROUNDING_TOLERANCE` (≤) : décide que l'équilibre EST atteint
 *     (`is_fully_balanced = true`). Mirror route L566/L762.
 *   Renverser cette asymétrie crée des "presque-équilibres" qui fonts du flip-
 *   flop entre is_fully_balanced=false et l'auto-balance.
 */

import { ROUNDING_TOLERANCE } from '@/lib/constants/finance'

import type {
  AllocationOperation,
  BudgetAnalysis,
  ProcessStep1Decision,
  ProcessStep1Snapshot,
} from './types'

/**
 * Décide ce qu'il faut faire face au snapshot fourni. Fonction PURE :
 * aucun I/O, aucun mutation de `snapshot`, déterministe (les budgets sont
 * triés par id ASC avant tout calcul proportionnel — sans cela, l'ordre
 * Supabase non-garanti rendrait les tests flaky).
 */
export function decideStep1Allocation(snapshot: ProcessStep1Snapshot): ProcessStep1Decision {
  // Tri déterministe pour reproductibilité (Supabase select sans .order() ne
  // garantit pas l'ordre, ce qui rendrait les tests flaky).
  const sortedBudgets = [...snapshot.budgetAnalyses].sort((a, b) => a.id.localeCompare(b.id))

  if (snapshot.difference >= 0) {
    return decideCase1(snapshot, sortedBudgets)
  }
  return decideCase2(snapshot, sortedBudgets)
}

// ---------------------------------------------------------------------------
// CAS 1 — excédent ou équilibre
// ---------------------------------------------------------------------------
function decideCase1(
  snapshot: ProcessStep1Snapshot,
  budgets: BudgetAnalysis[],
): ProcessStep1Decision {
  const excedent = snapshot.difference // ≥ 0 par construction (caller check)
  const operations: AllocationOperation[] = []

  let newPiggyBank = snapshot.piggyBank
  if (excedent > 0) {
    newPiggyBank = snapshot.piggyBank + excedent
    operations.push({
      step: '1.1',
      type: 'excedent_to_piggy_bank',
      details: {
        excedent_amount: excedent,
        old_piggy_bank: snapshot.piggyBank,
        new_piggy_bank: newPiggyBank,
      },
    })
  }

  // CAS 1 : on ne renfloue PAS les budgets déficitaires (les déficits sont
  // déjà inclus dans le RAV). On les liste tout de même dans la réponse
  // pour que le frontend puisse les afficher (l'utilisateur décidera à
  // l'écran 2).
  const budgetsWithDeficitRefloated = budgets
    .filter((b) => b.deficit > 0)
    .map((b) => ({ id: b.id, name: b.name, deficit: b.deficit }))

  return {
    case: 'excedent',
    operations,
    newPiggyBank,
    newBudgetSavings: {},
    budgetsWithDeficitRefloated,
    secondPassRefloatOps: [],
  }
}

// ---------------------------------------------------------------------------
// CAS 2 — déficit
// ---------------------------------------------------------------------------
function decideCase2(
  snapshot: ProcessStep1Snapshot,
  budgets: BudgetAnalysis[],
): ProcessStep1Decision {
  // Working copies — l'algorithme mute son COPY local mais jamais le snapshot
  // input. Permet d'enchaîner les sous-étapes en réutilisant le state évolutif.
  const workingBudgets: BudgetAnalysis[] = budgets.map((b) => ({ ...b }))
  const budgetsWithSurplus = workingBudgets.filter((b) => b.surplus > 0)
  const budgetsWithDeficit = workingBudgets.filter((b) => b.deficit > 0)
  const budgetsWithSavings = workingBudgets.filter((b) => b.cumulated_savings > 0)

  const operations: AllocationOperation[] = []
  const newBudgetSavings: Record<string, number> = {}
  let gap = Math.abs(snapshot.difference)
  const gapInitial = gap

  // ÉTAPE 2.1 — tirelire préservée pour l'étape 2 (no-op ici)

  // ÉTAPE 2.2 — utiliser les économies proportionnellement
  if (gap > 0) {
    const totalSavings = budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)
    if (totalSavings > 0) {
      const amountToUseFromSavings = Math.min(gap, totalSavings)
      for (const budget of budgetsWithSavings) {
        if (budget.cumulated_savings > 0 && gap > 0) {
          const proportion = budget.cumulated_savings / totalSavings
          const amountToUse = Math.min(
            proportion * amountToUseFromSavings,
            budget.cumulated_savings,
          )
          const newSavings = budget.cumulated_savings - amountToUse
          operations.push({
            step: '2.2',
            type: 'use_savings',
            details: {
              budget_id: budget.id,
              budget_name: budget.name,
              amount_used: amountToUse,
              proportion,
              old_savings: budget.cumulated_savings,
              new_savings: newSavings,
            },
          })
          newBudgetSavings[budget.id] = newSavings
          budget.cumulated_savings = newSavings
          gap -= amountToUse
        }
      }
    }
  }

  // ÉTAPE 2.3 — consommer le surplus proportionnellement.
  // Note: tolérance haute (`> ROUNDING_TOLERANCE`) pour éviter d'émettre des
  // micro-ops < 1 centime qui pollueraient operations_performed.
  if (gap > ROUNDING_TOLERANCE) {
    const totalSurplus = budgetsWithSurplus.reduce((s, b) => s + b.surplus, 0)
    if (totalSurplus > 0) {
      const surplusToConsume = Math.min(gap, totalSurplus)
      for (const surplusBudget of budgetsWithSurplus) {
        if (surplusBudget.surplus > 0 && gap > 0) {
          const proportion = surplusBudget.surplus / totalSurplus
          const amountToConsume = Math.min(
            proportion * surplusToConsume,
            surplusBudget.surplus,
            gap,
          )
          operations.push({
            step: '2.3',
            type: 'consume_surplus',
            details: {
              budget_id: surplusBudget.id,
              budget_name: surplusBudget.name,
              amount: amountToConsume,
              proportion,
            },
          })
          surplusBudget.surplus -= amountToConsume
          gap -= amountToConsume
        }
      }
    }
  }

  // ÉTAPE 2.3.1 — renflouer les budgets déficitaires depuis les ressources
  // utilisées. Le `ressourcesUtilisees` est ce qu'on a réellement pu couvrir
  // (gapInitial - gap résiduel). Si totalDeficit > ressourcesUtilisees, on
  // ne refloue que partiellement → des deficits subsistent en mémoire et
  // ÉTAPE 2.4.2 prend le relais avec les économies restantes.
  const ressourcesUtilisees = gapInitial - gap
  const totalDeficit = budgetsWithDeficit.reduce((s, b) => s + b.deficit, 0)

  if (totalDeficit > 0 && ressourcesUtilisees > ROUNDING_TOLERANCE) {
    const montantARenflouer = Math.min(ressourcesUtilisees, totalDeficit)
    for (const deficitBudget of budgetsWithDeficit) {
      if (deficitBudget.deficit > 0) {
        const proportion = deficitBudget.deficit / totalDeficit
        const transferAmount = Math.min(proportion * montantARenflouer, deficitBudget.deficit)
        if (transferAmount > ROUNDING_TOLERANCE) {
          const deficitRestant = deficitBudget.deficit - transferAmount
          operations.push({
            step: '2.3.1',
            type: 'transfer_to_deficit',
            details: {
              budget_id: deficitBudget.id,
              budget_name: deficitBudget.name,
              transfer_amount: transferAmount,
              deficit_remaining: deficitRestant,
            },
          })
          deficitBudget.deficit -= transferAmount
        }
      }
    }
  }

  // ÉTAPE 2.4.2 — 2nd-pass refloat depuis économies restantes vers déficits
  // restants. La condition d'entrée mirror la route L618-621 : `gap` doit être
  // ≤ tolérance ET il faut au moins 1 deficit budget ET au moins 1 budget avec
  // économies > 0. La 2.4.1 (excédent résiduel → tirelire) est gérée par la
  // couche persist car elle dépend du RAV refetchée.
  const secondPassRefloatOps: ProcessStep1Decision['secondPassRefloatOps'] = []
  const isFullyBalanced = gap <= ROUNDING_TOLERANCE

  if (
    isFullyBalanced &&
    budgetsWithDeficit.length > 0 &&
    budgetsWithSavings.some((b) => b.cumulated_savings > 0)
  ) {
    for (const budget of budgetsWithDeficit) {
      let remainingDeficit = budget.deficit
      if (remainingDeficit > 0) {
        // On RECALCULE totalSavings à chaque budget car les itérations
        // précédentes ont pu consommer des économies (mirror route L638-641).
        const totalSavingsLeft = budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)
        if (totalSavingsLeft > 0) {
          for (const savingsBudget of budgetsWithSavings) {
            if (savingsBudget.cumulated_savings > 0 && remainingDeficit > 0) {
              const proportion = savingsBudget.cumulated_savings / totalSavingsLeft
              const amountFromSavings = Math.min(
                proportion * remainingDeficit,
                savingsBudget.cumulated_savings,
              )
              const newSavings = savingsBudget.cumulated_savings - amountFromSavings
              secondPassRefloatOps.push({
                fromBudgetId: savingsBudget.id,
                fromBudgetName: savingsBudget.name,
                toBudgetId: budget.id,
                toBudgetName: budget.name,
                amount: amountFromSavings,
                oldSavings: savingsBudget.cumulated_savings,
                newSavings,
              })
              newBudgetSavings[savingsBudget.id] = newSavings
              savingsBudget.cumulated_savings = newSavings
              remainingDeficit -= amountFromSavings
            }
          }
        }
      }
    }
  }

  return {
    case: 'deficit',
    operations,
    // Le piggy_bank n'est pas changé par l'algorithme en CAS 2 — la 2.4.1
    // (excédent résiduel → tirelire) est décidée par la persist layer après
    // le refetch financial-data.
    newPiggyBank: snapshot.piggyBank,
    newBudgetSavings,
    budgetsWithDeficitRefloated: [],
    gapResiduel: gap,
    isFullyBalanced,
    secondPassRefloatOps,
  }
}
