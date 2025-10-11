import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getRavFromDatabase } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API to retrieve the current Remaining to Live (RAV) from database
 * This endpoint returns the persisted RAV value without recalculating it
 *
 * Query params:
 * - context: 'profile' | 'group' (optional, defaults to profile)
 */
export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const forceContext = searchParams.get('context') as 'profile' | 'group' | null

    // Retrieve profile to determine context
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('❌ Error retrieving profile:', profileError)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Determine context
    let context: 'profile' | 'group'
    let contextId: string

    if (forceContext === 'group' && profile.group_id) {
      context = 'group'
      contextId = profile.group_id
    } else {
      context = 'profile'
      contextId = profile.id
    }

    console.log(`🔍 [GET /api/financial/rav] Fetching RAV from database for ${context}: ${contextId}`)

    // Retrieve RAV from database
    const remainingToLive = await getRavFromDatabase(
      context === 'profile' ? contextId : null,
      context === 'group' ? contextId : null
    )

    console.log(`✅ [GET /api/financial/rav] RAV retrieved: ${remainingToLive}€`)

    return NextResponse.json({
      remainingToLive,
      context,
      timestamp: Date.now()
    })

  } catch (error) {
    console.error('❌ Error in GET /api/financial/rav:', error)
    return NextResponse.json(
      {
        error: 'Erreur lors de la récupération du RAV',
        remainingToLive: 0
      },
      { status: 500 }
    )
  }
}
