import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API GET /api/monthly-recap/step2-data
 *
 * Récupère les données nécessaires pour l'étape 2 du monthly recap
 * CALCUL EN TEMPS RÉEL - Prend en compte les transferts entre budgets
 *
 * LOGIQUE DE CALCUL DES SURPLUS/DÉFICITS :
 * 1. spentAmount = SUM(real_expenses pour ce budget)
 * 2. transfersFrom = SUM(budget_transfers FROM ce budget)
 * 3. transfersTo = SUM(budget_transfers TO ce budget)
 * 4. adjustedSpent = spentAmount + transfersFrom - transfersTo
 * 5. surplus/déficit calculé depuis adjustedSpent
 *
 * Cela permet de voir immédiatement l'effet des transferts sur les budgets
 *
 * Query: { context: 'profile' | 'group' }
 *
 * Retourne:
 * - current_remaining_to_live: nombre
 * - budget_stats: Array avec statistiques complètes (incluant ajustements)
 * - month: nombre (1-12)
 * - year: nombre
 * - total_surplus: nombre (après transferts)
 * - total_deficit: nombre (après transferts)
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

    console.log(`🔍 [DEBUG STEP2] ====================================`)
    console.log(`🔍 [DEBUG STEP2] ÉTAPE 2 - RÉCUPÉRATION RAV POUR ${context.toUpperCase()}:${contextId}`)
    console.log(`🔍 [DEBUG STEP2] TIMESTAMP: ${new Date().toISOString()}`)
    console.log(`🔍 [DEBUG STEP2] ====================================`)

    // 1. Récupérer le reste à vivre actuel
    let financialData: any
    if (context === 'profile') {
      console.log(`🔍 [DEBUG STEP2] Appel getProfileFinancialData pour ${contextId} - ${new Date().toISOString()}`)
      financialData = await getProfileFinancialData(contextId)
    } else {
      console.log(`🔍 [DEBUG STEP2] Appel getGroupFinancialData pour ${contextId} - ${new Date().toISOString()}`)
      financialData = await getGroupFinancialData(contextId)
    }

    const currentRemainingToLive = financialData.remainingToLive
    console.log(``)
    console.log(`📊📊📊 ========================================================`)
    console.log(`📊📊📊 ÉTAPE 2 - RESTE À VIVRE`)
    console.log(`📊📊📊 ========================================================`)
    console.log(`📊 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`📊 ID: ${contextId}`)
    console.log(`📊 TIMESTAMP: ${new Date().toISOString()}`)
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
    console.log(`📊📊📊 ========================================================`)
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

    // 3. Récupérer les dépenses réelles
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    // 3b. Récupérer les transferts de budgets pour ce mois
    const { data: transfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount, transfer_reason')
      .eq(ownerField, contextId)

    if (transfersError) {
      throw new Error(`Erreur récupération transferts: ${transfersError.message}`)
    }

    console.log(`🔄 [Step2 Data] ${transfers?.length || 0} transferts trouvés`)

    // 4. Calculer les statistiques pour chaque budget
    const budgetStats = []
    let totalSurplus = 0
    let totalDeficit = 0

    for (const budget of budgets) {
      // Calculer le montant dépensé pour ce budget
      const spentAmount = expenses
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      // Calculer les ajustements dus aux transferts
      // IMPORTANT: Les transferts depuis savings (économies cumulées) ne doivent PAS
      // augmenter le spent_amount du budget source, car les économies sont déjà "mises de côté"
      const transfersFrom = (transfers || [])
        .filter(t => t.from_budget_id === budget.id)
        .filter(t => !t.transfer_reason?.includes('économies cumulées')) // Exclure transferts depuis savings
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      const transfersTo = (transfers || [])
        .filter(t => t.to_budget_id === budget.id)
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      // Le spent_amount ajusté prend en compte les transferts
      // Transferts FROM (surplus uniquement) = augmente le spent (on donne de l'argent)
      // Transferts TO = diminue le spent (on reçoit de l'argent)
      const adjustedSpentAmount = spentAmount + transfersFrom - transfersTo

      // Calculer l'excédent/déficit avec le montant ajusté
      const difference = budget.estimated_amount - adjustedSpentAmount
      const surplus = Math.max(0, difference)
      const deficit = Math.max(0, -difference)

      const budgetStat = {
        id: budget.id,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        spent_amount: adjustedSpentAmount,
        difference: difference,
        surplus: surplus,
        deficit: deficit,
        cumulated_savings: budget.cumulated_savings || 0
      }

      budgetStats.push(budgetStat)
      totalSurplus += surplus
      totalDeficit += deficit

      console.log(`📊 [Step2 Data] Budget "${budget.name}": estimé=${budget.estimated_amount}€, dépensé=${spentAmount}€, transferts (from: ${transfersFrom}€, to: ${transfersTo}€), ajusté=${adjustedSpentAmount}€, différence=${difference}€`)
    }

    // 5. Informations sur le mois actuel
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1 // 1-12
    const currentYear = currentDate.getFullYear()

    console.log(`💎 [Step2 Data] Total surplus: ${totalSurplus}€`)
    console.log(`📉 [Step2 Data] Total deficit: ${totalDeficit}€`)

    // Retourner les données structurées pour l'étape 2
    return NextResponse.json({
      success: true,
      current_remaining_to_live: currentRemainingToLive,
      budget_stats: budgetStats,
      month: currentMonth,
      year: currentYear,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,
      timestamp: Date.now() // Pour forcer le rafraîchissement
    })

  } catch (error) {
    console.error('❌ [Step2 Data] Erreur lors de la récupération des données:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}