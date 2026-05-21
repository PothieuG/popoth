import { NextResponse, type NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { processComplete } from '@/lib/recap-legacy'
import { RecapBudgetNotFoundError, RecapContextError } from '@/lib/recap-legacy/complete-types'
import { completeBodySchema } from '@/lib/schemas/recap-legacy'

/**
 * POST /api/monthly-recap/complete — thin handler. Business logic lives in
 * `lib/recap/{complete-algorithm,complete-persist}.ts` (Sprint Refactor-I6).
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { profile }) => {
  try {
    const body = await parseBody(request, completeBodySchema)
    const { context, session_id, remaining_to_live_choice } = body
    const { action, final_amount } = remaining_to_live_choice
    const budgetId =
      action === 'deduct_from_budget' ? remaining_to_live_choice.budget_id : undefined

    const contextId = context === 'profile' ? profile.id : profile.group_id
    if (!contextId) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const output = await processComplete({
      userId: profile.id,
      context,
      contextId,
      ownerField,
      sessionId: session_id,
      finalAmount: final_amount,
      action,
      budgetId,
      currentDate: new Date(),
    })

    return NextResponse.json(output)
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapBudgetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof RecapContextError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('[POST /api/monthly-recap/complete] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 },
    )
  }
})
