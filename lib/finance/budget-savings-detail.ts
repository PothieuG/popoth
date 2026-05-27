/**
 * Détail des économies par budget (profile-only).
 *
 * Extrait de lib/financial-calculations.ts au chantier I4. Profile-only :
 * il n'existe pas de variant group de cette fonction (vérifié via grep —
 * seul `getProfileFinancialData` agrège les économies de groupe au niveau
 * total via `cumulated_savings`).
 *
 * Renvoie `[]` sur erreur (fail-soft, le composant qui consomme affiche
 * une liste vide plutôt qu'un crash).
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { calculateBudgetSavings } from './calc-rtl'
import type { BudgetSavings } from './types'

export async function getBudgetSavingsDetail(profileId: string): Promise<BudgetSavings[]> {
  try {
    const { data: budgets } = await supabaseServer
      .from('estimated_budgets')
      .select(
        'id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date',
      )
      .eq('profile_id', profileId)

    if (!budgets) return []

    // Sprint 15 V3 + Part 35 — exclure toute transaction provenant d'un recap
    // antérieur (états A & B). Sprint Fix-Deficit-Current-Month-Only
    // (2026-05-27) — filtrer aussi par mois calendaire courant pour s'aligner
    // avec l'affichage du budget dashboard et le calcul du déficit dans
    // `financial-data.ts`.
    const todayDetail = new Date()
    const firstDayCurrentDetail = `${todayDetail.getFullYear()}-${String(todayDetail.getMonth() + 1).padStart(2, '0')}-01`
    const lastDayCurrentDetail = (() => {
      const d = new Date(todayDetail.getFullYear(), todayDetail.getMonth() + 1, 0)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq('profile_id', profileId)
      .is('carried_from_recap_id', null)
      .gte('expense_date', firstDayCurrentDetail)
      .lte('expense_date', lastDayCurrentDetail)
      .not('estimated_budget_id', 'is', null)

    const result: BudgetSavings[] = []

    for (const budget of budgets) {
      // Only count amount_from_budget (not piggy bank or savings)
      const realExpensesThisMonth =
        expenses
          ?.filter((e) => e.estimated_budget_id === budget.id)
          .reduce((sum, e) => {
            const amountFromBudget =
              e.amount_from_budget !== null && e.amount_from_budget !== undefined
                ? e.amount_from_budget
                : e.amount
            return sum + amountFromBudget
          }, 0) ?? 0

      // carryover_spent_amount nouveau système, fallback sur monthly_surplus négatif
      let carryoverSpent = 0
      if (budget.carryover_spent_amount !== undefined) {
        carryoverSpent = budget.carryover_spent_amount ?? 0
      } else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
        carryoverSpent = Math.abs(budget.monthly_surplus)
      }

      const totalSpentThisMonth = realExpensesThisMonth + carryoverSpent
      // isEndOfPeriod=false → toujours 0 en temps réel (calculé par le worker recap)
      const savings = calculateBudgetSavings(budget.estimated_amount, totalSpentThisMonth, false)

      result.push({
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedAmount: budget.estimated_amount,
        spentThisMonth: totalSpentThisMonth,
        savings,
      })
    }

    return result
  } catch (error) {
    logger.error('Erreur lors du calcul des économies par budget', { profileId, error })
    return []
  }
}
