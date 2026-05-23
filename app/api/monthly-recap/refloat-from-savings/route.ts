/**
 * POST /api/monthly-recap/refloat-from-savings — debit each budget's
 * `cumulated_savings` proportionally to its share of the total savings pool,
 * up to the current `deficitRemaining`. Sprint 07 Monthly Recap V3 —
 * negative flow action 2 (écran 3B ligne 2).
 *
 * The body carries only the `context`; the server computes the per-budget
 * allocation via `computeProportionalSavingsRefloat`. Each per-budget debit
 * is its own atomic single-row RPC (`update_budget_cumulated_savings`); the
 * loop is fail-soft so one failure does not abort the others. After the
 * loop, `monthly_recaps.refloated_from_savings` is bumped by the actually-
 * applied total.
 *
 * Pool empty (no budget has cumulated_savings > 0) returns a no-op 200 with
 * `shortfall === deficitRemaining` and an empty `perBudget` — the UI is
 * expected to show the line as indicatif when `totalSavings === 0`, so this
 * path should be unreachable in practice.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 *   - Bilan is not negative                                                409 no_deficit
 *   - Deficit already covered (deficitRemaining ≤ 0)                       409 no_deficit
 *
 * Does NOT advance `current_step` (cf. refloat-from-piggy rationale).
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeRefloatFromSavings, RecapActionError } from '@/lib/recap/actions-negative'
import { refloatFromSavingsBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, refloatFromSavingsBodySchema)

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

    const outcome = await executeRefloatFromSavings({
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
    logger.error('[recap/refloat-from-savings] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
