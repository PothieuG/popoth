import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getGroupFinancialData, calculateBudgetSavings } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API de debug pour analyser les calculs financiers de GROUPE étape par étape
 */
export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    console.log('🔍 DEBUG FINANCIER GROUPE - Début pour userId:', userId)

    // 1. Récupérer les informations du profil
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, first_name, last_name, group_id, salary')
      .eq('id', userId)
      .single()

    if (profileError || !profile || !profile.group_id) {
      return NextResponse.json({ error: 'Profil ou groupe non trouvé' }, { status: 404 })
    }

    const groupId = profile.group_id
    console.log('👥 Groupe trouvé:', groupId)

    // 2. Récupérer tous les revenus estimés du GROUPE
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('*')
      .eq('group_id', groupId)

    console.log('💰 Revenus estimés GROUPE:', estimatedIncomes)

    // 3. Récupérer tous les budgets estimés du GROUPE
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq('group_id', groupId)

    console.log('📊 Budgets estimés GROUPE:', estimatedBudgets)

    // 4. Récupérer les revenus réels du GROUPE
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('*')
      .eq('group_id', groupId)

    console.log('💵 Revenus réels GROUPE:', realIncomes)

    // 5. Récupérer les dépenses réelles du GROUPE
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq('group_id', groupId)

    console.log('💳 Dépenses réelles GROUPE:', realExpenses)

    // 6. Récupérer les contributions des membres
    const { data: contributions } = await supabaseServer
      .from('group_contributions')
      .select('*')
      .eq('group_id', groupId)

    console.log('👥 Contributions membres:', contributions)

    // 7. Calculs étape par étape
    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0
    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0
    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0
    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0
    const profileContributions = contributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // Dépenses exceptionnelles
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // Économies par budget (toujours 0 en temps réel)
    let totalSavings = 0

    // Calcul final selon battleplan pour GROUPE
    const totalIncomes = totalEstimatedIncome + totalRealIncome + profileContributions
    const remainingToLive = totalIncomes - totalEstimatedBudgets - exceptionalExpenses + totalSavings
    const availableBalance = totalRealIncome + profileContributions - totalRealExpenses

    // 8. Obtenir le calcul officiel via la fonction
    const officialData = await getGroupFinancialData(groupId)

    console.log('📋 RÉSUMÉ DEBUG GROUPE:')
    console.log('- Total revenus estimés GROUPE:', totalEstimatedIncome)
    console.log('- Total budgets estimés GROUPE:', totalEstimatedBudgets)
    console.log('- Total revenus réels GROUPE:', totalRealIncome)
    console.log('- Total dépenses réelles GROUPE:', totalRealExpenses)
    console.log('- Contributions des profiles:', profileContributions)
    console.log('- Total revenus (estimé + réel + contributions):', totalIncomes)
    console.log('- Calcul manuel - Reste à vivre:', remainingToLive)
    console.log('- Calcul officiel:', officialData)

    return NextResponse.json({
      profile,
      groupId,
      rawData: {
        estimatedIncomes,
        estimatedBudgets,
        realIncomes,
        realExpenses,
        contributions
      },
      calculations: {
        totalEstimatedIncome,
        totalEstimatedBudgets,
        totalRealIncome,
        totalRealExpenses,
        profileContributions,
        totalIncomes,
        exceptionalExpenses,
        totalSavings
      },
      manualCalculation: {
        availableBalance,
        remainingToLive,
        formula: `(${totalEstimatedIncome} + ${totalRealIncome} + ${profileContributions}) - ${totalEstimatedBudgets} - ${exceptionalExpenses} + ${totalSavings} = ${remainingToLive}`
      },
      officialCalculation: officialData,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Erreur dans DEBUG financier groupe:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}