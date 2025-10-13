import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/auto-balance
 *
 * Répartit automatiquement les économies cumulées et excédents dans les budgets déficitaires
 * de manière proportionnelle et équitable
 *
 * ALGORITHME DE RÉPARTITION PROPORTIONNELLE EN 2 PHASES :
 *
 * PHASE 1 - Utilisation des économies cumulées jusqu'à épuisement :
 * - Utiliser TOUTES les économies disponibles de manière proportionnelle et équitable
 * - Chaque budget avec économies contribue proportionnellement à son montant
 * - Chaque budget en déficit reçoit proportionnellement à son déficit
 * - Formule : Transfert(A→C) = (Économies_A / Total_Économies) × (Déficit_C / Total_Déficits) × Total_Économies
 * - Résultat : Toutes les économies vidées (à ZÉRO)
 *
 * PHASE 2 - Utilisation des surplus SEULEMENT si déficit restant :
 * - CONDITION : S'il reste des déficits après Phase 1
 * - Utiliser les surplus mensuels proportionnellement et équitablement
 * - Chaque budget avec surplus contribue proportionnellement à son montant
 * - Chaque budget en déficit restant reçoit proportionnellement à son déficit
 * - Formule : Transfert(A→C) = (Surplus_A / Total_Surplus) × (Déficit_Restant_C / Total_Déficits_Restants) × Total_Surplus
 *
 * - Distribution équitable et prévisible
 * - PRIORITÉ ABSOLUE : économies → surplus (seulement si nécessaire)
 *
 * EXEMPLE 1 - Économies suffisantes (pas besoin de surplus) :
 * Économies : Budget A (100€), Budget B (50€) → Total: 150€
 * Surplus : Budget A (+200€), Budget B (+100€) → Total: 300€
 * Déficits : Budget C (-90€), Budget D (-60€) → Total: 150€
 *
 * Phase 1 - Utilisation des économies (150€ disponibles, besoin: 150€) :
 * - Budget A (66.67%) → C: 60€, D: 40€ = 100€
 * - Budget B (33.33%) → C: 30€, D: 20€ = 50€
 * Résultat : Économies VIDÉES (0€), Déficits COUVERTS (0€), Phase 2 NON DÉCLENCHÉE
 *
 * EXEMPLE 2 - Économies insuffisantes (surplus nécessaires) :
 * Économies : Budget A (60€), Budget B (40€) → Total: 100€
 * Surplus : Budget A (+100€), Budget B (+50€) → Total: 150€
 * Déficits : Budget C (-90€), Budget D (-60€) → Total: 150€
 *
 * Phase 1 - Utilisation des économies (100€ disponibles) :
 * - Budget A (60%) → C: 36€, D: 24€ = 60€
 * - Budget B (40%) → C: 24€, D: 16€ = 40€
 * Résultat : Économies VIDÉES (0€), Déficits restants : C: -54€, D: -36€ (total: -90€)
 *
 * Phase 2 - Utilisation des surplus (150€ disponibles, besoin: 90€) :
 * - Budget A (66.67%) → C: 36€, D: 24€ = 60€
 * - Budget B (33.33%) → C: 18€, D: 12€ = 30€
 * Résultat : Surplus utilisés (90€), Tous déficits COUVERTS
 *
 * Body: {
 *   context: 'profile' | 'group'
 * }
 *
 * Returns: {
 *   success: true,
 *   transfers: Array<{from_budget_id, to_budget_id, amount, source: 'savings' | 'surplus'}>,
 *   total_transferred: number,
 *   savings_used: number,
 *   surplus_used: number,
 *   remaining_surplus: number,
 *   remaining_deficit: number
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
    const { context = 'profile' } = body

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
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

    const contextId = context === 'profile' ? profile.id : profile.group_id

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    // Récupérer tous les budgets du contexte
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    if (budgetsError || !budgets) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 }
      )
    }

    if (budgets.length === 0) {
      return NextResponse.json(
        { error: 'Aucun budget trouvé' },
        { status: 404 }
      )
    }

    // Récupérer les dépenses réelles
    const { data: expenses, error: expensesError } = await supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount')
      .eq(ownerField, contextId)
      .not('estimated_budget_id', 'is', null)

    if (expensesError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des dépenses' },
        { status: 500 }
      )
    }

    // Récupérer les transferts existants
    const { data: existingTransfers, error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq(ownerField, contextId)

    if (transfersError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des transferts' },
        { status: 500 }
      )
    }

    // Calculer les surplus/déficits en temps réel pour chaque budget
    const budgetsWithStats = budgets.map(budget => {
      // Calculer le montant dépensé
      const spentAmount = (expenses || [])
        .filter(e => e.estimated_budget_id === budget.id)
        .reduce((sum, e) => sum + e.amount, 0)

      // Calculer les ajustements dus aux transferts
      const transfersFrom = (existingTransfers || [])
        .filter(t => t.from_budget_id === budget.id)
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      const transfersTo = (existingTransfers || [])
        .filter(t => t.to_budget_id === budget.id)
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      const adjustedSpentAmount = spentAmount + transfersFrom - transfersTo
      const difference = budget.estimated_amount - adjustedSpentAmount

      return {
        id: budget.id,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        spent_amount: adjustedSpentAmount,
        cumulated_savings: budget.cumulated_savings || 0,
        monthly_surplus: Math.max(0, difference),
        monthly_deficit: Math.max(0, -difference)
      }
    })

    // Séparer les budgets par catégorie
    const budgetsWithSavings = budgetsWithStats.filter(b => b.cumulated_savings > 0)
    const budgetsWithSurplus = budgetsWithStats.filter(b => b.monthly_surplus > 0)
    const budgetsWithDeficit = budgetsWithStats.filter(b => b.monthly_deficit > 0)

    console.log(`⚖️ [Auto Balance] Démarrage pour ${context}:${contextId}`)
    console.log(`⚖️ [Auto Balance] Budgets avec économies: ${budgetsWithSavings.length}`)
    console.log(`⚖️ [Auto Balance] Budgets avec surplus: ${budgetsWithSurplus.length}`)
    console.log(`⚖️ [Auto Balance] Budgets avec déficit: ${budgetsWithDeficit.length}`)

    if (budgetsWithDeficit.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucun budget déficitaire à compenser',
          transfers: []
        }
      )
    }

    if (budgetsWithSavings.length === 0 && budgetsWithSurplus.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucune économie ou surplus disponible pour la répartition',
          transfers: []
        }
      )
    }

    // Calculer les totaux
    const totalSavings = budgetsWithSavings.reduce((sum, b) => sum + b.cumulated_savings, 0)
    const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + b.monthly_surplus, 0)
    const totalDeficit = budgetsWithDeficit.reduce((sum, b) => sum + b.monthly_deficit, 0)

    console.log(`⚖️ [Auto Balance] Économies totales: ${totalSavings}€`)
    console.log(`⚖️ [Auto Balance] Surplus total: ${totalSurplus}€`)
    console.log(`⚖️ [Auto Balance] Déficit total: ${totalDeficit}€`)

    // Stratégie de répartition équilibrée en 2 phases:
    // PHASE 1: Utiliser les économies de manière proportionnelle
    // PHASE 2: Utiliser les surplus de manière proportionnelle si nécessaire
    const transfers: Array<{
      from_budget_id: string
      from_budget_name: string
      to_budget_id: string
      to_budget_name: string
      amount: number
      source: 'savings' | 'surplus'
    }> = []

    const savingsUpdates: Array<{ budget_id: string; old_savings: number; new_savings: number }> = []
    let totalSavingsUsed = 0
    let totalSurplusUsed = 0
    let remainingDeficitToCover = totalDeficit

    // PHASE 1: Utiliser TOUTES les économies disponibles de manière proportionnelle et équitable
    if (totalSavings > 0 && remainingDeficitToCover > 0) {
      console.log(`⚖️ [Auto Balance] === PHASE 1: Utilisation de TOUTES les économies cumulées ===`)
      console.log(`⚖️ [Auto Balance] Économies totales disponibles: ${totalSavings}€`)
      console.log(`⚖️ [Auto Balance] Déficit total à couvrir: ${totalDeficit}€`)

      // Répartition proportionnelle : chaque transfert est calculé selon :
      // Transfert(A→C) = (Économies_A / Total_Économies) × (Déficit_C / Total_Déficits) × Total_Économies
      // Simplifié : Transfert(A→C) = Économies_A × (Déficit_C / Total_Déficits)

      // Pour chaque budget en déficit, calculer combien il doit recevoir
      for (const deficitBudget of budgetsWithDeficit) {
        const deficitProportion = deficitBudget.monthly_deficit / totalDeficit
        const amountNeededForThisDeficit = Math.min(deficitBudget.monthly_deficit, totalSavings * deficitProportion)

        console.log(`⚖️ [Auto Balance] Budget "${deficitBudget.name}": ${deficitBudget.monthly_deficit}€ de déficit, recevra ${amountNeededForThisDeficit.toFixed(2)}€`)

        // Chaque budget avec savings contribue proportionnellement à ce déficit
        for (const savingsBudget of budgetsWithSavings) {
          const savingsProportion = savingsBudget.cumulated_savings / totalSavings

          // Contribution = Part des économies de ce budget × Montant nécessaire pour ce déficit
          const contributionAmount = Math.round(amountNeededForThisDeficit * savingsProportion * 100) / 100

          if (contributionAmount > 0) {
            transfers.push({
              from_budget_id: savingsBudget.id,
              from_budget_name: savingsBudget.name,
              to_budget_id: deficitBudget.id,
              to_budget_name: deficitBudget.name,
              amount: contributionAmount,
              source: 'savings'
            })

            totalSavingsUsed += contributionAmount

            console.log(`  💎 ${savingsBudget.name} (${(savingsProportion * 100).toFixed(1)}%) → ${deficitBudget.name}: ${contributionAmount}€`)
          }
        }
      }

      // Mettre à jour les économies de chaque budget source
      for (const savingsBudget of budgetsWithSavings) {
        const totalUsedFromThisBudget = transfers
          .filter(t => t.from_budget_id === savingsBudget.id && t.source === 'savings')
          .reduce((sum, t) => sum + t.amount, 0)

        const newSavings = savingsBudget.cumulated_savings - totalUsedFromThisBudget

        savingsUpdates.push({
          budget_id: savingsBudget.id,
          old_savings: savingsBudget.cumulated_savings,
          new_savings: newSavings
        })

        console.log(`  💎 ${savingsBudget.name}: ${savingsBudget.cumulated_savings}€ → ${newSavings.toFixed(2)}€ (utilisé: ${totalUsedFromThisBudget.toFixed(2)}€)`)
      }

      console.log(`⚖️ [Auto Balance] Total économies utilisées: ${totalSavingsUsed.toFixed(2)}€ sur ${totalSavings}€ disponibles`)

      remainingDeficitToCover = Math.max(0, totalDeficit - totalSavingsUsed)
      console.log(`⚖️ [Auto Balance] Déficit restant après Phase 1: ${remainingDeficitToCover.toFixed(2)}€`)
    }

    // PHASE 2: Utiliser les surplus SEULEMENT si déficit restant après Phase 1
    if (totalSurplus > 0 && remainingDeficitToCover > 0) {
      console.log(`⚖️ [Auto Balance] === PHASE 2: Utilisation des surplus mensuels (déficit restant détecté) ===`)
      console.log(`⚖️ [Auto Balance] Surplus totaux disponibles: ${totalSurplus}€`)
      console.log(`⚖️ [Auto Balance] Déficit restant à couvrir: ${remainingDeficitToCover.toFixed(2)}€`)

      // Calculer les déficits restants après Phase 1
      const remainingDeficits = budgetsWithDeficit.map(b => {
        const coveredFromSavings = transfers
          .filter(t => t.to_budget_id === b.id && t.source === 'savings')
          .reduce((sum, t) => sum + t.amount, 0)
        return {
          ...b,
          remaining_deficit: Math.max(0, b.monthly_deficit - coveredFromSavings)
        }
      }).filter(b => b.remaining_deficit > 0)

      const totalRemainingDeficit = remainingDeficits.reduce((sum, b) => sum + b.remaining_deficit, 0)

      if (remainingDeficits.length === 0) {
        console.log(`⚖️ [Auto Balance] ✅ Aucun déficit restant, Phase 2 non nécessaire`)
      } else {
        console.log(`⚖️ [Auto Balance] Budgets avec déficit restant: ${remainingDeficits.length}`)

        // Répartition proportionnelle des surplus sur les déficits restants
        // Transfert(A→C) = (Surplus_A / Total_Surplus) × Déficit_Restant_C

        // Pour chaque budget en déficit restant, calculer combien il doit recevoir
        for (const deficitBudget of remainingDeficits) {
          const deficitProportion = deficitBudget.remaining_deficit / totalRemainingDeficit
          const amountNeededForThisDeficit = Math.min(deficitBudget.remaining_deficit, totalSurplus * deficitProportion)

          console.log(`⚖️ [Auto Balance] Budget "${deficitBudget.name}": ${deficitBudget.remaining_deficit}€ de déficit restant, recevra ${amountNeededForThisDeficit.toFixed(2)}€`)

          // Chaque budget avec surplus contribue proportionnellement à ce déficit
          for (const surplusBudget of budgetsWithSurplus) {
            const surplusProportion = surplusBudget.monthly_surplus / totalSurplus

            // Contribution = Part du surplus de ce budget × Montant nécessaire pour ce déficit
            const contributionAmount = Math.round(amountNeededForThisDeficit * surplusProportion * 100) / 100

            if (contributionAmount > 0) {
              transfers.push({
                from_budget_id: surplusBudget.id,
                from_budget_name: surplusBudget.name,
                to_budget_id: deficitBudget.id,
                to_budget_name: deficitBudget.name,
                amount: contributionAmount,
                source: 'surplus'
              })

              totalSurplusUsed += contributionAmount

              console.log(`  📊 ${surplusBudget.name} (${(surplusProportion * 100).toFixed(1)}%) → ${deficitBudget.name}: ${contributionAmount}€`)
            }
          }
        }

        console.log(`⚖️ [Auto Balance] Total surplus utilisés: ${totalSurplusUsed.toFixed(2)}€`)
      }
    } else if (remainingDeficitToCover === 0) {
      console.log(`⚖️ [Auto Balance] ✅ Tous les déficits ont été couverts par les économies, Phase 2 NON déclenchée`)
    }

    if (transfers.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucun transfert nécessaire ou possible',
          transfers: []
        }
      )
    }

    // Exécuter tous les transferts planifiés et les mises à jour
    console.log(`⚖️ [Auto Balance] Exécution de ${transfers.length} transferts`)
    console.log(`⚖️ [Auto Balance] Mises à jour d'économies: ${savingsUpdates.length} budgets`)

    // 1. Mettre à jour les économies cumulées pour les budgets qui ont contribué depuis leurs économies
    for (const update of savingsUpdates) {
      console.log(`💎 Mise à jour économies: ${update.old_savings}€ → ${update.new_savings}€`)

      const { error: updateError } = await supabaseServer
        .from('estimated_budgets')
        .update({
          cumulated_savings: update.new_savings,
          updated_at: new Date().toISOString()
        })
        .eq('id', update.budget_id)

      if (updateError) {
        console.error('❌ Erreur lors de la mise à jour des économies:', updateError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour des économies' },
          { status: 500 }
        )
      }
    }

    // 2. Insérer TOUS les transferts dans budget_transfers
    // Les transferts réduisent le spent_amount des budgets qui reçoivent (transfersTo)
    console.log(`⚖️ [Auto Balance] Enregistrement de ${transfers.length} transferts`)

    const transferInserts = transfers.map(transfer => ({
      [ownerField]: contextId,
      from_budget_id: transfer.from_budget_id,
      to_budget_id: transfer.to_budget_id,
      transfer_amount: transfer.amount,
      transfer_reason: transfer.source === 'savings'
        ? 'Auto-balance via monthly recap (économies cumulées)'
        : 'Auto-balance via monthly recap (surplus mensuel)',
      transfer_date: new Date().toISOString().split('T')[0]
    }))

    const { error: insertError } = await supabaseServer
      .from('budget_transfers')
      .insert(transferInserts)

    if (insertError) {
      console.error('❌ Erreur lors de l\'enregistrement des transferts:', insertError)
      return NextResponse.json(
        { error: 'Erreur lors de l\'enregistrement des transferts' },
        { status: 500 }
      )
    }

    const totalTransferred = totalSavingsUsed + totalSurplusUsed

    // Calculer ce qui reste après répartition
    const remainingDeficit = Math.max(0, totalDeficit - totalTransferred)
    const remainingSavings = Math.max(0, totalSavings - totalSavingsUsed)
    const remainingSurplus = Math.max(0, totalSurplus - totalSurplusUsed)

    console.log(`✅ [Auto Balance] Répartition automatique terminée: ${totalTransferred}€ répartis en ${transfers.length} transferts`)
    console.log(`✅ [Auto Balance]   - Économies utilisées: ${totalSavingsUsed}€`)
    console.log(`✅ [Auto Balance]   - Surplus utilisés: ${totalSurplusUsed}€`)
    console.log(`✅ [Auto Balance] Économies restantes: ${remainingSavings}€`)
    console.log(`✅ [Auto Balance] Surplus restant: ${remainingSurplus}€`)
    console.log(`✅ [Auto Balance] Déficit restant: ${remainingDeficit}€`)

    return NextResponse.json({
      success: true,
      message: `Répartition automatique effectuée: ${totalTransferred}€ répartis équitablement (${totalSavingsUsed}€ économies + ${totalSurplusUsed}€ surplus)`,
      transfers,
      total_transferred: totalTransferred,
      savings_used: totalSavingsUsed,
      surplus_used: totalSurplusUsed,
      transfers_count: transfers.length,
      remaining_savings: remainingSavings,
      remaining_surplus: remainingSurplus,
      remaining_deficit: remainingDeficit
    })

  } catch (error) {
    console.error('❌ Erreur lors de la répartition automatique:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}