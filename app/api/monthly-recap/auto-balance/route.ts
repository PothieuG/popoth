import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/auto-balance
 *
 * Répartit automatiquement les excédents dans les budgets déficitaires
 * de manière équilibrée
 *
 * Body: {
 *   context: 'profile' | 'group'
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
      .select('id, name, estimated_amount, monthly_surplus, monthly_deficit')
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

    // Séparer les budgets avec surplus et déficit
    const budgetsWithSurplus = budgets.filter(b => (b.monthly_surplus || 0) > 0)
    const budgetsWithDeficit = budgets.filter(b => (b.monthly_deficit || 0) > 0)

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

    // Stratégie de répartition équilibrée
    const transfers = []
    let remainingSurplus = totalSurplus
    const surplusBudgets = [...budgetsWithSurplus] // Copie pour manipulation
    const deficitBudgets = [...budgetsWithDeficit] // Copie pour manipulation

    // Trier les budgets déficitaires par ordre de déficit (plus petit en premier)
    deficitBudgets.sort((a, b) => (a.monthly_deficit || 0) - (b.monthly_deficit || 0))

    for (const deficitBudget of deficitBudgets) {
      if (remainingSurplus <= 0) break

      const deficitAmount = deficitBudget.monthly_deficit || 0
      let neededAmount = deficitAmount
      let amountToTransfer = Math.min(neededAmount, remainingSurplus)

      console.log(`⚖️ [Auto Balance] Compensation pour "${deficitBudget.name}": ${deficitAmount}€ de déficit`)

      // Répartir proportionnellement depuis les budgets avec surplus
      const activeSurplusBudgets = surplusBudgets.filter(b => (b.monthly_surplus || 0) > 0)

      if (activeSurplusBudgets.length === 0) break

      const totalActiveSurplus = activeSurplusBudgets.reduce((sum, b) => sum + (b.monthly_surplus || 0), 0)

      for (const surplusBudget of activeSurplusBudgets) {
        if (amountToTransfer <= 0) break

        const surplusAmount = surplusBudget.monthly_surplus || 0
        if (surplusAmount <= 0) continue

        // Calculer la proportion de ce budget dans le surplus total
        const proportion = surplusAmount / totalActiveSurplus
        const maxFromThisBudget = Math.min(
          Math.floor(amountToTransfer * proportion * 100) / 100, // Arrondi à 2 décimales
          surplusAmount,
          amountToTransfer
        )

        if (maxFromThisBudget > 0) {
          transfers.push({
            from_budget_id: surplusBudget.id,
            from_budget_name: surplusBudget.name,
            to_budget_id: deficitBudget.id,
            to_budget_name: deficitBudget.name,
            amount: maxFromThisBudget
          })

          // Mettre à jour les montants temporaires
          surplusBudget.monthly_surplus = (surplusBudget.monthly_surplus || 0) - maxFromThisBudget
          amountToTransfer -= maxFromThisBudget
          remainingSurplus -= maxFromThisBudget

          console.log(`⚖️ [Auto Balance] Planifié: ${maxFromThisBudget}€ de "${surplusBudget.name}" vers "${deficitBudget.name}"`)
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

    // Exécuter tous les transferts planifiés
    console.log(`⚖️ [Auto Balance] Exécution de ${transfers.length} transferts`)

    const updates = []

    // Grouper les transferts par budget pour optimiser les mises à jour
    const budgetUpdates = new Map()

    // Initialiser avec les valeurs actuelles
    for (const budget of budgets) {
      budgetUpdates.set(budget.id, {
        id: budget.id,
        name: budget.name,
        surplus: budget.monthly_surplus || 0,
        deficit: budget.monthly_deficit || 0
      })
    }

    // Appliquer tous les transferts
    for (const transfer of transfers) {
      const fromBudget = budgetUpdates.get(transfer.from_budget_id)
      const toBudget = budgetUpdates.get(transfer.to_budget_id)

      // Réduire le surplus du budget source
      fromBudget.surplus -= transfer.amount

      // Réduire le déficit du budget destination
      const deficitReduction = Math.min(transfer.amount, toBudget.deficit)
      const surplusIncrease = transfer.amount - deficitReduction

      toBudget.deficit -= deficitReduction
      toBudget.surplus += surplusIncrease
    }

    // Créer les mises à jour SQL
    for (const [budgetId, budgetUpdate] of budgetUpdates) {
      updates.push(
        supabaseServer
          .from('estimated_budgets')
          .update({
            monthly_surplus: Math.max(0, budgetUpdate.surplus),
            monthly_deficit: Math.max(0, budgetUpdate.deficit),
            updated_at: new Date().toISOString()
          })
          .eq('id', budgetId)
      )
    }

    // Exécuter toutes les mises à jour
    const results = await Promise.all(updates)
    const hasErrors = results.some(result => result.error)

    if (hasErrors) {
      console.error('❌ Erreur lors de la répartition automatique:', results.map(r => r.error).filter(Boolean))
      return NextResponse.json(
        { error: 'Erreur lors de la répartition automatique' },
        { status: 500 }
      )
    }

    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0)

    console.log(`✅ [Auto Balance] Répartition automatique terminée: ${totalTransferred}€ répartis en ${transfers.length} transferts`)

    return NextResponse.json({
      success: true,
      message: `Répartition automatique effectuée: ${totalTransferred}€ répartis équitablement`,
      transfers,
      total_transferred: totalTransferred,
      transfers_count: transfers.length,
      remaining_surplus: remainingSurplus
    })

  } catch (error) {
    console.error('❌ Erreur lors de la répartition automatique:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}