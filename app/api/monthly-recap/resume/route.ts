import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API GET /api/monthly-recap/resume
 *
 * Récupère les données d'un récapitulatif mensuel existant en cours:
 * 1. Vérifie s'il existe un récap en cours pour ce mois
 * 2. Si oui, retourne les données actuelles avec l'étape courante
 * 3. Si non, retourne null pour indiquer qu'un nouveau récap doit être créé
 *
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

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'profile'

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()

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

    // Vérifier s'il existe un récap pour ce mois
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: existingRecap, error: recapCheckError } = await supabaseServer
      .from('monthly_recaps')
      .select('id, current_step, completed_at, initial_remaining_to_live, final_remaining_to_live')
      .eq(ownerField, contextId)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .maybeSingle()

    if (recapCheckError) {
      console.error('❌ Erreur lors de la vérification du récap existant:', recapCheckError)
      return NextResponse.json(
        { error: 'Erreur lors de la vérification du récap existant' },
        { status: 500 }
      )
    }

    // Si aucun récap existant, retourner null
    if (!existingRecap) {
      console.log(`📊 [Resume API] Aucun récap existant trouvé pour ${context}:${contextId}`)
      return NextResponse.json({
        exists: false,
        message: 'Aucun récapitulatif en cours pour ce mois'
      })
    }

    // Si le récap est déjà complété, l'utilisateur ne devrait pas être ici
    if (existingRecap.completed_at) {
      console.log(`📊 [Resume API] Récap déjà complété pour ${context}:${contextId}`)
      return NextResponse.json({
        exists: false,
        completed: true,
        message: 'Récapitulatif déjà complété pour ce mois'
      })
    }

    console.log(`📊 [Resume API] Récap en cours trouvé pour ${context}:${contextId} à l'étape ${existingRecap.current_step}`)

    // Récupérer les données financières actuelles
    let financialData: any
    if (context === 'profile') {
      financialData = await getProfileFinancialData(profile.id)
    } else {
      financialData = await getGroupFinancialData(profile.group_id)
    }

    // Récupérer les budgets estimés
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq(ownerField, contextId)

    if (budgetsError) {
      console.error('❌ Erreur lors de la récupération des budgets:', budgetsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 }
      )
    }

    // Récupérer les dépenses réelles
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq(ownerField, contextId)

    if (expensesError) {
      console.error('❌ Erreur lors de la récupération des dépenses:', expensesError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des dépenses' },
        { status: 500 }
      )
    }

    // Récupérer les transferts existants pour ce contexte
    const { data: existingTransfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq(ownerField, contextId)

    if (transfersError) {
      console.error('❌ [Resume] Erreur lors de la récupération des transferts:', transfersError)
    }

    const transfers = transfersError ? [] : (existingTransfers || [])
    console.log(`🔍 [Resume] ${transfers.length} transferts existants trouvés`)

    // Calculer les économies/déficits des budgets pour ce mois (avec transferts)
    const budgetStats = []

    if (budgets && expenses) {
      for (const budget of budgets) {
        // Calculer le montant dépensé de base pour ce budget
        const baseSpentAmount = expenses
          .filter((expense: any) => expense.estimated_budget_id === budget.id)
          .reduce((sum: number, expense: any) => sum + parseFloat(expense.amount), 0)

        // Calculer les ajustements de transfert pour ce budget
        let transferAdjustment = 0

        // Transferts sortants (ce budget donne de l'argent) -> augmente le montant "dépensé"
        const outgoingTransfers = transfers
          .filter(transfer => transfer.from_budget_id === budget.id)
          .reduce((sum, transfer) => sum + parseFloat(transfer.transfer_amount), 0)

        // Transferts entrants (ce budget reçoit de l'argent) -> diminue le montant "dépensé"
        const incomingTransfers = transfers
          .filter(transfer => transfer.to_budget_id === budget.id)
          .reduce((sum, transfer) => sum + parseFloat(transfer.transfer_amount), 0)

        transferAdjustment = outgoingTransfers - incomingTransfers

        // Montant dépensé final avec ajustements de transfert
        const adjustedSpentAmount = baseSpentAmount + transferAdjustment

        const estimated = parseFloat(budget.estimated_amount)
        const difference = estimated - adjustedSpentAmount

        const budgetStat = {
          id: budget.id,
          name: budget.name,
          estimated_amount: estimated,
          spent_amount: adjustedSpentAmount, // Montant dépensé avec transferts
          carryover_spent_amount: 0, // Plus utilisé
          total_spent_amount: adjustedSpentAmount,
          difference, // Positif = économie, Négatif = déficit
          surplus: Math.max(0, difference), // Économies (budget - dépenses)
          deficit: Math.max(0, -difference), // Déficit (dépenses - budget)
          cumulated_savings: budget.cumulated_savings || 0 // Économies cumulées existantes
        }

        budgetStats.push(budgetStat)
      }
    }

    // Calculer les totaux généraux
    const totalSurplus = budgetStats.reduce((sum, budget) => sum + budget.surplus, 0)
    const totalDeficit = budgetStats.reduce((sum, budget) => sum + budget.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    // Créer une session_id simple pour le suivi de page
    const sessionId = `${context}_${contextId}_${currentMonth}_${currentYear}_${Date.now()}`

    console.log(`📊 [Resume API] Données récupérées pour ${context}:${contextId}`)
    console.log(`📊 [Resume API] Reste à vivre actuel: ${financialData.remainingToLive}€`)
    console.log(`📊 [Resume API] Étape courante: ${existingRecap.current_step}`)

    // Retourner les données pour reprendre le récap
    return NextResponse.json({
      exists: true,
      session_id: sessionId,
      current_step: existingRecap.current_step,
      current_remaining_to_live: financialData.remainingToLive,
      budget_stats: budgetStats,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      general_ratio: generalRatio,
      context,
      month: currentMonth,
      year: currentYear,
      user_name: `${profile.first_name} ${profile.last_name}`,
      recap_id: existingRecap.id
    })

  } catch (error) {
    console.error('❌ Erreur lors de la récupération du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}