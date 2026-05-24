import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/finance'
import type { Database } from '@/lib/database.types'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { createRealIncomeBodySchema, updateRealIncomeBodySchema } from '@/lib/schemas/income'
import { deleteByIdQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

type RealIncomeInsert = Database['public']['Tables']['real_income_entries']['Insert']
type RealIncomeUpdate = Database['public']['Tables']['real_income_entries']['Update']

export interface RealIncomeEntryData {
  id: string
  profile_id?: string
  group_id?: string
  estimated_income_id?: string
  amount: number
  description: string
  entry_date: string
  is_exceptional: boolean
  created_at: string
  estimated_income?: {
    name: string
  }
  created_by?: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
}

export interface CreateRealIncomeEntryRequest {
  amount: number
  description: string
  entry_date?: string
  estimated_income_id?: string
  is_for_group?: boolean
}

/**
 * GET /api/finance/income/real - Récupère les entrées réelles d'argent
 * Retourne les entrées d'argent de l'utilisateur ou de son groupe
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    logger.debug('[GET /api/finance/income/real] Session validated', { userId })

    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = supabaseServer
      .from('real_income_entries')
      .select(
        `
        *,
        estimated_income:estimated_incomes(name),
        created_by:profiles!real_income_entries_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .order('entry_date', { ascending: false })
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
        return NextResponse.json({ real_income_entries: [], total: 0 })
      }

      query = query.eq('group_id', profile.group_id)
    } else {
      query = query.eq('profile_id', userId)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Error fetching real income entries:', error)
      return NextResponse.json(
        { error: "Erreur lors de la récupération des entrées d'argent" },
        { status: 500 },
      )
    }

    // Get total count for pagination
    let countQuery = supabaseServer
      .from('real_income_entries')
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

    const { count } = await countQuery

    return NextResponse.json({
      real_income_entries: data || [],
      total: count || 0,
      limit,
      offset,
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/finance/income/real - Crée une nouvelle entrée réelle d'argent
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, createRealIncomeBodySchema)
    const { amount, description, entry_date, estimated_income_id } = body
    const is_for_group = body.is_for_group ?? false

    const todayIso = new Date().toISOString().split('T')[0] as string
    const insertData: RealIncomeInsert = {
      amount,
      description,
      entry_date: entry_date || todayIso,
      is_exceptional: !estimated_income_id,
      created_by_profile_id: userId,
    }

    if (estimated_income_id) {
      // Verify that the estimated income exists and belongs to the user/group
      const { data: estimatedIncome, error: verifyError } = await supabaseServer
        .from('estimated_incomes')
        .select('id, profile_id, group_id')
        .eq('id', estimated_income_id)
        .single()

      if (verifyError || !estimatedIncome) {
        return NextResponse.json({ error: 'Revenu estimé introuvable' }, { status: 404 })
      }

      // Check ownership
      if (is_for_group) {
        const { data: profile } = await supabaseServer
          .from('profiles')
          .select('group_id')
          .eq('id', userId)
          .single()

        if (!profile?.group_id || estimatedIncome.group_id !== profile.group_id) {
          return NextResponse.json(
            { error: 'Revenu estimé non autorisé pour ce groupe' },
            { status: 403 },
          )
        }
      } else {
        if (estimatedIncome.profile_id !== userId) {
          return NextResponse.json(
            { error: 'Revenu estimé non autorisé pour cet utilisateur' },
            { status: 403 },
          )
        }
      }

      insertData.estimated_income_id = estimated_income_id
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
          { error: 'Vous devez appartenir à un groupe pour ajouter des entrées de groupe' },
          { status: 400 },
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = userId
    }

    // Create the real income entry
    const { data, error } = await supabaseServer
      .from('real_income_entries')
      .insert(insertData)
      .select(
        `
        *,
        estimated_income:estimated_incomes(name),
        created_by:profiles!real_income_entries_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .single()

    if (error) {
      logger.error('Error creating real income entry:', error)
      return NextResponse.json(
        { error: "Erreur lors de la création de l'entrée d'argent" },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre si c'est un revenu exceptionnel ou associé
    if (data.is_exceptional || data.estimated_income_id) {
      const reason = data.is_exceptional
        ? 'exceptional_income_created'
        : 'associated_income_created'
      const snapshotSuccess = await saveRemainingToLiveSnapshot({
        profileId: is_for_group ? undefined : userId,
        groupId: is_for_group ? (insertData.group_id ?? undefined) : undefined,
        reason,
      })

      if (!snapshotSuccess) {
        logger.warn('Échec sauvegarde snapshot (non critique)')
      }
    }

    return NextResponse.json({
      real_income_entry: data,
      message: "Entrée d'argent créée avec succès",
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/finance/income/real - Met à jour une entrée réelle d'argent
 */
export const PUT = withAuth(async (request: NextRequest) => {
  try {
    const body = await parseBody(request, updateRealIncomeBodySchema)
    const { id, amount, description, entry_date, estimated_income_id } = body

    // Sprint 15 V3 (2026-05-27) — interdire la modification d'un revenu
    // reporté du mois précédent (miroir guard expenses-real.ts).
    const { data: carriedCheck } = await supabaseServer
      .from('real_income_entries')
      .select('is_carried_over')
      .eq('id', id)
      .maybeSingle()
    if (carriedCheck?.is_carried_over) {
      return NextResponse.json({ error: 'cannot-edit-carried-transaction' }, { status: 409 })
    }

    const updates: RealIncomeUpdate = {}
    if (amount !== undefined) updates.amount = amount
    if (description !== undefined) updates.description = description
    if (entry_date !== undefined) updates.entry_date = entry_date
    if (estimated_income_id !== undefined) {
      updates.estimated_income_id = estimated_income_id
      updates.is_exceptional = !estimated_income_id
    }

    // Update the real income entry
    const { data, error } = await supabaseServer
      .from('real_income_entries')
      .update(updates)
      .eq('id', id)
      .select(
        `
        *,
        estimated_income:estimated_incomes(name),
        created_by:profiles!real_income_entries_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)
      `,
      )
      .single()

    if (error) {
      logger.error('Error updating real income entry:', error)
      return NextResponse.json(
        { error: "Erreur lors de la mise à jour de l'entrée d'argent" },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre si c'est un revenu exceptionnel ou associé
    if (data.is_exceptional || data.estimated_income_id) {
      const reason = data.is_exceptional
        ? 'exceptional_income_updated'
        : 'associated_income_updated'
      const snapshotSuccess = await saveRemainingToLiveSnapshot({
        profileId: data.profile_id || undefined,
        groupId: data.group_id || undefined,
        reason,
      })

      if (!snapshotSuccess) {
        logger.warn('Échec sauvegarde snapshot (non critique)')
      }
    }

    return NextResponse.json({
      real_income_entry: data,
      message: "Entrée d'argent mise à jour avec succès",
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/finance/income/real - Supprime une entrée réelle d'argent
 */
export const DELETE = withAuth(async (request: NextRequest) => {
  try {
    const { id } = parseQuery(request, deleteByIdQuerySchema)

    // Récupérer d'abord les informations du revenu avant suppression pour savoir s'il était exceptionnel ou associé
    const { data: incomeToDelete } = await supabaseServer
      .from('real_income_entries')
      .select('profile_id, group_id, is_exceptional, estimated_income_id, applied_to_balance_at')
      .eq('id', id)
      .single()

    // Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23) — bloquer la
    // suppression d'un revenu déjà appliqué au solde. Cf. miroir dans
    // expenses-real.ts DELETE.
    if (incomeToDelete?.applied_to_balance_at) {
      return NextResponse.json({ error: 'cannot-delete-applied-transaction' }, { status: 409 })
    }

    // Delete the real income entry
    const { error } = await supabaseServer.from('real_income_entries').delete().eq('id', id)

    if (error) {
      logger.error('Error deleting real income entry:', error)
      return NextResponse.json(
        { error: "Erreur lors de la suppression de l'entrée d'argent" },
        { status: 500 },
      )
    }

    // Sauvegarder automatiquement le nouveau reste à vivre si c'était un revenu exceptionnel ou associé à un revenu estimé
    if (incomeToDelete?.is_exceptional || incomeToDelete?.estimated_income_id) {
      const reason = incomeToDelete.is_exceptional
        ? 'exceptional_income_deleted'
        : 'associated_income_deleted'
      const snapshotSuccess = await saveRemainingToLiveSnapshot({
        profileId: incomeToDelete.profile_id || undefined,
        groupId: incomeToDelete.group_id || undefined,
        reason,
      })

      if (!snapshotSuccess) {
        logger.warn('Échec sauvegarde snapshot (non critique)')
      }
    }

    return NextResponse.json({
      message: "Entrée d'argent supprimée avec succès",
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
