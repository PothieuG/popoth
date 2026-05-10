import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/financial-calculations'
import { withAuthAndProfile } from '@/lib/api/with-auth'
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

    const body = await request.json()

    const { name, estimatedAmount } = body

    // Validation des données
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Le nom du budget est requis (minimum 2 caractères)' },
        { status: 400 },
      )
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Vérifier le contexte et l'appartenance à un groupe
    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour créer un budget de groupe" },
        { status: 400 },
      )
    }

    // Préparer les données du budget selon le contexte
    let budgetData
    if (context === 'group') {
      budgetData = {
        name: name.trim(),
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        group_id: profile.group_id,
        profile_id: null,
      }
    } else {
      budgetData = {
        name: name.trim(),
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
  } catch {
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

    const body = await request.json()

    const { name, estimatedAmount } = body

    // Validation des données
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Le nom du budget est requis (minimum 2 caractères)' },
        { status: 400 },
      )
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Préparer les données de mise à jour
    const updateData = {
      name: name.trim(),
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
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const DELETE = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const budgetId = searchParams.get('id')

    if (!budgetId) {
      return NextResponse.json({ error: 'ID du budget requis' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Vérifier d'abord que le budget appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingBudget } = await supabase
      .from('estimated_budgets')
      .select('*')
      .eq('id', budgetId)
      .or(ownershipCondition)
      .single()

    if (!existingBudget) {
      return NextResponse.json(
        { error: 'Budget non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Supprimer le budget
    const { error } = await supabase.from('estimated_budgets').delete().eq('id', budgetId)

    if (error) {
      logger.error('Erreur lors de la suppression du budget:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après suppression
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingBudget.profile_id || undefined,
      groupId: existingBudget.group_id || undefined,
      reason: 'budget_deleted',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ message: 'Budget supprimé avec succès' })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})
