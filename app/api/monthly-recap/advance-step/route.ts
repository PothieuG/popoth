/**
 * POST /api/monthly-recap/advance-step — generic explicit wizard transition.
 * Sprint 11 Monthly Recap V3.
 *
 * Used by the wizard's "next" buttons. The 5 real transitions are ALL adjacent :
 *   welcome → complete_month → summary → manage_bilan → salary_update → final_recap
 * Body : `{ context, fromStep, toStep }`.
 *
 * Sprint Advance-Step-Adjacency (2026-08-31) — the route now REJECTS every
 * non-adjacent forward jump. `executeAdvanceStep` / `isAdvanceAllowed` keep
 * their deliberately permissive contract (pinned by
 * `lib/recap/__tests__/actions-advance.test.ts`) ; the business rule lives here,
 * exactly as their docstrings prescribe. Two distinct holes are closed :
 *
 *   1. Skipping `manage_bilan` on a NEGATIVE bilan leaves `budget_snapshot_data`
 *      empty. `finalize_recap_apply_snapshot` has OVERWRITE semantics (it resets
 *      every owner budget's `carryover_spent_amount` to 0, then applies the
 *      snapshot), so the overspend debt would be silently ERASED instead of
 *      carried over. On a POSITIVE bilan the per-budget surpluses are never
 *      credited to `cumulated_savings` and the RAV is never swept to the piggy.
 *   2. `toStep = 'completed'` is refused outright — closing the recap is
 *      `/complete`'s job. Writing `current_step = 'completed'` here would leave
 *      `completed_at` NULL, so `checkRecapStatus` keeps reporting `in_progress`
 *      while `RecapWizard` renders its "Redirection…" spinner forever, and
 *      `/complete` answers 409 (`ALLOWED_STEPS = ['final_recap']`) — locking the
 *      user out of the app for good, with none of the 4 finalize RPCs run.
 *
 * Validation pipeline (in order) :
 *   - Zod body parse                                              400 body invalide
 *   - context='group' but no group_id on caller's profile          400 'Pas de groupe'
 *   - No active recap for the recapped month                       404 'no_active_recap'
 *   - Caller is not the recap initiator                            403 'not_initiator'
 *   - fromStep ≠ recap.current_step (stale client)                 409 'stale_step'
 *   - toStep ≠ nextRequiredStep(fromStep), or toStep='completed'   400 'invalid_transition'
 *   - executeAdvanceStep returns 'invalid_transition'              400
 *   - executeAdvanceStep returns 'stale_step' (concurrent writer)  409
 *   - executeAdvanceStep returns 'db_error'                        500
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
import { nextRequiredStep } from '@/lib/recap/state'
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

    // Stale client (out-of-date tab, double submit). Surfaced here rather than
    // left to `executeAdvanceStep` so the adjacency rule below can trust
    // `body.fromStep` as the recap's real current step.
    if (body.fromStep !== recap.current_step) {
      return NextResponse.json(
        { error: 'stale_step', currentStep: recap.current_step },
        { status: 409 },
      )
    }

    // Adjacency + no self-completion (see file header). `nextRequiredStep`
    // returns `'completed'` for `'final_recap'` and `null` for `'completed'`.
    const requiredStep = nextRequiredStep(body.fromStep)
    if (requiredStep === null || requiredStep === 'completed' || body.toStep !== requiredStep) {
      return NextResponse.json(
        { error: 'invalid_transition', fromStep: body.fromStep, toStep: body.toStep },
        { status: 400 },
      )
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
      recapMonth: recap.recap_month,
      recapYear: recap.recap_year,
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
