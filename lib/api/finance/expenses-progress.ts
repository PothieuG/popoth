import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'

type BudgetForProgress = {
  id: string
  name: string
  estimated_amount: number
  cumulated_savings: number | null
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
 * Récupère la progression des dépenses par budget estimé
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)

    let budgets: BudgetForProgress[] = []
    let expenses: ExpenseForProgress[] = []

    if (context === 'profile') {
      // Récupérer les budgets du profil avec leurs économies
      const { data: budgetsData } = await supabaseServer
        .from('estimated_budgets')
        .select('id, name, estimated_amount, cumulated_savings')
        .eq('profile_id', userId)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles associées aux budgets
      const { data: expensesData } = await supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
        )
        .eq('profile_id', userId)
        .not('estimated_budget_id', 'is', null)

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
        .select('id, name, estimated_amount, cumulated_savings')
        .eq('group_id', profileData.group_id)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles du groupe associées aux budgets
      const { data: expensesData } = await supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
        )
        .eq('group_id', profileData.group_id)
        .not('estimated_budget_id', 'is', null)

      expenses = expensesData || []
    }

    // Calculer la progression pour chaque budget
    // Ne compter QUE amount_from_budget (pas tirelire ni savings)
    const progressData = budgets.map((budget) => {
      const relatedExpenses = expenses.filter(
        (expense) => expense.estimated_budget_id === budget.id,
      )

      const spentAmount = relatedExpenses.reduce((sum, expense) => {
        // Use amount_from_budget if available, otherwise use amount (backward compatibility)
        const amountFromBudget =
          expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
            ? Number(expense.amount_from_budget)
            : Number(expense.amount)

        return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
      }, 0)

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
