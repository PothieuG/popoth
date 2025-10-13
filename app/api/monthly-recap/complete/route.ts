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
 * 4. Finalise le processus
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   session_id: string,
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
      session_id,
      remaining_to_live_choice
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!session_id || !remaining_to_live_choice) {
      return NextResponse.json(
        { error: 'session_id et remaining_to_live_choice sont requis' },
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

    // Récupérer les données financières en temps réel
    const { getProfileFinancialData, getGroupFinancialData } = await import('@/lib/financial-calculations')

    let financialData: any
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const initialRemainingToLive = financialData.remainingToLive

    console.log(``)
    console.log(`🏁🏁🏁 ========================================================`)
    console.log(`🏁🏁🏁 FINALISATION - RESTE À VIVRE FINAL`)
    console.log(`🏁🏁🏁 ========================================================`)
    console.log(`🏁 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`🏁 ID: ${contextId}`)
    console.log(`🏁 TIMESTAMP: ${new Date().toISOString()}`)
    console.log(``)
    console.log(`💰 RESTE À VIVRE AVANT VALIDATION: ${initialRemainingToLive}€`)
    console.log(`💰 RESTE À VIVRE FINAL (après choix): ${final_amount}€`)
    console.log(``)
    console.log(`🎯 ACTION CHOISIE: ${action}`)
    console.log(`${action === 'deduct_from_budget' ? `🎯 BUDGET UTILISÉ: ${budget_id}` : '🎯 MODE: Report sur le mois suivant'}`)
    console.log(``)
    console.log(`📊 DÉTAILS FINANCIERS AVANT FINALISATION:`)
    console.log(`   - Solde bancaire: ${financialData.bankBalance}€`)
    console.log(`   - Revenus estimés: ${financialData.totalEstimatedIncome}€`)
    console.log(`   - Revenus réels: ${financialData.totalRealIncome}€`)
    console.log(`   - Budgets estimés: ${financialData.totalEstimatedBudget}€`)
    console.log(`   - Dépenses réelles: ${financialData.totalRealExpenses}€`)
    console.log(`   - Solde disponible: ${financialData.availableBalance}€`)
    console.log(`🏁🏁🏁 ========================================================`)
    console.log(``)

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
      current_step: 3, // Marquer comme complété (étape 3)
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
      // 1. Vérifier s'il existe déjà un enregistrement en cours pour ce mois
      const { data: existingRecap, error: checkError } = await supabaseServer
        .from('monthly_recaps')
        .select('id, completed_at')
        .eq(ownerField, contextId)
        .eq('recap_month', currentMonth)
        .eq('recap_year', currentYear)
        .maybeSingle()

      if (checkError) {
        console.error('❌ Erreur lors de la vérification du récap existant:', checkError)
        return NextResponse.json(
          { error: 'Erreur lors de la vérification du récap existant' },
          { status: 500 }
        )
      }

      let monthlyRecap
      if (existingRecap) {
        // Mettre à jour l'enregistrement existant
        console.log(`🔄 [Monthly Recap Complete] Mise à jour du récap existant ID: ${existingRecap.id}`)
        const { data: updatedRecap, error: updateError } = await supabaseServer
          .from('monthly_recaps')
          .update(recapData)
          .eq('id', existingRecap.id)
          .select('id')
          .single()

        if (updateError) {
          console.error('❌ Erreur lors de la mise à jour du récap:', updateError)
          return NextResponse.json(
            { error: 'Erreur lors de la sauvegarde du récap' },
            { status: 500 }
          )
        }

        monthlyRecap = updatedRecap
      } else {
        // Créer un nouvel enregistrement
        console.log(`✨ [Monthly Recap Complete] Création d'un nouveau récap`)
        const { data: newRecap, error: insertError } = await supabaseServer
          .from('monthly_recaps')
          .insert(recapData)
          .select('id')
          .single()

        if (insertError) {
          console.error('❌ Erreur lors de l\'insertion du récap:', insertError)
          return NextResponse.json(
            { error: 'Erreur lors de la sauvegarde du récap' },
            { status: 500 }
          )
        }

        monthlyRecap = newRecap
      }

      // 2. NE PAS MODIFIER LE SOLDE BANCAIRE - Le reste à vivre est déjà inclus dans le calcul global
      console.log(`💰 [Monthly Recap Complete] Reste à vivre final: ${final_amount}€`)
      console.log(`📝 [Monthly Recap Complete] Le solde bancaire reste inchangé (le reste à vivre est déjà pris en compte dans les calculs)`)

      // 2.1. NE PAS remettre les revenus estimés à 0 - ils restent pour le mois suivant
      console.log(`📝 [Monthly Recap Complete] Les revenus estimés restent inchangés pour le mois suivant`)

      // 3. Reporter le déficit comme dépense du mois suivant (avec prise en compte des transferts)
      console.log(`🔄 [Deficit Processing] Début du traitement des déficits avec transferts pour ${context}:${contextId}`)

      try {
        // Récupérer TOUS les budgets pour calculer les déficits
        const { data: allBudgets, error: budgetsQueryError } = await supabaseServer
          .from('estimated_budgets')
          .select('id, name, estimated_amount')
          .eq(ownerField, contextId)

        if (budgetsQueryError) {
          console.error('❌ [Deficit Processing] Erreur lors de la récupération des budgets:', budgetsQueryError)
        } else if (!allBudgets || allBudgets.length === 0) {
          console.log('✅ [Deficit Processing] Aucun budget à traiter')
        } else {
          console.log(`🔄 [Deficit Processing] ${allBudgets.length} budget(s) trouvé(s), calcul des déficits...`)

          // Récupérer les transferts de budgets pour ce mois
          const { data: transfers, error: transfersError } = await supabaseServer
            .from('budget_transfers')
            .select('from_budget_id, to_budget_id, transfer_amount')
            .eq(ownerField, contextId)

          if (transfersError) {
            console.error('❌ [Deficit Processing] Erreur lors de la récupération des transferts:', transfersError)
          }

          console.log(`🔄 [Deficit Processing] ${transfers?.length || 0} transfert(s) trouvé(s)`)

          // Calculer les déficits pour chaque budget
          const deficitExpenses = []

          for (const budget of allBudgets) {
            // Calculer le montant dépensé ce mois (dépenses réelles)
            const { data: expenses } = await supabaseServer
              .from('real_expenses')
              .select('amount')
              .eq('estimated_budget_id', budget.id)

            const realExpensesThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

            // Calculer les ajustements dus aux transferts
            const transfersFrom = (transfers || [])
              .filter(t => t.from_budget_id === budget.id)
              .reduce((sum, t) => sum + t.transfer_amount, 0)

            const transfersTo = (transfers || [])
              .filter(t => t.to_budget_id === budget.id)
              .reduce((sum, t) => sum + t.transfer_amount, 0)

            // Le spent_amount ajusté prend en compte les transferts
            const adjustedSpentAmount = realExpensesThisMonth + transfersFrom - transfersTo

            // Calculer le déficit avec le montant ajusté: dépenses ajustées - budget estimé
            const deficit = Math.max(0, adjustedSpentAmount - budget.estimated_amount)

            console.log(`📊 [Deficit Processing] "${budget.name}": ${budget.estimated_amount}€ estimé, ${realExpensesThisMonth}€ dépensé, transferts (from: ${transfersFrom}€, to: ${transfersTo}€), ajusté: ${adjustedSpentAmount}€ = ${deficit}€ déficit`)

            if (deficit > 0) {
              // Créer une dépense réelle pour le déficit (APRÈS reset des dépenses)
              const deficitExpense = {
                estimated_budget_id: budget.id,
                amount: deficit,
                description: `Déficit reporté du récap ${currentMonth}/${currentYear}`,
                expense_date: currentDate.toISOString().split('T')[0],
                created_at: new Date().toISOString()
              }

              // Ajouter les champs de propriétaire
              if (context === 'profile') {
                deficitExpense.profile_id = contextId
              } else {
                deficitExpense.group_id = contextId
              }

              deficitExpenses.push(deficitExpense)
            }
          }

          // Stocker les déficits pour les insérer APRÈS le reset des dépenses
          if (deficitExpenses.length > 0) {
            console.log(`🔄 [Deficit Processing] ${deficitExpenses.length} déficit(s) à reporter après reset`)
            // Les déficits seront insérés plus tard dans le code
            global.deficitExpensesToInsert = deficitExpenses
          }
        }
      } catch (deficitError) {
        console.error('❌ [Deficit Processing] Erreur générale lors du traitement des déficits:', deficitError)
        // Ne pas faire échouer la transaction pour ça
      }

      // 3.5. Calculer et reporter les économies (surplus) avec prise en compte des transferts
      console.log(`💰 [Savings Processing] Début du traitement des économies avec transferts pour ${context}:${contextId}`)

      try {
        // Récupérer tous les budgets pour calculer les économies
        const { data: allBudgetsForSavings, error: savingsQueryError } = await supabaseServer
          .from('estimated_budgets')
          .select('id, name, estimated_amount, cumulated_savings')
          .eq(ownerField, contextId)

        if (savingsQueryError) {
          console.error('❌ [Savings Processing] Erreur lors de la récupération des budgets:', savingsQueryError)
        } else if (!allBudgetsForSavings || allBudgetsForSavings.length === 0) {
          console.log('✅ [Savings Processing] Aucun budget à traiter')
        } else {
          console.log(`💰 [Savings Processing] ${allBudgetsForSavings.length} budget(s) trouvé(s), calcul des économies...`)

          // Récupérer les transferts de budgets pour ce mois
          const { data: transfers, error: transfersError } = await supabaseServer
            .from('budget_transfers')
            .select('from_budget_id, to_budget_id, transfer_amount')
            .eq(ownerField, contextId)

          if (transfersError) {
            console.error('❌ [Savings Processing] Erreur lors de la récupération des transferts:', transfersError)
          }

          console.log(`🔄 [Savings Processing] ${transfers?.length || 0} transfert(s) trouvé(s)`)

          const budgetsWithSavings = []

          for (const budget of allBudgetsForSavings) {
            // Calculer le montant dépensé ce mois (dépenses réelles)
            const { data: expenses } = await supabaseServer
              .from('real_expenses')
              .select('amount')
              .eq('estimated_budget_id', budget.id)

            const realExpensesThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

            // Calculer les ajustements dus aux transferts
            const transfersFrom = (transfers || [])
              .filter(t => t.from_budget_id === budget.id)
              .reduce((sum, t) => sum + t.transfer_amount, 0)

            const transfersTo = (transfers || [])
              .filter(t => t.to_budget_id === budget.id)
              .reduce((sum, t) => sum + t.transfer_amount, 0)

            // Le spent_amount ajusté prend en compte les transferts
            // Transferts FROM = augmente le spent (on donne de l'argent)
            // Transferts TO = diminue le spent (on reçoit de l'argent)
            const adjustedSpentAmount = realExpensesThisMonth + transfersFrom - transfersTo

            // Calculer les économies avec le montant ajusté
            const surplus = Math.max(0, budget.estimated_amount - adjustedSpentAmount)

            console.log(`💰 [Savings Processing] "${budget.name}": ${budget.estimated_amount}€ estimé, ${realExpensesThisMonth}€ dépensé, transferts (from: ${transfersFrom}€, to: ${transfersTo}€), ajusté: ${adjustedSpentAmount}€ = ${surplus}€ économies`)

            if (surplus > 0) {
              budgetsWithSavings.push({
                ...budget,
                calculated_savings: surplus
              })
            }
          }

          if (budgetsWithSavings.length > 0) {
            console.log(`💰 [Savings Processing] ${budgetsWithSavings.length} budget(s) avec économies détecté(s)`)

            // Appliquer les économies
            const savingsPromises = budgetsWithSavings.map(budget => {
              const currentSavings = budget.cumulated_savings || 0
              const newSavingsAmount = currentSavings + budget.calculated_savings

              console.log(`💰 [Savings Processing] "${budget.name}": économies ${budget.calculated_savings}€ + économies existantes ${currentSavings}€ = ${newSavingsAmount}€`)

              return supabaseServer
                .from('estimated_budgets')
                .update({
                  cumulated_savings: newSavingsAmount,
                  last_savings_update: currentDate.toISOString().split('T')[0],
                  updated_at: new Date().toISOString()
                })
                .eq('id', budget.id)
            })

            const savingsResults = await Promise.all(savingsPromises)
            const savingsErrors = savingsResults.filter(result => result.error)

            if (savingsErrors.length > 0) {
              console.error('❌ [Savings Processing] Erreurs lors du report des économies:', savingsErrors.map(r => r.error))
            } else {
              console.log(`✅ [Savings Processing] ${budgetsWithSavings.length} économie(s) reportée(s) avec succès`)
            }
          } else {
            console.log('✅ [Savings Processing] Aucun budget avec économies à traiter')
          }
        }
      } catch (savingsError) {
        console.error('❌ [Savings Processing] Erreur générale lors du traitement des économies:', savingsError)
        // Ne pas faire échouer la transaction pour ça
      }

      // 3.6. Calculer l'écart de reste à vivre et créer une dépense exceptionnelle si nécessaire
      console.log(`📊 [RAV Difference Processing] Début du calcul de l'écart de reste à vivre pour ${context}:${contextId}`)

      try {
        // Calculer le reste à vivre de base: revenus estimés - dépenses estimées
        const baseRemainingToLive = financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets

        // Récupérer le reste à vivre actuel de la BDD
        const { data: bankBalance, error: bankBalanceError } = await supabaseServer
          .from('bank_balances')
          .select('current_remaining_to_live')
          .eq(ownerField, contextId)
          .single()

        if (bankBalanceError) {
          console.error('❌ [RAV Difference Processing] Erreur lors de la récupération du reste à vivre actuel:', bankBalanceError)
        } else {
          const currentRemainingToLive = bankBalance?.current_remaining_to_live || 0

          console.log(`📊 [RAV Difference Processing] Reste à vivre de base (calcul): ${baseRemainingToLive}€`)
          console.log(`📊 [RAV Difference Processing] Reste à vivre actuel (BDD): ${currentRemainingToLive}€`)

          // Calculer l'écart: BDD - calcul de base
          const difference = currentRemainingToLive - baseRemainingToLive

          console.log(`📊 [RAV Difference Processing] Écart calculé: ${difference}€`)

          // Si l'écart est négatif (BDD < calcul de base), on reporte la valeur absolue comme dépense exceptionnelle
          if (difference < 0) {
            const exceptionalExpenseAmount = Math.abs(difference)

            console.log(`⚠️ [RAV Difference Processing] Écart négatif détecté: ${difference}€`)
            console.log(`📝 [RAV Difference Processing] Création d'une dépense exceptionnelle de ${exceptionalExpenseAmount}€ pour le mois prochain`)

            // Créer une dépense exceptionnelle (sera insérée après le reset des dépenses)
            const exceptionalExpense = {
              amount: exceptionalExpenseAmount,
              description: `Écart de reste à vivre reporté du récap ${currentMonth}/${currentYear}`,
              expense_date: currentDate.toISOString().split('T')[0],
              is_exceptional: true,
              estimated_budget_id: null, // Pas de lien avec un budget
              created_at: new Date().toISOString()
            }

            // Ajouter les champs de propriétaire
            if (context === 'profile') {
              exceptionalExpense.profile_id = contextId
            } else {
              exceptionalExpense.group_id = contextId
            }

            // Stocker dans un tableau séparé pour insertion après reset
            global.exceptionalExpenseToInsert = exceptionalExpense

            console.log(`✅ [RAV Difference Processing] Dépense exceptionnelle préparée pour insertion`)
          } else {
            console.log(`✅ [RAV Difference Processing] Pas d'écart négatif, aucune dépense exceptionnelle à créer`)
          }
        }
      } catch (ravDifferenceError) {
        console.error('❌ [RAV Difference Processing] Erreur générale lors du traitement de l\'écart de reste à vivre:', ravDifferenceError)
        // Ne pas faire échouer la transaction pour ça
      }

      // 4. Log de session (plus de snapshot à désactiver)
      console.log(`📝 [Monthly Recap Complete] Session ${session_id} terminée avec succès`)

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

      // 4.2.5. Supprimer tous les transferts entre budgets (déjà pris en compte dans les calculs)
      console.log(`🗑️ [Monthly Recap Complete] Suppression des transferts entre budgets pour ${context}:${contextId}`)
      const { error: deleteTransfersError } = await supabaseServer
        .from('budget_transfers')
        .delete()
        .eq(ownerField, contextId)

      if (deleteTransfersError) {
        console.error('❌ Erreur lors de la suppression des transferts:', deleteTransfersError)
      } else {
        console.log(`✅ [Monthly Recap Complete] Transferts entre budgets supprimés avec succès`)
      }

      // 4.2.1. Insérer les déficits reportés APRÈS le reset
      if (global.deficitExpensesToInsert && global.deficitExpensesToInsert.length > 0) {
        console.log(`🔄 [Deficit Processing] Insertion de ${global.deficitExpensesToInsert.length} déficit(s) reporté(s)`)

        const { error: insertDeficitError } = await supabaseServer
          .from('real_expenses')
          .insert(global.deficitExpensesToInsert)

        if (insertDeficitError) {
          console.error('❌ [Deficit Processing] Erreur lors de l\'insertion des déficits reportés:', insertDeficitError)
        } else {
          console.log(`✅ [Deficit Processing] ${global.deficitExpensesToInsert.length} déficit(s) reporté(s) avec succès`)
        }

        // Nettoyer la variable globale
        delete global.deficitExpensesToInsert
      }

      // 4.2.2. Insérer la dépense exceptionnelle pour l'écart de reste à vivre
      if (global.exceptionalExpenseToInsert) {
        console.log(`🔄 [RAV Difference Processing] Insertion de la dépense exceptionnelle`)

        const { error: insertExceptionalError } = await supabaseServer
          .from('real_expenses')
          .insert([global.exceptionalExpenseToInsert])

        if (insertExceptionalError) {
          console.error('❌ [RAV Difference Processing] Erreur lors de l\'insertion de la dépense exceptionnelle:', insertExceptionalError)
        } else {
          console.log(`✅ [RAV Difference Processing] Dépense exceptionnelle de ${global.exceptionalExpenseToInsert.amount}€ insérée avec succès`)
        }

        // Nettoyer la variable globale
        delete global.exceptionalExpenseToInsert
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

      // 4.4. Remettre à zéro les champs surplus/déficit (plus utilisés)
      console.log('🔄 [Monthly Recap Complete] Reset des champs surplus/déficit')

      const { error: resetSurplusError2 } = await supabaseServer
        .from('estimated_budgets')
        .update({
          monthly_surplus: 0,
          monthly_deficit: 0,
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)

      if (resetSurplusError2) {
        console.error('❌ Erreur lors du reset des surplus/déficit:', resetSurplusError2)
      } else {
        console.log('✅ [Monthly Recap Complete] Champs surplus/déficit remis à zéro')
      }

      console.log(`✅ [Monthly Recap Complete] Processus finalisé pour ${context}`)

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