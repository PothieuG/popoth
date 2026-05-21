import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/finance'
import { reverseAllocation, applyAllocation } from '@/lib/expense-allocation'
import type { Database } from '@/lib/database.types'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { createRealExpenseBodySchema, updateRealExpenseBodySchema } from '@/lib/schemas/expense'
import { deleteByIdQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

type RealExpenseInsert = Database['public']['Tables']['real_expenses']['Insert']
type RealExpenseUpdate = Database['public']['Tables']['real_expenses']['Update']

export interface RealExpenseData {
  id: string
  profile_id?: string
  group_id?: string
  estimated_budget_id?: string
  amount: number
  description: string
  expense_date: string
  is_exceptional: boolean
  created_at: string
  estimated_budget?: {
    name: string
  }
  created_by?: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
}

export interface CreateRealExpenseRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
}

/**
 * GET /api/finance/expenses/real - Récupère les dépenses réelles
 * Retourne les dépenses de l'utilisateur ou de son groupe
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const budgetId = url.searchParams.get('budget_id')
    const isExceptional = url.searchParams.get('exceptional')

    let query = supabaseServer
      .from('real_expenses')
      .select(
        `
        *,
        estimated_budget:estimated_budgets(name),
        created_by:profiles!real_expenses_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ real_expenses: [], total: 0 })
      }

      query = query.eq('group_id', profile.group_id)
    } else {
      query = query.eq('profile_id', userId)
    }

    // Additional filters
    if (budgetId) {
      query = query.eq('estimated_budget_id', budgetId)
    }

    if (isExceptional === 'true') {
      query = query.eq('is_exceptional', true)
    } else if (isExceptional === 'false') {
      query = query.eq('is_exceptional', false)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Error fetching real expenses:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des dépenses' },
        { status: 500 },
      )
    }

    // Get total count for pagination
    let countQuery = supabaseServer
      .from('real_expenses')
      .select('*', { count: 'exact', head: true })

    if (forGroup) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (profile?.group_id) {
        countQuery = countQuery.eq('group_id', profile.group_id)
      }
    } else {
      countQuery = countQuery.eq('profile_id', userId)
    }

    if (budgetId) {
      countQuery = countQuery.eq('estimated_budget_id', budgetId)
    }

    if (isExceptional === 'true') {
      countQuery = countQuery.eq('is_exceptional', true)
    } else if (isExceptional === 'false') {
      countQuery = countQuery.eq('is_exceptional', false)
    }

    const { count } = await countQuery

    return NextResponse.json({
      real_expenses: data || [],
      total: count || 0,
      limit,
      offset,
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/finance/expenses/real - Crée une nouvelle dépense réelle
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, createRealExpenseBodySchema)
    const { amount, description, expense_date, estimated_budget_id } = body
    const is_for_group = body.is_for_group ?? false

    const todayIso = new Date().toISOString().split('T')[0] as string
    const insertData: RealExpenseInsert = {
      amount,
      description,
      expense_date: expense_date || todayIso,
      is_exceptional: !estimated_budget_id,
      created_by_profile_id: userId,
    }

    if (estimated_budget_id) {
      // Verify that the estimated budget exists and belongs to the user/group
      const { data: estimatedBudget, error: verifyError } = await supabaseServer
        .from('estimated_budgets')
        .select('id, profile_id, group_id')
        .eq('id', estimated_budget_id)
        .single()

      if (verifyError || !estimatedBudget) {
        return NextResponse.json({ error: 'Budget estimé introuvable' }, { status: 404 })
      }

      // Check ownership
      if (is_for_group) {
        const { data: profile } = await supabaseServer
          .from('profiles')
          .select('group_id')
          .eq('id', userId)
          .single()

        if (!profile?.group_id || estimatedBudget.group_id !== profile.group_id) {
          return NextResponse.json(
            { error: 'Budget estimé non autorisé pour ce groupe' },
            { status: 403 },
          )
        }
      } else {
        if (estimatedBudget.profile_id !== userId) {
          return NextResponse.json(
            { error: 'Budget estimé non autorisé pour cet utilisateur' },
            { status: 403 },
          )
        }
      }

      insertData.estimated_budget_id = estimated_budget_id
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
          { error: 'Vous devez appartenir à un groupe pour ajouter des dépenses de groupe' },
          { status: 400 },
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = userId
    }

    // Create the real expense
    const { data, error } = await supabaseServer
      .from('real_expenses')
      .insert(insertData)
      .select(
        `
        *,
        estimated_budget:estimated_budgets(name),
        created_by:profiles!real_expenses_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .single()

    if (error) {
      logger.error('Error creating real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création de la dépense' },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre si c'est une dépense exceptionnelle
    if (data.is_exceptional) {
      const snapshotSuccess = await saveRemainingToLiveSnapshot({
        profileId: is_for_group ? undefined : userId,
        groupId: is_for_group ? (insertData.group_id ?? undefined) : undefined,
        reason: 'exceptional_expense_created',
      })

      if (!snapshotSuccess) {
        logger.warn('Échec sauvegarde snapshot (non critique)')
      }
    }

    return NextResponse.json({
      real_expense: data,
      message: 'Dépense créée avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/finance/expenses/real - Met à jour une dépense réelle
 */
export const PUT = withAuth(async (request: NextRequest) => {
  try {
    const body = await parseBody(request, updateRealExpenseBodySchema)
    const { id, amount, description, expense_date, estimated_budget_id } = body

    const updates: RealExpenseUpdate = {}
    if (amount !== undefined) updates.amount = amount
    if (description !== undefined) updates.description = description
    if (expense_date !== undefined) updates.expense_date = expense_date
    if (estimated_budget_id !== undefined) {
      updates.estimated_budget_id = estimated_budget_id
      updates.is_exceptional = !estimated_budget_id
    }

    // Si le montant change, recalculer l'allocation (tirelire -> economies -> budget)
    if (amount !== undefined) {
      // Recuperer l'ancienne depense avec ses champs de breakdown
      const { data: oldExpense, error: fetchError } = await supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget, profile_id, group_id, is_exceptional',
        )
        .eq('id', id)
        .single()

      if (fetchError || !oldExpense) {
        return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 })
      }

      const budgetId =
        estimated_budget_id !== undefined ? estimated_budget_id : oldExpense.estimated_budget_id

      // Reallocation uniquement pour les depenses budgetees
      if (budgetId && !oldExpense.is_exceptional) {
        const contextFilter: Record<string, string> = {}
        if (oldExpense.group_id) contextFilter.group_id = oldExpense.group_id
        else if (oldExpense.profile_id) contextFilter.profile_id = oldExpense.profile_id

        // Etape 1: Reverser l'ancienne allocation (refund piggy + savings dans les pools)
        await reverseAllocation(oldExpense, contextFilter)

        // Etape 2: Appliquer la nouvelle allocation. On passe `oldExpense` pour que
        // applyAllocation utilise l'algorithme « preserve existing caps » (Sprint
        // 2026-05-21 fix) : savings/piggy stockés sur la dépense existante sont
        // des CEILINGS pour la nouvelle allocation. Sans cela, P4-strict
        // redistribuait arbitrairement (e.g., 25€ savings + 98€ budget → 0
        // savings + 5 budget lors d'une réduction à 5€, alors qu'on veut 5
        // savings + 0 budget pour préserver la portion savings revendiquée).
        const result = await applyAllocation(amount, budgetId, contextFilter, oldExpense)

        // Ajouter les nouveaux breakdown fields aux updates
        updates.amount_from_piggy_bank = result.fromPiggyBank
        updates.amount_from_budget_savings = result.fromBudgetSavings
        updates.amount_from_budget = result.fromBudget
      }
    }

    // Update the real expense
    const { data, error } = await supabaseServer
      .from('real_expenses')
      .update(updates)
      .eq('id', id)
      .select(
        `
        *,
        estimated_budget:estimated_budgets(name),
        created_by:profiles!real_expenses_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .single()

    if (error) {
      logger.error('Error updating real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour de la dépense' },
        { status: 500 },
      )
    }

    // Sauvegarder le snapshot reste a vivre
    await saveRemainingToLiveSnapshot({
      profileId: data.profile_id || undefined,
      groupId: data.group_id || undefined,
      reason: data.is_exceptional ? 'exceptional_expense_updated' : 'budgeted_expense_updated',
    })

    return NextResponse.json({
      real_expense: data,
      message: 'Dépense mise à jour avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/finance/expenses/real - Supprime une dépense réelle
 */
export const DELETE = withAuth(async (request: NextRequest) => {
  try {
    const { id } = parseQuery(request, deleteByIdQuerySchema)

    // Recuperer les informations completes de la depense avant suppression
    const { data: expenseToDelete } = await supabaseServer
      .from('real_expenses')
      .select(
        'profile_id, group_id, is_exceptional, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq('id', id)
      .single()

    // Delete the real expense
    const { error } = await supabaseServer.from('real_expenses').delete().eq('id', id)

    if (error) {
      logger.error('Error deleting real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression de la dépense' },
        { status: 500 },
      )
    }

    if (expenseToDelete) {
      // Reverser l'allocation si c'etait une depense budgetee
      if (expenseToDelete.estimated_budget_id && !expenseToDelete.is_exceptional) {
        const contextFilter: Record<string, string> = {}
        if (expenseToDelete.group_id) contextFilter.group_id = expenseToDelete.group_id
        else if (expenseToDelete.profile_id) contextFilter.profile_id = expenseToDelete.profile_id

        try {
          await reverseAllocation(expenseToDelete, contextFilter)
        } catch (err) {
          // Cleanup-attempt CRITIQUE : le reversement d'allocation a fail après que la
          // dépense est déjà supprimée — état DB potentiellement inconsistant
          logger.error("Erreur lors du reversement de l'allocation:", err)
        }
      }

      // Sauvegarder le snapshot reste a vivre
      await saveRemainingToLiveSnapshot({
        profileId: expenseToDelete.profile_id || undefined,
        groupId: expenseToDelete.group_id || undefined,
        reason: expenseToDelete.is_exceptional
          ? 'exceptional_expense_deleted'
          : 'budgeted_expense_deleted',
      })
    }

    return NextResponse.json({
      message: 'Dépense supprimée avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
