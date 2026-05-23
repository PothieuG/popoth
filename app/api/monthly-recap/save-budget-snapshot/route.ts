/**
 * POST /api/monthly-recap/save-budget-snapshot — compute a proportional
 * snapshot of how to draw the deficit_remaining from next month's budgets
 * and OVERWRITE `monthly_recaps.budget_snapshot_data` JSONB. Sprint 07
 * Monthly Recap V3 — negative flow action 3 (écran 3B ligne 3).
 *
 * The body carries only the `context`; the server computes the allocation
 * via `computeProportionalBudgetSnapshot` (pool = `estimated_amount`). The
 * snapshot is NOT applied to `estimated_budgets.carryover_spent_amount`
 * here — that's the finalize job (sprint 08). Re-clicks are idempotent
 * because the snapshot is computed from `|bilan| - refloatedFromPiggy -
 * refloatedFromSavings` (existing snapshot deliberately excluded).
 *
 * THIS endpoint is the ONLY negative-flow endpoint that advances the recap
 * state machine — to `'salary_update'` iff `newDeficit ≤ 0.01`.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 *   - Bilan is not negative                                                409 no_deficit
 *   - Deficit already covered                                              409 no_deficit
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeSaveBudgetSnapshot, RecapActionError } from '@/lib/recap/actions-negative'
import { saveBudgetSnapshotBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, saveBudgetSnapshotBodySchema)

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

    const outcome = await executeSaveBudgetSnapshot({
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
    logger.error('[recap/save-budget-snapshot] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
