import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API POST /api/monthly-recap/process-step1
 *
 * ALGORITHME CORRIGÉ - Ordre: Tirelire → Économies → Surplus
 *
 * Exécute l'algorithme complet de rééquilibrage de l'Étape 1:
 *
 * CAS 1 (Différence ≥ 0 - Excédent):
 *   1.1. Transférer l'excédent → tirelire
 *   NOTE: Pas de renflouage des budgets déficitaires en CAS 1.
 *   NOTE: Les surplus restent intacts (pas de consommation en CAS 1).
 *
 * CAS 2 (Différence < 0 - Déficit / Gap à combler):
 *   2.1. Utiliser tirelire (entièrement si nécessaire)
 *   2.2. Utiliser économies proportionnellement
 *   2.3. Consommer surplus proportionnellement (dépenses)
 *   2.3.1. Créer CRÉDITS sur budgets déficitaires (pour annuler leurs déficits)
 *   2.4. Le surplus restant reste comme "surplus" pour l'écran 2.
 */
export async function POST(request: NextRequest) {
  try {
    // ============================================================================
    // VALIDATION SESSION ET CONTEXTE
    // ============================================================================

    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const { context } = await request.json()

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
      .select('id, group_id, first_name, last_name')
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

    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    console.log(``)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯🎯🎯 PROCESS STEP 1 - ALGORITHME DE RÉÉQUILIBRAGE`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`🎯 ID: ${contextId}`)
    console.log(`🎯 USER: ${profile.first_name} ${profile.last_name}`)
    console.log(`🎯 TIMESTAMP: ${new Date().toISOString()}`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(``)

    // ============================================================================
    // RÉCUPÉRATION DES DONNÉES FINANCIÈRES
    // ============================================================================

    let financialData: any
    if (context === 'profile') {
      financialData = await getProfileFinancialData(contextId)
    } else {
      financialData = await getGroupFinancialData(contextId)
    }

    const ravActuel = financialData.remainingToLive
    const ravBudgetaire = financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets
    const difference = ravActuel - ravBudgetaire

    console.log(`💰 RAV ACTUEL: ${ravActuel}€`)
    console.log(`💰 RAV BUDGÉTAIRE (CIBLE): ${ravBudgetaire}€`)
    console.log(`📊 DIFFÉRENCE: ${difference}€`)
    console.log(``)

    // ============================================================================
    // RÉCUPÉRATION DES BUDGETS, DÉPENSES, TIRELIRE
    // ============================================================================

    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq(ownerField, contextId)

    if (budgetsError) {
      throw new Error(`Erreur récupération budgets: ${budgetsError.message}`)
    }

    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      throw new Error(`Erreur récupération dépenses: ${expensesError.message}`)
    }

    const { data: piggyBankData, error: piggyBankError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .single()

    if (piggyBankError) {
      throw new Error(`Erreur récupération tirelire: ${piggyBankError.message}`)
    }

    let piggyBankAmount = piggyBankData?.amount || 0

    console.log(`🐷 TIRELIRE INITIALE: ${piggyBankAmount}€`)
    console.log(`📊 BUDGETS: ${budgets.length}`)
    console.log(`📊 DÉPENSES: ${expenses.length}`)
    console.log(``)

    // ============================================================================
    // CALCUL DES SURPLUS ET DÉFICITS PAR BUDGET
    // ============================================================================

    interface BudgetAnalysis {
      id: string
      name: string
      estimated_amount: number
      spent_amount: number
      surplus: number
      deficit: number
      cumulated_savings: number
    }

    const budgetAnalyses: BudgetAnalysis[] = []

    for (const budget of budgets) {
      const spentAmount = expenses
        .filter(expense => expense.estimated_budget_id === budget.id)
        .reduce((sum, expense) => sum + expense.amount, 0)

      const difference = budget.estimated_amount - spentAmount
      const surplus = Math.max(0, difference)
      const deficit = Math.max(0, -difference)

      budgetAnalyses.push({
        id: budget.id,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        spent_amount: spentAmount,
        surplus,
        deficit,
        cumulated_savings: budget.cumulated_savings || 0
      })

      console.log(`📊 Budget "${budget.name}": ${budget.estimated_amount}€ estimé, ${spentAmount}€ dépensé, surplus=${surplus}€, déficit=${deficit}€, économies=${budget.cumulated_savings || 0}€`)
    }

    const budgetsWithSurplus = budgetAnalyses.filter(b => b.surplus > 0)
    const budgetsWithDeficit = budgetAnalyses.filter(b => b.deficit > 0)
    const budgetsWithSavings = budgetAnalyses.filter(b => b.cumulated_savings > 0)

    console.log(``)
    console.log(`📊 RÉSUMÉ:`)
    console.log(`   - Budgets avec surplus: ${budgetsWithSurplus.length} (${budgetsWithSurplus.reduce((s, b) => s + b.surplus, 0)}€)`)
    console.log(`   - Budgets avec déficit: ${budgetsWithDeficit.length} (${budgetsWithDeficit.reduce((s, b) => s + b.deficit, 0)}€)`)
    console.log(`   - Budgets avec économies: ${budgetsWithSavings.length} (${budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)}€)`)
    console.log(``)

    // ============================================================================
    // DÉTERMINATION DU CAS ET EXÉCUTION DE L'ALGORITHME
    // ============================================================================

    const operations: Array<{
      step: string
      type: string
      details: any
    }> = []

    if (difference >= 0) {
      // ========================================================================
      // CAS 1: EXCÉDENT OU ÉQUILIBRE (Différence ≥ 0)
      // ========================================================================

      console.log(`✅ CAS 1: EXCÉDENT OU ÉQUILIBRE (Différence ≥ 0)`)
      console.log(``)

      // NOTE: Les surplus ne sont PAS automatiquement transférés vers les économies.
      // Ils restent comme "surplus" jusqu'à ce que l'utilisateur décide à l'écran 2.
      console.log(`ℹ️ Les surplus (${budgetsWithSurplus.reduce((s, b) => s + b.surplus, 0)}€) restent comme "surplus"`)
      console.log(`   → L'utilisateur pourra les répartir vers économies à l'écran 2`)
      console.log(``)

      // ÉTAPE 1.1: Transférer l'excédent vers la tirelire
      console.log(`🔄 ÉTAPE 1.1: Transfert de l'excédent vers la tirelire`)

      const excedentPourTirelire = difference

      if (excedentPourTirelire > 0) {
        const newPiggyBankAmount = piggyBankAmount + excedentPourTirelire

        const { error: updateError } = await supabaseServer
          .from('piggy_bank')
          .update({
            amount: newPiggyBankAmount,
            last_updated: new Date().toISOString()
          })
          .eq(ownerField, contextId)

        if (updateError) {
          throw new Error(`Erreur mise à jour tirelire: ${updateError.message}`)
        }

        console.log(`   ✅ Tirelire: ${piggyBankAmount}€ + ${excedentPourTirelire}€ = ${newPiggyBankAmount}€`)

        operations.push({
          step: '1.1',
          type: 'excedent_to_piggy_bank',
          details: {
            excedent_amount: excedentPourTirelire,
            old_piggy_bank: piggyBankAmount,
            new_piggy_bank: newPiggyBankAmount
          }
        })

        piggyBankAmount = newPiggyBankAmount
      } else {
        console.log(`   ℹ️ Aucun excédent à transférer (différence = 0€)`)
      }

      console.log(``)

      // CAS 1: Pas de renflouage automatique des budgets déficitaires
      // Les déficits individuels sont déjà inclus dans le RAV.
      // La tirelire et les économies ne doivent pas être touchées en cas d'excédent global.
      if (budgetsWithDeficit.length > 0) {
        console.log(`ℹ️ ${budgetsWithDeficit.length} budget(s) déficitaire(s) détecté(s), mais pas de renflouage en CAS 1 (excédent global)`)
        console.log(`   Les déficits individuels sont déjà inclus dans le calcul du RAV`)
        console.log(``)
      } else {
        console.log(`✅ Aucun budget déficitaire`)
        console.log(``)
      }

      // Récupérer les données finales
      let finalFinancialData: any
      if (context === 'profile') {
        finalFinancialData = await getProfileFinancialData(contextId)
      } else {
        finalFinancialData = await getGroupFinancialData(contextId)
      }

      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`🎯🎯🎯 RÉSULTAT FINAL - CAS 1 (EXCÉDENT)`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`💰 RAV INITIAL: ${ravActuel}€`)
      console.log(`💰 RAV FINAL: ${finalFinancialData.remainingToLive}€`)
      console.log(`💰 RAV BUDGÉTAIRE: ${ravBudgetaire}€`)
      console.log(`🐷 TIRELIRE FINALE: ${piggyBankAmount}€`)
      console.log(`📊 OPÉRATIONS EFFECTUÉES: ${operations.length}`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(``)

      return NextResponse.json({
        success: true,
        case: 'excedent',
        initial_rav: ravActuel,
        budgetary_rav: ravBudgetaire,
        final_rav: finalFinancialData.remainingToLive,
        difference: difference,
        piggy_bank_final: piggyBankAmount,
        operations_performed: operations,
        budgets_with_deficit_refloated: budgetsWithDeficit.map(b => ({
          id: b.id,
          name: b.name,
          deficit: b.deficit
        })),
        timestamp: Date.now()
      })

    } else {
      // ========================================================================
      // CAS 2: DÉFICIT (Différence < 0)
      // ========================================================================

      console.log(`⚠️ CAS 2: DÉFICIT (Différence < 0)`)
      console.log(``)

      let gapACombler = Math.abs(difference)
      const totalSurplusAvailable = budgetsWithSurplus.reduce((s, b) => s + b.surplus, 0)
      const totalSavingsAvailable = budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)

      console.log(`📉 GAP À COMBLER: ${gapACombler}€`)
      console.log(`🐷 Tirelire disponible: ${piggyBankAmount}€`)
      console.log(`💎 Économies disponibles: ${totalSavingsAvailable}€`)
      console.log(`💚 Surplus disponible: ${totalSurplusAvailable}€`)
      console.log(`💰 TOTAL RESSOURCES: ${piggyBankAmount + totalSavingsAvailable + totalSurplusAvailable}€`)
      console.log(``)

      // NOTE: Les surplus NE SONT PAS automatiquement transférés vers les économies.
      // Ordre d'utilisation: Tirelire → Économies → Surplus
      // Le surplus restant après équilibrage reste comme "surplus"

      // ÉTAPE 2.1: La tirelire est préservée pour l'étape 2 (auto-répartition)
      // L'utilisateur pourra l'utiliser via l'auto-répartition à l'écran 2
      console.log(`🔄 ÉTAPE 2.1: Tirelire préservée (${piggyBankAmount}€) - sera disponible à l'étape 2`)

      console.log(``)

      // ÉTAPE 2.2: Utiliser les économies proportionnellement
      console.log(`🔄 ÉTAPE 2.2: Utilisation proportionnelle des économies`)

      if (gapACombler > 0) {
        const totalSavingsAvailable = budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)

        if (totalSavingsAvailable > 0) {
          console.log(`   💎 Économies disponibles: ${totalSavingsAvailable}€`)

          const amountToUseFromSavings = Math.min(gapACombler, totalSavingsAvailable)

          for (const budget of budgetsWithSavings) {
            if (budget.cumulated_savings > 0 && gapACombler > 0) {
              const proportion = budget.cumulated_savings / totalSavingsAvailable
              const amountToUse = Math.min(
                proportion * amountToUseFromSavings,
                budget.cumulated_savings
              )

              const newSavings = budget.cumulated_savings - amountToUse

              const { error: updateError } = await supabaseServer
                .from('estimated_budgets')
                .update({
                  cumulated_savings: newSavings,
                  updated_at: new Date().toISOString()
                })
                .eq('id', budget.id)

              if (updateError) {
                throw new Error(`Erreur mise à jour économies ${budget.name}: ${updateError.message}`)
              }

              console.log(`      ✅ ${budget.name}: ${amountToUse.toFixed(2)}€ utilisés (${(proportion * 100).toFixed(1)}%)`)
              console.log(`         Économies: ${budget.cumulated_savings}€ → ${newSavings.toFixed(2)}€`)

              operations.push({
                step: '2.2',
                type: 'use_savings',
                details: {
                  budget_id: budget.id,
                  budget_name: budget.name,
                  amount_used: amountToUse,
                  proportion: proportion,
                  old_savings: budget.cumulated_savings,
                  new_savings: newSavings
                }
              })

              budget.cumulated_savings = newSavings
              gapACombler -= amountToUse
            }
          }

          console.log(`   📉 Gap restant après économies: ${gapACombler.toFixed(2)}€`)
        } else {
          console.log(`   ℹ️ Aucune économie disponible`)
        }
      }

      console.log(``)

      // ÉTAPE 2.3: Consommer le surplus proportionnellement pour combler le gap
      // NOTE: Les déficits sont DÉJÀ inclus dans le calcul du gap, donc on ne crée PAS de crédits
      console.log(`🔄 ÉTAPE 2.3: Consommation du surplus pour combler le gap`)

      if (gapACombler > 0.01) {
        // Calculer le surplus total disponible
        const totalSurplusAvailable = budgetsWithSurplus.reduce((s, b) => s + b.surplus, 0)

        if (totalSurplusAvailable > 0) {
          console.log(`   💰 Surplus disponible: ${totalSurplusAvailable}€`)
          console.log(`   📊 Gap restant: ${gapACombler}€`)

          // Montant de surplus à consommer pour combler le gap
          const surplusToConsume = Math.min(gapACombler, totalSurplusAvailable)
          console.log(`   📉 Surplus à consommer: ${surplusToConsume}€`)

          // Consommer le surplus proportionnellement de chaque budget
          for (const surplusBudget of budgetsWithSurplus) {
            if (surplusBudget.surplus > 0 && gapACombler > 0) {
              // Proportion de ce budget dans le surplus total
              const proportion = surplusBudget.surplus / totalSurplusAvailable
              const amountToConsume = Math.min(
                proportion * surplusToConsume,
                surplusBudget.surplus,
                gapACombler
              )

              // Créer un TRANSFERT FROM surplus budget TO null (couverture du gap)
              // NOTE: On ne crée PAS de dépense car cela diminuerait le RAV
              // Le transfert permet de tracker l'utilisation du surplus sans affecter le RAV
              const { error: transferError } = await supabaseServer
                .from('budget_transfers')
                .insert([{
                  [ownerField]: contextId,
                  from_budget_id: surplusBudget.id,  // FROM = budget avec surplus
                  to_budget_id: null,                 // TO null = couverture du gap
                  transfer_amount: amountToConsume,
                  transfer_reason: `Surplus utilisé pour combler gap (récap mensuel)`,
                  transfer_date: new Date().toISOString().split('T')[0]
                }])

              if (transferError) {
                console.error(`      ❌ Erreur création transfert surplus: ${transferError.message}`)
                continue
              }

              console.log(`      ✅ "${surplusBudget.name}": ${amountToConsume.toFixed(2)}€ surplus utilisé pour gap (${(proportion * 100).toFixed(1)}%)`)

              operations.push({
                step: '2.3',
                type: 'consume_surplus',
                details: {
                  budget_id: surplusBudget.id,
                  budget_name: surplusBudget.name,
                  amount: amountToConsume,
                  proportion: proportion
                }
              })

              surplusBudget.surplus -= amountToConsume
              gapACombler -= amountToConsume
            }
          }

          console.log(`   📉 Gap restant après consommation surplus: ${gapACombler.toFixed(2)}€`)
        } else {
          console.log(`   ⚠️ Aucun surplus disponible dans les budgets`)
        }
      }

      console.log(``)

      // ÉTAPE 2.3.1: Créer des TRANSFERTS vers les budgets déficitaires pour les renflouer
      // IMPORTANT: On ne peut renflouer que le montant qu'on a réellement pu fournir
      // Les ressources utilisées = gap initial - gap résiduel
      console.log(`🔄 ÉTAPE 2.3.1: Création des transferts vers budgets déficitaires`)

      const totalDeficit = budgetsWithDeficit.reduce((s, b) => s + b.deficit, 0)

      // Calculer le montant qu'on a réellement pu fournir pour renflouer
      // C'est le gap initial MOINS le gap résiduel (ce qu'on n'a pas pu couvrir)
      const gapInitial = Math.abs(difference)  // Le gap qu'on devait combler
      const ressourcesUtilisees = gapInitial - gapACombler  // Ce qu'on a réellement pu couvrir

      console.log(`   📉 Déficit total des budgets: ${totalDeficit.toFixed(2)}€`)
      console.log(`   💰 Ressources utilisées pour renflouer: ${ressourcesUtilisees.toFixed(2)}€`)
      console.log(`   ⚠️ Gap non couvert: ${gapACombler.toFixed(2)}€`)

      if (totalDeficit > 0 && ressourcesUtilisees > 0.01) {
        // On ne peut renflouer que proportionnellement aux ressources disponibles
        const montantARenflouer = Math.min(ressourcesUtilisees, totalDeficit)

        for (const deficitBudget of budgetsWithDeficit) {
          if (deficitBudget.deficit > 0) {
            // Proportion de ce déficit dans le total des déficits
            const proportion = deficitBudget.deficit / totalDeficit
            // Montant de renflouage = proportion * ressources disponibles
            const transferAmount = Math.min(proportion * montantARenflouer, deficitBudget.deficit)

            if (transferAmount > 0.01) {
              const { error: transferError } = await supabaseServer
                .from('budget_transfers')
                .insert([{
                  [ownerField]: contextId,
                  from_budget_id: null,  // null = tirelire/ressources générales
                  to_budget_id: deficitBudget.id,
                  transfer_amount: transferAmount,
                  transfer_reason: `Renflouage partiel déficit (récap mensuel)`,
                  transfer_date: new Date().toISOString().split('T')[0]
                }])

              if (transferError) {
                console.error(`      ❌ Erreur création transfert pour "${deficitBudget.name}": ${transferError.message}`)
                continue
              }

              const deficitRestant = deficitBudget.deficit - transferAmount
              console.log(`      ✅ "${deficitBudget.name}": ${transferAmount.toFixed(2)}€ renfloués, déficit restant: ${deficitRestant.toFixed(2)}€`)

              operations.push({
                step: '2.3.1',
                type: 'transfer_to_deficit',
                details: {
                  budget_id: deficitBudget.id,
                  budget_name: deficitBudget.name,
                  transfer_amount: transferAmount,
                  deficit_remaining: deficitRestant
                }
              })

              // NE PAS mettre le déficit à 0, mais soustraire le montant renfloué
              deficitBudget.deficit -= transferAmount
            }
          }
        }

        const totalDeficitRestant = budgetsWithDeficit.reduce((s, b) => s + b.deficit, 0)
        console.log(`   📊 Déficit total restant après renflouage: ${totalDeficitRestant.toFixed(2)}€`)
      } else if (totalDeficit > 0) {
        console.log(`   ⚠️ Aucune ressource disponible pour renflouer les déficits`)
        console.log(`   📊 Déficit non couvert: ${totalDeficit.toFixed(2)}€`)
      } else {
        console.log(`   ℹ️ Aucun déficit à renflouer`)
      }

      console.log(``)

      // ÉTAPE 2.4: Après retour à l'équilibre
      // NOTE: Le surplus restant n'est PAS automatiquement transféré vers économies
      // L'utilisateur pourra le faire manuellement à l'écran 2
      if (gapACombler <= 0.01) {
        console.log(`✅ ÉQUILIBRE ATTEINT`)

        // Récupérer les nouvelles données
        let newFinancialData: any
        if (context === 'profile') {
          newFinancialData = await getProfileFinancialData(contextId)
        } else {
          newFinancialData = await getGroupFinancialData(contextId)
        }

        const newRAV = newFinancialData.remainingToLive
        const newDifference = newRAV - ravBudgetaire

        console.log(`💰 NOUVEAU RAV: ${newRAV}€`)
        console.log(`📊 NOUVELLE DIFFÉRENCE: ${newDifference}€`)

        // ÉTAPE 2.4.1: S'il y a un excédent, le transférer à la tirelire
        if (newDifference > 0) {
          console.log(``)
          console.log(`🔄 ÉTAPE 2.4.1: Transfert excédent vers tirelire`)

          const newPiggyBankAmount = piggyBankAmount + newDifference

          const { error: updateError } = await supabaseServer
            .from('piggy_bank')
            .update({
              amount: newPiggyBankAmount,
              last_updated: new Date().toISOString()
            })
            .eq(ownerField, contextId)

          if (updateError) {
            throw new Error(`Erreur mise à jour tirelire: ${updateError.message}`)
          }

          console.log(`   ✅ Tirelire: ${piggyBankAmount}€ + ${newDifference}€ = ${newPiggyBankAmount}€`)

          operations.push({
            step: '2.4.1',
            type: 'excedent_to_piggy_bank',
            details: {
              excedent_amount: newDifference,
              old_piggy_bank: piggyBankAmount,
              new_piggy_bank: newPiggyBankAmount
            }
          })

          piggyBankAmount = newPiggyBankAmount
        }

        // ÉTAPE 2.4.2: Renflouer budgets déficitaires si possible
        if (budgetsWithDeficit.length > 0 && budgetsWithSavings.some(b => b.cumulated_savings > 0)) {
          console.log(``)
          console.log(`🔄 ÉTAPE 2.4.2: Renflouage des budgets déficitaires`)
          console.log(`   Budgets déficitaires: ${budgetsWithDeficit.length}`)
          console.log(``)

          for (const budget of budgetsWithDeficit) {
            let remainingDeficit = budget.deficit
            console.log(`   💰 Renflouage "${budget.name}": ${remainingDeficit}€ de déficit`)

            // 2.4.2.1: Tirelire préservée pour l'étape 2
            console.log(`      ℹ️ Tirelire (${piggyBankAmount}€) préservée - sera disponible à l'étape 2`)

            // 2.4.2.2: Utiliser les économies proportionnellement
            if (remainingDeficit > 0) {
              const totalSavingsAvailable = budgetsWithSavings.reduce((s, b) => s + b.cumulated_savings, 0)

              if (totalSavingsAvailable > 0) {
                console.log(`      ℹ️ Déficit restant: ${remainingDeficit}€, économies disponibles: ${totalSavingsAvailable}€`)

                for (const savingsBudget of budgetsWithSavings) {
                  if (savingsBudget.cumulated_savings > 0 && remainingDeficit > 0) {
                    const proportion = savingsBudget.cumulated_savings / totalSavingsAvailable
                    const amountFromSavings = Math.min(
                      proportion * remainingDeficit,
                      savingsBudget.cumulated_savings
                    )

                    // Créer un TRANSFERT depuis les économies vers le budget déficitaire
                    const { error: transferError } = await supabaseServer
                      .from('budget_transfers')
                      .insert([{
                        [ownerField]: contextId,
                        from_budget_id: savingsBudget.id,  // source = budget avec économies
                        to_budget_id: budget.id,
                        transfer_amount: amountFromSavings,
                        transfer_reason: `Renflouage déficit depuis économies cumulées (récap)`,
                        transfer_date: new Date().toISOString().split('T')[0]
                      }])

                    if (!transferError) {
                      const newSavings = savingsBudget.cumulated_savings - amountFromSavings

                      const { error: updateError } = await supabaseServer
                        .from('estimated_budgets')
                        .update({
                          cumulated_savings: newSavings,
                          updated_at: new Date().toISOString()
                        })
                        .eq('id', savingsBudget.id)

                      if (!updateError) {
                        console.log(`         ✅ Économies "${savingsBudget.name}": ${amountFromSavings.toFixed(2)}€ → Budget "${budget.name}"`)
                        console.log(`            Économies: ${savingsBudget.cumulated_savings}€ → ${newSavings.toFixed(2)}€`)

                        operations.push({
                          step: '2.4.2.2',
                          type: 'refloat_from_savings',
                          details: {
                            from_budget_id: savingsBudget.id,
                            from_budget_name: savingsBudget.name,
                            to_budget_id: budget.id,
                            to_budget_name: budget.name,
                            amount: amountFromSavings,
                            old_savings: savingsBudget.cumulated_savings,
                            new_savings: newSavings
                          }
                        })

                        savingsBudget.cumulated_savings = newSavings
                        remainingDeficit -= amountFromSavings
                      }
                    } else {
                      console.error(`         ❌ Erreur création transfert économies: ${transferError.message}`)
                    }
                  }
                }
              }
            }

            if (remainingDeficit > 0.01) {
              console.log(`      ⚠️ Déficit résiduel de ${remainingDeficit.toFixed(2)}€ pour "${budget.name}" (ressources épuisées)`)
            }

            console.log(``)
          }
        }
      } else {
        console.log(`⚠️ ÉQUILIBRE IMPOSSIBLE: Gap résiduel de ${gapACombler.toFixed(2)}€`)
        console.log(`   Recommandation: Réduire les budgets estimés ou augmenter les revenus`)
      }

      // Récupérer les données finales
      let finalFinancialData: any
      if (context === 'profile') {
        finalFinancialData = await getProfileFinancialData(contextId)
      } else {
        finalFinancialData = await getGroupFinancialData(contextId)
      }

      console.log(``)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`🎯🎯🎯 RÉSULTAT FINAL - CAS 2 (DÉFICIT)`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`💰 RAV INITIAL: ${ravActuel}€`)
      console.log(`💰 RAV FINAL: ${finalFinancialData.remainingToLive}€`)
      console.log(`💰 RAV BUDGÉTAIRE: ${ravBudgetaire}€`)
      console.log(`📊 DIFFÉRENCE FINALE: ${(finalFinancialData.remainingToLive - ravBudgetaire).toFixed(2)}€`)
      console.log(`🐷 TIRELIRE FINALE: ${piggyBankAmount}€`)
      console.log(`⚠️ GAP RÉSIDUEL: ${gapACombler.toFixed(2)}€`)
      console.log(`📊 OPÉRATIONS EFFECTUÉES: ${operations.length}`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(``)

      return NextResponse.json({
        success: true,
        case: 'deficit',
        initial_rav: ravActuel,
        budgetary_rav: ravBudgetaire,
        final_rav: finalFinancialData.remainingToLive,
        difference: difference,
        gap_residuel: gapACombler,
        is_fully_balanced: gapACombler <= 0.01,
        piggy_bank_final: piggyBankAmount,
        operations_performed: operations,
        timestamp: Date.now()
      })
    }

  } catch (error) {
    console.error('❌ [Process Step1] Erreur lors du rééquilibrage:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
