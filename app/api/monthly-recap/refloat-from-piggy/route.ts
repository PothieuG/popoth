/**
 * POST /api/monthly-recap/refloat-from-piggy — debit `piggy_bank.amount` by
 * the user-specified `amount` and bump `monthly_recaps.refloated_from_piggy`.
 * Sprint 07 Monthly Recap V3 — negative flow action 1 (écran 3B ligne 1).
 *
 * The two writes (piggy debit + recap tracker update) are NOT composite-
 * atomic. If the tracker update fails after a successful piggy debit, the
 * orphan debit is logged but accepted — composite RPC was deemed too heavy
 * for this feature (cf. sprint 07 plan). UI must disable the button while
 * the mutation is pending to mitigate concurrent clicks.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 *   - Bilan is not negative (no deficit to refloat)                        409 no_deficit
 *   - amount > deficitRemaining + 0.01 (cents-precise tolerance)           400 overflow
 *   - amount > piggy.amount + 0.01                                         400 piggy_insufficient
 *
 * Does NOT advance `current_step` even when the deficit reaches 0 — the UI
 * decides whether to route to the positive flow (when piggy generated a
 * residual surplus) or to call `save-budget-snapshot` (the only endpoint
 * that advances to `'salary_update'`).
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeRefloatFromPiggy, RecapActionError } from '@/lib/recap/actions-negative'
import { refloatFromPiggyBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, refloatFromPiggyBodySchema)

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

    const filter: ContextFilter =
      body.context === 'profile' ? { profile_id: userId } : { group_id: profile.group_id as string }

    const outcome = await executeRefloatFromPiggy({
      context: body.context,
      filter,
      profileId: userId,
      groupId: profile.group_id,
      recap,
      amount: body.amount,
    })

    return NextResponse.json({ data: outcome })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapActionError) {
      return NextResponse.json({ error: error.code, ...error.extras }, { status: error.status })
    }
    logger.error('[recap/refloat-from-piggy] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
