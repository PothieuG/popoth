import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { updateGroupBodySchema } from '@/lib/schemas/groups'
import { logger } from '@/lib/logger'

interface RouteParams {
  id: string
}

export interface UpdateGroupRequest {
  name?: string
}

/**
 * PUT /api/groups/[id] - Update a group (only by creator)
 *
 * Sprint Group-Budget-Auto-Sync (2026-05-19) : `monthly_budget_estimate` is
 * no longer editable through this route. The column is auto-synced from
 * SUM(estimated_budgets) by the DB trigger. Only `name` remains mutable.
 */
export const PUT = withAuth<RouteParams>(async (request, { userId }, routeContext) => {
  try {
    const resolvedParams = await routeContext.params
    const groupId = resolvedParams.id
    const { name } = await parseBody(request, updateGroupBodySchema)

    const supabase = supabaseServer

    // Check if group exists and user is the creator
    const { data: group, error: fetchError } = await supabase
      .from('groups')
      .select('id, creator_id, name')
      .eq('id', groupId)
      .single()

    if (fetchError || !group) {
      return NextResponse.json({ error: 'Groupe introuvable' }, { status: 404 })
    }

    if (group.creator_id !== userId) {
      return NextResponse.json(
        { error: 'Seul le créateur peut modifier le groupe' },
        { status: 403 },
      )
    }

    // Update the group (only name — monthly_budget_estimate auto-synced)
    const { data: updatedGroup, error: updateError } = await supabase
      .from('groups')
      .update({ name })
      .eq('id', groupId)
      .select()
      .single()

    if (updateError) {
      // Handle unique constraint violation
      if (updateError.code === '23505') {
        return NextResponse.json({ error: 'Un groupe avec ce nom existe déjà' }, { status: 409 })
      }

      logger.error('Error updating group:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du groupe' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      group: updatedGroup,
      message: 'Groupe mis à jour avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/groups/[id] - Delete a group (only by creator)
 */
export const DELETE = withAuth<RouteParams>(async (_request, { userId }, routeContext) => {
  try {
    const resolvedParams = await routeContext.params
    const groupId = resolvedParams.id
    const supabase = supabaseServer

    // Check if group exists and user is the creator
    const { data: group, error: fetchError } = await supabase
      .from('groups')
      .select('id, creator_id, name')
      .eq('id', groupId)
      .single()

    if (fetchError || !group) {
      return NextResponse.json({ error: 'Groupe introuvable' }, { status: 404 })
    }

    if (group.creator_id !== userId) {
      return NextResponse.json(
        { error: 'Seul le créateur peut supprimer le groupe' },
        { status: 403 },
      )
    }

    // Delete the group (cascade will handle group_members)
    const { error: deleteError } = await supabase.from('groups').delete().eq('id', groupId)

    if (deleteError) {
      logger.error('Error deleting group:', deleteError)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du groupe' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      message: 'Groupe supprimé avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
