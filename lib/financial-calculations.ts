/**
 * Bibliothèque de calculs financiers côté application
 * Implémente les règles métier définies dans battleplan.txt
 */

import { supabaseServer } from '@/lib/supabase-server'

// ============================================
// INTERFACES TYPESCRIPT
// ============================================

export interface FinancialData {
  availableBalance: number      // Cash disponible (peut être négatif)
  remainingToLive: number      // Reste à vivre (peut être négatif)
  totalSavings: number         // Total des économies des budgets
  totalEstimatedIncome: number // Total des revenus estimés
  totalEstimatedBudgets: number // Total des budgets estimés
  totalRealIncome: number      // Total des revenus réels
  totalRealExpenses: number    // Total des dépenses réelles
}

export interface BudgetSavings {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  savings: number              // MAX(0, estimatedAmount - spentThisMonth)
}

// ============================================
// CALCULS SELON BATTLEPLAN.TXT
// ============================================

/**
 * Règle cash disponible (battleplan ligne 13-16):
 * "c'est l'argent disponible sur le compte bancaire à un temps T"
 * "c'est les réels entrées d'argent moins les réels dépenses"
 * "Ca peut être négatif"
 */
export function calculateAvailableCash(realIncomes: number, realExpenses: number): number {
  return realIncomes - realExpenses
}

/**
 * Règle reste à vivre pour PROFILES (battleplan ligne 18-19):
 * "l'ensemble des entrées d'argent moins ce qui a été budgété pour le mois
 * moins les dépenses non-budgété (exceptionnelles),
 * mais on y ajoute l'ensemble des économies des budgets"
 */
export function calculateRemainingToLiveProfile(
  estimatedIncomes: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  totalBudgetSavings: number
): number {
  return estimatedIncomes - estimatedBudgets - exceptionalExpenses + totalBudgetSavings
}

/**
 * Règle reste à vivre pour GROUPS (battleplan ligne 20-21):
 * "l'ensemble des entrées d'argent estimés et entrées réels (les contributions des profiles du groupe + entrées d'argent exceptionnels),
 * moins l'ensemble de ce qui a été budgété moins les dépenses non-budgété"
 */
export function calculateRemainingToLiveGroup(
  estimatedIncomes: number,
  realIncomes: number,
  profileContributions: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  totalBudgetSavings: number
): number {
  const totalIncomes = estimatedIncomes + realIncomes + profileContributions
  return totalIncomes - estimatedBudgets - exceptionalExpenses + totalBudgetSavings
}

/**
 * Calcul des économies d'un budget (battleplan ligne 28):
 * "si je décide de budgété 200€ pour des courses pendant un mois et qu'en fait je ne dépense que 150€,
 * à la fin du mois, 50€ sera ajouté aux économies de ce budget"
 */
export function calculateBudgetSavings(estimatedAmount: number, spentThisMonth: number): number {
  return Math.max(0, estimatedAmount - spentThisMonth)
}

// ============================================
// FONCTIONS DE RÉCUPÉRATION DE DONNÉES
// ============================================

/**
 * Récupère les données financières pour un utilisateur (profile)
 */
export async function getProfileFinancialData(profileId: string): Promise<FinancialData> {
  try {

    // 1. Récupérer tous les revenus estimés du profile
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq('profile_id', profileId)

    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0

    // 2. Récupérer tous les budgets estimés du profile
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount')
      .eq('profile_id', profileId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 3. Récupérer tous les revenus réels du profile
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .eq('profile_id', profileId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 4. Récupérer toutes les dépenses réelles du profile
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional')
      .eq('profile_id', profileId)

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5. Calculer les dépenses exceptionnelles (non liées à un budget)
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 6. Calculer les économies pour chaque budget
    let totalSavings = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget = realExpenses
          .filter(expense => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0)

        const budgetSavings = calculateBudgetSavings(budget.estimated_amount, spentOnBudget)
        totalSavings += budgetSavings
      }
    }

    // 7. Appliquer les règles de calcul du battleplan
    const availableBalance = calculateAvailableCash(totalRealIncome, totalRealExpenses)
    const remainingToLive = calculateRemainingToLiveProfile(
      totalEstimatedIncome,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalSavings
    )

    // Calculs terminés

    return {
      availableBalance,
      remainingToLive,
      totalSavings,
      totalEstimatedIncome,
      totalEstimatedBudgets,
      totalRealIncome,
      totalRealExpenses
    }

  } catch (error) {
    console.error('❌ Erreur lors du calcul des données financières:', error)
    // Retourner des valeurs par défaut en cas d'erreur
    return {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0
    }
  }
}

/**
 * Récupère les données financières pour un groupe
 */
export async function getGroupFinancialData(groupId: string): Promise<FinancialData> {
  try {

    // 1. Récupérer les revenus estimés du groupe
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq('group_id', groupId)

    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0

    // 2. Récupérer les budgets estimés du groupe
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount')
      .eq('group_id', groupId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 3. Récupérer les revenus réels du groupe
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .eq('group_id', groupId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 4. Récupérer les dépenses réelles du groupe
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional')
      .eq('group_id', groupId)

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5. Récupérer les contributions des membres du groupe
    const { data: contributions } = await supabaseServer
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', groupId)

    const profileContributions = contributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // 6. Calculer les dépenses exceptionnelles
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 7. Calculer les économies des budgets
    let totalSavings = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget = realExpenses
          .filter(expense => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0)

        const budgetSavings = calculateBudgetSavings(budget.estimated_amount, spentOnBudget)
        totalSavings += budgetSavings
      }
    }

    // 8. Appliquer les règles de calcul pour groupe
    const availableBalance = calculateAvailableCash(totalRealIncome + profileContributions, totalRealExpenses)
    const remainingToLive = calculateRemainingToLiveGroup(
      totalEstimatedIncome,
      totalRealIncome,
      profileContributions,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalSavings
    )

    return {
      availableBalance,
      remainingToLive,
      totalSavings,
      totalEstimatedIncome,
      totalEstimatedBudgets,
      totalRealIncome,
      totalRealExpenses
    }

  } catch (error) {
    console.error('❌ Erreur lors du calcul des données financières du groupe:', error)
    return {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0
    }
  }
}

/**
 * Récupère le détail des économies par budget pour un profile
 */
export async function getBudgetSavingsDetail(profileId: string): Promise<BudgetSavings[]> {
  try {
    const { data: budgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount')
      .eq('profile_id', profileId)

    if (!budgets) return []

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id')
      .eq('profile_id', profileId)
      .not('estimated_budget_id', 'is', null)

    const result: BudgetSavings[] = []

    for (const budget of budgets) {
      const spentThisMonth = expenses
        ?.filter(expense => expense.estimated_budget_id === budget.id)
        ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

      const savings = calculateBudgetSavings(budget.estimated_amount, spentThisMonth)

      result.push({
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedAmount: budget.estimated_amount,
        spentThisMonth,
        savings
      })
    }

    return result

  } catch (error) {
    console.error('❌ Erreur lors du calcul des économies par budget:', error)
    return []
  }
}