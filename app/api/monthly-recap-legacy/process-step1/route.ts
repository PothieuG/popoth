import { NextResponse, type NextRequest } from 'next/server'
import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { processStep1 } from '@/lib/recap-legacy'
import { processStep1BodySchema } from '@/lib/schemas/recap-legacy'

/**
 * POST /api/monthly-recap/process-step1
 *
 * Algorithm "Étape 1" du récap mensuel: rééquilibrage tirelire → économies →
 * surplus, refloat des budgets en déficit. La logique métier est extraite
 * dans `lib/recap/{step1-algorithm,step1-persist}.ts` (Sprint Refactor-I5).
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { profile }) => {
  try {
    const body = await parseBody(request, processStep1BodySchema)
    const context = body.context
    const contextId = context === 'profile' ? profile.id : profile.group_id
    if (!contextId) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const result = await processStep1({
      userId: profile.id,
      context,
      contextId,
      ownerField,
    })

    return NextResponse.json(result)
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[POST /api/monthly-recap/process-step1] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 },
    )
  }
})
