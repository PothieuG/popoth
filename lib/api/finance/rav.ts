import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRavFromDatabase } from '@/lib/financial-calculations'
import { withAuthAndProfile } from '@/lib/api/with-auth'

/**
 * API to retrieve the current Remaining to Live (RAV) from database
 * This endpoint returns the persisted RAV value without recalculating it
 *
 * Query params:
 * - context: 'profile' | 'group' (optional, defaults to profile)
 */
export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Get query params
    const { searchParams } = new URL(request.url)
    const forceContext = searchParams.get('context') as 'profile' | 'group' | null

    // Determine context
    let context: 'profile' | 'group'
    let contextId: string

    if (forceContext === 'group' && profile.group_id) {
      context = 'group'
      contextId = profile.group_id
    } else {
      context = 'profile'
      contextId = userId
    }

    console.log(`🔍 [GET /api/finance/rav] Fetching RAV from database for ${context}: ${contextId}`)

    // Retrieve RAV from database
    const remainingToLive = await getRavFromDatabase(
      context === 'profile' ? contextId : null,
      context === 'group' ? contextId : null,
    )

    console.log(`✅ [GET /api/finance/rav] RAV retrieved: ${remainingToLive}€`)

    return NextResponse.json({
      remainingToLive,
      context,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('❌ Error in GET /api/finance/rav:', error)
    return NextResponse.json(
      {
        error: 'Erreur lors de la récupération du RAV',
        remainingToLive: 0,
      },
      { status: 500 },
    )
  }
})
