import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

export interface SearchableGroup {
  id: string
  name: string
  monthly_budget_estimate: number
  created_at: string
  member_count: number
  is_member: boolean
  creator_name: string
}

/**
 * GET /api/groups/search - Search for groups to join
 * Query parameters:
 * - q: search query (optional)
 * - limit: number of results (default: 20, max: 50)
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

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    const supabase = supabaseServer

    // Get user's profile ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', session.userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur introuvable' },
        { status: 404 }
      )
    }

    // Build the query
    let groupsQuery = supabase
      .from('groups')
      .select(`
        id,
        name,
        monthly_budget_estimate,
        created_at,
        creator_id
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    // Add search filter if query provided
    if (query) {
      groupsQuery = groupsQuery.ilike('name', `%${query}%`)
    }

    const { data: groups, error: groupsError } = await groupsQuery

    if (groupsError) {
      console.error('Error searching groups:', groupsError)
      return NextResponse.json(
        { error: 'Erreur lors de la recherche de groupes' },
        { status: 500 }
      )
    }

    // Get user's current group membership (single group)
    const { data: userProfile, error: userProfileError } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', profile.id)
      .single()

    if (userProfileError) {
      console.error('Error fetching user profile:', userProfileError)
      return NextResponse.json(
        { error: 'Erreur lors de la vérification du profil' },
        { status: 500 }
      )
    }

    const userGroupId = userProfile.group_id

    // Transform groups with additional info
    const searchableGroups: SearchableGroup[] = await Promise.all(
      groups.map(async (group) => {
        // Get member count for each group
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact' })
          .eq('group_id', group.id)

        // Get creator profile info
        const { data: creatorProfile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', group.creator_id)
          .single()
        
        return {
          id: group.id,
          name: group.name,
          monthly_budget_estimate: group.monthly_budget_estimate,
          created_at: group.created_at,
          member_count: count || 0,
          is_member: userGroupId === group.id,
          creator_name: creatorProfile 
            ? `${creatorProfile.first_name} ${creatorProfile.last_name}`
            : 'Utilisateur inconnu'
        }
      })
    )

    return NextResponse.json({ 
      groups: searchableGroups,
      total: searchableGroups.length,
      query: query || null
    })
  } catch (error) {
    console.error('Error in GET /api/groups/search:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}