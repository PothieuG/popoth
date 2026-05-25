import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { deleteCarriedExpenseToPiggy, saveRemainingToLiveSnapshot } from '@/lib/finance'
import { reverseAllocation, applyAllocation } from '@/lib/expense-allocation'
import {
  deleteExpenseWithSourcesRefund,
  updateExpenseWithSourcesReapply,
} from '@/lib/finance/expenses'
import { calculateBreakdownWithAutoCascade } from '@/lib/expense-breakdown'
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
  /**
   * Feature "Contribution au groupe" (2026-05-28) — non-null = row auto-managée
   * par trigger `sync_contribution_real_expense`. Édition/suppression manuelle
   * bloquées par les guards 409 PUT/DELETE. UI rend en mode read-only.
   */
  contribution_id?: string | null
  /**
   * Feature "Contribution au groupe" (2026-05-28) — snapshot du montant au
   * moment de la dernière validation long-press. Utilisé par l'UI pour
   * calculer le delta affiché si le trigger a auto-mis-à-jour `amount`
   * pendant que la row était validée (= drift à re-valider).
   */
  last_applied_amount?: number | null
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

    // Sprint 15 V3 (2026-05-27) — interdire la modification d'une dépense
    // reportée du mois précédent (`is_carried_over=true`). Règle produit :
    // une carry-over ne peut qu'être validée (long-press) ou supprimée.
    // Pour la modifier, l'utilisateur doit d'abord la valider — elle redevient
    // alors une dépense normale et l'édition est ré-autorisée.
    // L'UI omet déjà "Modifier" du dropdown pour les carry-overs ; ce guard
    // est la défense en profondeur côté API.
    //
    // Feature "Contribution au groupe" (2026-05-28) — interdire aussi la
    // modification d'une row contribution auto-managée (`contribution_id`
    // non-null). Le montant suit `group_contributions.contribution_amount`
    // via le trigger `sync_contribution_real_expense` ; la description suit
    // le nom du groupe. Aucune édition manuelle ne doit pouvoir corrompre
    // cet état dérivé.
    const { data: protectedCheck } = await supabaseServer
      .from('real_expenses')
      .select('is_carried_over, contribution_id')
      .eq('id', id)
      .maybeSingle()
    if (protectedCheck?.is_carried_over) {
      return NextResponse.json({ error: 'cannot-edit-carried-transaction' }, { status: 409 })
    }
    if (protectedCheck?.contribution_id) {
      return NextResponse.json({ error: 'cannot-edit-contribution-row' }, { status: 409 })
    }

    const updates: RealExpenseUpdate = {}
    let skipFinalUpdate = false
    if (amount !== undefined) updates.amount = amount
    if (description !== undefined) updates.description = description
    if (expense_date !== undefined) updates.expense_date = expense_date
    if (estimated_budget_id !== undefined) {
      updates.estimated_budget_id = estimated_budget_id
      updates.is_exceptional = !estimated_budget_id
    }

    if (amount !== undefined) {
      const { data: oldExpense, error: fetchError } = await supabaseServer
        .from('real_expenses')
        .select(
          'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget, profile_id, group_id, is_exceptional, description, expense_date',
        )
        .eq('id', id)
        .single()

      if (fetchError || !oldExpense) {
        return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 })
      }

      const budgetId =
        estimated_budget_id !== undefined ? estimated_budget_id : oldExpense.estimated_budget_id
      const budgetChanged =
        estimated_budget_id !== undefined && estimated_budget_id !== oldExpense.estimated_budget_id

      // Sprint Auto-Cascade-Piggy / Traceability (2026-05-26) — pour les
      // dépenses budgetées dont le destination budget ne change PAS, on
      // utilise la RPC reverse-then-reapply atomique qui consulte la trace
      // expense_savings_sources pour rendre les sources d'origine puis
      // applique la nouvelle cascade auto. Pour les cas legacy (changement
      // de budget destination, dépense devient exceptionnelle), on retombe
      // sur reverseAllocation + applyAllocation (perte de trace acceptée).
      if (budgetId && !oldExpense.is_exceptional && !budgetChanged) {
        const contextFilter: Record<string, string> = {}
        if (oldExpense.group_id) contextFilter.group_id = oldExpense.group_id
        else if (oldExpense.profile_id) contextFilter.profile_id = oldExpense.profile_id

        const { data: sources } = await supabaseServer
          .from('expense_savings_sources')
          .select('source_type, source_budget_id, amount')
          .eq('real_expense_id', id)

        const sourceMap = new Map<string, number>()
        let piggyFromSources = 0
        for (const s of sources ?? []) {
          if (s.source_type === 'piggy') {
            piggyFromSources += s.amount
          } else if (s.source_type === 'budget_savings' && s.source_budget_id) {
            sourceMap.set(s.source_budget_id, (sourceMap.get(s.source_budget_id) ?? 0) + s.amount)
          }
        }
        const hasTrace = (sources?.length ?? 0) > 0

        const { data: piggyData } = await supabaseServer
          .from('piggy_bank')
          .select('amount')
          .match(contextFilter)
          .maybeSingle()
        const piggyCurrent = piggyData?.amount ?? 0
        const piggyPostReverse =
          piggyCurrent + (hasTrace ? piggyFromSources : (oldExpense.amount_from_piggy_bank ?? 0))

        const { data: budgetData } = await supabaseServer
          .from('estimated_budgets')
          .select('estimated_amount, cumulated_savings')
          .eq('id', budgetId)
          .single()
        if (!budgetData) {
          return NextResponse.json({ error: 'Budget non trouvé' }, { status: 404 })
        }

        const destinationOldSavingsClaim = hasTrace
          ? (sourceMap.get(budgetId) ?? 0)
          : (oldExpense.amount_from_budget_savings ?? 0)
        const savingsPostReverse = (budgetData.cumulated_savings ?? 0) + destinationOldSavingsClaim

        const { data: budgetExpenses } = await supabaseServer
          .from('real_expenses')
          .select('id, amount_from_budget')
          .eq('estimated_budget_id', budgetId)
          .match(contextFilter)
        const budgetSpentCurrent =
          budgetExpenses?.reduce((sum, e) => sum + (e.amount_from_budget ?? 0), 0) ?? 0
        const budgetSpentPostReverse = budgetSpentCurrent - (oldExpense.amount_from_budget ?? 0)
        const budgetRemainingPostReverse = budgetData.estimated_amount - budgetSpentPostReverse

        const { data: otherBudgets } = await supabaseServer
          .from('estimated_budgets')
          .select('id, cumulated_savings')
          .match(contextFilter)
          .neq('id', budgetId)
        const otherBudgetsPostReverse = (otherBudgets ?? [])
          .map((b) => {
            const currentSavings = b.cumulated_savings ?? 0
            const oldClaim = hasTrace ? (sourceMap.get(b.id) ?? 0) : 0
            return { budget_id: b.id, available: currentSavings + oldClaim }
          })
          .filter((b) => b.available > 0)

        const allocation = calculateBreakdownWithAutoCascade(
          amount,
          budgetRemainingPostReverse,
          savingsPostReverse,
          piggyPostReverse,
          otherBudgetsPostReverse,
        )

        try {
          await updateExpenseWithSourcesReapply({
            expenseId: id,
            newAmount: amount,
            newDescription: description ?? oldExpense.description,
            newExpenseDate: expense_date ?? oldExpense.expense_date,
            newAmountFromPiggyBank: allocation.fromPiggyBank,
            newAmountFromLocalSavings: allocation.fromBudgetSavings,
            newAmountFromBudget: allocation.fromBudget,
            newCrossBudgetDebits: allocation.crossBudgetDebits,
          })
        } catch (rpcErr) {
          logger.error('Erreur UPDATE atomique avec sources:', rpcErr)
          return NextResponse.json(
            { error: 'Erreur lors de la mise à jour de la dépense' },
            { status: 500 },
          )
        }
        // La RPC a déjà fait l'UPDATE complet (incluant description/date) →
        // skip le UPDATE final, on fait juste un SELECT au retour.
        skipFinalUpdate = true
      } else if (budgetId && !oldExpense.is_exceptional) {
        // Legacy path : budget destination change ou pas de trace → flow ancien
        const contextFilter: Record<string, string> = {}
        if (oldExpense.group_id) contextFilter.group_id = oldExpense.group_id
        else if (oldExpense.profile_id) contextFilter.profile_id = oldExpense.profile_id
        await reverseAllocation(oldExpense, contextFilter)
        const result = await applyAllocation(amount, budgetId, contextFilter, oldExpense)
        updates.amount_from_piggy_bank = result.fromPiggyBank
        updates.amount_from_budget_savings = result.fromBudgetSavings
        updates.amount_from_budget = result.fromBudget
      }
    }

    // Update the real expense (skip si la RPC update_expense_with_sources_reapply
    // a déjà fait le UPDATE complet — on fait juste SELECT pour récupérer la row).
    const selectClause = `
      *,
      estimated_budget:estimated_budgets(name),
      created_by:profiles!real_expenses_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
    `
    const { data, error } = skipFinalUpdate
      ? await supabaseServer.from('real_expenses').select(selectClause).eq('id', id).single()
      : await supabaseServer
          .from('real_expenses')
          .update(updates)
          .eq('id', id)
          .select(selectClause)
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
        'profile_id, group_id, is_exceptional, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget, applied_to_balance_at, is_carried_over, contribution_id',
      )
      .eq('id', id)
      .single()

    // Feature "Contribution au groupe" (2026-05-28) — interdire la suppression
    // manuelle d'une row contribution auto-managée. Le cycle de vie est piloté
    // par les triggers DB (création/sync via `sync_contribution_real_expense`
    // sur group_contributions UPSERT ; suppression via CASCADE quand le user
    // quitte le groupe — le trigger `credit_balance_on_contribution_delete`
    // restitue alors le solde si nécessaire).
    if (expenseToDelete?.contribution_id) {
      return NextResponse.json({ error: 'cannot-delete-contribution-row' }, { status: 409 })
    }

    // Sprint 15 Monthly Recap V3 (2026-05-27) — auto-detect carry-over.
    // Une dépense reportée (`is_carried_over=true`) doit être supprimée via
    // la RPC atomique `delete_carried_expense_to_piggy` qui DELETE la row
    // ET crédite la tirelire en 1 tx. Le client envoie un simple DELETE,
    // le serveur reconnaît l'état carry-over et applique la procédure
    // appropriée — pas de signal client à passer.
    if (expenseToDelete?.is_carried_over) {
      try {
        const result = await deleteCarriedExpenseToPiggy(id)
        return NextResponse.json({
          message: 'Dépense reportée supprimée — montant renvoyé en tirelire',
          piggy_credited: result.piggyCredited,
        })
      } catch (carryError) {
        logger.error('[DELETE/expense] delete_carried_expense_to_piggy failed', carryError)
        return NextResponse.json(
          { error: 'Erreur lors de la suppression de la dépense reportée' },
          { status: 500 },
        )
      }
    }

    // Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23) — bloquer la
    // suppression d'une dépense déjà appliquée au solde. L'UI doit forcer
    // l'utilisateur à dé-appliquer via long-press d'abord. Sans ce guard,
    // bank_balances.balance resterait avec le delta de la dépense supprimée
    // (état orphelin), invariant cassé CLAUDE.md §8.
    if (expenseToDelete?.applied_to_balance_at) {
      return NextResponse.json({ error: 'cannot-delete-applied-transaction' }, { status: 409 })
    }

    // Sprint Auto-Cascade-Piggy / Traceability (2026-05-26) — pour les
    // dépenses budgetées, on utilise la RPC composite atomique qui refund
    // chaque source d'origine via la trace `expense_savings_sources` puis
    // DELETE en 1 tx. Pour les dépenses exceptionnelles (pas de breakdown),
    // DELETE direct conserve le comportement actuel.
    if (expenseToDelete && expenseToDelete.estimated_budget_id && !expenseToDelete.is_exceptional) {
      try {
        await deleteExpenseWithSourcesRefund(id)
      } catch (err) {
        logger.error('Erreur DELETE atomique avec refund:', err)
        return NextResponse.json(
          { error: 'Erreur lors de la suppression de la dépense' },
          { status: 500 },
        )
      }
    } else {
      const { error } = await supabaseServer.from('real_expenses').delete().eq('id', id)
      if (error) {
        logger.error('Error deleting real expense:', error)
        return NextResponse.json(
          { error: 'Erreur lors de la suppression de la dépense' },
          { status: 500 },
        )
      }
    }

    if (expenseToDelete) {
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
