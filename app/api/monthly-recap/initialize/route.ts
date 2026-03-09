import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'
import { createFullDatabaseSnapshot } from '@/lib/database-snapshot'

/**
 * API POST /api/monthly-recap/initialize
 *
 * Initialise un nouveau récapitulatif mensuel:
 * 1. Crée un snapshot de sécurité des données actuelles
 * 2. Calcule les économies/déficits des budgets
 * 3. Retourne les données nécessaires pour l'étape 1
 *
 * Body: { context: 'profile' | 'group' }
 */
export async function POST(request: NextRequest) {
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { context = 'profile' } = body

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
    let financialData: any

    if (context === 'profile') {
      contextId = profile.id
      financialData = await getProfileFinancialData(profile.id)
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 400 }
        )
      }
      contextId = profile.group_id
      financialData = await getGroupFinancialData(profile.group_id)
    }

    // Vérifier s'il n'y a pas déjà un récap pour ce mois
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: existingRecaps, error: recapCheckError } = await supabaseServer
      .from('monthly_recaps')
      .select('id')
      .eq(ownerField, contextId)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .limit(1)

    if (recapCheckError && recapCheckError.code !== 'PGRST116') {
      console.error('❌ Erreur lors de la vérification des récaps existants:', recapCheckError)
      return NextResponse.json(
        { error: 'Erreur lors de la vérification des récaps existants' },
        { status: 500 }
      )
    }

    if (existingRecaps && existingRecaps.length > 0) {
      return NextResponse.json(
        { error: 'Un récapitulatif existe déjà pour ce mois' },
        { status: 409 }
      )
    }

    // 0. Créer un snapshot complet de la DB avant toute modification
    console.log(`📸 [Monthly Recap] Création du snapshot complet avant recap pour ${context}:${contextId}`)
    const { snapshotId, error: snapshotError } = await createFullDatabaseSnapshot(
      contextId,
      context,
      currentMonth,
      currentYear
    )

    if (snapshotError) {
      console.error(`❌ [Monthly Recap] Erreur création snapshot: ${snapshotError}`)
      return NextResponse.json(
        { error: 'Erreur lors de la création du snapshot de sécurité' },
        { status: 500 }
      )
    }

    console.log(`📸 [Monthly Recap] Snapshot créé: ${snapshotId}`)

    // 1. Récupérer les données actuelles en temps réel
    console.log(`📊 [Monthly Recap] Récupération des données en temps réel pour ${context}:${contextId}`)

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

    // 2. Récupérer les transferts existants pour ce contexte
    const { data: existingTransfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq(ownerField, contextId)

    if (transfersError) {
      console.error('❌ [Initialize] Erreur lors de la récupération des transferts:', transfersError)
    }

    const transfers = transfersError ? [] : (existingTransfers || [])
    console.log(`🔍 [Initialize] ${transfers.length} transferts existants trouvés`)

    // 3. Calculer les économies/déficits des budgets pour ce mois (avec transferts)
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

        console.log(`🔍 [Initialize Debug] Budget "${budget.name}":`)
        console.log(`  - baseSpentAmount: ${baseSpentAmount}€`)
        console.log(`  - outgoingTransfers: ${outgoingTransfers}€`)
        console.log(`  - incomingTransfers: ${incomingTransfers}€`)
        console.log(`  - transferAdjustment: ${transferAdjustment}€`)
        console.log(`  - adjustedSpentAmount: ${adjustedSpentAmount}€`)
        console.log(`  - estimated: ${estimated}€`)
        console.log(`  - difference: ${estimated} - ${adjustedSpentAmount} = ${difference}€`)
        console.log(`  - surplus: ${Math.max(0, difference)}€`)
        console.log(`  - deficit: ${Math.max(0, -difference)}€`)

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

    console.log(`📊 [Monthly Recap] Données calculées pour ${context}:${contextId}`)
    console.log(`📊 [Monthly Recap] Reste à vivre actuel: ${financialData.remainingToLive}€`)
    console.log(`📊 [Monthly Recap] Surplus total: ${totalSurplus}€, Déficit total: ${totalDeficit}€`)

    // Créer une session_id simple pour le suivi de page
    const sessionId = `${context}_${contextId}_${currentMonth}_${currentYear}_${Date.now()}`

    // Retourner les données pour l'étape 1
    return NextResponse.json({
      success: true,
      session_id: sessionId,
      snapshot_id: snapshotId,
      current_remaining_to_live: financialData.remainingToLive,
      budget_stats: budgetStats,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      general_ratio: generalRatio,
      context,
      month: currentMonth,
      year: currentYear,
      user_name: `${profile.first_name} ${profile.last_name}`
    })

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}