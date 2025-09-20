import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * GET /api/finances/expenses/progress
 * Récupère la progression des dépenses par budget estimé
 */
export async function GET(request: NextRequest) {
  try {
    // Vérifier l'authentification
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    // Récupérer le contexte depuis les paramètres URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' || 'profile'

    let budgets: any[] = []
    let expenses: any[] = []

    if (context === 'profile') {
      // Récupérer les budgets du profil
      const { data: budgetsData } = await supabaseServer
        .from('estimated_budgets')
        .select('id, name, estimated_amount')
        .eq('profile_id', userId)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles associées aux budgets
      const { data: expensesData } = await supabaseServer
        .from('real_expenses')
        .select('amount, estimated_budget_id')
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
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 404 }
        )
      }

      // Récupérer les budgets du groupe
      const { data: budgetsData } = await supabaseServer
        .from('estimated_budgets')
        .select('id, name, estimated_amount')
        .eq('group_id', profileData.group_id)

      budgets = budgetsData || []

      // Récupérer les dépenses réelles du groupe associées aux budgets
      const { data: expensesData } = await supabaseServer
        .from('real_expenses')
        .select('amount, estimated_budget_id')
        .eq('group_id', profileData.group_id)
        .not('estimated_budget_id', 'is', null)

      expenses = expensesData || []
    }

    // Calculer la progression pour chaque budget
    const progressData = budgets.map(budget => {
      const spentAmount = expenses
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      const remainingAmount = budget.estimated_amount - spentAmount
      const economyAmount = Math.max(0, remainingAmount)

      return {
        budgetId: budget.id,
        budgetName: budget.name,
        spentAmount,
        estimatedAmount: budget.estimated_amount,
        remainingAmount,
        economyAmount
      }
    })

    return NextResponse.json(progressData)

  } catch (error) {
    console.error('❌ Erreur dans /api/finances/expenses/progress:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}