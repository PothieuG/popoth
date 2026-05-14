import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData, type FinancialData } from '@/lib/finance'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { updateBudgetCumulatedSavings } from '@/lib/finance/budget-savings'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { balanceBodySchema } from '@/lib/schemas/recap'

/**
 * API POST /api/monthly-recap/balance
 *
 * NOUVELLE LOGIQUE PROPORTIONNELLE:
 * 1. Phase 1: Utiliser la tirelire en PREMIER (montant complet si nécessaire)
 * 2. Phase 2: Utiliser les économies (cumulated_savings) de manière PROPORTIONNELLE
 * 3. Phase 3: Utiliser les excédents (estimated - spent) de manière PROPORTIONNELLE
 * 4. Objectif: Atteindre le RAV budgétaire si possible
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context } = await parseBody(request, balanceBodySchema)

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

    // 1. Calculer le reste à vivre actuel et budgétaire
    let financialData: FinancialData
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const initialRAV = financialData.remainingToLive
    const budgetaryRAV = financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets

    // Calculer l'écart à combler
    const gap = budgetaryRAV - initialRAV

    // Si gap <= 0, pas d'équilibrage nécessaire (RAV >= RAV budgétaire)
    if (gap <= 0) {
      const surplus = Math.abs(gap)
      return NextResponse.json(
        {
          success: true,
          no_balancing_needed: true,
          initial_remaining_to_live: initialRAV,
          budgetary_remaining_to_live: budgetaryRAV,
          surplus_for_piggy_bank: surplus,
          message: `Aucun équilibrage nécessaire. Le RAV actuel (${initialRAV}€) est supérieur ou égal au RAV budgétaire (${budgetaryRAV}€).`,
        },
        { status: 200 },
      )
    }

    const deficit = gap

    // 2. Récupérer la tirelire
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: piggyBank } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .single()

    const piggyBankAmount = piggyBank?.amount || 0

    // 3. Récupérer les budgets et calculer économies/excédents disponibles
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq(ownerField, contextId)

    if (budgetsError) {
      throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
    }

    // Récupérer les dépenses réelles pour calculer les excédents
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq(ownerField, contextId)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    // 3. Analyser les budgets et préparer les données pour l'équilibrage proportionnel
    const budgetsWithSavings: Array<{
      id: string
      name: string
      savings: number
      estimated_amount: number
      spent_amount: number
    }> = []

    const budgetsWithSurplus: Array<{
      id: string
      name: string
      surplus: number
      estimated_amount: number
      spent_amount: number
    }> = []

    let totalSavingsAvailable = 0
    let totalSurplusAvailable = 0

    for (const budget of budgets) {
      const savings = budget.cumulated_savings || 0
      const spentAmount = expenses
        .filter((expense) => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      const surplus = Math.max(0, budget.estimated_amount - spentAmount)

      // Ajouter aux listes appropriées si des montants sont disponibles
      if (savings > 0) {
        budgetsWithSavings.push({
          id: budget.id,
          name: budget.name,
          savings,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
        })
        totalSavingsAvailable += savings
      }

      if (surplus > 0) {
        budgetsWithSurplus.push({
          id: budget.id,
          name: budget.name,
          surplus,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount,
        })
        totalSurplusAvailable += surplus
      }
    }

    const totalAvailable = piggyBankAmount + totalSavingsAvailable + totalSurplusAvailable

    if (totalAvailable === 0) {
      return NextResponse.json(
        { error: 'Aucune tirelire, économie ou excédent disponible pour équilibrer' },
        { status: 400 },
      )
    }

    // 4. LOGIQUE PROPORTIONNELLE: Répartir équitablement selon les disponibilités
    let remainingDeficit = deficit
    let totalUsedFromPiggyBank = 0
    let totalUsedFromSavings = 0
    let totalUsedFromSurplus = 0
    const changes: Array<{
      budget_id?: string
      budget_name?: string
      type: 'piggy_bank' | 'savings' | 'surplus'
      amount_used: number
    }> = []

    // PHASE 1: Utiliser la TIRELIRE en premier (montant complet si nécessaire)
    if (piggyBankAmount > 0 && remainingDeficit > 0) {
      const amountToUseFromPiggyBank = Math.min(remainingDeficit, piggyBankAmount)

      totalUsedFromPiggyBank = amountToUseFromPiggyBank
      remainingDeficit -= amountToUseFromPiggyBank

      changes.push({
        type: 'piggy_bank',
        amount_used: amountToUseFromPiggyBank,
      })
    }

    // PHASE 2: Utiliser les économies de manière PROPORTIONNELLE
    if (totalSavingsAvailable > 0 && remainingDeficit > 0) {
      const amountToUseFromSavings = Math.min(remainingDeficit, totalSavingsAvailable)

      for (const budget of budgetsWithSavings) {
        // Calculer la proportion de ce budget par rapport au total
        const proportion = budget.savings / totalSavingsAvailable
        const amountToUse = proportion * amountToUseFromSavings

        totalUsedFromSavings += amountToUse
        remainingDeficit -= amountToUse

        changes.push({
          budget_id: budget.id,
          budget_name: budget.name,
          type: 'savings',
          amount_used: amountToUse,
        })
      }
    }

    // PHASE 3: Utiliser les excédents de manière PROPORTIONNELLE
    if (totalSurplusAvailable > 0 && remainingDeficit > 0) {
      const amountToUseFromSurplus = Math.min(remainingDeficit, totalSurplusAvailable)

      for (const budget of budgetsWithSurplus) {
        // Calculer la proportion de ce budget par rapport au total
        const proportion = budget.surplus / totalSurplusAvailable
        const amountToUse = proportion * amountToUseFromSurplus

        totalUsedFromSurplus += amountToUse
        remainingDeficit -= amountToUse

        changes.push({
          budget_id: budget.id,
          budget_name: budget.name,
          type: 'surplus',
          amount_used: amountToUse,
        })
      }
    }

    const totalUsed = totalUsedFromPiggyBank + totalUsedFromSavings + totalUsedFromSurplus

    // Vérifier si l'équilibrage est complet ou partiel
    const remainingGap = deficit - totalUsed
    const isFullyBalanced = remainingGap <= 0.01 // Tolérance de 1 centime pour les arrondis
    let deficitMessage = ''

    if (!isFullyBalanced) {
      deficitMessage = `⚠️ Équilibrage partiel : il manque ${remainingGap.toFixed(2)}€ pour atteindre le RAV budgétaire`
    }

    // 5. NE PAS créer de revenu exceptionnel !
    // L'équilibrage consiste à consommer les économies/excédents, pas à créer de nouveaux revenus
    // Le RAV sera automatiquement ajusté par la réduction des économies et la création de dépenses

    // 5.1. Vérifier que le solde bancaire est lisible (sans le modifier)
    const { error: bankError } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)
      .single()

    if (bankError) {
      throw new Error(`Erreur récupération solde bancaire: ${bankError.message}`)
    }

    // 6. Appliquer les changements proportionnels

    // 6.1. Mettre à jour la tirelire si nécessaire (atomique via RPC)
    if (totalUsedFromPiggyBank > 0) {
      try {
        const filter =
          ownerField === 'profile_id' ? { profile_id: contextId } : { group_id: contextId }
        await updatePiggyBank(filter, -totalUsedFromPiggyBank)
      } catch (piggyBankUpdateError) {
        throw new Error(
          `Erreur mise à jour tirelire: ${piggyBankUpdateError instanceof Error ? piggyBankUpdateError.message : String(piggyBankUpdateError)}`,
        )
      }
    }

    // 6.2. Mettre à jour les budgets (atomique via RPC)
    for (const change of changes) {
      if (change.type === 'savings') {
        // Réduire les économies proportionnellement
        try {
          await updateBudgetCumulatedSavings(change.budget_id!, -change.amount_used)
        } catch (savingsError) {
          throw new Error(
            `Erreur mise à jour économies ${change.budget_name}: ${savingsError instanceof Error ? savingsError.message : String(savingsError)}`,
          )
        }
      }
      // NE PAS créer de dépense pour consommer l'excédent !
      // Les excédents (budget estimé - dépensé) ne peuvent PAS être "consommés" pour équilibrer le RAV
      // car ils font déjà partie du RAV budgétaire (revenus estimés - budgets estimés)
      // Si on crée une dépense, on réduit artificiellement le RAV, ce qui crée un cercle vicieux
    }

    // 7. Vérification finale avec les nouvelles données
    let finalFinancialData: FinancialData
    if (context === 'profile') {
      finalFinancialData = await getProfileFinancialData(contextId)
    } else {
      finalFinancialData = await getGroupFinancialData(contextId)
    }

    const finalRAV = finalFinancialData.remainingToLive

    // Construire les budgetStats finaux pour l'affichage
    const finalBudgetStats = []
    for (const budget of budgets) {
      const usedFromSavings =
        changes.find((c) => c.budget_id === budget.id && c.type === 'savings')?.amount_used || 0
      const usedFromSurplus =
        changes.find((c) => c.budget_id === budget.id && c.type === 'surplus')?.amount_used || 0

      const updatedSpentAmount =
        expenses
          .filter((expense) => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0) + usedFromSurplus

      const updatedSavings = (budget.cumulated_savings || 0) - usedFromSavings
      const finalSurplus = Math.max(0, budget.estimated_amount - updatedSpentAmount)

      finalBudgetStats.push({
        id: budget.id,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        spent_amount: updatedSpentAmount,
        difference: budget.estimated_amount - updatedSpentAmount,
        surplus: finalSurplus,
        deficit: Math.max(0, updatedSpentAmount - budget.estimated_amount),
        cumulated_savings: updatedSavings,
      })
    }

    // Attente pour garantir la cohérence de la base de données
    await new Promise((resolve) => setTimeout(resolve, 500))

    return NextResponse.json({
      success: true,
      method: 'proportional',
      original_remaining_to_live: initialRAV,
      budgetary_remaining_to_live: budgetaryRAV,
      final_remaining_to_live: finalRAV,
      target_gap: deficit,
      deficit_covered: totalUsed,
      remaining_gap: remainingGap,
      is_fully_balanced: isFullyBalanced,
      deficit_message: deficitMessage,
      piggy_bank_used: totalUsedFromPiggyBank,
      savings_used: totalUsedFromSavings,
      surplus_used: totalUsedFromSurplus,
      proportional_changes: changes,
      budget_stats: finalBudgetStats,
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
