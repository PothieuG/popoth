import { NextResponse } from 'next/server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { autoBalanceBodySchema } from '@/lib/schemas/recap-legacy'
import { processAutoBalance, RecapNoBudgetsError } from '@/lib/recap-legacy'

/**
 * POST /api/monthly-recap/auto-balance
 *
 * Thin handler (Sprint Refactor-Auto-Balance 2026-05-16). The 3-phase
 * proportional auto-balance algorithm lives in lib/recap/auto-balance-
 * algorithm.ts (pure) + lib/recap/auto-balance-persist.ts (I/O orchestration
 * via composite RPCs + batched INSERT). See those modules for the JSDoc
 * description of the algorithm + atomicity contracts.
 *
 * This handler:
 *   1. Validates the body via autoBalanceBodySchema (Zod)
 *   2. Checks the group context invariant (profile.group_id required when
 *      context='group')
 *   3. Builds ProcessAutoBalanceInput and delegates to processAutoBalance
 *   4. Maps thrown errors to HTTP status:
 *        RecapNoBudgetsError    → 404 (no estimated_budgets for the owner)
 *        BadRequestError (Zod)  → 400 (handleBadRequest)
 *        any other Error        → 500
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context } = await parseBody(request, autoBalanceBodySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId = context === 'profile' ? profile.id : profile.group_id!
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const output = await processAutoBalance({
      userId: profile.id,
      context,
      contextId,
      ownerField,
    })

    return NextResponse.json(output)
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapNoBudgetsError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
