/**
 * POST /api/monthly-recap/advance-step — generic explicit wizard transition.
 * Sprint 11 Monthly Recap V3.
 *
 * Used by the two "next" buttons of the early wizard (Welcome → Summary,
 * Summary → Manage_bilan). Body : `{ context, fromStep, toStep }`.
 *
 * Validation pipeline (in order) :
 *   - Zod body parse                                             400 body invalide
 *   - context='group' but no group_id on caller's profile         400 'Pas de groupe'
 *   - No active recap for current month                           404 'no_active_recap'
 *   - Caller is not the recap initiator                           403 'not_initiator'
 *   - executeAdvanceStep returns 'invalid_transition'             400
 *   - executeAdvanceStep returns 'stale_step' (race or out-of-date) 409
 *   - executeAdvanceStep returns 'db_error'                       500
 *
 * Returns `{ data: { recap: { ...recap, current_step: toStep }, summary } }`
 * on success — fresh summary so the client can re-hydrate the wizard in one
 * round trip.
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeAdvanceStep } from '@/lib/recap/actions-advance'
import { loadRecapSummary } from '@/lib/recap/load-summary'
import { advanceStepBodySchema } from '@/lib/schemas/recap'

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, advanceStepBodySchema)

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

    const outcome = await executeAdvanceStep({
      recap,
      fromStep: body.fromStep,
      toStep: body.toStep,
    })

    if (!outcome.success) {
      if (outcome.error === 'invalid_transition') {
        return NextResponse.json(
          {
            error: 'invalid_transition',
            fromStep: body.fromStep,
            toStep: body.toStep,
          },
          { status: 400 },
        )
      }
      if (outcome.error === 'stale_step') {
        return NextResponse.json(
          { error: 'stale_step', currentStep: recap.current_step },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
    }

    const summary = await loadRecapSummary({
      context: body.context,
      profileId: userId,
      groupId: profile.group_id,
    })

    return NextResponse.json({
      data: {
        recap: { ...recap, current_step: outcome.currentStep },
        summary,
      },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[recap/advance-step] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
