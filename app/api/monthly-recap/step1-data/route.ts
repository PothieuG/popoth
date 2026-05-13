import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData, type FinancialData } from '@/lib/finance'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'

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
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)

    // Déterminer l'ID du contexte
    let contextId: string
    if (context === 'profile') {
      contextId = profile.id
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait partie d'aucun groupe" },
          { status: 400 },
        )
      }
      contextId = profile.group_id
    }

    // 1. Récupérer le reste à vivre actuel DIRECTEMENT depuis les calculs financiers
    let financialData: FinancialData
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const currentRemainingToLive = financialData.remainingToLive

    // 2. Récupérer le montant de la tirelire depuis la base de données
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: piggyBank } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .single()

    const piggyBankAmount = piggyBank?.amount || 0

    // 3. Récupérer les budgets avec leurs données
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    if (budgetsError) {
      throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
    }

    // 4. Récupérer les dépenses réelles pour calculer les excédents
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    // 5. Calculer les excédents et économies pour chaque budget
    const budgetsWithSurplus = []
    const budgetsWithSavings = []
    let totalSurplusAvailable = 0
    let totalSavingsAvailable = 0

    for (const budget of budgets) {
      // Calculer le montant dépensé pour ce budget
      const spentAmount = expenses
        .filter((expense) => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      // Calculer l'excédent (budget estimé - dépensé)
      const surplus = Math.max(0, budget.estimated_amount - spentAmount)

      // Récupérer les économies existantes
      const savings = budget.cumulated_savings || 0

      // Ajouter aux listes si des montants sont disponibles
      if (surplus > 0) {
        budgetsWithSurplus.push({
          id: budget.id,
          name: budget.name,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
          surplus: surplus,
        })
        totalSurplusAvailable += surplus
      }

      if (savings > 0) {
        budgetsWithSavings.push({
          id: budget.id,
          name: budget.name,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
          savings: savings,
        })
        totalSavingsAvailable += savings
      }
    }

    const totalAvailable = piggyBankAmount + totalSavingsAvailable + totalSurplusAvailable
    const canBalance = totalAvailable > 0

    // 5. Déterminer la situation
    const isPositiveRAV = currentRemainingToLive >= 0
    const deficit = isPositiveRAV ? 0 : Math.abs(currentRemainingToLive)
    const canFullyBalance = totalAvailable >= deficit

    // 6. Calculer le reste à vivre budgétaire (simple différence revenus estimés - budgets estimés)
    const budgetaryRemainingToLive =
      financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets

    // 7. Le reste à vivre normal est le currentRemainingToLive (avec toutes les dépenses exceptionnelles, etc.)
    const normalRemainingToLive = currentRemainingToLive

    // 8. Calculer le reste à vivre factuel (écart entre normal et budgétaire)
    const factualRemainingToLive = normalRemainingToLive - budgetaryRemainingToLive

    // 9. Déterminer si l'équilibrage est nécessaire
    // LOGIQUE CIBLE: On veut atteindre le RAV budgétaire, pas 0€
    // Si RAV normal < RAV budgétaire → il faut combler l'écart (équilibrage nécessaire)
    // Si RAV normal >= RAV budgétaire → surplus disponible pour l'étape suivante
    const needsBalancing = normalRemainingToLive < budgetaryRemainingToLive
    const balanceAmount = needsBalancing ? budgetaryRemainingToLive - normalRemainingToLive : 0
    const surplus = !needsBalancing ? normalRemainingToLive - budgetaryRemainingToLive : 0

    // Retourner les données structurées pour l'étape 1
    return NextResponse.json({
      success: true,
      current_remaining_to_live: currentRemainingToLive,
      budgetary_remaining_to_live: budgetaryRemainingToLive,
      normal_remaining_to_live: normalRemainingToLive,
      factual_remaining_to_live: factualRemainingToLive,
      piggy_bank_amount: piggyBankAmount,
      needs_balancing: needsBalancing,
      balance_amount: balanceAmount,
      surplus_for_next_step: surplus,
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
      timestamp: Date.now(), // Pour forcer le rafraîchissement
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 },
    )
  }
})
