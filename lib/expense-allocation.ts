import { supabaseServer } from '@/lib/supabase-server'

export interface AllocationBreakdown {
  fromPiggyBank: number
  fromBudgetSavings: number
  fromBudget: number
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

/**
 * Calcule la repartition d'un montant selon la priorite: tirelire -> economies -> budget
 */
export function calculateBreakdown(
  amount: number,
  piggyBankAvailable: number,
  savingsAvailable: number
): AllocationBreakdown {
  let remaining = amount
  let fromPiggyBank = 0
  let fromBudgetSavings = 0
  let fromBudget = 0

  // Priorite 1: Tirelire
  if (piggyBankAvailable > 0) {
    fromPiggyBank = Math.min(remaining, piggyBankAvailable)
    remaining -= fromPiggyBank
  }

  // Priorite 2: Economies du budget
  if (remaining > 0 && savingsAvailable > 0) {
    fromBudgetSavings = Math.min(remaining, savingsAvailable)
    remaining -= fromBudgetSavings
  }

  // Priorite 3: Budget
  if (remaining > 0) {
    fromBudget = remaining
  }

  return { fromPiggyBank, fromBudgetSavings, fromBudget }
}

/**
 * Reverse une allocation precedente: restaure la tirelire et les economies du budget
 */
export async function reverseAllocation(
  oldExpense: ExpenseWithBreakdown,
  contextFilter: ContextFilter
): Promise<void> {
  const piggyToRestore = oldExpense.amount_from_piggy_bank || 0
  const savingsToRestore = oldExpense.amount_from_budget_savings || 0

  // Restaurer la tirelire
  if (piggyToRestore > 0) {
    const { data: piggyData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()

    const currentPiggy = piggyData?.amount || 0
    const { error } = await supabaseServer
      .from('piggy_bank')
      .update({ amount: currentPiggy + piggyToRestore })
      .match(contextFilter)

    if (error) {
      console.error('Erreur restauration tirelire:', error)
      throw new Error('Erreur lors de la restauration de la tirelire')
    }
  }

  // Restaurer les economies du budget
  if (savingsToRestore > 0 && oldExpense.estimated_budget_id) {
    const { data: budgetData } = await supabaseServer
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', oldExpense.estimated_budget_id)
      .single()

    const currentSavings = budgetData?.cumulated_savings || 0
    const { error } = await supabaseServer
      .from('estimated_budgets')
      .update({
        cumulated_savings: currentSavings + savingsToRestore,
        last_savings_update: new Date().toISOString()
      })
      .eq('id', oldExpense.estimated_budget_id)

    if (error) {
      console.error('Erreur restauration economies:', error)
      throw new Error('Erreur lors de la restauration des economies')
    }
  }
}

/**
 * Applique une nouvelle allocation: lit les soldes actuels, calcule le breakdown,
 * met a jour tirelire et economies en DB, et retourne le resultat
 */
export async function applyAllocation(
  amount: number,
  budgetId: string,
  contextFilter: ContextFilter
): Promise<ApplyAllocationResult> {
  // Lire la tirelire actuelle
  const { data: piggyData } = await supabaseServer
    .from('piggy_bank')
    .select('amount')
    .match(contextFilter)
    .maybeSingle()

  const piggyBankBefore = piggyData?.amount || 0

  // Lire les economies du budget
  const { data: budgetData } = await supabaseServer
    .from('estimated_budgets')
    .select('cumulated_savings, estimated_amount')
    .eq('id', budgetId)
    .single()

  if (!budgetData) {
    throw new Error('Budget introuvable')
  }

  const savingsBefore = budgetData.cumulated_savings || 0

  // Lire le budget deja depense (somme des amount_from_budget des depenses existantes)
  const { data: expenses } = await supabaseServer
    .from('real_expenses')
    .select('amount_from_budget')
    .eq('estimated_budget_id', budgetId)
    .match(contextFilter)

  const budgetSpentBefore = expenses?.reduce((sum, e) => {
    return sum + (e.amount_from_budget || 0)
  }, 0) || 0

  // Calculer le breakdown
  const breakdown = calculateBreakdown(amount, piggyBankBefore, savingsBefore)

  const piggyBankAfter = piggyBankBefore - breakdown.fromPiggyBank
  const savingsAfter = savingsBefore - breakdown.fromBudgetSavings
  const budgetSpentAfter = budgetSpentBefore + breakdown.fromBudget

  // Mettre a jour la tirelire
  if (breakdown.fromPiggyBank > 0 && piggyData) {
    const { error } = await supabaseServer
      .from('piggy_bank')
      .update({ amount: piggyBankAfter })
      .match(contextFilter)

    if (error) {
      console.error('Erreur mise a jour tirelire:', error)
      throw new Error('Erreur lors de la mise a jour de la tirelire')
    }
  }

  // Mettre a jour les economies du budget
  if (breakdown.fromBudgetSavings > 0) {
    const { error } = await supabaseServer
      .from('estimated_budgets')
      .update({
        cumulated_savings: savingsAfter,
        last_savings_update: new Date().toISOString()
      })
      .eq('id', budgetId)

    if (error) {
      console.error('Erreur mise a jour economies:', error)
      throw new Error('Erreur lors de la mise a jour des economies')
    }
  }

  return {
    ...breakdown,
    piggyBankBefore,
    piggyBankAfter,
    savingsBefore,
    savingsAfter,
    budgetSpentBefore,
    budgetSpentAfter
  }
}
