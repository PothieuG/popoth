import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { refreshRecapQuerySchema } from '@/lib/schemas/recap-legacy'
import { logger } from '@/lib/logger'

/**
 * API GET /api/monthly-recap/refresh
 *
 * Rafraîchit les données du récapitulatif mensuel avec les calculs en temps réel
 * Query: {
 *   context: 'profile' | 'group',
 *   session_id: string
 * }
 */
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context, session_id: sessionId } = parseQuery(request, refreshRecapQuerySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!

    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()

    // Récupérer les données en temps réel (plus de snapshot)
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq(ownerField, contextId)

    if (budgetsError) {
      logger.error('Erreur lors de la récupération des budgets:', budgetsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 },
      )
    }

    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq(ownerField, contextId)

    if (expensesError) {
      logger.error('Erreur lors de la récupération des dépenses:', expensesError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des dépenses' },
        { status: 500 },
      )
    }

    // Récupérer les transferts (seule donnée qui change après le début du récap)
    const { data: transfersData, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq(ownerField, contextId)

    if (transfersError) {
      logger.error('[Refresh] Erreur lors de la récupération des transferts:', transfersError)
    }

    // Si la récupération des transferts échoue, continuer sans transferts
    const transfers = transfersError ? [] : transfersData || []

    // Recalculer les statistiques des budgets en temps réel
    const budgetStats = []

    for (const budget of budgets) {
      // Calculer le montant dépensé de base pour ce budget (données temps réel)
      const baseSpentAmount = expenses
        .filter((expense) => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      // Calculer les ajustements de transfert pour ce budget
      let transferAdjustment = 0

      // Transferts sortants (ce budget donne de l'argent) -> augmente le montant "dépensé"
      const outgoingTransfers = transfers
        .filter((transfer) => transfer.from_budget_id === budget.id)
        .reduce((sum, transfer) => sum + transfer.transfer_amount, 0)

      // Transferts entrants (ce budget reçoit de l'argent) -> diminue le montant "dépensé"
      const incomingTransfers = transfers
        .filter((transfer) => transfer.to_budget_id === budget.id)
        .reduce((sum, transfer) => sum + transfer.transfer_amount, 0)

      transferAdjustment = outgoingTransfers - incomingTransfers

      // Montant dépensé final avec ajustements de transfert
      const adjustedSpentAmount = baseSpentAmount + transferAdjustment

      const estimated = budget.estimated_amount
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
        cumulated_savings: 0, // Recalculé ailleurs si nécessaire
      }

      budgetStats.push(budgetStat)
    }

    // Calculer les totaux généraux
    const totalSurplus = budgetStats.reduce((sum, budget) => sum + budget.surplus, 0)
    const totalDeficit = budgetStats.reduce((sum, budget) => sum + budget.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    // Recalculer le remaining_to_live en temps réel
    // Pour l'instant, on met 0 car on se concentre sur les transferts
    const currentRemainingToLive = 0

    // Retourner les données rafraîchies avec la même structure que l'initialisation
    return NextResponse.json({
      success: true,
      session_id: sessionId,
      current_remaining_to_live: currentRemainingToLive,
      budget_stats: budgetStats,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      general_ratio: generalRatio,
      context,
      month: currentMonth,
      year: currentYear,
      user_name: `${profile.first_name} ${profile.last_name}`,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
