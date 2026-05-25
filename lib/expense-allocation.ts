import { supabaseServer } from '@/lib/supabase-server'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import { asContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'
import {
  calculateBreakdown,
  calculateBreakdownWithAutoCascade,
  type AllocationBreakdown,
  type CalculateBreakdownOptions,
  type CrossBudgetDebit,
} from './expense-breakdown'

// Re-export the pure algorithm + types so existing consumers (route handlers,
// tests) keep their `@/lib/expense-allocation` import path unchanged.
// Client-side hooks should prefer importing directly from `./expense-breakdown`
// to avoid pulling in `supabase-server` (and its service_role client).
export { calculateBreakdown, calculateBreakdownWithAutoCascade }
export type { AllocationBreakdown, CalculateBreakdownOptions, CrossBudgetDebit }

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
  amount?: number | null
  amount_from_piggy_bank?: number | null
  amount_from_budget_savings?: number | null
  amount_from_budget?: number | null
  estimated_budget_id?: string | null
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
 * `reverseAllocation` puis `applyAllocation` avec le nouveau montant. Quand
 * `existingExpense` est fourni (mode EDIT), on bascule sur l'algorithme
 * **« preserve existing caps »** introduit Sprint 2026-05-21 (cf. bug report
 * user) : les valeurs `amount_from_piggy_bank` et `amount_from_budget_savings`
 * stockées sur la dépense sont des CEILINGS pour la nouvelle allocation —
 * savings/piggy débitées d'abord jusqu'à leur cap existant, puis budget
 * absorbe le reste (incl. déficit éventuel). Cela évite que reverseAllocation
 * + applyAllocation-fresh redistribue arbitrairement la portion savings vers
 * le budget quand le user diminue le montant (cas A 123€ avec 25€ savings
 * réduite à 5€ : on veut 5€ savings + 0 budget, pas 0 savings + 5 budget).
 *
 * Sans `existingExpense` (mode ADD), l'algorithme P4-strict s'applique
 * (budget first, savings cascade overflow). Le mode P5 toggle n'est pas
 * exposé via le edit flow (preserves the original intent).
 *
 * **Note Sprint P4-P5-P6** : depuis le refactor calculateBreakdown, fromPiggyBank
 * est toujours 0 en ADD. En EDIT, fromPiggyBank peut être > 0 si l'existing
 * en avait (legacy data avant P4 strict, ou cross-budget cascade qui débitait
 * piggy avant Phase 2).
 */
export async function applyAllocation(
  amount: number,
  budgetId: string,
  contextFilter: ContextFilter,
  existingExpense?: ExpenseWithBreakdown | null,
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

  // Mode EDIT (existingExpense fourni) : algorithme « delta-based cascade ».
  // Mode ADD : P4 strict default — edit flow n'utilise pas le toggle P5.
  let breakdown: AllocationBreakdown
  if (existingExpense) {
    const eP = existingExpense.amount_from_piggy_bank ?? 0
    const eS = existingExpense.amount_from_budget_savings ?? 0
    const eB = existingExpense.amount_from_budget ?? 0
    const existingAmount = existingExpense.amount ?? eP + eS + eB
    // Round to nearest cent to absorb float-precision drift (e.g., 250.0000001
    // typed via DecimalFormInput parses to 250.0000001 instead of 250).
    const delta = Math.round((amount - existingAmount) * 100) / 100

    if (delta === 0) {
      breakdown = { fromPiggyBank: eP, fromBudgetSavings: eS, fromBudget: eB, overflow: 0 }
    } else if (delta > 0) {
      // Sprint 2026-05-21 (refinement) : on cascade le delta supplémentaire sur
      // les économies AVANT le budget si le pool en a encore (extra room beyond
      // existing claim). Sans ça, A=250 (eS=250, pool=50) édité à 275 mettait
      // les 25€ supplémentaires sur le budget au lieu d'aller piocher dans les
      // 50€ d'économies libres. User explicit : « si il existe encore des
      // économies disponibles, il faut les utiliser ». Piggy reste à `eP` —
      // jamais auto-débitée même en EDIT (P4 strict).
      const extraSavings = Math.max(0, savingsBefore - eS)
      let remaining = delta
      const addSavings = Math.min(remaining, extraSavings)
      remaining -= addSavings
      const addBudget = remaining // absorbe le reste, incl. déficit éventuel
      breakdown = {
        fromPiggyBank: eP,
        fromBudgetSavings: eS + addSavings,
        fromBudget: eB + addBudget,
        overflow: 0,
      }
    } else {
      // delta < 0 : refund priorité reverse — budget d'abord (vidé à 0), puis
      // savings (préserve la portion savings tant que budget peut absorber le
      // refund), puis piggy en dernier recours.
      let remainingRefund = -delta
      const refundFromBudget = Math.min(remainingRefund, eB)
      remainingRefund -= refundFromBudget
      const refundFromSavings = Math.min(remainingRefund, eS)
      remainingRefund -= refundFromSavings
      const refundFromPiggy = Math.min(remainingRefund, eP)
      breakdown = {
        fromPiggyBank: eP - refundFromPiggy,
        fromBudgetSavings: eS - refundFromSavings,
        fromBudget: eB - refundFromBudget,
        overflow: 0,
      }
    }
  } else {
    breakdown = calculateBreakdown(amount, budgetRemaining, savingsBefore)
  }

  // Si overflow > 0 (ADD seulement, EDIT a déjà résorbé dans fromBudget), le
  // edit flow accepte le débordement (le user a explicitement augmenté le
  // montant). Le `fromBudget` reçoit le résidu — produit un déficit budget
  // visible (impact RAV). Le user peut annuler edit s'il refuse.
  const fromBudgetWithOverflow = breakdown.fromBudget + breakdown.overflow

  const piggyBankAfter = piggyBankBefore - breakdown.fromPiggyBank
  const savingsAfter = savingsBefore - breakdown.fromBudgetSavings
  // En EDIT, le `budgetSpentBefore` lu plus haut inclut l'ancienne contribution
  // `existingExpense.amount_from_budget` (real_expenses pas encore updaté). Pour
  // refléter l'état post-save, on soustrait l'ancienne contribution et on
  // ajoute la nouvelle. En ADD, existingExpense est null → subtract = 0.
  const existingBudgetContribution = existingExpense?.amount_from_budget ?? 0
  const budgetSpentAfter = budgetSpentBefore - existingBudgetContribution + fromBudgetWithOverflow

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
