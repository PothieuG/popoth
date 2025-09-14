import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

// Group data types
export interface GroupData {
  id: string
  name: string
  monthly_budget_estimate: number
  creator_id: string
  created_at: string
  updated_at: string
  member_count?: number
  is_creator?: boolean
}

export interface CreateGroupRequest {
  name: string
  monthly_budget_estimate: number
}

/**
 * GET /api/groups - Get the user's group (single group per user)
 * Returns the group the user belongs to, if any
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session || !session.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const supabase = supabaseServer

    // Get user's profile
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

    // If user has no group, return empty array
    if (!profile.group_id) {
      return NextResponse.json({ groups: [] })
    }

    // Get the group details
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', profile.group_id)
      .single()

    if (groupError || !group) {
      console.error('Error fetching group details:', groupError)
      return NextResponse.json({ groups: [] })
    }

    // Get member count for the group
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact' })
      .eq('group_id', group.id)

    const groupData: GroupData = {
      id: group.id,
      name: group.name,
      monthly_budget_estimate: group.monthly_budget_estimate,
      creator_id: group.creator_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      member_count: count || 0,
      is_creator: group.creator_id === session.userId
    }

    return NextResponse.json({ groups: [groupData] })
  } catch (error) {
    console.error('Error in GET /api/groups:', error)
    console.error('Stack trace:', (error as Error).stack)
    return NextResponse.json(
      { error: 'Erreur interne du serveur', details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined },
      { status: 500 }
    )
  }
}

/**
 * POST /api/groups - Create a new group
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session || !session.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const body: CreateGroupRequest = await request.json()
    const { name, monthly_budget_estimate } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Le nom du groupe est requis' },
        { status: 400 }
      )
    }

    if (!monthly_budget_estimate || typeof monthly_budget_estimate !== 'number' || monthly_budget_estimate <= 0) {
      return NextResponse.json(
        { error: 'L\'estimation du budget mensuel doit être un nombre positif' },
        { status: 400 }
      )
    }

    const supabase = supabaseServer

    // Get user's profile and check if already in a group
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
      return NextResponse.json(
        { error: 'Vous êtes déjà membre d\'un groupe. Quittez d\'abord votre groupe actuel.' },
        { status: 409 }
      )
    }

    // Create the group
    const { data: group, error: createError } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        monthly_budget_estimate,
        creator_id: session.userId
      })
      .select()
      .single()

    if (createError) {
      // Handle unique constraint violation
      if (createError.code === '23505') {
        return NextResponse.json(
          { error: 'Un groupe avec ce nom existe déjà' },
          { status: 409 }
        )
      }
      
      console.error('Error creating group:', createError)
      return NextResponse.json(
        { error: 'Erreur lors de la création du groupe' },
        { status: 500 }
      )
    }

    // Update user's profile to join the group
    const { error: joinError } = await supabase
      .from('profiles')
      .update({ group_id: group.id })
      .eq('id', profile.id)

    if (joinError) {
      console.error('Error adding creator to group:', joinError)
      // Try to cleanup the created group
      await supabase.from('groups').delete().eq('id', group.id)
      
      return NextResponse.json(
        { error: 'Erreur lors de l\'ajout du créateur au groupe' },
        { status: 500 }
      )
    }

    // Return the created group with additional info
    const groupData: GroupData = {
      id: group.id,
      name: group.name,
      monthly_budget_estimate: group.monthly_budget_estimate,
      creator_id: group.creator_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      member_count: 1,
      is_creator: true
    }

    return NextResponse.json({ 
      group: groupData,
      message: 'Groupe créé avec succès' 
    })
  } catch (error) {
    console.error('Error in POST /api/groups:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}