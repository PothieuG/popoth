/**
 * Bibliothèque de calculs spécifiques au récapitulatif mensuel
 * Étend les calculs financiers existants avec des fonctions dédiées
 */

import { supabaseServer } from '@/lib/supabase-server'

// ============================================
// INTERFACES TYPESCRIPT
// ============================================

export interface MonthlyBudgetStats {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  difference: number
  surplus: number
  deficit: number
  monthly_surplus?: number
  monthly_deficit?: number
}

export interface MonthlyRecapSummary {
  context: 'profile' | 'group'
  context_id: string
  month: number
  year: number
  current_remaining_to_live: number
  budget_stats: MonthlyBudgetStats[]
  total_surplus: number
  total_deficit: number
  general_ratio: number
  estimated_incomes_total: number
  real_incomes_total: number
  real_expenses_total: number
}

// ============================================
// FONCTIONS DE CALCUL MENSUEL
// ============================================

/**
 * Calcule les statistiques détaillées pour tous les budgets d'un contexte
 */
export async function calculateMonthlyBudgetStats(
  contextId: string,
  context: 'profile' | 'group',
  month?: number,
  year?: number
): Promise<MonthlyBudgetStats[]> {
  try {
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const currentDate = new Date()
    const targetMonth = month || (currentDate.getMonth() + 1)
    const targetYear = year || currentDate.getFullYear()

    // Récupérer tous les budgets estimés
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, monthly_surplus, monthly_deficit')
      .eq(ownerField, contextId)

    if (budgetsError || !budgets) {
      console.error('❌ Erreur lors de la récupération des budgets:', budgetsError)
      return []
    }

    // Récupérer toutes les dépenses réelles du mois
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, expense_date')
      .eq(ownerField, contextId)
      .gte('expense_date', `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`)
      .lt('expense_date', `${targetMonth === 12 ? targetYear + 1 : targetYear}-${targetMonth === 12 ? '01' : (targetMonth + 1).toString().padStart(2, '0')}-01`)

    if (expensesError) {
      console.error('❌ Erreur lors de la récupération des dépenses:', expensesError)
    }

    const monthlyExpenses = expenses || []

    // Calculer les statistiques pour chaque budget
    const budgetStats: MonthlyBudgetStats[] = []

    for (const budget of budgets) {
      // Calculer le montant dépensé pour ce budget ce mois
      const spentAmount = monthlyExpenses
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + parseFloat(expense.amount.toString()), 0)

      const estimatedAmount = parseFloat(budget.estimated_amount.toString())
      const difference = estimatedAmount - spentAmount

      const budgetStat: MonthlyBudgetStats = {
        id: budget.id,
        name: budget.name,
        estimated_amount: estimatedAmount,
        spent_amount: spentAmount,
        difference,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        monthly_surplus: budget.monthly_surplus ? parseFloat(budget.monthly_surplus.toString()) : undefined,
        monthly_deficit: budget.monthly_deficit ? parseFloat(budget.monthly_deficit.toString()) : undefined
      }

      budgetStats.push(budgetStat)
    }

    console.log(`📊 [Monthly Budget Stats] Calculé pour ${context}:${contextId} - ${budgetStats.length} budgets`)
    return budgetStats

  } catch (error) {
    console.error('❌ Erreur lors du calcul des statistiques mensuelles:', error)
    return []
  }
}

/**
 * Met à jour les colonnes monthly_surplus et monthly_deficit d'un budget
 */
export async function updateBudgetMonthlySurplusDeficit(
  budgetId: string,
  surplus: number,
  deficit: number
): Promise<boolean> {
  try {
    const { error } = await supabaseServer
      .from('estimated_budgets')
      .update({
        monthly_surplus: Math.max(0, surplus),
        monthly_deficit: Math.max(0, deficit),
        last_monthly_update: new Date().toISOString().split('T')[0], // Format YYYY-MM-DD
        updated_at: new Date().toISOString()
      })
      .eq('id', budgetId)

    if (error) {
      console.error(`❌ Erreur lors de la mise à jour du budget ${budgetId}:`, error)
      return false
    }

    console.log(`✅ Budget ${budgetId} mis à jour: surplus=${surplus}€, deficit=${deficit}€`)
    return true

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour mensuelle du budget:', error)
    return false
  }
}

/**
 * Met à jour tous les budgets d'un contexte avec leurs surplus/déficits calculés
 */
export async function updateAllBudgetsMonthlySurplusDeficit(
  contextId: string,
  context: 'profile' | 'group',
  budgetStats: MonthlyBudgetStats[]
): Promise<{ success: number; errors: number }> {
  let successCount = 0
  let errorCount = 0

  console.log(`🔄 [Update All Budgets] Début pour ${context}:${contextId} - ${budgetStats.length} budgets`)

  for (const budgetStat of budgetStats) {
    const success = await updateBudgetMonthlySurplusDeficit(
      budgetStat.id,
      budgetStat.surplus,
      budgetStat.deficit
    )

    if (success) {
      successCount++
    } else {
      errorCount++
    }
  }

  console.log(`✅ [Update All Budgets] Terminé: ${successCount} succès, ${errorCount} erreurs`)
  return { success: successCount, errors: errorCount }
}

/**
 * Vérifie si un récapitulatif mensuel a déjà été effectué
 */
export async function hasMonthlyRecapBeenCompleted(
  contextId: string,
  context: 'profile' | 'group',
  month?: number,
  year?: number
): Promise<boolean> {
  try {
    const currentDate = new Date()
    const targetMonth = month || (currentDate.getMonth() + 1)
    const targetYear = year || currentDate.getFullYear()
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: recap, error } = await supabaseServer
      .from('monthly_recaps')
      .select('id')
      .eq(ownerField, contextId)
      .eq('recap_month', targetMonth)
      .eq('recap_year', targetYear)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('❌ Erreur lors de la vérification du récap mensuel:', error)
    }

    return !!recap

  } catch (error) {
    console.error('❌ Erreur lors de la vérification du récap mensuel:', error)
    return false
  }
}

/**
 * Obtient le résumé complet du récapitulatif mensuel
 */
export async function getMonthlyRecapSummary(
  contextId: string,
  context: 'profile' | 'group',
  month?: number,
  year?: number
): Promise<MonthlyRecapSummary | null> {
  try {
    const currentDate = new Date()
    const targetMonth = month || (currentDate.getMonth() + 1)
    const targetYear = year || currentDate.getFullYear()

    // Calculer les statistiques des budgets
    const budgetStats = await calculateMonthlyBudgetStats(contextId, context, targetMonth, targetYear)

    // Calculer les totaux
    const totalSurplus = budgetStats.reduce((sum, budget) => sum + budget.surplus, 0)
    const totalDeficit = budgetStats.reduce((sum, budget) => sum + budget.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    // Récupérer les données financières supplémentaires
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    // Total des revenus estimés
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq(ownerField, contextId)

    const estimatedIncomesTotal = estimatedIncomes?.reduce(
      (sum, income) => sum + parseFloat(income.estimated_amount.toString()), 0
    ) || 0

    // Total des revenus réels du mois
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .eq(ownerField, contextId)
      .gte('entry_date', `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`)
      .lt('entry_date', `${targetMonth === 12 ? targetYear + 1 : targetYear}-${targetMonth === 12 ? '01' : (targetMonth + 1).toString().padStart(2, '0')}-01`)

    const realIncomesTotal = realIncomes?.reduce(
      (sum, income) => sum + parseFloat(income.amount.toString()), 0
    ) || 0

    // Total des dépenses réelles du mois
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount')
      .eq(ownerField, contextId)
      .gte('expense_date', `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`)
      .lt('expense_date', `${targetMonth === 12 ? targetYear + 1 : targetYear}-${targetMonth === 12 ? '01' : (targetMonth + 1).toString().padStart(2, '0')}-01`)

    const realExpensesTotal = realExpenses?.reduce(
      (sum, expense) => sum + parseFloat(expense.amount.toString()), 0
    ) || 0

    // Calculer le reste à vivre (formule simplifiée pour le récap)
    const totalEstimatedBudgets = budgetStats.reduce((sum, budget) => sum + budget.estimated_amount, 0)
    const currentRemainingToLive = estimatedIncomesTotal - totalEstimatedBudgets

    const summary: MonthlyRecapSummary = {
      context,
      context_id: contextId,
      month: targetMonth,
      year: targetYear,
      current_remaining_to_live: currentRemainingToLive,
      budget_stats: budgetStats,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      general_ratio: generalRatio,
      estimated_incomes_total: estimatedIncomesTotal,
      real_incomes_total: realIncomesTotal,
      real_expenses_total: realExpensesTotal
    }

    console.log(`📊 [Monthly Recap Summary] Généré pour ${context}:${contextId}`)
    console.log(`📊 [Monthly Recap Summary] Surplus: ${totalSurplus}€, Déficit: ${totalDeficit}€, Ratio: ${generalRatio}€`)

    return summary

  } catch (error) {
    console.error('❌ Erreur lors de la génération du résumé mensuel:', error)
    return null
  }
}

/**
 * Réinitialise tous les revenus estimés d'un contexte à 0
 */
export async function resetEstimatedIncomes(
  contextId: string,
  context: 'profile' | 'group'
): Promise<boolean> {
  try {
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { error } = await supabaseServer
      .from('estimated_incomes')
      .update({
        estimated_amount: 0,
        updated_at: new Date().toISOString()
      })
      .eq(ownerField, contextId)

    if (error) {
      console.error(`❌ Erreur lors du reset des revenus estimés pour ${context}:${contextId}:`, error)
      return false
    }

    console.log(`✅ [Reset Incomes] Revenus estimés remis à 0 pour ${context}:${contextId}`)
    return true

  } catch (error) {
    console.error('❌ Erreur lors du reset des revenus estimés:', error)
    return false
  }
}

/**
 * Marque tous les budgets d'un contexte comme mis à jour ce mois-ci
 */
export async function markBudgetsAsUpdated(
  contextId: string,
  context: 'profile' | 'group'
): Promise<boolean> {
  try {
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const today = new Date().toISOString().split('T')[0] // Format YYYY-MM-DD

    const { error } = await supabaseServer
      .from('estimated_budgets')
      .update({
        last_monthly_update: today,
        updated_at: new Date().toISOString()
      })
      .eq(ownerField, contextId)

    if (error) {
      console.error(`❌ Erreur lors de la mise à jour des budgets pour ${context}:${contextId}:`, error)
      return false
    }

    console.log(`✅ [Mark Budgets Updated] Budgets marqués comme mis à jour pour ${context}:${contextId}`)
    return true

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour des budgets:', error)
    return false
  }
}