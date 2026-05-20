import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { asContextFilter, saveRemainingToLiveSnapshot } from '@/lib/finance'
import { deleteBudgetWithSavingsTransfer } from '@/lib/finance/savings'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { createBudgetBodySchema, updateBudgetBodySchema } from '@/lib/schemas/budget'
import { deleteByIdQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * API pour la création/modification/suppression des budgets estimés.
 * La lecture passe par /api/finance/budgets/estimated (handler dédié avec
 * cumulated_savings + spent_this_month).
 */

export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const { name, estimatedAmount } = await parseBody(request, createBudgetBodySchema)

    const supabase = supabaseServer

    // Vérifier le contexte et l'appartenance à un groupe
    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour créer un budget de groupe" },
        { status: 400 },
      )
    }

    // Préparer les données du budget selon le contexte (name déjà trimmé par le schema)
    let budgetData
    if (context === 'group') {
      budgetData = {
        name,
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        group_id: profile.group_id,
        profile_id: null,
      }
    } else {
      budgetData = {
        name,
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        profile_id: userId,
        group_id: null,
      }
    }

    // Créer le budget
    const { data: budget, error } = await supabase
      .from('estimated_budgets')
      .insert(budgetData)
      .select()
      .single()

    if (error) {
      logger.error('Erreur lors de la création du budget:', error)
      return NextResponse.json({ error: 'Erreur lors de la création du budget' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: context === 'group' ? undefined : userId,
      groupId: context === 'group' ? (profile.group_id ?? undefined) : undefined,
      reason: 'budget_created',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ budget }, { status: 201 })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const PUT = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const budgetId = searchParams.get('id')

    if (!budgetId) {
      return NextResponse.json({ error: 'ID du budget requis' }, { status: 400 })
    }

    const { name, estimatedAmount } = await parseBody(request, updateBudgetBodySchema)

    const supabase = supabaseServer

    // Préparer les données de mise à jour (name déjà trimmé par le schema)
    const updateData = {
      name,
      estimated_amount: estimatedAmount,
      updated_at: new Date().toISOString(),
    }

    // Vérifier d'abord que le budget appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingBudget } = await supabase
      .from('estimated_budgets')
      .select(
        'id, profile_id, group_id, name, estimated_amount, is_monthly_recurring, created_at, updated_at',
      )
      .eq('id', budgetId)
      .or(ownershipCondition)
      .single()

    if (!existingBudget) {
      return NextResponse.json(
        { error: 'Budget non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Mettre à jour le budget
    const { data: budget, error } = await supabase
      .from('estimated_budgets')
      .update(updateData)
      .eq('id', budgetId)
      .select()
      .single()

    if (error) {
      logger.error('Erreur lors de la mise à jour du budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du budget' },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après modification
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingBudget.profile_id || undefined,
      groupId: existingBudget.group_id || undefined,
      reason: 'budget_updated',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ budget })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const DELETE = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id: budgetId } = parseQuery(request, deleteByIdQuerySchema)

    const supabase = supabaseServer

    // Vérifier d'abord que le budget appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingBudget } = await supabase
      .from('estimated_budgets')
      .select('id, profile_id, group_id, cumulated_savings')
      .eq('id', budgetId)
      .or(ownershipCondition)
      .single()

    if (!existingBudget) {
      return NextResponse.json(
        { error: 'Budget non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Composite atomic: transfert cumulated_savings → piggy_bank (si > 0)
    // puis DELETE budget en 1 transaction Postgres. transferred_amount = 0
    // si pas d'économies, piggy_amount = null dans ce cas (skip UPSERT).
    const filter = asContextFilter({
      profile_id: existingBudget.profile_id,
      group_id: existingBudget.group_id,
    })
    const { transferred_amount, piggy_amount } = await deleteBudgetWithSavingsTransfer(filter, {
      budgetId,
    })

    // Sauvegarder automatiquement le nouveau reste à vivre après suppression
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingBudget.profile_id || undefined,
      groupId: existingBudget.group_id || undefined,
      reason: 'budget_deleted',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({
      message: 'Budget supprimé avec succès',
      transferredAmount: Number(transferred_amount),
      piggyAmount: piggy_amount !== null ? Number(piggy_amount) : null,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Erreur lors de la suppression du budget:', error)
    return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
  }
})
