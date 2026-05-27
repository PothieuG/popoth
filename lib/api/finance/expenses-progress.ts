import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { progressQuerySchema } from '@/lib/schemas/common'
import { computePeriodDateRange } from '@/lib/finance/period'

type BudgetForProgress = {
  id: string
  name: string
  estimated_amount: number
  cumulated_savings: number | null
  carryover_spent_amount: number | null
}
type ExpenseForProgress = {
  amount: number
  estimated_budget_id: string | null
  amount_from_piggy_bank: number | null
  amount_from_budget_savings: number | null
  amount_from_budget: number | null
}

/**
 * GET /api/finance/expenses/progress
 *
 * Récupère la progression des dépenses par budget estimé.
 *
 * Sprint P1 — `?period=month|week|day` filtre `real_expenses.expense_date` au
 * range correspondant ('month' = pas de filtre, préserve la sémantique
 * "depuis dernier recap"). Les `estimated_budgets` ne sont PAS filtrés
 * (entités, pas transactions). Conséquence : en mode 'week' / 'day', le
 * `spentAmount` reflète uniquement la sous-période ; le `estimatedAmount`
 * reste le budget mensuel (= compare consommation de la période vs cap mensuel).
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const { context, period } = parseQuery(request, progressQuerySchema)
    const dateRange = computePeriodDateRange(period)

    let budgets: BudgetForProgress[] = []
    let expenses: ExpenseForProgress[] = []

    if (context === 'profile') {
      // Récupérer les budgets du profil avec leurs économies
      const { data: budgetsData } = await supabaseServer
        .from('estimated_budgets')
        .select('id, name, estimated_amount, cumulated_savings, carryover_spent_amount')
        .eq('profile_id', userId)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles associées aux budgets (filtrées par période si demandé)
      let profileExpensesQuery = supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
        )
        .eq('profile_id', userId)
        .is('carried_from_recap_id', null)
        .not('estimated_budget_id', 'is', null)
      if (dateRange) {
        profileExpensesQuery = profileExpensesQuery
          .gte('expense_date', dateRange.startDate)
          .lte('expense_date', dateRange.endDate)
      }
      const { data: expensesData } = await profileExpensesQuery

      expenses = expensesData || []
    } else {
      // Récupérer les informations du groupe de l'utilisateur
      const { data: profileData } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profileData?.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait partie d'aucun groupe" },
          { status: 404 },
        )
      }

      // Récupérer les budgets du groupe avec leurs économies
      const { data: budgetsData } = await supabaseServer
        .from('estimated_budgets')
        .select('id, name, estimated_amount, cumulated_savings, carryover_spent_amount')
        .eq('group_id', profileData.group_id)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles du groupe (filtrées par période si demandé)
      let groupExpensesQuery = supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
        )
        .eq('group_id', profileData.group_id)
        .is('carried_from_recap_id', null)
        .not('estimated_budget_id', 'is', null)
      if (dateRange) {
        groupExpensesQuery = groupExpensesQuery
          .gte('expense_date', dateRange.startDate)
          .lte('expense_date', dateRange.endDate)
      }
      const { data: expensesData } = await groupExpensesQuery

      expenses = expensesData || []
    }

    // Calculer la progression pour chaque budget
    // Ne compter QUE amount_from_budget (pas tirelire ni savings)
    const progressData = budgets.map((budget) => {
      const relatedExpenses = expenses.filter(
        (expense) => expense.estimated_budget_id === budget.id,
      )

      const actualSpent = relatedExpenses.reduce((sum, expense) => {
        // Use amount_from_budget if available, otherwise use amount (backward compatibility)
        const amountFromBudget =
          expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
            ? Number(expense.amount_from_budget)
            : Number(expense.amount)

        return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
      }, 0)

      // Inclure le carryover (déficit reporté du recap précédent) — sans ça,
      // le `spentAmount` diverge du dashboard `budget.spent_this_month` et
      // casse en cascade l'encart violet "dépassement" dans AddTransactionModal
      // ainsi que le preview "Après suppression" dans TransactionListItem
      // (qui se basent tous deux sur ce `spentAmount` via `useProgressData`).
      const carryoverSpent = Number(budget.carryover_spent_amount ?? 0)
      const spentAmount = actualSpent + (isNaN(carryoverSpent) ? 0 : carryoverSpent)

      const remainingAmount = budget.estimated_amount - spentAmount
      // Utiliser les économies stockées en base (cumulated_savings)
      const economyAmount = budget.cumulated_savings || 0

      return {
        budgetId: budget.id,
        budgetName: budget.name,
        spentAmount,
        estimatedAmount: budget.estimated_amount,
        remainingAmount,
        economyAmount,
      }
    })

    return NextResponse.json(progressData)
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})
