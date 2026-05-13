import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRavFromDatabase } from '@/lib/finance'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * API to retrieve the current Remaining to Live (RAV) from database
 * This endpoint returns the persisted RAV value without recalculating it
 *
 * Query params:
 * - context: 'profile' | 'group' (optional, defaults to profile)
 */
export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { context: forceContext } = parseQuery(request, contextOnlyQuerySchema)

    // Determine context: group iff explicitly requested and user is in a group
    let context: 'profile' | 'group'
    let contextId: string

    if (forceContext === 'group' && profile.group_id) {
      context = 'group'
      contextId = profile.group_id
    } else {
      context = 'profile'
      contextId = userId
    }

    // Retrieve RAV from database
    const remainingToLive = await getRavFromDatabase(
      context === 'profile' ? contextId : null,
      context === 'group' ? contextId : null,
    )

    return NextResponse.json({
      remainingToLive,
      context,
      timestamp: Date.now(),
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Error in GET /api/finance/rav:', error)
    return NextResponse.json(
      {
        error: 'Erreur lors de la récupération du RAV',
        remainingToLive: 0,
      },
      { status: 500 },
    )
  }
})
