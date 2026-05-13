import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/finance'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { createIncomeBodySchema, updateIncomeBodySchema } from '@/lib/schemas/income'
import { deleteByIdQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * API pour la gestion des revenus estimés
 * - GET: Récupère tous les revenus de l'utilisateur ou du groupe
 * - POST: Crée un nouveau revenu estimé
 */

export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const supabase = supabaseServer

    // Construire la requête selon le contexte demandé
    let query
    if (context === 'group' && profile.group_id) {
      // Récupérer seulement les revenus du groupe
      query = supabase
        .from('estimated_incomes')
        .select('*')
        .eq('group_id', profile.group_id)
        .is('profile_id', null)
    } else {
      // Récupérer seulement les revenus personnels
      query = supabase
        .from('estimated_incomes')
        .select('*')
        .eq('profile_id', userId)
        .is('group_id', null)
    }

    const { data: incomes, error } = await query.order('created_at', { ascending: false })

    if (error) {
      logger.error('Erreur lors de la récupération des revenus:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }

    return NextResponse.json({ incomes: incomes || [] })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const { name, estimatedAmount } = await parseBody(request, createIncomeBodySchema)

    const supabase = supabaseServer

    // Vérifier le contexte et l'appartenance à un groupe
    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour créer un revenu de groupe" },
        { status: 400 },
      )
    }

    // Préparer les données du revenu selon le contexte (name déjà trimmé par le schema)
    let incomeData
    if (context === 'group') {
      incomeData = {
        name,
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        group_id: profile.group_id,
        profile_id: null,
      }
    } else {
      incomeData = {
        name,
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        profile_id: userId,
        group_id: null,
      }
    }

    // Créer le revenu
    const { data: income, error } = await supabase
      .from('estimated_incomes')
      .insert(incomeData)
      .select()
      .single()

    if (error) {
      logger.error('Erreur lors de la création du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la création du revenu' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: context === 'group' ? undefined : userId,
      groupId: context === 'group' ? (profile.group_id ?? undefined) : undefined,
      reason: 'income_created',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income }, { status: 201 })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const PUT = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const incomeId = searchParams.get('id')

    if (!incomeId) {
      return NextResponse.json({ error: 'ID du revenu requis' }, { status: 400 })
    }

    const { name, estimatedAmount } = await parseBody(request, updateIncomeBodySchema)

    const supabase = supabaseServer

    // Préparer les données de mise à jour (name déjà trimmé par le schema)
    const updateData = {
      name,
      estimated_amount: estimatedAmount,
      updated_at: new Date().toISOString(),
    }

    // Vérifier d'abord que le revenu appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingIncome } = await supabase
      .from('estimated_incomes')
      .select(
        'id, profile_id, group_id, name, estimated_amount, is_monthly_recurring, created_at, updated_at',
      )
      .eq('id', incomeId)
      .or(ownershipCondition)
      .single()

    if (!existingIncome) {
      return NextResponse.json(
        { error: 'Revenu non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Mettre à jour le revenu
    const { data: income, error } = await supabase
      .from('estimated_incomes')
      .update(updateData)
      .eq('id', incomeId)
      .select()
      .single()

    if (error) {
      logger.error('Erreur lors de la mise à jour du revenu:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du revenu' },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après modification
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_updated',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const DELETE = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id: incomeId } = parseQuery(request, deleteByIdQuerySchema)

    const supabase = supabaseServer

    // Vérifier d'abord que le revenu appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingIncome } = await supabase
      .from('estimated_incomes')
      .select('*')
      .eq('id', incomeId)
      .or(ownershipCondition)
      .single()

    if (!existingIncome) {
      return NextResponse.json(
        { error: 'Revenu non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Supprimer le revenu
    const { error } = await supabase.from('estimated_incomes').delete().eq('id', incomeId)

    if (error) {
      logger.error('Erreur lors de la suppression du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après suppression
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_deleted',
    })

    if (!snapshotSuccess) {
      logger.warn('Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ message: 'Revenu supprimé avec succès' })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})
