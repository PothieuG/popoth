import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API POST /api/monthly-recap/balance
 *
 * NOUVELLE LOGIQUE PROPORTIONNELLE:
 * 1. Phase 1: Utiliser toutes les économies (current_savings) de manière PROPORTIONNELLE
 * 2. Phase 2: Utiliser tous les excédents (estimated - spent) de manière PROPORTIONNELLE
 * 3. Objectif: Remettre le reste à vivre à 0€ si possible
 * 4. Ajustement du solde bancaire pour refléter les changements
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

    const { context } = await request.json()

    // Validation des paramètres
    if (!context || !['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
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

    console.log(`🎯 [Balance API] Début équilibrage PROPORTIONNEL pour ${context}:${contextId}`)

    // 1. Calculer le reste à vivre actuel et budgétaire
    let financialData: any
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const initialRAV = financialData.remainingToLive
    const budgetaryRAV = financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets

    console.log(`💰 [Balance API] RAV initial: ${initialRAV}€`)
    console.log(`💰 [Balance API] RAV budgétaire (CIBLE): ${budgetaryRAV}€`)

    // Calculer l'écart à combler
    const gap = budgetaryRAV - initialRAV
    console.log(`📊 [Balance API] Écart à combler: ${gap}€`)

    // Si gap <= 0, pas d'équilibrage nécessaire (RAV >= RAV budgétaire)
    if (gap <= 0) {
      const surplus = Math.abs(gap)
      console.log(`✅ [Balance API] Pas d'équilibrage nécessaire. Surplus de ${surplus}€ disponible pour la tirelire.`)
      return NextResponse.json(
        {
          success: true,
          no_balancing_needed: true,
          initial_remaining_to_live: initialRAV,
          budgetary_remaining_to_live: budgetaryRAV,
          surplus_for_piggy_bank: surplus,
          message: `Aucun équilibrage nécessaire. Le RAV actuel (${initialRAV}€) est supérieur ou égal au RAV budgétaire (${budgetaryRAV}€).`
        },
        { status: 200 }
      )
    }

    const deficit = gap
    console.log(`📉 [Balance API] Déficit à combler pour atteindre le RAV budgétaire: ${deficit}€`)

    // 2. Récupérer les budgets et calculer économies/excédents disponibles
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
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
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      const surplus = Math.max(0, budget.estimated_amount - spentAmount)

      // Ajouter aux listes appropriées si des montants sont disponibles
      if (savings > 0) {
        budgetsWithSavings.push({
          id: budget.id,
          name: budget.name,
          savings,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount
        })
        totalSavingsAvailable += savings
      }

      if (surplus > 0) {
        budgetsWithSurplus.push({
          id: budget.id,
          name: budget.name,
          surplus,
          estimated_amount: budget.estimated_amount,
          spent_amount: spentAmount
        })
        totalSurplusAvailable += surplus
      }

      console.log(`📊 [Balance API] Budget "${budget.name}": ${savings}€ économies, ${surplus}€ excédent`)
    }

    console.log(`💎 [Balance API] Total économies disponibles: ${totalSavingsAvailable}€`)
    console.log(`📊 [Balance API] Total excédents disponibles: ${totalSurplusAvailable}€`)

    const totalAvailable = totalSavingsAvailable + totalSurplusAvailable
    console.log(`💰 [Balance API] Total disponible: ${totalAvailable}€`)

    if (totalAvailable === 0) {
      return NextResponse.json(
        { error: 'Aucune économie ou excédent disponible pour équilibrer' },
        { status: 400 }
      )
    }

    // 4. LOGIQUE PROPORTIONNELLE: Répartir équitablement selon les disponibilités
    let remainingDeficit = deficit
    let totalUsedFromSavings = 0
    let totalUsedFromSurplus = 0
    const changes: Array<{
      budget_id: string
      budget_name: string
      type: 'savings' | 'surplus'
      amount_used: number
    }> = []

    // PHASE 1: Utiliser les économies de manière PROPORTIONNELLE
    if (totalSavingsAvailable > 0 && remainingDeficit > 0) {
      console.log(`🔄 [Balance API] Phase 1: Utilisation proportionnelle des économies`)

      const amountToUseFromSavings = Math.min(remainingDeficit, totalSavingsAvailable)
      console.log(`💎 [Balance API] Montant à utiliser des économies: ${amountToUseFromSavings}€ sur ${totalSavingsAvailable}€ disponibles`)

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
          amount_used: amountToUse
        })

        console.log(`  💎 ${budget.name}: -${amountToUse.toFixed(2)}€ économies (${(proportion * 100).toFixed(1)}% du total)`)
      }
    }

    // PHASE 2: Utiliser les excédents de manière PROPORTIONNELLE
    if (totalSurplusAvailable > 0 && remainingDeficit > 0) {
      console.log(`🔄 [Balance API] Phase 2: Utilisation proportionnelle des excédents`)

      const amountToUseFromSurplus = Math.min(remainingDeficit, totalSurplusAvailable)
      console.log(`📊 [Balance API] Montant à utiliser des excédents: ${amountToUseFromSurplus}€ sur ${totalSurplusAvailable}€ disponibles`)

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
          amount_used: amountToUse
        })

        console.log(`  📊 ${budget.name}: -${amountToUse.toFixed(2)}€ excédent (${(proportion * 100).toFixed(1)}% du total)`)
      }
    }

    const totalUsed = totalUsedFromSavings + totalUsedFromSurplus
    console.log(`✅ [Balance API] Total récupéré: ${totalUsed.toFixed(2)}€ (${totalUsedFromSavings.toFixed(2)}€ économies + ${totalUsedFromSurplus.toFixed(2)}€ excédents)`)

    // Vérifier si l'équilibrage est complet ou partiel
    const remainingGap = deficit - totalUsed
    const isFullyBalanced = remainingGap <= 0.01 // Tolérance de 1 centime pour les arrondis
    let deficitMessage = ''

    if (!isFullyBalanced) {
      deficitMessage = `⚠️ Équilibrage partiel : il manque ${remainingGap.toFixed(2)}€ pour atteindre le RAV budgétaire`
      console.log(`⚠️ [Balance API] ${deficitMessage}`)
    } else {
      console.log(`✅ [Balance API] Équilibrage complet : le RAV budgétaire sera atteint`)
    }

    // 5. Créer une entrée de revenu exceptionnel pour refléter l'équilibrage dans le RAV
    console.log(`💾 [Balance API] Création d'une entrée de revenu exceptionnel pour l'équilibrage`)

    // 5.1. Récupérer le solde bancaire actuel pour les logs
    const { data: currentBankBalance, error: bankError } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)
      .single()

    if (bankError) {
      throw new Error(`Erreur récupération solde bancaire: ${bankError.message}`)
    }

    const currentBalance = currentBankBalance?.balance || 0
    const newBalance = currentBalance + totalUsed

    console.log(`💰 [Balance API] Solde bancaire sera: ${currentBalance}€ → ${newBalance.toFixed(2)}€ (+${totalUsed.toFixed(2)}€)`)

    // 5.2. Créer une entrée de revenu exceptionnel pour que le RAV reflète l'équilibrage
    const { error: exceptionalIncomeError } = await supabaseServer
      .from('real_income_entries')
      .insert({
        [ownerField]: contextId,
        amount: totalUsed,
        description: `Équilibrage RAV proportionnel - Récupération ${totalUsedFromSavings.toFixed(2)}€ économies + ${totalUsedFromSurplus.toFixed(2)}€ excédents`,
        entry_date: new Date().toISOString().split('T')[0],
        is_exceptional: true,
        estimated_income_id: null
      })

    if (exceptionalIncomeError) {
      throw new Error(`Erreur création revenu exceptionnel: ${exceptionalIncomeError.message}`)
    }

    console.log(`✅ [Balance API] Revenu exceptionnel créé: +${totalUsed.toFixed(2)}€`)

    // 5.3. Mettre à jour le solde bancaire
    const { error: updateBankError } = await supabaseServer
      .from('bank_balances')
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

    if (updateBankError) {
      throw new Error(`Erreur mise à jour solde bancaire: ${updateBankError.message}`)
    }

    console.log(`✅ [Balance API] Solde bancaire mis à jour avec succès`)

    // 6. Appliquer les changements proportionnels aux budgets
    console.log(`🔄 [Balance API] Application des changements proportionnels`)

    for (const change of changes) {
      if (change.type === 'savings') {
        // Réduire les économies proportionnellement
        const originalBudget = budgetsWithSavings.find(b => b.id === change.budget_id)!
        const newSavings = originalBudget.savings - change.amount_used

        const { error: savingsError } = await supabaseServer
          .from('estimated_budgets')
          .update({
            cumulated_savings: newSavings,
            updated_at: new Date().toISOString()
          })
          .eq('id', change.budget_id)

        if (savingsError) {
          throw new Error(`Erreur mise à jour économies ${change.budget_name}: ${savingsError.message}`)
        }

        console.log(`✅ Économies réduites pour ${change.budget_name}: ${originalBudget.savings}€ → ${newSavings.toFixed(2)}€`)

      } else {
        // Créer une dépense pour consommer l'excédent proportionnellement
        const { error: expenseError } = await supabaseServer
          .from('real_expenses')
          .insert({
            [ownerField]: contextId,
            estimated_budget_id: change.budget_id,
            amount: change.amount_used,
            description: `Équilibrage RAV proportionnel - Excédent utilisé ${change.budget_name}`,
            expense_date: new Date().toISOString().split('T')[0],
            is_exceptional: false
          })

        if (expenseError) {
          throw new Error(`Erreur création dépense ${change.budget_name}: ${expenseError.message}`)
        }

        console.log(`✅ Excédent consommé pour ${change.budget_name}: +${change.amount_used.toFixed(2)}€ dépense`)
      }
    }

    // 7. Vérification finale avec les nouvelles données
    let finalFinancialData: any
    if (context === 'profile') {
      finalFinancialData = await getProfileFinancialData(contextId)
    } else {
      finalFinancialData = await getGroupFinancialData(contextId)
    }

    const finalRAV = finalFinancialData.remainingToLive
    const finalAvailableBalance = finalFinancialData.availableBalance

    console.log(``)
    console.log(`🔄🔄🔄 ========================================================`)
    console.log(`🔄🔄🔄 APRÈS RÉÉQUILIBRAGE - RESTE À VIVRE`)
    console.log(`🔄🔄🔄 ========================================================`)
    console.log(`🔄 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`🔄 ID: ${contextId}`)
    console.log(`🔄 TIMESTAMP: ${new Date().toISOString()}`)
    console.log(``)
    console.log(`💰 RESTE À VIVRE INITIAL: ${initialRAV}€`)
    console.log(`💰 RESTE À VIVRE APRÈS RÉÉQUILIBRAGE: ${finalRAV}€`)
    console.log(`📈 CHANGEMENT: ${(finalRAV - initialRAV) > 0 ? '+' : ''}${(finalRAV - initialRAV).toFixed(2)}€`)
    console.log(``)
    console.log(`💵 RÉCUPÉRÉ:`)
    console.log(`   - Économies utilisées: ${totalUsedFromSavings.toFixed(2)}€`)
    console.log(`   - Excédents utilisés: ${totalUsedFromSurplus.toFixed(2)}€`)
    console.log(`   - TOTAL RÉCUPÉRÉ: ${totalUsed.toFixed(2)}€`)
    console.log(``)
    console.log(`🏦 SOLDE BANCAIRE:`)
    console.log(`   - Initial: ${currentBalance}€`)
    console.log(`   - Final: ${newBalance.toFixed(2)}€`)
    console.log(`   - Changement: +${totalUsed.toFixed(2)}€`)
    console.log(``)
    console.log(`✅ VÉRIFICATION MATHÉMATIQUE:`)
    console.log(`   - Attendu: ${initialRAV}€ + ${totalUsed.toFixed(2)}€ = ${(initialRAV + totalUsed).toFixed(2)}€`)
    console.log(`   - Réel: ${finalRAV}€`)
    console.log(`   - Match: ${Math.abs(finalRAV - (initialRAV + totalUsed)) < 0.01 ? '✅ OUI' : '❌ NON'}`)
    console.log(`🔄🔄🔄 ========================================================`)
    console.log(``)

    // Construire les budgetStats finaux pour l'affichage
    const finalBudgetStats = []
    for (const budget of budgets) {
      const usedFromSavings = changes.find(c => c.budget_id === budget.id && c.type === 'savings')?.amount_used || 0
      const usedFromSurplus = changes.find(c => c.budget_id === budget.id && c.type === 'surplus')?.amount_used || 0

      const updatedSpentAmount = expenses
        .filter(expense => expense.estimated_budget_id === budget.id)
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
        cumulated_savings: updatedSavings
      })
    }

    console.log(`✅ [Balance API] Équilibrage proportionnel terminé avec succès`)

    // Attente pour garantir la cohérence de la base de données
    console.log(`🔄 [Balance API] Attente pour garantir la cohérence de la base de données...`)
    await new Promise(resolve => setTimeout(resolve, 500))

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
      savings_used: totalUsedFromSavings,
      surplus_used: totalUsedFromSurplus,
      bank_balance_increase: totalUsed,
      proportional_changes: changes,
      budget_stats: finalBudgetStats
    })

  } catch (error) {
    console.error('❌ [Balance API] Erreur lors de l\'équilibrage proportionnel:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}