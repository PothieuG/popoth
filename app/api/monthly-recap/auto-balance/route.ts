import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/auto-balance
 *
 * Répartit automatiquement les excédents dans les budgets déficitaires
 * de manière proportionnelle et équitable
 *
 * ALGORITHME DE RÉPARTITION PROPORTIONNELLE :
 * - Chaque budget avec surplus contribue selon sa proportion du total
 * - Formule : Contribution = (Surplus du budget / Surplus total) × Déficit à couvrir
 * - Tous les déficits sont traités simultanément en une seule fois
 * - Distribution équitable et prévisible
 *
 * EXEMPLE :
 * Surplus : Budget A (+100€), Budget B (+50€) → Total: 150€
 * Déficits : Budget C (-90€), Budget D (-60€)
 *
 * Répartition :
 * - Budget A (66.67%) contribue : 60€ vers C, 40€ vers D
 * - Budget B (33.33%) contribue : 30€ vers C, 20€ vers D
 *
 * Résultat : Tous les déficits couverts proportionnellement
 *
 * Body: {
 *   context: 'profile' | 'group'
 * }
 *
 * Returns: {
 *   success: true,
 *   transfers: Array<{from_budget_id, to_budget_id, amount}>,
 *   total_transferred: number,
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
      .select('id, name, estimated_amount')
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
        monthly_surplus: Math.max(0, difference),
        monthly_deficit: Math.max(0, -difference)
      }
    })

    // Séparer les budgets avec surplus et déficit
    const budgetsWithSurplus = budgetsWithStats.filter(b => b.monthly_surplus > 0)
    const budgetsWithDeficit = budgetsWithStats.filter(b => b.monthly_deficit > 0)

    console.log(`⚖️ [Auto Balance] Démarrage pour ${context}:${contextId}`)
    console.log(`⚖️ [Auto Balance] Budgets avec surplus: ${budgetsWithSurplus.length}`)
    console.log(`⚖️ [Auto Balance] Budgets avec déficit: ${budgetsWithDeficit.length}`)

    if (budgetsWithSurplus.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucun budget avec surplus disponible pour la répartition',
          transfers: []
        }
      )
    }

    if (budgetsWithDeficit.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucun budget déficitaire à compenser',
          transfers: []
        }
      )
    }

    // Calculer les totaux
    const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + (b.monthly_surplus || 0), 0)
    const totalDeficit = budgetsWithDeficit.reduce((sum, b) => sum + (b.monthly_deficit || 0), 0)

    console.log(`⚖️ [Auto Balance] Surplus total: ${totalSurplus}€, Déficit total: ${totalDeficit}€`)

    if (totalSurplus === 0) {
      return NextResponse.json(
        {
          message: 'Aucun surplus disponible pour la répartition',
          transfers: []
        }
      )
    }

    // Stratégie de répartition équilibrée:
    // Chaque budget avec surplus contribue proportionnellement à son surplus
    // pour couvrir TOUS les déficits en une seule fois
    const transfers = []

    // Montant total à redistribuer (le minimum entre surplus total et déficit total)
    const amountToRedistribute = Math.min(totalSurplus, totalDeficit)

    console.log(`⚖️ [Auto Balance] Montant total à redistribuer: ${amountToRedistribute}€`)
    console.log(`⚖️ [Auto Balance] Surplus disponible: ${totalSurplus}€`)
    console.log(`⚖️ [Auto Balance] Déficit total: ${totalDeficit}€`)

    // Pour chaque budget en déficit
    for (const deficitBudget of budgetsWithDeficit) {
      const deficitAmount = deficitBudget.monthly_deficit

      console.log(`⚖️ [Auto Balance] Compensation pour "${deficitBudget.name}": ${deficitAmount}€ de déficit`)

      // Chaque budget avec surplus contribue proportionnellement
      for (const surplusBudget of budgetsWithSurplus) {
        const surplusAmount = surplusBudget.monthly_surplus

        // Calculer la contribution de ce budget surplus au déficit actuel
        // Contribution = (surplus de ce budget / surplus total) * déficit à couvrir
        const proportion = surplusAmount / totalSurplus
        const contributionAmount = Math.round(deficitAmount * proportion * 100) / 100

        if (contributionAmount > 0) {
          transfers.push({
            from_budget_id: surplusBudget.id,
            from_budget_name: surplusBudget.name,
            to_budget_id: deficitBudget.id,
            to_budget_name: deficitBudget.name,
            amount: contributionAmount
          })

          console.log(`⚖️ [Auto Balance] Planifié: ${contributionAmount}€ (${(proportion * 100).toFixed(1)}%) de "${surplusBudget.name}" vers "${deficitBudget.name}"`)
        }
      }
    }

    if (transfers.length === 0) {
      return NextResponse.json(
        {
          message: 'Aucun transfert nécessaire ou possible',
          transfers: []
        }
      )
    }

    // Exécuter tous les transferts planifiés en les enregistrant dans budget_transfers
    console.log(`⚖️ [Auto Balance] Exécution de ${transfers.length} transferts`)

    const transferInserts = transfers.map(transfer => ({
      [ownerField]: contextId,
      from_budget_id: transfer.from_budget_id,
      to_budget_id: transfer.to_budget_id,
      transfer_amount: transfer.amount,
      transfer_reason: 'Auto-balance via monthly recap',
      transfer_date: new Date().toISOString().split('T')[0]
    }))

    // Insérer tous les transferts
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

    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0)

    // Calculer ce qui reste après répartition
    const remainingDeficit = Math.max(0, totalDeficit - totalTransferred)
    const remainingSurplus = Math.max(0, totalSurplus - totalTransferred)

    console.log(`✅ [Auto Balance] Répartition automatique terminée: ${totalTransferred}€ répartis en ${transfers.length} transferts`)
    console.log(`✅ [Auto Balance] Surplus restant: ${remainingSurplus}€`)
    console.log(`✅ [Auto Balance] Déficit restant: ${remainingDeficit}€`)

    return NextResponse.json({
      success: true,
      message: `Répartition automatique effectuée: ${totalTransferred}€ répartis équitablement`,
      transfers,
      total_transferred: totalTransferred,
      transfers_count: transfers.length,
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