import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

export interface UpdateGroupRequest {
  name?: string
  monthly_budget_estimate?: number
}

/**
 * PUT /api/groups/[id] - Update a group (only by creator)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await validateSessionToken(request)
    if (!session || !session.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const resolvedParams = await params
    const groupId = resolvedParams.id
    const body: UpdateGroupRequest = await request.json()
    const { name, monthly_budget_estimate } = body

    // Validation
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Le nom du groupe ne peut pas être vide' },
        { status: 400 }
      )
    }

    if (monthly_budget_estimate !== undefined && (typeof monthly_budget_estimate !== 'number' || monthly_budget_estimate <= 0)) {
      return NextResponse.json(
        { error: 'L\'estimation du budget mensuel doit être un nombre positif' },
        { status: 400 }
      )
    }

    const supabase = supabaseServer

    // Check if group exists and user is the creator
    const { data: group, error: fetchError } = await supabase
      .from('groups')
      .select('id, creator_id, name, monthly_budget_estimate')
      .eq('id', groupId)
      .single()

    if (fetchError || !group) {
      return NextResponse.json(
        { error: 'Groupe introuvable' },
        { status: 404 }
      )
    }

    if (group.creator_id !== session.userId) {
      return NextResponse.json(
        { error: 'Seul le créateur peut modifier le groupe' },
        { status: 403 }
      )
    }

    // Prepare update data
    const updateData: Partial<UpdateGroupRequest> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (monthly_budget_estimate !== undefined) updateData.monthly_budget_estimate = monthly_budget_estimate

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée à mettre à jour' },
        { status: 400 }
      )
    }

    // Update the group
    const { data: updatedGroup, error: updateError } = await supabase
      .from('groups')
      .update(updateData)
      .eq('id', groupId)
      .select()
      .single()

    if (updateError) {
      // Handle unique constraint violation
      if (updateError.code === '23505') {
        return NextResponse.json(
          { error: 'Un groupe avec ce nom existe déjà' },
          { status: 409 }
        )
      }

      console.error('Error updating group:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du groupe' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      group: updatedGroup,
      message: 'Groupe mis à jour avec succès' 
    })
  } catch (error) {
    console.error('Error in PUT /api/groups/[id]:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/groups/[id] - Delete a group (only by creator)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await validateSessionToken(request)
    if (!session || !session.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const resolvedParams = await params
    const groupId = resolvedParams.id
    const supabase = supabaseServer

    // Check if group exists and user is the creator
    const { data: group, error: fetchError } = await supabase
      .from('groups')
      .select('id, creator_id, name')
      .eq('id', groupId)
      .single()

    if (fetchError || !group) {
      return NextResponse.json(
        { error: 'Groupe introuvable' },
        { status: 404 }
      )
    }

    if (group.creator_id !== session.userId) {
      return NextResponse.json(
        { error: 'Seul le créateur peut supprimer le groupe' },
        { status: 403 }
      )
    }

    // Delete the group (cascade will handle group_members)
    const { error: deleteError } = await supabase
      .from('groups')
      .delete()
      .eq('id', groupId)

    if (deleteError) {
      console.error('Error deleting group:', deleteError)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du groupe' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      message: 'Groupe supprimé avec succès' 
    })
  } catch (error) {
    console.error('Error in DELETE /api/groups/[id]:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}