/**
 * POST /api/monthly-recap/transform-remaining-surpluses-to-savings — convert
 * every remaining positive surplus into the budgets' cumulated_savings AND
 * sweep the positive reste à vivre effectif (= summary.bilan = ravEffectif)
 * into the piggy bank. Sprint 06 Monthly Recap V3 — positive flow action 2
 * (terminates the 4.A branch by advancing the state machine to
 * `'salary_update'`). Sprint Bilan-Equals-RavEffectif added the rav→piggy sweep
 * (`data.sweptToPiggy`).
 *
 * Loop is fail-soft per budget (`update_budget_cumulated_savings` is its own
 * single-row tx). The state machine advances only when at least one transform
 * succeeded — or when there were no targets at all (no-op safe). On 100%
 * failure against a non-empty target set, `current_step` is preserved so the
 * user can retry; the response signals this via `nextStep: null`.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeTransformRemainingToSavings } from '@/lib/recap/actions-positive'
import { transformRemainingBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, transformRemainingBodySchema)

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

    const outcome = await executeTransformRemainingToSavings({
      context: body.context,
      recap,
      profileId: userId,
      groupId: profile.group_id,
    })

    return NextResponse.json({
      data: {
        transformed: outcome.transformed,
        failed: outcome.failed,
        nextStep: outcome.nextStep,
        sweptToPiggy: outcome.sweptToPiggy,
      },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[recap/transform-remaining-surpluses-to-savings] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
