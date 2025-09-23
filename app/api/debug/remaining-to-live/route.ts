import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API DEBUG GET /api/debug/remaining-to-live
 *
 * Affiche le détail complet du calcul du reste à vivre
 * Query: ?context=profile|group
 */
export async function GET(request: NextRequest) {
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const context = url.searchParams.get('context') || 'profile'

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id, first_name, last_name')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    // Déterminer l'ID du contexte
    let contextId: string
    if (context === 'profile') {
      contextId = profile.id
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 400 }
        )
      }
      contextId = profile.group_id
    }

    console.log(`🔍 [RAV Debug] Analyse détaillée pour ${context}:${contextId}`)

    // 1. Récupérer les données financières calculées
    let financialData: any
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    console.log('📊 [RAV Debug] Données financières calculées:', financialData)

    // 2. Récupérer les données détaillées pour analyse
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    // 2.1 Revenus estimés
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('id, name, estimated_amount')
      .eq(ownerField, contextId)

    // 2.2 Revenus réels
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('id, amount, description, estimated_income_id, is_exceptional')
      .eq(ownerField, contextId)

    // 2.3 Budgets estimés
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    // 2.4 Dépenses réelles
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('id, amount, description, estimated_budget_id, is_exceptional')
      .eq(ownerField, contextId)

    // 2.5 Solde bancaire
    const { data: bankBalance } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq(ownerField, contextId)
      .single()

    // 3. Analyser les revenus
    const incomeAnalysis = (estimatedIncomes || []).map(estimatedIncome => {
      const linkedRealIncomes = (realIncomes || []).filter(
        real => real.estimated_income_id === estimatedIncome.id
      )
      const totalRealAmount = linkedRealIncomes.reduce((sum, real) => sum + real.amount, 0)

      return {
        id: estimatedIncome.id,
        name: estimatedIncome.name,
        estimated_amount: estimatedIncome.estimated_amount,
        real_amount: totalRealAmount,
        is_used: totalRealAmount > 0,
        contribution_to_rav: totalRealAmount > 0 ? totalRealAmount : estimatedIncome.estimated_amount,
        real_incomes: linkedRealIncomes
      }
    })

    // 4. Analyser les budgets
    const budgetAnalysis = (estimatedBudgets || []).map(budget => {
      const linkedExpenses = (realExpenses || []).filter(
        expense => expense.estimated_budget_id === budget.id
      )
      const totalSpent = linkedExpenses.reduce((sum, expense) => sum + expense.amount, 0)
      const surplus = Math.max(0, budget.estimated_amount - totalSpent)

      return {
        id: budget.id,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        spent_amount: totalSpent,
        surplus: surplus,
        cumulated_savings: budget.cumulated_savings || 0,
        expenses: linkedExpenses
      }
    })

    // 5. Dépenses exceptionnelles
    const exceptionalExpenses = (realExpenses || []).filter(expense =>
      expense.is_exceptional && !expense.estimated_budget_id
    )
    const totalExceptionalExpenses = exceptionalExpenses.reduce((sum, expense) => sum + expense.amount, 0)

    // 6. Revenus exceptionnels
    const exceptionalIncomes = (realIncomes || []).filter(income =>
      income.is_exceptional && !income.estimated_income_id
    )
    const totalExceptionalIncomes = exceptionalIncomes.reduce((sum, income) => sum + income.amount, 0)

    // 7. Calculs des totaux
    const totalEstimatedIncomes = incomeAnalysis.reduce((sum, income) => sum + income.estimated_amount, 0)
    const totalIncomeContribution = incomeAnalysis.reduce((sum, income) => sum + income.contribution_to_rav, 0)
    const totalEstimatedBudgets = budgetAnalysis.reduce((sum, budget) => sum + budget.estimated_amount, 0)
    const totalSavings = budgetAnalysis.reduce((sum, budget) => sum + budget.cumulated_savings, 0)

    // 8. Calcul manuel du reste à vivre pour vérification (NOUVELLE FORMULE SANS ÉCONOMIES)
    const manualRAVCalculation = {
      income_contribution: totalIncomeContribution,
      exceptional_incomes: totalExceptionalIncomes,
      estimated_budgets: -totalEstimatedBudgets,
      exceptional_expenses: -totalExceptionalExpenses,
      cumulated_savings_EXCLUDED: totalSavings, // ⚠️ PLUS utilisé dans le calcul
      manual_total: totalIncomeContribution + totalExceptionalIncomes - totalEstimatedBudgets - totalExceptionalExpenses
    }

    // 9. Contributions de groupe (si applicable)
    let groupContributions = []
    if (context === 'group') {
      const { data: contributions } = await supabaseServer
        .from('group_contributions')
        .select('profile_id, contribution_amount, profiles(first_name, last_name)')
        .eq('group_id', contextId)

      groupContributions = contributions || []
    }

    return NextResponse.json({
      success: true,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,

      // Résultat final des calculs
      financial_data: financialData,

      // Détail des composants
      income_analysis: incomeAnalysis,
      budget_analysis: budgetAnalysis,
      exceptional_expenses: exceptionalExpenses,
      exceptional_incomes: exceptionalIncomes,
      group_contributions: groupContributions,

      // Totaux calculés
      totals: {
        estimated_incomes: totalEstimatedIncomes,
        income_contribution_to_rav: totalIncomeContribution,
        estimated_budgets: totalEstimatedBudgets,
        exceptional_expenses: totalExceptionalExpenses,
        exceptional_incomes: totalExceptionalIncomes,
        cumulated_savings: totalSavings,
        bank_balance: bankBalance?.balance || 0
      },

      // Vérification manuelle
      manual_calculation: manualRAVCalculation,
      calculation_matches: Math.abs(manualRAVCalculation.manual_total - financialData.remainingToLive) < 0.01,

      // Formule appliquée (NOUVELLE VERSION SANS ÉCONOMIES)
      formula: context === 'profile'
        ? "RAV = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels - Budgets Estimés - Dépenses Exceptionnelles"
        : "RAV = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels + Contributions Groupe - Budgets Estimés - Dépenses Exceptionnelles",

      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ [RAV Debug] Erreur:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}