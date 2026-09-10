import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import {
  createEstimatedBudgetBodySchema,
  updateEstimatedBudgetBodySchema,
} from '@/lib/schemas/budget'
import { deleteByIdQuerySchema, estimatedListQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

type EstimatedBudgetRow = Database['public']['Tables']['estimated_budgets']['Row']
type EstimatedBudgetInsert = Database['public']['Tables']['estimated_budgets']['Insert']
type EstimatedBudgetUpdate = Database['public']['Tables']['estimated_budgets']['Update']

/**
 * GET /api/finance/budgets/estimated - Récupère les budgets estimés
 * Retourne les budgets estimés de l'utilisateur ou de son groupe
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const { group: forGroup } = parseQuery(request, estimatedListQuerySchema)

    let data, error

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ estimated_budgets: [] })
      }

      // Get group's estimated budgets
      const result = await supabaseServer
        .from('estimated_budgets')
        .select(
          '*, carryover_spent_amount, carryover_applied_date, cumulated_savings, last_savings_update',
        )
        .eq('group_id', profile.group_id)
        .order('created_at', { ascending: false })

      data = result.data
      error = result.error
    } else {
      // Get user's personal estimated budgets
      const result = await supabaseServer
        .from('estimated_budgets')
        .select(
          '*, carryover_spent_amount, carryover_applied_date, cumulated_savings, last_savings_update',
        )
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })

      data = result.data
      error = result.error
    }

    if (error) {
      logger.error('Error fetching estimated budgets:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets estimés' },
        { status: 500 },
      )
    }

    // Dépensé du mois par budget.
    //
    // Sprint Perf-Waterfall (2026-09-10) — c'était un N+1 : une requête
    // `real_expenses` PAR budget (`.eq('estimated_budget_id', budget.id)`),
    // lancées en parallèle mais qui saturaient quand même le pool pour un
    // résultat qu'une seule requête `.in(...)` produit. 12 budgets = 12
    // requêtes ; désormais 1, quel que soit leur nombre.
    //
    // Le regroupement se fait en mémoire : les lignes sont déjà bornées au mois
    // courant et aux budgets de l'appelant, donc le volume est celui d'un
    // écran, pas d'un historique.
    const budgets = data || []
    const currentDate = new Date()
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

    const spentByBudgetId = new Map<string, number>()
    if (budgets.length > 0) {
      const { data: expenses } = await supabaseServer
        .from('real_expenses')
        .select(
          'estimated_budget_id, amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
        )
        .in(
          'estimated_budget_id',
          budgets.map((b: EstimatedBudgetRow) => b.id),
        )
        .is('carried_from_recap_id', null)
        .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0] as string)
        .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0] as string)

      for (const expense of expenses ?? []) {
        if (!expense.estimated_budget_id) continue
        // `amount_from_budget` fait foi quand il est renseigné ; repli sur
        // `amount` pour les lignes antérieures à la ventilation (inchangé).
        const amountFromBudget =
          expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
            ? parseFloat(expense.amount_from_budget.toString())
            : parseFloat(expense.amount.toString())
        if (isNaN(amountFromBudget)) continue
        spentByBudgetId.set(
          expense.estimated_budget_id,
          (spentByBudgetId.get(expense.estimated_budget_id) ?? 0) + amountFromBudget,
        )
      }
    }

    const budgetsWithSpending = budgets.map((budget: EstimatedBudgetRow) => {
      // Inclure le carryover (déficit reporté du mois précédent) dans le montant
      // dépensé : affiche le déficit dans l'écran budget sans créer de dépense
      // visible.
      const carryover = parseFloat((budget.carryover_spent_amount || 0).toString())
      const actualSpent = spentByBudgetId.get(budget.id) ?? 0
      return {
        ...budget,
        spent_this_month: (isNaN(carryover) ? 0 : carryover) + actualSpent,
      }
    })

    return NextResponse.json({ estimated_budgets: budgetsWithSpending })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/finance/budgets/estimated - Crée un nouveau budget estimé
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, createEstimatedBudgetBodySchema)
    const { name, estimated_amount, is_monthly_recurring = true, is_for_group = false } = body

    const insertData: EstimatedBudgetInsert = {
      name,
      estimated_amount,
      is_monthly_recurring,
      // current_savings calculated dynamically in application
    }

    if (is_for_group) {
      // Get user's group
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Vous devez appartenir à un groupe pour ajouter des budgets de groupe' },
          { status: 400 },
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = userId
    }

    // Create the estimated budget
    const { data, error } = await supabaseServer
      .from('estimated_budgets')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      logger.error('Error creating estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création du budget estimé' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      estimated_budget: { ...data, spent_this_month: 0 },
      message: 'Budget estimé créé avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/finance/budgets/estimated - Met à jour un budget estimé
 */
export const PUT = withAuth(async (request: NextRequest) => {
  try {
    const body = await parseBody(request, updateEstimatedBudgetBodySchema)
    const { id, name, estimated_amount, is_monthly_recurring } = body

    const updates: EstimatedBudgetUpdate = {}

    if (name !== undefined) {
      updates.name = name
    }

    if (estimated_amount !== undefined) {
      updates.estimated_amount = estimated_amount
      // current_savings calculated dynamically in application, not stored
    }

    if (is_monthly_recurring !== undefined) {
      updates.is_monthly_recurring = is_monthly_recurring
    }

    // Update the estimated budget
    const { data, error } = await supabaseServer
      .from('estimated_budgets')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du budget estimé' },
        { status: 500 },
      )
    }

    // Calculate spent this month for response
    const currentDate = new Date()
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
      .eq('estimated_budget_id', id)
      .is('carried_from_recap_id', null)
      .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
      .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

    const spentThisMonth =
      expenses?.reduce((sum, expense) => {
        const amountFromBudget =
          expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
            ? parseFloat(expense.amount_from_budget.toString())
            : parseFloat(expense.amount.toString())
        return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
      }, 0) || 0

    return NextResponse.json({
      estimated_budget: { ...data, spent_this_month: spentThisMonth },
      message: 'Budget estimé mis à jour avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/finance/budgets/estimated - Supprime un budget estimé
 */
export const DELETE = withAuth(async (request: NextRequest) => {
  try {
    const { id } = parseQuery(request, deleteByIdQuerySchema)

    // Delete the estimated budget (this will set estimated_budget_id to null in related expenses)
    const { error } = await supabaseServer.from('estimated_budgets').delete().eq('id', id)

    if (error) {
      logger.error('Error deleting estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du budget estimé' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      message: 'Budget estimé supprimé avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
