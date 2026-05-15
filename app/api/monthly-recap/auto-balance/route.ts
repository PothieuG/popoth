import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { TablesInsert } from '@/lib/database.types'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { transferWithSavingsDebit } from '@/lib/finance/budget-transfers'
import { asContextFilter } from '@/lib/finance/context'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { autoBalanceBodySchema } from '@/lib/schemas/recap'
import { logger } from '@/lib/logger'

/**
 * API POST /api/monthly-recap/auto-balance
 *
 * Répartit automatiquement la tirelire, les économies cumulées et excédents dans les budgets déficitaires
 * de manière proportionnelle et équitable
 *
 * ALGORITHME DE RÉPARTITION PROPORTIONNELLE EN 3 PHASES :
 *
 * PHASE 0 - Utilisation de la TIRELIRE (revenus exceptionnels) en priorité :
 * - PRIORITÉ ABSOLUE : Utiliser d'abord la tirelire si disponible
 * - La tirelire est répartie proportionnellement entre tous les déficits
 * - Chaque budget en déficit reçoit : (Déficit / Total_Déficits) × Tirelire
 * - Résultat : Tirelire vidée (à ZÉRO) ou partiellement utilisée
 *
 * PHASE 1 - Utilisation des économies cumulées (si déficit restant) :
 * - CONDITION : S'il reste des déficits après Phase 0
 * - Utiliser TOUTES les économies disponibles de manière proportionnelle et équitable
 * - Chaque budget avec économies contribue proportionnellement à son montant
 * - Chaque budget en déficit reçoit proportionnellement à son déficit
 * - Formule : Transfert(A→C) = (Économies_A / Total_Économies) × (Déficit_C / Total_Déficits) × Total_Économies
 * - Résultat : Toutes les économies vidées (à ZÉRO)
 *
 * PHASE 2 - Utilisation des surplus (si déficit restant) :
 * - CONDITION : S'il reste des déficits après Phase 0 et Phase 1
 * - Utiliser les surplus mensuels proportionnellement et équitablement
 * - Chaque budget avec surplus contribue proportionnellement à son montant
 * - Chaque budget en déficit restant reçoit proportionnellement à son déficit
 * - Formule : Transfert(A→C) = (Surplus_A / Total_Surplus) × (Déficit_Restant_C / Total_Déficits_Restants) × Total_Surplus
 *
 * - Distribution équitable et prévisible
 * - PRIORITÉ ABSOLUE : tirelire → économies → surplus (seulement si nécessaire)
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
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context } = await parseBody(request, autoBalanceBodySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!

    // Récupérer tous les budgets du contexte
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerField, contextId)

    if (budgetsError || !budgets) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 },
      )
    }

    if (budgets.length === 0) {
      return NextResponse.json({ error: 'Aucun budget trouvé' }, { status: 404 })
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
        { status: 500 },
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
        { status: 500 },
      )
    }

    // Calculer les surplus/déficits en temps réel pour chaque budget
    const budgetsWithStats = budgets.map((budget) => {
      // Calculer le montant dépensé
      const spentAmount = (expenses || [])
        .filter((e) => e.estimated_budget_id === budget.id)
        .reduce((sum, e) => sum + e.amount, 0)

      // Calculer les ajustements dus aux transferts
      const transfersFrom = (existingTransfers || [])
        .filter((t) => t.from_budget_id === budget.id)
        .reduce((sum, t) => sum + t.transfer_amount, 0)

      const transfersTo = (existingTransfers || [])
        .filter((t) => t.to_budget_id === budget.id)
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
        monthly_deficit: Math.max(0, -difference),
      }
    })

    // Récupérer la tirelire depuis la table piggy_bank
    const { data: piggyBankData, error: piggyBankError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .maybeSingle()

    let piggyBank = 0
    if (piggyBankData && !piggyBankError) {
      piggyBank = piggyBankData.amount || 0
    } else if (piggyBankError) {
      logger.warn('[Auto Balance] Erreur récupération tirelire (fail-soft)', piggyBankError)
    }

    // Séparer les budgets par catégorie
    const budgetsWithSavings = budgetsWithStats.filter((b) => b.cumulated_savings > 0)
    const budgetsWithSurplus = budgetsWithStats.filter((b) => b.monthly_surplus > 0)
    const budgetsWithDeficit = budgetsWithStats.filter((b) => b.monthly_deficit > 0)

    if (budgetsWithDeficit.length === 0) {
      return NextResponse.json({
        message: 'Aucun budget déficitaire à compenser',
        transfers: [],
      })
    }

    if (piggyBank === 0 && budgetsWithSavings.length === 0 && budgetsWithSurplus.length === 0) {
      return NextResponse.json({
        message: 'Aucune tirelire, économie ou surplus disponible pour la répartition',
        transfers: [],
      })
    }

    // Calculer les totaux
    const totalSavings = budgetsWithSavings.reduce((sum, b) => sum + b.cumulated_savings, 0)
    const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + b.monthly_surplus, 0)
    const totalDeficit = budgetsWithDeficit.reduce((sum, b) => sum + b.monthly_deficit, 0)

    // Stratégie de répartition équilibrée en 3 phases:
    // PHASE 0: Utiliser la tirelire en priorité
    // PHASE 1: Utiliser les économies de manière proportionnelle
    // PHASE 2: Utiliser les surplus de manière proportionnelle si nécessaire
    const transfers: Array<{
      from_budget_id: string | null
      from_budget_name: string
      to_budget_id: string
      to_budget_name: string
      amount: number
      source: 'piggy_bank' | 'savings' | 'surplus'
    }> = []

    let totalPiggyBankUsed = 0
    let totalSavingsUsed = 0
    let totalSurplusUsed = 0
    let remainingDeficitToCover = totalDeficit

    // PHASE 0: Utiliser la TIRELIRE en PRIORITÉ ABSOLUE
    if (piggyBank > 0 && remainingDeficitToCover > 0) {
      // Répartition proportionnelle de la tirelire entre tous les déficits
      // Chaque budget en déficit reçoit : (Déficit / Total_Déficits) × Min(Tirelire, Total_Déficits)
      const amountToDistribute = Math.min(piggyBank, totalDeficit)

      for (const deficitBudget of budgetsWithDeficit) {
        const deficitProportion = deficitBudget.monthly_deficit / totalDeficit
        const contributionAmount = Math.round(amountToDistribute * deficitProportion * 100) / 100

        if (contributionAmount > 0) {
          transfers.push({
            from_budget_id: null, // La tirelire n'est pas associée à un budget
            from_budget_name: 'Tirelire 🐷',
            to_budget_id: deficitBudget.id,
            to_budget_name: deficitBudget.name,
            amount: contributionAmount,
            source: 'piggy_bank',
          })

          totalPiggyBankUsed += contributionAmount
        }
      }

      remainingDeficitToCover = Math.max(0, totalDeficit - totalPiggyBankUsed)
    }

    // PHASE 1: Utiliser TOUTES les économies disponibles de manière proportionnelle et équitable (si déficit restant)
    if (totalSavings > 0 && remainingDeficitToCover > 0) {
      // Calculer les déficits restants après Phase 0
      const remainingDeficitsPhase1 = budgetsWithDeficit
        .map((b) => {
          const coveredFromPiggyBank = transfers
            .filter((t) => t.to_budget_id === b.id && t.source === 'piggy_bank')
            .reduce((sum, t) => sum + t.amount, 0)
          return {
            ...b,
            remaining_deficit: Math.max(0, b.monthly_deficit - coveredFromPiggyBank),
          }
        })
        .filter((b) => b.remaining_deficit > 0)

      const totalRemainingDeficitPhase1 = remainingDeficitsPhase1.reduce(
        (sum, b) => sum + b.remaining_deficit,
        0,
      )

      // Répartition proportionnelle : chaque transfert est calculé selon :
      // Transfert(A→C) = Économies_A × (Déficit_Restant_C / Total_Déficits_Restants)

      // Pour chaque budget en déficit restant, calculer combien il doit recevoir
      for (const deficitBudget of remainingDeficitsPhase1) {
        const deficitProportion = deficitBudget.remaining_deficit / totalRemainingDeficitPhase1
        const amountNeededForThisDeficit = Math.min(
          deficitBudget.remaining_deficit,
          totalSavings * deficitProportion,
        )

        // Chaque budget avec savings contribue proportionnellement à ce déficit
        for (const savingsBudget of budgetsWithSavings) {
          // IMPORTANT: Un budget ne peut pas se transférer à lui-même
          if (savingsBudget.id === deficitBudget.id) {
            continue
          }

          const savingsProportion = savingsBudget.cumulated_savings / totalSavings

          // Contribution = Part des économies de ce budget × Montant nécessaire pour ce déficit
          const contributionAmount =
            Math.round(amountNeededForThisDeficit * savingsProportion * 100) / 100

          if (contributionAmount > 0) {
            transfers.push({
              from_budget_id: savingsBudget.id,
              from_budget_name: savingsBudget.name,
              to_budget_id: deficitBudget.id,
              to_budget_name: deficitBudget.name,
              amount: contributionAmount,
              source: 'savings',
            })

            totalSavingsUsed += contributionAmount
          }
        }
      }

      remainingDeficitToCover = Math.max(0, totalDeficit - totalSavingsUsed)
    }

    // PHASE 2: Utiliser les surplus SEULEMENT si déficit restant après Phase 0 et Phase 1
    if (totalSurplus > 0 && remainingDeficitToCover > 0) {
      // Calculer les déficits restants après Phase 0 et Phase 1
      const remainingDeficits = budgetsWithDeficit
        .map((b) => {
          const coveredFromPiggyBank = transfers
            .filter((t) => t.to_budget_id === b.id && t.source === 'piggy_bank')
            .reduce((sum, t) => sum + t.amount, 0)
          const coveredFromSavings = transfers
            .filter((t) => t.to_budget_id === b.id && t.source === 'savings')
            .reduce((sum, t) => sum + t.amount, 0)
          return {
            ...b,
            remaining_deficit: Math.max(
              0,
              b.monthly_deficit - coveredFromPiggyBank - coveredFromSavings,
            ),
          }
        })
        .filter((b) => b.remaining_deficit > 0)

      const totalRemainingDeficit = remainingDeficits.reduce(
        (sum, b) => sum + b.remaining_deficit,
        0,
      )

      if (remainingDeficits.length > 0) {
        // Répartition proportionnelle des surplus sur les déficits restants
        // Transfert(A→C) = (Surplus_A / Total_Surplus) × Déficit_Restant_C

        // Pour chaque budget en déficit restant, calculer combien il doit recevoir
        for (const deficitBudget of remainingDeficits) {
          const deficitProportion = deficitBudget.remaining_deficit / totalRemainingDeficit
          const amountNeededForThisDeficit = Math.min(
            deficitBudget.remaining_deficit,
            totalSurplus * deficitProportion,
          )

          // Chaque budget avec surplus contribue proportionnellement à ce déficit
          for (const surplusBudget of budgetsWithSurplus) {
            // IMPORTANT: Un budget ne peut pas se transférer à lui-même
            if (surplusBudget.id === deficitBudget.id) {
              continue
            }

            const surplusProportion = surplusBudget.monthly_surplus / totalSurplus

            // Contribution = Part du surplus de ce budget × Montant nécessaire pour ce déficit
            const contributionAmount =
              Math.round(amountNeededForThisDeficit * surplusProportion * 100) / 100

            if (contributionAmount > 0) {
              transfers.push({
                from_budget_id: surplusBudget.id,
                from_budget_name: surplusBudget.name,
                to_budget_id: deficitBudget.id,
                to_budget_name: deficitBudget.name,
                amount: contributionAmount,
                source: 'surplus',
              })

              totalSurplusUsed += contributionAmount
            }
          }
        }
      }
    }

    if (transfers.length === 0) {
      return NextResponse.json({
        message: 'Aucun transfert nécessaire ou possible',
        transfers: [],
      })
    }

    // Shared context filter used by atomic savings transfers and piggy bank debit.
    const filter = asContextFilter(
      ownerField === 'profile_id' ? { profile_id: contextId } : { group_id: contextId },
    )

    // 1. Apply savings transfers atomically per (from, to) pair via composite RPC.
    //    Each call composes INSERT budget_transfers + debit cumulated_savings into a
    //    single Postgres transaction — Sprint Auto-Balance-Atomic (mirror
    //    lib/recap/step1-persist.ts step 2.4.2 / Sprint Refactor-I5-followup-v2).
    //    Pre-refactor this was the reversed pattern (aggregate debit per FROM, then
    //    batched INSERT): an INSERT failure after debits succeeded left orphan
    //    cumulated_savings reductions with no audit-trail row. Fail-soft on any
    //    individual transfer — the Postgres tx rolls back atomically, no risk of
    //    half-applied state for that pair.
    const savingsTransfers = transfers.filter(
      (t) => t.source === 'savings' && t.from_budget_id !== null,
    )
    for (const transfer of savingsTransfers) {
      try {
        await transferWithSavingsDebit(filter, {
          fromBudgetId: transfer.from_budget_id!,
          toBudgetId: transfer.to_budget_id,
          amount: transfer.amount,
          reason: 'Auto-balance via monthly recap (économies cumulées)',
        })
      } catch (error) {
        logger.warn('[Auto Balance] transferWithSavingsDebit failed (fail-soft)', {
          fromBudgetId: transfer.from_budget_id,
          toBudgetId: transfer.to_budget_id,
          amount: transfer.amount,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 2a. Traiter les transferts depuis la tirelire
    // La tirelire est stockée dans la table piggy_bank.
    // Quand on l'utilise, on doit:
    // 1. Déduire le montant utilisé de piggy_bank.amount
    // 2. Créer des budget_transfers avec from_budget_id = null pour représenter la tirelire
    //    Cela permet aux budgets déficitaires de voir leur transfersTo augmenter
    //    et donc de réduire leur déficit ajusté
    const transfersFromPiggyBank = transfers.filter((t) => t.from_budget_id === null)

    if (transfersFromPiggyBank.length > 0 && totalPiggyBankUsed > 0) {
      // 1. Déduire le montant utilisé de la tirelire (atomique via RPC)
      const newPiggyBankAmount = Math.max(0, piggyBank - totalPiggyBankUsed)
      const piggyDelta = newPiggyBankAmount - piggyBank

      try {
        await updatePiggyBank(filter, piggyDelta)
      } catch (updateError) {
        logger.error('[Auto Balance] Erreur mise à jour tirelire', updateError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour de la tirelire' },
          { status: 500 },
        )
      }

      // 2. Créer des budget_transfers pour chaque budget qui reçoit de l'argent de la tirelire
      // IMPORTANT: from_budget_id = null représente la tirelire
      // Ces transferts seront comptés dans transfersTo pour réduire le déficit
      const piggyBankTransfers: TablesInsert<'budget_transfers'>[] = transfersFromPiggyBank.map(
        (transfer) => {
          const base = {
            from_budget_id: null, // null = tirelire (revenus exceptionnels)
            to_budget_id: transfer.to_budget_id,
            transfer_amount: transfer.amount,
            transfer_reason: `Tirelire → ${transfer.to_budget_name} (auto-balance récap)`,
            transfer_date: new Date().toISOString().split('T')[0]!,
          }
          return context === 'profile'
            ? { ...base, profile_id: contextId }
            : { ...base, group_id: contextId }
        },
      )

      const { error: transferError } = await supabaseServer
        .from('budget_transfers')
        .insert(piggyBankTransfers)

      if (transferError) {
        logger.error('[Auto Balance] Erreur création transferts depuis tirelire', transferError)
        return NextResponse.json(
          { error: "Erreur lors de l'application de la tirelire" },
          { status: 500 },
        )
      }
    }

    // 2b. Insérer les transferts surplus (depuis budgets surplus → budgets déficitaires).
    //     Surplus n'est pas stocké comme colonne (computed via real_expenses +
    //     budget_transfers), donc pas de debit associé — un INSERT seul suffit.
    //     Les transferts savings ont déjà été insérés par transferWithSavingsDebit
    //     ci-dessus.
    const surplusTransfers = transfers.filter(
      (t) => t.source === 'surplus' && t.from_budget_id !== null,
    )

    if (surplusTransfers.length > 0) {
      const transferInserts: TablesInsert<'budget_transfers'>[] = surplusTransfers.map(
        (transfer) => {
          const base = {
            from_budget_id: transfer.from_budget_id,
            to_budget_id: transfer.to_budget_id,
            transfer_amount: transfer.amount,
            transfer_reason: 'Auto-balance via monthly recap (surplus mensuel)',
            transfer_date: new Date().toISOString().split('T')[0]!,
          }
          return context === 'profile'
            ? { ...base, profile_id: contextId }
            : { ...base, group_id: contextId }
        },
      )

      const { error: insertError } = await supabaseServer
        .from('budget_transfers')
        .insert(transferInserts)

      if (insertError) {
        logger.error('[Auto Balance] Erreur enregistrement transferts surplus', {
          transfersAttempted: transferInserts.length,
          transfers: transferInserts,
          error: insertError,
        })
        return NextResponse.json(
          {
            error: "Erreur lors de l'enregistrement des transferts surplus",
            details: insertError.message || 'Erreur inconnue',
            transfers_attempted: transferInserts.length,
          },
          { status: 500 },
        )
      }
    }

    const totalTransferred = totalPiggyBankUsed + totalSavingsUsed + totalSurplusUsed

    // Calculer ce qui reste après répartition
    const remainingDeficit = Math.max(0, totalDeficit - totalTransferred)
    const remainingSavings = Math.max(0, totalSavings - totalSavingsUsed)
    const remainingSurplus = Math.max(0, totalSurplus - totalSurplusUsed)
    const remainingPiggyBank = Math.max(0, piggyBank - totalPiggyBankUsed)

    // Construire le message en fonction de ce qui a été utilisé
    const messageParts = []
    if (totalPiggyBankUsed > 0) messageParts.push(`${totalPiggyBankUsed}€ tirelire`)
    if (totalSavingsUsed > 0) messageParts.push(`${totalSavingsUsed}€ économies`)
    if (totalSurplusUsed > 0) messageParts.push(`${totalSurplusUsed}€ surplus`)

    return NextResponse.json({
      success: true,
      message: `Répartition automatique effectuée: ${totalTransferred}€ répartis équitablement (${messageParts.join(' + ')})`,
      transfers,
      total_transferred: totalTransferred,
      piggy_bank_used: totalPiggyBankUsed,
      savings_used: totalSavingsUsed,
      surplus_used: totalSurplusUsed,
      transfers_count: transfers.length,
      remaining_piggy_bank: remainingPiggyBank,
      remaining_savings: remainingSavings,
      remaining_surplus: remainingSurplus,
      remaining_deficit: remainingDeficit,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
