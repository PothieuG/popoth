import { supabaseServer } from '@/lib/supabase-server'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import { asContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'

export interface AllocationBreakdown {
  fromPiggyBank: number
  fromBudgetSavings: number
  fromBudget: number
  /**
   * Amount remaining after all local cascades (budget + local savings).
   * `overflow > 0` signals that Phase 2 cross-budget cascade is needed
   * (handled separately by the route handler / UI step). The consumer
   * MUST handle non-zero overflow explicitly — leaving it unhandled
   * means the breakdown doesn't sum to `amount` and downstream RPCs
   * will reject the insert.
   */
  overflow: number
}

export interface ApplyAllocationResult extends AllocationBreakdown {
  piggyBankBefore: number
  piggyBankAfter: number
  savingsBefore: number
  savingsAfter: number
  budgetSpentBefore: number
  budgetSpentAfter: number
}

type ContextFilter = Record<string, string>

interface ExpenseWithBreakdown {
  amount_from_piggy_bank?: number | null
  amount_from_budget_savings?: number | null
  amount_from_budget?: number | null
  estimated_budget_id?: string | null
}

export interface CalculateBreakdownOptions {
  /**
   * P5 opt-in toggle "Utiliser les économies de ce budget" — when true,
   * the user actively chose to draw from the budget's local savings even
   * if the budget still has room. Savings consumed BEFORE the budget.
   *
   * When false (default): P4 strict — budget consumed first, savings
   * cascade only on overflow (budget remaining < amount).
   */
  useSavingsToggle?: boolean
}

/**
 * Calcule la répartition d'un montant sur les sources disponibles selon le mode P4 strict.
 *
 * **P4 strict default (toggle off)** :
 * - Priorité 1: budget (jusqu'à budgetRemaining)
 * - Priorité 2 (cascade overflow): économies du budget (jusqu'à savingsAvailable)
 * - Tirelire : JAMAIS auto-débitée (`fromPiggyBank` toujours 0)
 *
 * **P5 opt-in (toggle on)** :
 * - Priorité 1: économies du budget (jusqu'à savingsAvailable)
 * - Priorité 2: budget (jusqu'à budgetRemaining)
 *
 * Si après les 2 priorités il reste un montant non alloué, `overflow > 0`
 * signale qu'une cascade cross-budget (Phase 2) est nécessaire — la
 * couche supérieure (route handler / UI step) doit proposer le user-choice
 * et soumettre via la composite RPC `add_expense_with_cross_budget_cascade`.
 *
 * **Note historique** : avant Sprint P4-P5-P6, la signature était
 * `calculateBreakdown(amount, piggyBankAvailable, savingsAvailable)` et la
 * priorité 1 était la tirelire (cascade aggressive). Le comportement actuel
 * matche la spec next-steps.md P4 : "si un budget dépasse son enveloppe …".
 */
export function calculateBreakdown(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdown {
  const { useSavingsToggle = false } = options
  let remaining = amount
  let fromBudget = 0
  let fromBudgetSavings = 0
  const fromPiggyBank = 0 // P4 strict: tirelire jamais auto-débitée

  if (useSavingsToggle) {
    // P5 opt-in: savings d'abord, budget ensuite
    if (savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
    if (remaining > 0 && budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
  } else {
    // P4 strict default: budget d'abord, savings cascade overflow
    if (budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
    if (remaining > 0 && savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
  }

  return { fromPiggyBank, fromBudgetSavings, fromBudget, overflow: remaining }
}

/**
 * Reverse une allocation précédente: restaure la tirelire et les économies du budget
 */
export async function reverseAllocation(
  oldExpense: ExpenseWithBreakdown,
  contextFilter: ContextFilter,
): Promise<void> {
  const piggyToRestore = oldExpense.amount_from_piggy_bank || 0
  const savingsToRestore = oldExpense.amount_from_budget_savings || 0

  // Restaurer la tirelire (atomique via RPC update_piggy_bank_amount)
  if (piggyToRestore > 0) {
    try {
      await updatePiggyBank(asContextFilter(contextFilter), piggyToRestore)
    } catch (error) {
      logger.error('Erreur restauration tirelire:', error)
      throw new Error('Erreur lors de la restauration de la tirelire')
    }
  }

  // Restaurer les économies du budget (atomique via RPC update_budget_cumulated_savings)
  if (savingsToRestore > 0 && oldExpense.estimated_budget_id) {
    try {
      await updateBudgetCumulatedSavings(oldExpense.estimated_budget_id, savingsToRestore)
    } catch (error) {
      logger.error('Erreur restauration economies:', error)
      throw new Error('Erreur lors de la restauration des économies')
    }
  }
}

/**
 * Applique une nouvelle allocation: lit les soldes actuels, calcule le breakdown,
 * met à jour les économies du budget si nécessaire et retourne le résultat.
 *
 * Edit-flow consumer ([lib/api/finance/expenses-real.ts] PUT) : appelle d'abord
 * `reverseAllocation` puis `applyAllocation` avec le nouveau montant. Le mode
 * P5 toggle n'est pas exposé via le edit flow (preserves the original intent).
 *
 * **Note Sprint P4-P5-P6** : depuis le refactor calculateBreakdown, fromPiggyBank
 * est toujours 0 ici. Le code conditionnel updatePiggyBank ci-dessous est
 * dead branch en pratique mais préservé pour défense en profondeur si un futur
 * caller passe explicitement un breakdown avec piggy via Phase 2 (non-implementé).
 */
export async function applyAllocation(
  amount: number,
  budgetId: string,
  contextFilter: ContextFilter,
): Promise<ApplyAllocationResult> {
  // Lire la tirelire actuelle (pour les champs de retour, pas pour cascade)
  const { data: piggyData } = await supabaseServer
    .from('piggy_bank')
    .select('amount')
    .match(contextFilter)
    .maybeSingle()

  const piggyBankBefore = piggyData?.amount || 0

  // Lire les économies du budget
  const { data: budgetData } = await supabaseServer
    .from('estimated_budgets')
    .select('cumulated_savings, estimated_amount')
    .eq('id', budgetId)
    .single()

  if (!budgetData) {
    throw new Error('Budget introuvable')
  }

  const savingsBefore = budgetData.cumulated_savings || 0
  const budgetEstimated = budgetData.estimated_amount || 0

  // Lire le budget déjà dépensé (somme des amount_from_budget des dépenses existantes)
  const { data: expenses } = await supabaseServer
    .from('real_expenses')
    .select('amount_from_budget')
    .eq('estimated_budget_id', budgetId)
    .match(contextFilter)

  const budgetSpentBefore =
    expenses?.reduce((sum, e) => {
      return sum + (e.amount_from_budget || 0)
    }, 0) || 0

  const budgetRemaining = budgetEstimated - budgetSpentBefore

  // Calculer le breakdown (P4 strict default — edit flow n'utilise pas le toggle P5)
  const breakdown = calculateBreakdown(amount, budgetRemaining, savingsBefore)

  // Si overflow > 0, le edit flow accepte le débordement (le user a explicitement
  // augmenté le montant). Le `fromBudget` reçoit le résidu — produit un déficit
  // budget visible (impact RAV). Le user peut annuler edit s'il refuse.
  const fromBudgetWithOverflow = breakdown.fromBudget + breakdown.overflow

  const piggyBankAfter = piggyBankBefore - breakdown.fromPiggyBank
  const savingsAfter = savingsBefore - breakdown.fromBudgetSavings
  const budgetSpentAfter = budgetSpentBefore + fromBudgetWithOverflow

  // Tirelire jamais débitée en P4 strict (dead branch préservée pour Phase 2)
  if (breakdown.fromPiggyBank > 0 && piggyData) {
    try {
      await updatePiggyBank(asContextFilter(contextFilter), -breakdown.fromPiggyBank)
    } catch (error) {
      logger.error('Erreur mise a jour tirelire:', error)
      throw new Error('Erreur lors de la mise à jour de la tirelire')
    }
  }

  // Mettre à jour les économies du budget (atomique via RPC update_budget_cumulated_savings)
  if (breakdown.fromBudgetSavings > 0) {
    try {
      await updateBudgetCumulatedSavings(budgetId, -breakdown.fromBudgetSavings)
    } catch (error) {
      logger.error('Erreur mise a jour economies:', error)
      throw new Error('Erreur lors de la mise à jour des économies')
    }
  }

  return {
    fromPiggyBank: breakdown.fromPiggyBank,
    fromBudgetSavings: breakdown.fromBudgetSavings,
    fromBudget: fromBudgetWithOverflow,
    overflow: 0, // resorbed dans fromBudget pour le edit flow
    piggyBankBefore,
    piggyBankAfter,
    savingsBefore,
    savingsAfter,
    budgetSpentBefore,
    budgetSpentAfter,
  }
}
