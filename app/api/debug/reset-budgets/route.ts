import { NextRequest, NextResponse } from 'next/server'
import { blockInProduction } from '@/lib/debug-guard'
import { validateSessionToken } from '@/lib/session-server'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/reset-budgets
 *
 * Endpoint pour réinitialiser les données de budget avec des valeurs cohérentes
 */
export async function POST(request: NextRequest) {
  const blocked = blockInProduction()
  if (blocked) return blocked
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId

    // 1. Supprimer tous les transferts de budget
    const { error: deleteTransfersError } = await supabaseServer
      .from('budget_transfers')
      .delete()
      .eq('profile_id', userId)

    if (deleteTransfersError) {
      logger.error(
        '[Reset Budgets] Erreur lors de la suppression des transferts:',
        deleteTransfersError,
      )
    }

    // 2. Supprimer toutes les dépenses réelles existantes
    const { error: deleteExpensesError } = await supabaseServer
      .from('real_expenses')
      .delete()
      .eq('profile_id', userId)

    if (deleteExpensesError) {
      logger.error(
        '[Reset Budgets] Erreur lors de la suppression des dépenses:',
        deleteExpensesError,
      )
    }

    // 3. Récupérer les budgets estimés
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq('profile_id', userId)

    if (budgetsError) {
      logger.error('[Reset Budgets] Erreur lors de la récupération des budgets:', budgetsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 },
      )
    }

    // 4. Créer des dépenses de test cohérentes
    const testExpenses = []
    const summary = []

    for (const budget of budgets) {
      let expenseAmount
      let description

      if (budget.name === 'Courses') {
        // Budget Courses: 400€ estimé, on dépense 250€ → 150€ de surplus
        expenseAmount = 250
        description = 'Courses de la semaine'
      } else if (budget.name === 'Scolarité') {
        // Budget Scolarité: 600€ estimé, on dépense 750€ → 150€ de déficit
        expenseAmount = 750
        description = 'Frais de scolarité'
      } else {
        // Pour les autres budgets, on dépense 80% du budget estimé → 20% de surplus
        expenseAmount = Math.round(budget.estimated_amount * 0.8)
        description = `Dépense pour ${budget.name}`
      }

      testExpenses.push({
        profile_id: userId,
        estimated_budget_id: budget.id,
        amount: expenseAmount,
        description: description,
        expense_date: '2025-09-22',
        is_exceptional: false,
      })

      const estimated = budget.estimated_amount
      const difference = estimated - expenseAmount

      summary.push({
        name: budget.name,
        estimated: estimated,
        spent: expenseAmount,
        difference: difference,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
      })
    }

    // 5. Insérer les nouvelles dépenses
    const { error: insertExpensesError } = await supabaseServer
      .from('real_expenses')
      .insert(testExpenses)

    if (insertExpensesError) {
      logger.error("[Reset Budgets] Erreur lors de l'insertion des dépenses:", insertExpensesError)
      return NextResponse.json(
        { error: "Erreur lors de l'insertion des dépenses" },
        { status: 500 },
      )
    }

    // 6. Désactiver tous les snapshots actifs pour forcer une réinitialisation
    const { error: deactivateSnapshotsError } = await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    if (deactivateSnapshotsError) {
      logger.error(
        '[Reset Budgets] Erreur lors de la désactivation des snapshots:',
        deactivateSnapshotsError,
      )
    }

    // 7. Calculer les totaux
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    return NextResponse.json({
      success: true,
      message: 'Données de budget réinitialisées avec succès',
      summary: {
        budgets: summary,
        totals: {
          surplus: totalSurplus,
          deficit: totalDeficit,
          ratio: generalRatio,
        },
        actions: {
          transfersDeleted: true,
          expensesDeleted: true,
          newExpensesCreated: testExpenses.length,
          snapshotsDeactivated: true,
        },
      },
    })
  } catch (error) {
    logger.error('[Reset Budgets] Erreur générale:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}
