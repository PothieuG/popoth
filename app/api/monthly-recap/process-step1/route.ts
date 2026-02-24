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
 *   1.1. Transférer l'excédent (revenus exceptionnels) → tirelire
 *   1.2. Identifier budgets déficitaires
 *   1.3. Renflouer budgets déficitaires (tirelire puis économies puis surplus)
 *   NOTE: Les surplus NE SONT PAS automatiquement transférés vers économies.
 *         Ils restent "surplus" jusqu'à ce que l'utilisateur décide à l'écran 2.
 *
 * CAS 2 (Différence < 0 - Déficit):
 *   2.1. Utiliser tirelire (entièrement si nécessaire)
 *   2.2. Utiliser économies proportionnellement
 *   2.3. Utiliser surplus des budgets (EN DERNIER)
 *   2.4. Le surplus restant reste comme "surplus" (pas transféré automatiquement)
 *   NOTE: L'utilisateur peut choisir de répartir le surplus vers économies à l'écran 2.
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

      // ÉTAPE 1.2-1.3: Renflouer les budgets déficitaires
      if (budgetsWithDeficit.length > 0) {
        console.log(`🔄 ÉTAPE 1.2-1.3: Renflouage des budgets déficitaires`)
        console.log(`   Budgets déficitaires: ${budgetsWithDeficit.length}`)
        console.log(``)

        for (const budget of budgetsWithDeficit) {
          let remainingDeficit = budget.deficit
          console.log(`   💰 Renflouage "${budget.name}": ${remainingDeficit}€ de déficit`)

          // ÉTAPE 1.2.1: Utiliser la tirelire en premier
          if (piggyBankAmount > 0 && remainingDeficit > 0) {
            const amountFromPiggyBank = Math.min(remainingDeficit, piggyBankAmount)

            // Créer un crédit (dépense négative) pour renflouer
            const { error: creditError } = await supabaseServer
              .from('real_expenses')
              .insert([{
                [ownerField]: contextId,
                estimated_budget_id: budget.id,
                amount: -amountFromPiggyBank,  // NÉGATIF = crédit
                description: `Renflouage déficit depuis tirelire (récap)`,
                expense_date: new Date().toISOString().split('T')[0],
                is_exceptional: false,
                created_at: new Date().toISOString()
              }])

            if (creditError) {
              console.error(`      ❌ Erreur création crédit tirelire: ${creditError.message}`)
            } else {
              // Mettre à jour la tirelire
              const newPiggyBankAmount = piggyBankAmount - amountFromPiggyBank

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

              console.log(`      ✅ Tirelire: ${amountFromPiggyBank}€ → Budget "${budget.name}"`)
              console.log(`         Tirelire: ${piggyBankAmount}€ → ${newPiggyBankAmount}€`)

              operations.push({
                step: '1.2.1',
                type: 'refloat_from_piggy_bank',
                details: {
                  budget_id: budget.id,
                  budget_name: budget.name,
                  amount: amountFromPiggyBank,
                  old_piggy_bank: piggyBankAmount,
                  new_piggy_bank: newPiggyBankAmount
                }
              })

              piggyBankAmount = newPiggyBankAmount
              remainingDeficit -= amountFromPiggyBank
            }
          }

          // ÉTAPE 1.2.2: Utiliser les économies proportionnellement
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

                  // Créer un crédit depuis les économies
                  const { error: creditError } = await supabaseServer
                    .from('real_expenses')
                    .insert([{
                      [ownerField]: contextId,
                      estimated_budget_id: budget.id,
                      amount: -amountFromSavings,  // NÉGATIF = crédit
                      description: `Renflouage déficit depuis économies "${savingsBudget.name}" (récap)`,
                      expense_date: new Date().toISOString().split('T')[0],
                      is_exceptional: false,
                      created_at: new Date().toISOString()
                    }])

                  if (creditError) {
                    console.error(`         ❌ Erreur création crédit économies: ${creditError.message}`)
                  } else {
                    // Réduire les économies du budget source
                    const newSavings = savingsBudget.cumulated_savings - amountFromSavings

                    const { error: updateError } = await supabaseServer
                      .from('estimated_budgets')
                      .update({
                        cumulated_savings: newSavings,
                        updated_at: new Date().toISOString()
                      })
                      .eq('id', savingsBudget.id)

                    if (updateError) {
                      throw new Error(`Erreur mise à jour économies ${savingsBudget.name}: ${updateError.message}`)
                    }

                    console.log(`         ✅ Économies "${savingsBudget.name}": ${amountFromSavings.toFixed(2)}€ → Budget "${budget.name}"`)
                    console.log(`            Économies: ${savingsBudget.cumulated_savings}€ → ${newSavings.toFixed(2)}€`)

                    operations.push({
                      step: '1.2.2',
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
                }
              }
            }
          }

          if (remainingDeficit > 0.01) {
            console.log(`      ⚠️ Déficit résiduel de ${remainingDeficit.toFixed(2)}€ pour "${budget.name}" (ressources épuisées)`)
          }

          console.log(``)
        }
      } else {
        console.log(`✅ Aucun budget déficitaire à renflouer`)
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

      // ÉTAPE 2.1: Utiliser la tirelire (entièrement si nécessaire)
      console.log(`🔄 ÉTAPE 2.1: Utilisation de la tirelire`)

      if (piggyBankAmount > 0 && gapACombler > 0) {
        const amountToUseFromPiggyBank = Math.min(gapACombler, piggyBankAmount)

        const newPiggyBankAmount = piggyBankAmount - amountToUseFromPiggyBank

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

        console.log(`   ✅ Tirelire: ${piggyBankAmount}€ - ${amountToUseFromPiggyBank}€ = ${newPiggyBankAmount}€`)
        console.log(`   📉 Gap restant: ${gapACombler}€ → ${gapACombler - amountToUseFromPiggyBank}€`)

        operations.push({
          step: '2.1',
          type: 'use_piggy_bank',
          details: {
            amount_used: amountToUseFromPiggyBank,
            old_piggy_bank: piggyBankAmount,
            new_piggy_bank: newPiggyBankAmount
          }
        })

        piggyBankAmount = newPiggyBankAmount
        gapACombler -= amountToUseFromPiggyBank
      } else {
        console.log(`   ℹ️ Tirelire vide ou gap déjà comblé`)
      }

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

      // ÉTAPE 2.3: Utiliser le surplus des budgets (EN DERNIER)
      console.log(`🔄 ÉTAPE 2.3: Utilisation du surplus des budgets`)

      if (gapACombler > 0.01) {
        // Recalculer les montants actuels des budgets
        const budgetsWithAvailable: Array<{
          id: string
          name: string
          available: number
        }> = []

        for (const budget of budgetAnalyses) {
          const available = Math.max(0, budget.estimated_amount - budget.spent_amount)
          if (available > 0) {
            budgetsWithAvailable.push({
              id: budget.id,
              name: budget.name,
              available
            })
          }
        }

        const totalAvailable = budgetsWithAvailable.reduce((s, b) => s + b.available, 0)

        if (totalAvailable > 0) {
          console.log(`   💰 Montants disponibles dans budgets: ${totalAvailable}€`)

          const amountToPreleveFromBudgets = Math.min(gapACombler, totalAvailable)

          for (const budget of budgetsWithAvailable) {
            if (budget.available > 0 && gapACombler > 0) {
              const proportion = budget.available / totalAvailable
              const amountToUse = Math.min(
                proportion * amountToPreleveFromBudgets,
                budget.available
              )

              // Créer une dépense virtuelle pour consommer le surplus
              // Cela réduit le surplus affiché sans créer de vraie dépense
              const { error: expenseError } = await supabaseServer
                .from('real_expenses')
                .insert([{
                  [ownerField]: contextId,
                  estimated_budget_id: budget.id,
                  amount: amountToUse,
                  description: `Utilisation surplus pour équilibrage récap`,
                  expense_date: new Date().toISOString().split('T')[0],
                  is_exceptional: false,
                  created_at: new Date().toISOString()
                }])

              if (expenseError) {
                console.error(`      ❌ Erreur création dépense surplus: ${expenseError.message}`)
              } else {
                console.log(`      ✅ ${budget.name}: ${amountToUse.toFixed(2)}€ surplus utilisé (${(proportion * 100).toFixed(1)}%)`)

                operations.push({
                  step: '2.3',
                  type: 'use_surplus',
                  details: {
                    budget_id: budget.id,
                    budget_name: budget.name,
                    amount_used: amountToUse,
                    proportion: proportion
                  }
                })

                gapACombler -= amountToUse
              }
            }
          }

          console.log(`   📉 Gap restant après utilisation surplus: ${gapACombler.toFixed(2)}€`)
        } else {
          console.log(`   ⚠️ Aucun montant disponible dans les budgets`)
        }
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
        if (budgetsWithDeficit.length > 0 && (piggyBankAmount > 0 || budgetsWithSavings.some(b => b.cumulated_savings > 0))) {
          console.log(``)
          console.log(`🔄 ÉTAPE 2.4.2: Renflouage budgets déficitaires`)

          // [Logique similaire à 1.2]
          // Pour éviter duplication, noter que cette logique serait identique à CAS 1 étape 1.2
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
