import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { calculateBudgetStatistics } from '@/lib/budget-calculations'

/**
 * API GET /api/debug/recap-data
 *
 * Endpoint de debug pour comparer les données en base avec l'affichage
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

    const contextId = context === 'profile' ? profile.id : profile.group_id

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    console.log(`🔍 [Debug] Analyse des données pour ${context}:${contextId}`)

    // 1. Récupérer les budgets estimés
    const { data: estimatedBudgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

    // 2. Récupérer les dépenses réelles
    const { data: realExpenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

    // 3. Récupérer les transferts
    const { data: transfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('*')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

    // 4. Récupérer le dernier snapshot actif
    const { data: activeSnapshot, error: snapshotError } = await supabaseServer
      .from('recap_snapshots')
      .select('*')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Calculer les statistiques de budget manuellement
    const budgetStats = []

    if (estimatedBudgets) {
      for (const budget of estimatedBudgets) {
        // Dépenses de base depuis la table real_expenses
        const baseSpent = realExpenses
          ?.filter(expense => expense.estimated_budget_id === budget.id)
          ?.reduce((sum, expense) => sum + parseFloat(expense.amount), 0) || 0

        // Ajustements de transfert
        const outgoingTransfers = transfers
          ?.filter(transfer => transfer.from_budget_id === budget.id)
          ?.reduce((sum, transfer) => sum + parseFloat(transfer.transfer_amount), 0) || 0

        const incomingTransfers = transfers
          ?.filter(transfer => transfer.to_budget_id === budget.id)
          ?.reduce((sum, transfer) => sum + parseFloat(transfer.transfer_amount), 0) || 0

        const transferAdjustment = outgoingTransfers - incomingTransfers
        const finalSpent = baseSpent + transferAdjustment
        const estimated = parseFloat(budget.estimated_amount)
        const difference = estimated - finalSpent

        budgetStats.push({
          id: budget.id,
          name: budget.name,
          estimated_amount: estimated,
          base_spent: baseSpent,
          outgoing_transfers: outgoingTransfers,
          incoming_transfers: incomingTransfers,
          transfer_adjustment: transferAdjustment,
          final_spent: finalSpent,
          difference: difference,
          surplus: Math.max(0, difference),
          deficit: Math.max(0, -difference)
        })
      }
    }

    // SINGLE SOURCE OF TRUTH - Utilisation de la fonction centralisée
    const { totalSurplus, totalDeficit } = calculateBudgetStatistics(budgetStats)

    return NextResponse.json({
      success: true,
      context,
      contextId,
      rawData: {
        estimatedBudgets: estimatedBudgets || [],
        realExpenses: realExpenses || [],
        transfers: transfers || [],
        activeSnapshot: activeSnapshot || null
      },
      calculatedStats: {
        budgetStats,
        totalSurplus,
        totalDeficit,
        generalRatio: totalSurplus - totalDeficit
      },
      snapshotData: activeSnapshot?.snapshot_data || null,
      errors: {
        budgetsError,
        expensesError,
        transfersError,
        snapshotError
      }
    })

  } catch (error) {
    console.error('❌ Erreur lors du debug recap data:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}