import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

export interface GroupMember {
  id: string
  first_name: string
  last_name: string
  joined_at: string
}

/**
 * GET /api/groups/[id]/members - Get all members of a group
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    // Get user's profile to check group membership
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', session.userId)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json(
        { error: 'Profil utilisateur introuvable' },
        { status: 404 }
      )
    }

    // Check if user is a member of this group
    if (userProfile.group_id !== groupId) {
      return NextResponse.json(
        { error: 'Vous n\'êtes pas membre de ce groupe' },
        { status: 403 }
      )
    }

    // Get all members of the group
    const { data: members, error: membersError } = await supabase
      .from('profiles')
      .select(`
        id,
        first_name,
        last_name,
        created_at
      `)
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })

    if (membersError) {
      console.error('Error fetching group members:', membersError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des membres' },
        { status: 500 }
      )
    }

    // Transform data
    const transformedMembers: GroupMember[] = members.map(member => ({
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      joined_at: member.created_at
    }))

    return NextResponse.json({ members: transformedMembers })
  } catch (error) {
    console.error('Error in GET /api/groups/[id]/members:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/groups/[id]/members - Join a group
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // Get user's profile and current group status
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', session.userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur introuvable' },
        { status: 404 }
      )
    }

    // Check if user is already in a group
    if (profile.group_id) {
      if (profile.group_id === groupId) {
        return NextResponse.json(
          { error: 'Vous êtes déjà membre de ce groupe' },
          { status: 409 }
        )
      } else {
        return NextResponse.json(
          { error: 'Vous êtes déjà membre d\'un autre groupe. Quittez d\'abord votre groupe actuel.' },
          { status: 409 }
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
      return NextResponse.json(
        { error: 'Groupe introuvable' },
        { status: 404 }
      )
    }

    // Add user to the group by updating their profile
    const { error: joinError } = await supabase
      .from('profiles')
      .update({ group_id: groupId })
      .eq('id', profile.id)

    if (joinError) {
      console.error('Error joining group:', joinError)
      return NextResponse.json(
        { error: 'Erreur lors de l\'adhésion au groupe' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      message: `Vous avez rejoint le groupe "${group.name}" avec succès` 
    })
  } catch (error) {
    console.error('Error in POST /api/groups/[id]/members:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/groups/[id]/members - Leave a group
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

    // Get user's profile and group information
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(`
        id,
        group_id,
        groups (
          id,
          name,
          creator_id
        )
      `)
      .eq('id', session.userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur introuvable' },
        { status: 404 }
      )
    }

    // Check if user is member of this group
    if (profile.group_id !== groupId) {
      return NextResponse.json(
        { error: 'Vous n\'êtes pas membre de ce groupe' },
        { status: 404 }
      )
    }

    const group = profile.groups as any
    if (!group) {
      return NextResponse.json(
        { error: 'Groupe introuvable' },
        { status: 404 }
      )
    }

    // Prevent creator from leaving their own group
    if (group.creator_id === session.userId) {
      return NextResponse.json(
        { error: 'Le créateur ne peut pas quitter son propre groupe. Supprimez le groupe si nécessaire.' },
        { status: 403 }
      )
    }

    // Remove user from the group by clearing their group_id
    const { error: leaveError } = await supabase
      .from('profiles')
      .update({ group_id: null })
      .eq('id', profile.id)

    if (leaveError) {
      console.error('Error leaving group:', leaveError)
      return NextResponse.json(
        { error: 'Erreur lors de la sortie du groupe' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      message: `Vous avez quitté le groupe "${group.name}" avec succès` 
    })
  } catch (error) {
    console.error('Error in DELETE /api/groups/[id]/members:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}