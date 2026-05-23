/**
 * POST /api/monthly-recap/update-salaries — push salary updates for the recap
 * (écran 4). Sprint 08 Monthly Recap V3.
 *
 * For context='profile' the body MUST carry exactly one entry whose
 * `profileId` matches the caller. For context='group' every `profileId` in
 * the body MUST belong to the caller's group (re-fetched server-side via
 * `fetchGroupMemberIds` — never trust the client list).
 *
 * On success: each `profiles.salary` is UPDATEd, `calculate_group_contributions`
 * is invoked for group context (fail-soft — the trigger on next budget change
 * eventually resyncs), and `current_step` advances to `'final_recap'`.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator                                  403
 *   - current_step ≠ 'salary_update'                                       409
 *   - context='profile' with !=1 salary or mismatched profileId            400 invalid_target
 *   - context='group' with any profileId outside the group                 400 invalid_target { invalid: [...] }
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { RecapActionError } from '@/lib/recap/actions-negative'
import { executeUpdateSalaries } from '@/lib/recap/actions-salary'
import { updateSalariesBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['salary_update']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, updateSalariesBodySchema)

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

    const outcome = await executeUpdateSalaries({
      context: body.context,
      userId,
      profile,
      recap,
      salaries: body.salaries,
    })

    return NextResponse.json({ data: outcome })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapActionError) {
      return NextResponse.json({ error: error.code, ...error.extras }, { status: error.status })
    }
    logger.error('[recap/update-salaries] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
