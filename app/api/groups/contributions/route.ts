import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

// Group contribution data types
export interface GroupContributionData {
  id: string
  profile_id: string
  group_id: string
  salary: number
  contribution_amount: number
  contribution_percentage: number
  calculated_at: string
  profile?: {
    first_name: string
    last_name: string
  }
}

export interface GroupContributionsResponse {
  contributions: GroupContributionData[]
  group_info: {
    id: string
    name: string
    monthly_budget_estimate: number
    total_salaries: number
    total_contributions: number
  }
}

/**
 * GET /api/groups/contributions - Get contributions for the user's group
 * Returns calculated contributions for all members of the user's group
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

    // Get user's profile and group
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

    // Check if user has a group
    if (!profile.group_id) {
      return NextResponse.json(
        { error: 'Vous n\'appartenez à aucun groupe' },
        { status: 400 }
      )
    }

    // Get group information
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name, monthly_budget_estimate')
      .eq('id', profile.group_id)
      .single()

    if (groupError || !group) {
      return NextResponse.json(
        { error: 'Groupe introuvable' },
        { status: 404 }
      )
    }

    // Get all contributions for the group with profile information
    const { data: contributions, error: contributionsError } = await supabase
      .from('group_contributions')
      .select(`
        *,
        profiles:profile_id (
          first_name,
          last_name
        )
      `)
      .eq('group_id', profile.group_id)
      .order('contribution_amount', { ascending: false })

    if (contributionsError) {
      console.error('Error fetching contributions:', contributionsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des contributions' },
        { status: 500 }
      )
    }

    // Calculate totals
    const totalSalaries = contributions?.reduce((sum, contrib) => sum + contrib.salary, 0) || 0
    const totalContributions = contributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // Format the response
    const formattedContributions: GroupContributionData[] = contributions?.map(contrib => ({
      id: contrib.id,
      profile_id: contrib.profile_id,
      group_id: contrib.group_id,
      salary: contrib.salary,
      contribution_amount: contrib.contribution_amount,
      contribution_percentage: contrib.contribution_percentage,
      calculated_at: contrib.calculated_at,
      profile: contrib.profiles as any
    })) || []

    const response: GroupContributionsResponse = {
      contributions: formattedContributions,
      group_info: {
        id: group.id,
        name: group.name,
        monthly_budget_estimate: group.monthly_budget_estimate,
        total_salaries: totalSalaries,
        total_contributions: totalContributions
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in GET /api/groups/contributions:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/groups/contributions/recalculate - Force recalculation of contributions
 * Triggers a manual recalculation of contributions for the user's group
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

    const supabase = supabaseServer

    // Get user's profile and group
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

    // Check if user has a group
    if (!profile.group_id) {
      return NextResponse.json(
        { error: 'Vous n\'appartenez à aucun groupe' },
        { status: 400 }
      )
    }

    // Call the PostgreSQL function to recalculate contributions
    const { error: calcError } = await supabase
      .rpc('calculate_group_contributions', {
        group_id_param: profile.group_id
      })

    if (calcError) {
      console.error('Error recalculating contributions:', calcError)
      return NextResponse.json(
        { error: 'Erreur lors du recalcul des contributions' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Contributions recalculées avec succès',
      group_id: profile.group_id
    })
  } catch (error) {
    console.error('Error in POST /api/groups/contributions:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}