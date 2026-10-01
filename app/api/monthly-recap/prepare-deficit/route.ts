/**
 * POST /api/monthly-recap/prepare-deficit — à l'arrivée sur l'écran
 * « Gestion du déficit » (bilan négatif), verse le surplus de chaque budget
 * dans ses économies. Sprint Recap-Manual-Refloat (2026-10-01).
 *
 * Appelé par `BilanNegativeStep` tant que `recap.surplusSavingsData` est
 * `null`. Idempotent et sûr en concurrence (RPC
 * `transfer_recap_surplus_to_savings`, ligne du récap verrouillée) : un
 * double appel ne crédite jamais deux fois. Ne fait pas avancer l'étape.
 *
 * Validation gates (in order):
 *   - Zod body                                                  400
 *   - context='group' without group_id on the caller's profile  400
 *   - No active recap for the recapped month                    404
 *   - Caller is not the recap's initiator                       403
 *   - current_step ≠ 'manage_bilan'                             409 invalid_step
 *   - Bilan is not negative                                     409 no_deficit
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executePrepareDeficit, RecapActionError } from '@/lib/recap/actions-negative'
import { prepareDeficitBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, prepareDeficitBodySchema)

    if (body.context === 'group' && !profile.group_id) {
      return NextResponse.json({ error: 'Pas de groupe' }, { status: 400 })
    }

    const recap = await getActiveRecap({ context: body.context, userId, profile })
    if (!recap) {
      return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    }
    if (recap.started_by_profile_id !== userId) {
      return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    }
    if (!ALLOWED_STEPS.includes(recap.current_step)) {
      return NextResponse.json(
        { error: 'invalid_step', currentStep: recap.current_step },
        { status: 409 },
      )
    }

    const outcome = await executePrepareDeficit({
      context: body.context,
      profileId: userId,
      groupId: profile.group_id,
      recap,
    })

    return NextResponse.json({ data: outcome })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapActionError) {
      return NextResponse.json({ error: error.code, ...error.extras }, { status: error.status })
    }
    logger.error('[recap/prepare-deficit] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
