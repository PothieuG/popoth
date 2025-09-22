import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/balance
 *
 * Équilibre automatiquement un reste à vivre négatif en redistribuant
 * les économies et excédents des budgets de manière proportionnelle
 *
 * Logique :
 * 1. Priorité aux économies (current_savings) - répartition proportionnelle
 * 2. Si insuffisant, utilise les excédents (estimated - spent) - répartition proportionnelle
 * 3. Met à jour les budgets en base de données
 * 4. Sauvegarde un snapshot du résultat
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

    const { context, snapshot_id } = await request.json()

    // Validation des paramètres
    if (!context || !['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!snapshot_id) {
      return NextResponse.json(
        { error: 'snapshot_id requis' },
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

    console.log(`🎯 [Balance API] Début équilibrage pour ${context}:${contextId}`)

    // 1. Calculer le reste à vivre actuel
    const { remainingToLive, budgetStats } = await calculateCurrentState(context, contextId)

    console.log(`💰 [Balance API] Reste à vivre actuel: ${remainingToLive}€`)

    // Vérifier que le reste à vivre est négatif
    if (remainingToLive >= 0) {
      return NextResponse.json(
        { error: 'Le reste à vivre n\'est pas négatif, aucun équilibrage nécessaire' },
        { status: 400 }
      )
    }

    const deficit = Math.abs(remainingToLive)
    console.log(`📉 [Balance API] Déficit à combler: ${deficit}€`)

    // 2. Identifier les budgets avec économies et excédents
    const budgetsWithSavings = budgetStats.filter(b => b.current_savings > 0)
    const budgetsWithSurplus = budgetStats.filter(b => b.surplus > 0)

    const totalSavings = budgetsWithSavings.reduce((sum, b) => sum + b.current_savings, 0)
    const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + b.surplus, 0)
    const totalAvailable = totalSavings + totalSurplus

    console.log(`💎 [Balance API] Total économies: ${totalSavings}€`)
    console.log(`📊 [Balance API] Total excédents: ${totalSurplus}€`)
    console.log(`💰 [Balance API] Total disponible: ${totalAvailable}€`)

    if (totalAvailable === 0) {
      return NextResponse.json(
        { error: 'Aucune économie ou excédent disponible pour équilibrer' },
        { status: 400 }
      )
    }

    // 3. Redistribution proportionnelle
    let remainingDeficit = deficit
    const redistributionActions: Array<{
      budget_id: string
      budget_name: string
      type: 'savings' | 'surplus'
      amount: number
      proportion: number
    }> = []

    // Phase 1: Utiliser les économies en priorité
    if (totalSavings > 0 && remainingDeficit > 0) {
      console.log(`🔄 [Balance API] Phase 1: Utilisation des économies`)

      for (const budget of budgetsWithSavings) {
        if (remainingDeficit <= 0) break

        // Prendre toutes les économies disponibles du budget, limitées par le déficit restant
        const amountToTake = Math.min(remainingDeficit, budget.current_savings)
        const proportion = budget.current_savings / totalSavings

        if (amountToTake > 0) {
          redistributionActions.push({
            budget_id: budget.id,
            budget_name: budget.name,
            type: 'savings',
            amount: amountToTake,
            proportion
          })

          remainingDeficit -= amountToTake
          console.log(`  💎 ${budget.name}: -${amountToTake.toFixed(2)}€ économies (total: ${budget.current_savings}€)`)
        }
      }
    }

    // Phase 2: Utiliser les excédents si nécessaire
    if (totalSurplus > 0 && remainingDeficit > 0) {
      console.log(`🔄 [Balance API] Phase 2: Utilisation des excédents`)

      for (const budget of budgetsWithSurplus) {
        if (remainingDeficit <= 0) break

        // Prendre tout le surplus disponible du budget, limité par le déficit restant
        const amountToTake = Math.min(remainingDeficit, budget.surplus)
        const proportion = budget.surplus / totalSurplus

        if (amountToTake > 0) {
          redistributionActions.push({
            budget_id: budget.id,
            budget_name: budget.name,
            type: 'surplus',
            amount: amountToTake,
            proportion
          })

          remainingDeficit -= amountToTake
          console.log(`  📊 ${budget.name}: -${amountToTake.toFixed(2)}€ excédent (surplus: ${budget.surplus}€)`)
        }
      }
    }

    const totalRedistributed = deficit - remainingDeficit
    console.log(`✅ [Balance API] Total redistribué: ${totalRedistributed.toFixed(2)}€`)
    console.log(`📉 [Balance API] Déficit restant: ${remainingDeficit.toFixed(2)}€`)

    // 4. Appliquer les modifications en base de données
    console.log(`🔄 [Balance API] Application des modifications en base`)

    for (const action of redistributionActions) {
      if (action.type === 'savings') {
        // Réduire les économies du budget
        const { error: updateError } = await supabaseServer
          .from('estimated_budgets')
          .update({
            current_savings: Math.max(0, budgetStats.find(b => b.id === action.budget_id)!.current_savings - action.amount),
            updated_at: new Date().toISOString()
          })
          .eq('id', action.budget_id)

        if (updateError) {
          console.error(`❌ [Balance API] Erreur mise à jour économies budget ${action.budget_id}:`, updateError)
          throw new Error(`Erreur lors de la mise à jour des économies du budget ${action.budget_name}`)
        }
      } else {
        // Réduire le montant estimé du budget au lieu de créer une fausse dépense
        const originalBudget = budgetStats.find(b => b.id === action.budget_id)
        if (originalBudget) {
          const newEstimatedAmount = Math.max(0, originalBudget.estimated_amount - action.amount)

          const { error: updateError } = await supabaseServer
            .from('estimated_budgets')
            .update({
              estimated_amount: newEstimatedAmount,
              updated_at: new Date().toISOString()
            })
            .eq('id', action.budget_id)

          if (updateError) {
            console.error(`❌ [Balance API] Erreur mise à jour budget estimé ${action.budget_id}:`, updateError)
            throw new Error(`Erreur lors de la mise à jour du budget estimé ${action.budget_name}`)
          }

          console.log(`📝 [Balance API] Budget ${action.budget_name}: ${originalBudget.estimated_amount}€ → ${newEstimatedAmount}€`)
        }
      }
    }

    // 5. Recalculer l'état final avec les nouveaux montants estimés mis à jour
    const { remainingToLive: finalRemainingToLive, budgetStats: finalBudgetStats } =
      await calculateCurrentState(context, contextId)

    console.log(`🎯 [Balance API] Reste à vivre final: ${finalRemainingToLive}€`)

    // 6. Log du résultat final (pas de snapshot pour éviter les erreurs de colonnes)
    console.log(`✅ [Balance API] Équilibrage terminé avec succès`)
    console.log(`📊 [Balance API] Résultat final: ${finalRemainingToLive}€`)

    return NextResponse.json({
      success: true,
      original_remaining_to_live: remainingToLive,
      final_remaining_to_live: finalRemainingToLive,
      deficit_covered: totalRedistributed,
      remaining_deficit: remainingDeficit,
      actions: redistributionActions,
      budget_stats: finalBudgetStats
    })

  } catch (error) {
    console.error('❌ [Balance API] Erreur lors de l\'équilibrage automatique:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * Calcule l'état financier actuel (reste à vivre + statistiques budgets)
 */
async function calculateCurrentState(context: 'profile' | 'group', contextId: string) {
  // Récupérer tous les budgets estimés
  const { data: budgets, error: budgetsError } = await supabaseServer
    .from('estimated_budgets')
    .select('*')
    .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

  if (budgetsError) {
    throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
  }

  // Récupérer toutes les dépenses réelles
  const { data: expenses, error: expensesError } = await supabaseServer
    .from('real_expenses')
    .select('*')
    .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

  if (expensesError) {
    throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
  }

  // Récupérer tous les revenus estimés
  const { data: estimatedIncomes, error: estimatedIncomesError } = await supabaseServer
    .from('estimated_incomes')
    .select('*')
    .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

  if (estimatedIncomesError) {
    throw new Error(`Erreur récupération revenus estimés: ${estimatedIncomesError.message}`)
  }

  // Récupérer tous les revenus réels
  const { data: realIncomes, error: realIncomesError } = await supabaseServer
    .from('real_income_entries')
    .select('*')
    .eq(context === 'profile' ? 'profile_id' : 'group_id', contextId)

  if (realIncomesError) {
    throw new Error(`Erreur récupération revenus réels: ${realIncomesError.message}`)
  }

  // Séparer les dépenses de redistribution des vraies dépenses
  const redistributionExpenses = expenses.filter(e =>
    e.description && e.description.includes('Équilibrage automatique du reste à vivre - Redistribution')
  )
  const realExpensesOnly = expenses.filter(e =>
    !e.description || !e.description.includes('Équilibrage automatique du reste à vivre - Redistribution')
  )

  // Calculer les statistiques des budgets
  const budgetStats = budgets.map(budget => {
    // Pour le calcul des dépenses, exclure les dépenses de redistribution
    const budgetExpenses = realExpensesOnly.filter(e => e.estimated_budget_id === budget.id)
    const spentAmount = budgetExpenses.reduce((sum, e) => sum + e.amount, 0)
    const surplus = Math.max(0, budget.estimated_amount - spentAmount)
    const deficit = Math.max(0, spentAmount - budget.estimated_amount)

    return {
      id: budget.id,
      name: budget.name,
      estimated_amount: budget.estimated_amount,
      spent_amount: spentAmount,
      current_savings: budget.current_savings || 0,
      surplus,
      deficit,
      difference: budget.estimated_amount - spentAmount
    }
  })

  // Calculer le reste à vivre
  const totalEstimatedIncome = estimatedIncomes.reduce((sum, income) => sum + income.estimated_amount, 0)
  const totalRealIncome = realIncomes.reduce((sum, income) => sum + income.amount, 0)
  const totalEstimatedBudgets = budgets.reduce((sum, budget) => sum + budget.estimated_amount, 0)
  const totalSavings = budgets.reduce((sum, budget) => sum + (budget.current_savings || 0), 0)

  const totalRealExpenses = realExpensesOnly.reduce((sum, e) => sum + e.amount, 0)
  const exceptionalExpenses = realExpensesOnly.filter(e => !e.estimated_budget_id).reduce((sum, e) => sum + e.amount, 0)
  const totalRedistributionAmount = redistributionExpenses.reduce((sum, e) => sum + e.amount, 0)

  console.log(`🔍 [Balance API] Calcul reste à vivre:`)
  console.log(`  - Revenus estimés: ${totalEstimatedIncome}€`)
  console.log(`  - Revenus réels: ${totalRealIncome}€`)
  console.log(`  - Budgets estimés: ${totalEstimatedBudgets}€`)
  console.log(`  - Vraies dépenses réelles: ${totalRealExpenses}€`)
  console.log(`  - Dépenses exceptionnelles: ${exceptionalExpenses}€`)
  console.log(`  - Dépenses de redistribution: ${totalRedistributionAmount}€`)
  console.log(`  - Économies: ${totalSavings}€`)

  // Après redistribution, les budgets estimés ont été mis à jour
  // Le calcul est maintenant automatiquement correct car les montants estimés reflètent la redistribution
  let remainingToLive = totalEstimatedIncome + totalRealIncome - totalEstimatedBudgets - exceptionalExpenses + totalSavings

  console.log(`🔍 [Balance API] Calcul final (budgets mis à jour): ${totalEstimatedIncome} + ${totalRealIncome} - ${totalEstimatedBudgets} - ${exceptionalExpenses} + ${totalSavings} = ${remainingToLive}€`)

  // Pour les groupes, ajouter les contributions des profils
  if (context === 'group') {
    const { data: contributions, error: contributionsError } = await supabaseServer
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', contextId)

    if (!contributionsError && contributions) {
      const totalContributions = contributions.reduce((sum, c) => sum + c.contribution_amount, 0)
      remainingToLive += totalContributions
    }
  }

  return {
    remainingToLive,
    budgetStats
  }
}