import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

interface RouteParams {
  id: string
}

export interface GroupMember {
  id: string
  first_name: string
  last_name: string
  joined_at: string | null
}

/**
 * GET /api/groups/[id]/members - Get all members of a group
 */
export const GET = withAuthAndProfile<RouteParams>(async (_request, { profile }, routeContext) => {
  try {
    const resolvedParams = await routeContext.params
    const groupId = resolvedParams.id
    const supabase = supabaseServer

    // Check if user is a member of this group
    if (profile.group_id !== groupId) {
      return NextResponse.json({ error: "Vous n'êtes pas membre de ce groupe" }, { status: 403 })
    }

    // Get all members of the group
    const { data: members, error: membersError } = await supabase
      .from('profiles')
      .select(
        `
        id,
        first_name,
        last_name,
        created_at
      `,
      )
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })

    if (membersError) {
      logger.error('Error fetching group members:', membersError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des membres' },
        { status: 500 },
      )
    }

    // Transform data
    const transformedMembers: GroupMember[] = members.map((member) => ({
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      joined_at: member.created_at,
    }))

    return NextResponse.json({ members: transformedMembers })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/groups/[id]/members - Join a group
 */
export const POST = withAuthAndProfile<RouteParams>(async (_request, { profile }, routeContext) => {
  try {
    const resolvedParams = await routeContext.params
    const groupId = resolvedParams.id
    const supabase = supabaseServer

    // Check if user is already in a group
    if (profile.group_id) {
      if (profile.group_id === groupId) {
        return NextResponse.json({ error: 'Vous êtes déjà membre de ce groupe' }, { status: 409 })
      } else {
        return NextResponse.json(
          {
            error: "Vous êtes déjà membre d'un autre groupe. Quittez d'abord votre groupe actuel.",
          },
          { status: 409 },
        )
      }
    }

    // Check if group exists
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .single()

    if (groupError || !group) {
      return NextResponse.json({ error: 'Groupe introuvable' }, { status: 404 })
    }

    // Add user to the group by updating their profile
    const { error: joinError } = await supabase
      .from('profiles')
      .update({ group_id: groupId })
      .eq('id', profile.id)

    if (joinError) {
      logger.error('Error joining group:', joinError)
      return NextResponse.json({ error: "Erreur lors de l'adhésion au groupe" }, { status: 500 })
    }

    return NextResponse.json({
      message: `Vous avez rejoint le groupe "${group.name}" avec succès`,
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/groups/[id]/members - Leave a group
 */
export const DELETE = withAuthAndProfile<RouteParams>(
  async (_request, { userId, profile }, routeContext) => {
    try {
      const resolvedParams = await routeContext.params
      const groupId = resolvedParams.id
      const supabase = supabaseServer

      // Check if user is member of this group
      if (profile.group_id !== groupId) {
        return NextResponse.json({ error: "Vous n'êtes pas membre de ce groupe" }, { status: 404 })
      }

      // Fetch group to check creator
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('id, name, creator_id')
        .eq('id', groupId)
        .single()

      if (groupError || !group) {
        return NextResponse.json({ error: 'Groupe introuvable' }, { status: 404 })
      }

      // Prevent creator from leaving while other members remain
      if (group.creator_id === userId) {
        const { count: memberCount, error: countError } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', groupId)

        if (countError) {
          logger.error('Error counting group members before creator leave:', countError)
          return NextResponse.json(
            { error: 'Erreur lors de la vérification des membres du groupe' },
            { status: 500 },
          )
        }

        if ((memberCount ?? 0) > 1) {
          return NextResponse.json(
            {
              error:
                "Vous ne pouvez pas quitter ce groupe tant qu'il y a d'autres membres. Les autres membres doivent d'abord quitter le groupe.",
            },
            { status: 403 },
          )
        }
      }

      // Remove user from the group by clearing their group_id
      const { error: leaveError } = await supabase
        .from('profiles')
        .update({ group_id: null })
        .eq('id', profile.id)

      if (leaveError) {
        logger.error('Error leaving group:', leaveError)
        return NextResponse.json({ error: 'Erreur lors de la sortie du groupe' }, { status: 500 })
      }

      return NextResponse.json({
        message: `Vous avez quitté le groupe "${group.name}" avec succès`,
      })
    } catch {
      return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
    }
  },
)
