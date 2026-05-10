import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import {
  getProfileFinancialData,
  getGroupFinancialData,
  type FinancialData,
} from '@/lib/finance'
import { withAuthAndProfile } from '@/lib/api/with-auth'

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
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const url = new URL(request.url)
    const context = url.searchParams.get('context') || 'profile'

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 },
      )
    }

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

    // 1. Récupérer le reste à vivre actuel
    let financialData: FinancialData
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const currentRemainingToLive = financialData.remainingToLive

    // 2. Récupérer les budgets avec leurs données
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    if (budgetsError) {
      throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
    }

    // 3. Récupérer les dépenses réelles (liées à un budget)
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    // 3a. Récupérer les dépenses exceptionnelles (sans budget lié)
    const { data: exceptionalExpenses } = await supabaseServer
      .from('real_expenses')
      .select('id, amount, description, expense_date')
      .eq(ownerField, contextId)
      .is('estimated_budget_id', null)

    const totalExceptionalExpenses = (exceptionalExpenses || []).reduce(
      (sum, exp) => sum + exp.amount,
      0,
    )

    // 3b. Récupérer les transferts de budgets pour ce mois
    const { data: transfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount, transfer_reason')
      .eq(ownerField, contextId)

    if (transfersError) {
      throw new Error(`Erreur récupération transferts: ${transfersError.message}`)
    }

    // Calculer le total du surplus/économies/tirelire utilisé pour combler le gap (step1 + auto-balance)
    const surplusUsedToFillGap = (transfers || [])
      .filter(
        (t) =>
          t.transfer_reason?.includes('Surplus utilisé pour combler gap') ||
          t.transfer_reason?.includes('Auto-balance via monthly recap') ||
          t.transfer_reason?.includes('auto-balance récap'),
      )
      .reduce((sum, t) => sum + t.transfer_amount, 0)

    // 4. Calculer les statistiques pour chaque budget
    const budgetStats = []
    let totalSurplus = 0
    let totalDeficit = 0

    for (const budget of budgets) {
      // Calculer le montant dépensé pour ce budget
      const spentAmount = expenses
        .filter((expense) => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      // Calculer les ajustements dus aux transferts
      // IMPORTANT: Les transferts depuis savings (économies cumulées) ne doivent PAS
      // augmenter le spent_amount du budget source, car les économies sont déjà "mises de côté"
      const transfersFrom = (transfers || [])
        .filter((t) => t.from_budget_id === budget.id)
        .filter((t) => !t.transfer_reason?.includes('économies cumulées')) // Exclure transferts depuis savings
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      // Les transferts TO incluent les transferts depuis d'autres budgets ET depuis la tirelire
      // (from_budget_id = null représente la tirelire)
      const transfersTo = (transfers || [])
        .filter((t) => t.to_budget_id === budget.id)
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      // Le spent_amount ajusté prend en compte les transferts
      // Transferts FROM (surplus uniquement) = augmente le spent (on donne de l'argent)
      // Transferts TO = diminue le spent (on reçoit de l'argent)
      const adjustedSpentAmount = spentAmount + transfersFrom - transfersTo

      // Calculer l'excédent/déficit avec le montant ajusté
      const difference = budget.estimated_amount - adjustedSpentAmount

      // Le surplus est simplement la différence positive (non dépensé ce mois)
      // NOTE: Le surplus n'est plus automatiquement transféré vers économies
      // Il reste comme "surplus" jusqu'à ce que l'utilisateur décide à l'écran 2
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
        cumulated_savings: budget.cumulated_savings || 0,
      }

      budgetStats.push(budgetStat)
      totalSurplus += surplus
      totalDeficit += deficit
    }

    // 5. Informations sur le mois actuel
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1 // 1-12
    const currentYear = currentDate.getFullYear()

    // 6. Calculer le reste à vivre budgétaire
    const budgetaryRemainingToLive =
      financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets

    // 7. Récupérer la tirelire depuis la table piggy_bank
    // Note: La tirelire est maintenant accumulée depuis l'étape 1,
    // donc on ne l'initialise plus automatiquement ici
    const { data: piggyBankData, error: piggyBankError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .maybeSingle()

    let piggyBank = 0

    if (piggyBankData && !piggyBankError) {
      // La tirelire existe déjà, on utilise le montant stocké
      piggyBank = piggyBankData.amount || 0
    } else if (!piggyBankData && !piggyBankError) {
      // Pas d'entrée trouvée, la tirelire est à 0
      // Elle sera créée lors de la validation de l'étape 1
      piggyBank = 0
    } else {
      piggyBank = 0
    }

    // 8. Calculer le détail des déficits (budgets vs autres)
    // Le gap global = différence entre RAV budgétaire et RAV actuel
    const gapGlobal = budgetaryRemainingToLive - currentRemainingToLive

    // Si gapGlobal > 0, on a un déficit global (RAV actuel < RAV budgétaire)
    // Ce déficit peut venir de:
    // - Déficits sur les budgets (dépenses > estimé)
    // - Dépenses exceptionnelles (sans budget)
    // - Différences de revenus (réels < estimés)
    // - Etc.

    // Le déficit global = gap brut MOINS le surplus utilisé pour le combler
    const deficitGlobal = Math.max(0, gapGlobal - surplusUsedToFillGap)

    const deficitBudgets = totalDeficit // Somme des déficits des budgets individuels
    const deficitAutres = Math.max(0, deficitGlobal - deficitBudgets) // La différence = autres sources

    // 9. Calculer le détail des "déficits autres"
    // Composé de: dépenses exceptionnelles + écart de revenus
    const ecartRevenus = Math.max(
      0,
      financialData.totalEstimatedIncome - financialData.totalRealIncome,
    )

    // Les "autres déficits" peuvent être décomposés en:
    const detailAutres = {
      depenses_exceptionnelles: {
        total: totalExceptionalExpenses,
        items: (exceptionalExpenses || []).map((exp) => ({
          id: exp.id,
          amount: exp.amount,
          description: exp.description || 'Dépense exceptionnelle',
          date: exp.expense_date,
        })),
      },
      ecart_revenus: ecartRevenus,
      // Note: la somme peut ne pas correspondre exactement à deficitAutres
      // car il peut y avoir d'autres facteurs (arrondis, transferts, etc.)
      autres_non_identifies: Math.max(0, deficitAutres - totalExceptionalExpenses - ecartRevenus),
    }

    // Retourner les données structurées pour l'étape 2
    return NextResponse.json({
      success: true,
      current_remaining_to_live: currentRemainingToLive,
      budgetary_remaining_to_live: budgetaryRemainingToLive,
      piggy_bank: piggyBank,
      budget_stats: budgetStats,
      month: currentMonth,
      year: currentYear,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      // Nouveau: détail des déficits
      deficit_global: deficitGlobal,
      deficit_budgets: deficitBudgets,
      deficit_autres: deficitAutres,
      detail_autres: detailAutres,
      surplus_used_to_fill_gap: surplusUsedToFillGap,
      gap_brut: gapGlobal,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,
      timestamp: Date.now(), // Pour forcer le rafraîchissement
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 },
    )
  }
})
