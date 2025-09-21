import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/complete
 *
 * Finalise le récapitulatif mensuel:
 * 1. Valide et enregistre le récap en base
 * 2. Reset les revenus estimés à 0
 * 3. Met à jour les colonnes de dernier récap
 * 4. Invalide le cache financier
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   snapshot_id: string,
 *   remaining_to_live_choice: {
 *     action: 'carry_forward' | 'deduct_from_budget',
 *     budget_id?: string, // requis si action = 'deduct_from_budget'
 *     final_amount: number
 *   }
 * }
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
    const {
      context = 'profile',
      snapshot_id,
      remaining_to_live_choice
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!snapshot_id || !remaining_to_live_choice) {
      return NextResponse.json(
        { error: 'snapshot_id et remaining_to_live_choice sont requis' },
        { status: 400 }
      )
    }

    const { action, budget_id, final_amount } = remaining_to_live_choice

    if (!['carry_forward', 'deduct_from_budget'].includes(action)) {
      return NextResponse.json(
        { error: 'Action invalide. Utilisez "carry_forward" ou "deduct_from_budget"' },
        { status: 400 }
      )
    }

    if (action === 'deduct_from_budget' && !budget_id) {
      return NextResponse.json(
        { error: 'budget_id requis pour l\'action "deduct_from_budget"' },
        { status: 400 }
      )
    }

    if (typeof final_amount !== 'number') {
      return NextResponse.json(
        { error: 'final_amount doit être un nombre' },
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

    const contextId = context === 'profile' ? profile.id : profile.group_id

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    // Vérifier que le snapshot appartient au bon utilisateur/groupe
    const snapshotOwnerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: snapshot, error: snapshotError } = await supabaseServer
      .from('recap_snapshots')
      .select('id, snapshot_data')
      .eq('id', snapshot_id)
      .eq(snapshotOwnerField, contextId)
      .eq('is_active', true)
      .single()

    if (snapshotError || !snapshot) {
      return NextResponse.json(
        { error: 'Snapshot non trouvé ou non autorisé' },
        { status: 404 }
      )
    }

    // Récupérer les données initiales du snapshot
    const snapshotData = snapshot.snapshot_data as any
    const initialRemainingToLive = snapshotData.financial_data?.remainingToLive || 0

    console.log(`🏁 [Monthly Recap Complete] Finalisation pour ${context}:${contextId}`)
    console.log(`🏁 [Monthly Recap Complete] Reste à vivre initial: ${initialRemainingToLive}€`)
    console.log(`🏁 [Monthly Recap Complete] Reste à vivre final: ${final_amount}€`)
    console.log(`🏁 [Monthly Recap Complete] Action: ${action}`)

    // Calculer les totaux de surplus/déficit actuels
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: currentBudgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, monthly_surplus, monthly_deficit')
      .eq(ownerField, contextId)

    if (budgetsError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 }
      )
    }

    const totalSurplus = currentBudgets?.reduce((sum, b) => sum + (b.monthly_surplus || 0), 0) || 0
    const totalDeficit = currentBudgets?.reduce((sum, b) => sum + (b.monthly_deficit || 0), 0) || 0

    // Préparer les données du récap
    const recapData: any = {
      recap_month: currentMonth,
      recap_year: currentYear,
      initial_remaining_to_live: initialRemainingToLive,
      final_remaining_to_live: final_amount,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      completed_at: new Date().toISOString()
    }

    // Déterminer la source du reste à vivre
    if (action === 'carry_forward') {
      recapData.remaining_to_live_source = 'carried_forward'
      recapData.remaining_to_live_amount = initialRemainingToLive
    } else {
      // Récupérer le nom du budget utilisé
      const budget = currentBudgets?.find(b => b.id === budget_id)
      if (!budget) {
        return NextResponse.json(
          { error: 'Budget spécifié non trouvé' },
          { status: 404 }
        )
      }
      recapData.remaining_to_live_source = `from_budget_${budget.name}`
      recapData.remaining_to_live_amount = final_amount
    }

    // Ajouter le bon champ propriétaire
    if (context === 'profile') {
      recapData.profile_id = contextId
    } else {
      recapData.group_id = contextId
    }

    // Démarrer une transaction
    try {
      // 1. Insérer le récap mensuel
      const { data: monthlyRecap, error: recapError } = await supabaseServer
        .from('monthly_recaps')
        .insert(recapData)
        .select('id')
        .single()

      if (recapError) {
        console.error('❌ Erreur lors de l\'insertion du récap:', recapError)
        return NextResponse.json(
          { error: 'Erreur lors de la sauvegarde du récap' },
          { status: 500 }
        )
      }

      // 2. NE PAS MODIFIER LE SOLDE BANCAIRE - Le reste à vivre est déjà inclus dans le calcul global
      console.log(`💰 [Monthly Recap Complete] Reste à vivre final: ${final_amount}€`)
      console.log(`📝 [Monthly Recap Complete] Le solde bancaire reste inchangé (le reste à vivre est déjà pris en compte dans les calculs)`)

      // 2.1. NE PAS remettre les revenus estimés à 0 - ils restent pour le mois suivant
      console.log(`📝 [Monthly Recap Complete] Les revenus estimés restent inchangés pour le mois suivant`)

      // 3. IMPORTANT: Reporter les déficits AVANT de supprimer les dépenses
      console.log(`🔄 [Deficit Carryover] Début du traitement des déficits pour ${context}:${contextId}`)

      try {
        // Forcer l'utilisation du nouveau système puisque les colonnes existent dans la base
        const hasCarryoverColumns = true
        console.log('✅ [Deficit Carryover] Utilisation forcée du système carryover complet')

        // Récupérer TOUS les budgets pour recalculer les déficits
        const selectFields = 'id, name, estimated_amount, carryover_spent_amount'

        const { data: allBudgets, error: budgetsQueryError } = await supabaseServer
          .from('estimated_budgets')
          .select(selectFields)
          .eq(ownerField, contextId)

        if (budgetsQueryError) {
          console.error('❌ [Deficit Carryover] Erreur lors de la récupération des budgets:', budgetsQueryError)
        } else if (!allBudgets || allBudgets.length === 0) {
          console.log('✅ [Deficit Carryover] Aucun budget à traiter')
        } else {
          console.log(`🔄 [Deficit Carryover] ${allBudgets.length} budget(s) trouvé(s), calcul des déficits...`)

          // Calculer les déficits pour chaque budget (comme dans l'initialize)
          const budgetsWithDeficit = []

          for (const budget of allBudgets) {
            // Calculer le montant dépensé ce mois (dépenses réelles)
            const { data: expenses } = await supabaseServer
              .from('real_expenses')
              .select('amount')
              .eq('estimated_budget_id', budget.id)

            const realExpensesThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

            // Ajouter le carryover existant
            const existingCarryover = budget.carryover_spent_amount || 0
            const totalSpent = realExpensesThisMonth + existingCarryover

            // Calculer le déficit
            const deficit = Math.max(0, totalSpent - budget.estimated_amount)

            console.log(`📊 [Deficit Carryover] "${budget.name}": ${budget.estimated_amount}€ estimé, ${totalSpent}€ total dépensé (${realExpensesThisMonth}€ + ${existingCarryover}€ carryover) = ${deficit}€ déficit`)

            if (deficit > 0) {
              budgetsWithDeficit.push({
                ...budget,
                monthly_deficit: deficit
              })
            }
          }

          console.log(`🔄 [Deficit Carryover] ${budgetsWithDeficit.length} budget(s) avec déficit détecté(s)`)

          if (budgetsWithDeficit.length > 0) {
            if (hasCarryoverColumns) {
              console.log('✅ [Deficit Carryover] Utilisation du système carryover complet')

              // SOLUTION DÉFINITIVE: Utiliser carryover_spent_amount
              const carryoverPromises = budgetsWithDeficit.map(budget => {
                const currentCarryover = budget.carryover_spent_amount || 0
                const newCarryoverAmount = currentCarryover + budget.monthly_deficit

                console.log(`🔄 [Deficit Carryover] "${budget.name}": déficit ${budget.monthly_deficit}€ + carryover existant ${currentCarryover}€ = ${newCarryoverAmount}€`)

                return supabaseServer
                  .from('estimated_budgets')
                  .update({
                    carryover_spent_amount: newCarryoverAmount,
                    carryover_applied_date: currentDate.toISOString().split('T')[0],
                    monthly_deficit: 0,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', budget.id)
              })

              const carryoverResults = await Promise.all(carryoverPromises)
              const carryoverErrors = carryoverResults.filter(result => result.error)

              console.log('🔍 [Deficit Carryover] Résultats des updates:', carryoverResults.map((result, index) => ({
                budget: budgetsWithDeficit[index]?.name,
                success: !result.error,
                error: result.error?.message,
                data: result.data
              })))

              if (carryoverErrors.length > 0) {
                console.error('❌ [Deficit Carryover] Erreurs lors du report:', carryoverErrors.map(r => r.error))
              } else {
                console.log(`✅ [Deficit Carryover] ${budgetsWithDeficit.length} déficit(s) reporté(s) avec succès`)
              }

            } else {
              console.log('💡 [Deficit Carryover] Utilisation du système de fallback (surplus négatif)')

              // SOLUTION TEMPORAIRE: Utiliser monthly_surplus en négatif pour simuler le carryover
              const carryoverPromises = budgetsWithDeficit.map(budget => {
                const carryoverAmount = -budget.monthly_deficit // Négatif pour indiquer "déjà dépensé"
                console.log(`🔄 [Deficit Carryover] "${budget.name}": déficit ${budget.monthly_deficit}€ → surplus négatif ${carryoverAmount}€ (fallback)`)

                return supabaseServer
                  .from('estimated_budgets')
                  .update({
                    monthly_surplus: carryoverAmount, // Stockage temporaire du carryover
                    monthly_deficit: 0,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', budget.id)
              })

              await Promise.all(carryoverPromises)
              console.log(`✅ [Deficit Carryover] ${budgetsWithDeficit.length} déficit(s) reporté(s) via fallback`)
              console.log('💡 [Deficit Carryover] Exécutez database/implement_deficit_carryover.sql pour le système complet')
            }
          } else {
            console.log('✅ [Deficit Carryover] Aucun budget avec déficit à traiter')
          }
        }
      } catch (carryoverError) {
        console.error('❌ [Deficit Carryover] Erreur générale lors du traitement des déficits:', carryoverError)
        // Ne pas faire échouer la transaction pour ça
      }

      // 3.6. Remettre à zéro les surplus POSITIFS (économies) pour le nouveau mois
      // Les déficits ont déjà été reportés en négatif, maintenant on reset les surplus positifs
      console.log('🔄 [Monthly Recap Complete] Reset des surplus positifs pour le nouveau mois')

      const { error: resetSurplusError } = await supabaseServer
        .from('estimated_budgets')
        .update({
          monthly_surplus: 0,
          monthly_deficit: 0,
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)
        .gte('monthly_surplus', 0) // Seulement les surplus positifs ou zéro

      if (resetSurplusError) {
        console.error('❌ Erreur lors du reset des surplus:', resetSurplusError)
      } else {
        console.log('✅ [Monthly Recap Complete] Surplus positifs remis à zéro pour le nouveau mois')
      }

      // 4. Désactiver le snapshot (marquer comme utilisé)
      const { error: snapshotUpdateError } = await supabaseServer
        .from('recap_snapshots')
        .update({ is_active: false })
        .eq('id', snapshot_id)

      if (snapshotUpdateError) {
        console.error('❌ Erreur lors de la mise à jour du snapshot:', snapshotUpdateError)
        // Ne pas faire échouer pour ça non plus
      }

      console.log(`✅ [Monthly Recap Complete] Récap mensuel finalisé avec ID: ${monthlyRecap.id}`)

      // 4. MAINTENANT supprimer les données réelles (après calcul du carryover)
      // 4.1. Supprimer tous les revenus réels
      console.log(`🗑️ [Monthly Recap Complete] Suppression des revenus réels pour ${context}:${contextId}`)
      const { error: deleteRealIncomesError } = await supabaseServer
        .from('real_income_entries')
        .delete()
        .eq(ownerField, contextId)

      if (deleteRealIncomesError) {
        console.error('❌ Erreur lors de la suppression des revenus réels:', deleteRealIncomesError)
      } else {
        console.log(`✅ [Monthly Recap Complete] Revenus réels supprimés avec succès`)
      }

      // 4.2. Supprimer toutes les dépenses réelles
      console.log(`🗑️ [Monthly Recap Complete] Suppression des dépenses réelles pour ${context}:${contextId}`)
      const { error: deleteRealExpensesError } = await supabaseServer
        .from('real_expenses')
        .delete()
        .eq(ownerField, contextId)

      if (deleteRealExpensesError) {
        console.error('❌ Erreur lors de la suppression des dépenses réelles:', deleteRealExpensesError)
      } else {
        console.log(`✅ [Monthly Recap Complete] Dépenses réelles supprimées avec succès`)
      }

      // 4.3. Mettre à jour la date de dernière mise à jour mensuelle des budgets
      const { error: budgetUpdateError } = await supabaseServer
        .from('estimated_budgets')
        .update({
          last_monthly_update: currentDate.toISOString().split('T')[0], // Format YYYY-MM-DD
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)

      if (budgetUpdateError) {
        console.error('❌ Erreur lors de la mise à jour des budgets:', budgetUpdateError)
        // Ne pas faire échouer la transaction pour ça, juste logger
      }

      // 4.4. Remettre à zéro les surplus POSITIFS (économies) pour le nouveau mois
      // Les déficits ont déjà été reportés via carryover, maintenant on reset les surplus positifs
      console.log('🔄 [Monthly Recap Complete] Reset des surplus positifs pour le nouveau mois')

      const { error: resetSurplusError2 } = await supabaseServer
        .from('estimated_budgets')
        .update({
          monthly_surplus: 0,
          monthly_deficit: 0,
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)
        .gte('monthly_surplus', 0) // Seulement les surplus positifs ou zéro

      if (resetSurplusError2) {
        console.error('❌ Erreur lors du reset des surplus:', resetSurplusError2)
      } else {
        console.log('✅ [Monthly Recap Complete] Surplus positifs remis à zéro pour le nouveau mois')
      }

      // 5. Invalider le cache financier (appel à l'API dashboard pour vider le cache)
      try {
        const baseUrl = request.nextUrl.origin
        const cacheInvalidateUrl = `${baseUrl}/api/financial/dashboard?context=${context}&invalidate_cache=true`

        await fetch(cacheInvalidateUrl, {
          method: 'GET',
          headers: {
            'Cookie': request.headers.get('Cookie') || ''
          }
        })

        console.log(`🔄 [Monthly Recap Complete] Cache financier invalidé pour ${context}`)
      } catch (cacheError) {
        console.error('⚠️ Erreur lors de l\'invalidation du cache:', cacheError)
        // Ne pas faire échouer pour ça
      }

      // Préparer le résumé final
      const summary = {
        recap_id: monthlyRecap.id,
        initial_remaining_to_live: initialRemainingToLive,
        final_remaining_to_live: final_amount,
        action_taken: action,
        budget_used: action === 'deduct_from_budget' ? currentBudgets?.find(b => b.id === budget_id)?.name : null,
        total_surplus: totalSurplus,
        total_deficit: totalDeficit,
        incomes_reset: true,
        month: currentMonth,
        year: currentYear,
        completed_at: recapData.completed_at
      }

      return NextResponse.json({
        success: true,
        message: 'Récapitulatif mensuel finalisé avec succès',
        summary,
        redirect_to_dashboard: true
      })

    } catch (transactionError) {
      console.error('❌ Erreur lors de la transaction de finalisation:', transactionError)
      return NextResponse.json(
        { error: 'Erreur lors de la finalisation du récap' },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('❌ Erreur lors de la finalisation du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}