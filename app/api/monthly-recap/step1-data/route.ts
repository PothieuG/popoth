import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API GET /api/monthly-recap/step1-data
 *
 * Récupère les données live nécessaires pour l'étape 1 du monthly recap
 * AUCUN CACHE - Données récupérées directement depuis la base
 *
 * Query: { context: 'profile' | 'group' }
 *
 * Retourne:
 * - current_remaining_to_live: nombre (peut être négatif)
 * - budgets_with_surplus: budget[] (excédents disponibles)
 * - budgets_with_savings: budget[] (économies disponibles)
 * - total_surplus_available: nombre
 * - total_savings_available: nombre
 * - can_balance: boolean (true si des fonds sont disponibles pour équilibrage)
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

    console.log(`🔍 [DEBUG STEP1] ====================================`)
    console.log(`🔍 [DEBUG STEP1] ÉTAPE 1 - RÉCUPÉRATION RAV POUR ${context.toUpperCase()}:${contextId}`)
    console.log(`🔍 [DEBUG STEP1] TIMESTAMP: ${new Date().toISOString()}`)
    console.log(`🔍 [DEBUG STEP1] ====================================`)

    // 1. Récupérer le reste à vivre actuel DIRECTEMENT depuis les calculs financiers
    let financialData: any
    if (context === 'profile') {
      console.log(`🔍 [DEBUG STEP1] Appel getProfileFinancialData pour ${contextId} - ${new Date().toISOString()}`)
      financialData = await getProfileFinancialData(contextId)
    } else {
      console.log(`🔍 [DEBUG STEP1] Appel getGroupFinancialData pour ${contextId} - ${new Date().toISOString()}`)
      financialData = await getGroupFinancialData(contextId)
    }

    const currentRemainingToLive = financialData.remainingToLive
    console.log(``)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯🎯🎯 ÉTAPE 1 - RESTE À VIVRE INITIAL`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`🎯 ID: ${contextId}`)
    console.log(`🎯 TIMESTAMP: ${new Date().toISOString()}`)
    console.log(``)
    console.log(`💰 RESTE À VIVRE (RAV): ${currentRemainingToLive}€`)
    console.log(``)
    console.log(`📊 DÉTAILS FINANCIERS:`)
    console.log(`   - Solde bancaire: ${financialData.bankBalance}€`)
    console.log(`   - Revenus estimés: ${financialData.totalEstimatedIncome}€`)
    console.log(`   - Revenus réels: ${financialData.totalRealIncome}€`)
    console.log(`   - Budgets estimés: ${financialData.totalEstimatedBudget}€`)
    console.log(`   - Dépenses réelles: ${financialData.totalRealExpenses}€`)
    console.log(`   - Solde disponible: ${financialData.availableBalance}€`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(``)

    // 2. Récupérer les budgets avec leurs données
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    if (budgetsError) {
      throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
    }

    // 3. Récupérer les dépenses réelles pour calculer les excédents
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    // 4. Calculer les excédents et économies pour chaque budget
    const budgetsWithSurplus = []
    const budgetsWithSavings = []
    let totalSurplusAvailable = 0
    let totalSavingsAvailable = 0

    for (const budget of budgets) {
      // Calculer le montant dépensé pour ce budget
      const spentAmount = expenses
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      // Calculer l'excédent (budget estimé - dépensé)
      const surplus = Math.max(0, budget.estimated_amount - spentAmount)

      // Récupérer les économies existantes
      const savings = budget.cumulated_savings || 0

      console.log(`📊 [Step1 Data] Budget "${budget.name}": estimé=${budget.estimated_amount}€, dépensé=${spentAmount}€, excédent=${surplus}€, économies=${savings}€`)

      // Ajouter aux listes si des montants sont disponibles
      if (surplus > 0) {
        budgetsWithSurplus.push({
          id: budget.id,
          name: budget.name,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
          surplus: surplus
        })
        totalSurplusAvailable += surplus
      }

      if (savings > 0) {
        budgetsWithSavings.push({
          id: budget.id,
          name: budget.name,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
          savings: savings
        })
        totalSavingsAvailable += savings
      }
    }

    const totalAvailable = totalSurplusAvailable + totalSavingsAvailable
    const canBalance = totalAvailable > 0

    console.log(`💎 [Step1 Data] Total économies disponibles: ${totalSavingsAvailable}€`)
    console.log(`📊 [Step1 Data] Total excédents disponibles: ${totalSurplusAvailable}€`)
    console.log(`💰 [Step1 Data] Total disponible pour équilibrage: ${totalAvailable}€`)
    console.log(`🎯 [Step1 Data] Peut équilibrer: ${canBalance}`)

    // 5. Déterminer la situation
    const isPositiveRAV = currentRemainingToLive >= 0
    const deficit = isPositiveRAV ? 0 : Math.abs(currentRemainingToLive)
    const canFullyBalance = totalAvailable >= deficit

    console.log(`🎯 [Step1 Data] Situation:`)
    console.log(`  - RAV positif: ${isPositiveRAV}`)
    console.log(`  - Déficit: ${deficit}€`)
    console.log(`  - Peut équilibrer complètement: ${canFullyBalance}`)

    // Retourner les données structurées pour l'étape 1
    return NextResponse.json({
      success: true,
      current_remaining_to_live: currentRemainingToLive,
      is_positive: isPositiveRAV,
      deficit: deficit,
      budgets_with_surplus: budgetsWithSurplus,
      budgets_with_savings: budgetsWithSavings,
      total_surplus_available: totalSurplusAvailable,
      total_savings_available: totalSavingsAvailable,
      total_available: totalAvailable,
      can_balance: canBalance,
      can_fully_balance: canFullyBalance,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,
      timestamp: Date.now() // Pour forcer le rafraîchissement
    })

  } catch (error) {
    console.error('❌ [Step1 Data] Erreur lors de la récupération des données:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}