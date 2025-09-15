import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getProfileFinancialData, getGroupFinancialData, calculateBudgetSavings } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API de debug pour analyser les calculs financiers étape par étape
 */
export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    console.log('🔍 DEBUG FINANCIER - Début pour userId:', userId)

    // 1. Récupérer les informations du profil
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, first_name, last_name, group_id, salary')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    console.log('👤 Profile trouvé:', profile)

    // 2. Récupérer tous les revenus estimés
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('*')
      .eq('profile_id', userId)

    console.log('💰 Revenus estimés:', estimatedIncomes)

    // 3. Récupérer tous les budgets estimés
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq('profile_id', userId)

    console.log('📊 Budgets estimés:', estimatedBudgets)

    // 4. Récupérer les revenus réels
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('*')
      .eq('profile_id', userId)

    console.log('💵 Revenus réels:', realIncomes)

    // 5. Récupérer les dépenses réelles
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq('profile_id', userId)

    console.log('💳 Dépenses réelles:', realExpenses)

    // 6. Calculs étape par étape
    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0
    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0
    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0
    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // Dépenses exceptionnelles (non liées à un budget)
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // Économies par budget
    let totalSavings = 0
    const budgetSavingsDetail = []
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget = realExpenses
          .filter(expense => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0)

        const budgetSavings = calculateBudgetSavings(budget.estimated_amount, spentOnBudget, false) // 0 en temps réel
        totalSavings += budgetSavings

        budgetSavingsDetail.push({
          budgetName: budget.name,
          estimated: budget.estimated_amount,
          spent: spentOnBudget,
          savings: budgetSavings
        })
      }
    }

    // Calcul final selon battleplan
    const availableBalance = totalRealIncome - totalRealExpenses
    const remainingToLive = totalEstimatedIncome - totalEstimatedBudgets - exceptionalExpenses + totalSavings

    // 7. Obtenir le calcul officiel via la fonction
    const officialData = await getProfileFinancialData(userId)

    console.log('📋 RÉSUMÉ DEBUG:')
    console.log('- Total revenus estimés:', totalEstimatedIncome)
    console.log('- Total budgets estimés:', totalEstimatedBudgets)
    console.log('- Total revenus réels:', totalRealIncome)
    console.log('- Total dépenses réelles:', totalRealExpenses)
    console.log('- Dépenses exceptionnelles:', exceptionalExpenses)
    console.log('- Total économies:', totalSavings)
    console.log('- Calcul manuel - Solde disponible:', availableBalance)
    console.log('- Calcul manuel - Reste à vivre:', remainingToLive)
    console.log('- Calcul officiel:', officialData)

    return NextResponse.json({
      profile,
      rawData: {
        estimatedIncomes,
        estimatedBudgets,
        realIncomes,
        realExpenses
      },
      calculations: {
        totalEstimatedIncome,
        totalEstimatedBudgets,
        totalRealIncome,
        totalRealExpenses,
        exceptionalExpenses,
        totalSavings,
        budgetSavingsDetail
      },
      manualCalculation: {
        availableBalance,
        remainingToLive,
        formula: `${totalEstimatedIncome} - ${totalEstimatedBudgets} - ${exceptionalExpenses} + ${totalSavings} = ${remainingToLive}`
      },
      officialCalculation: officialData,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Erreur dans DEBUG financier:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}