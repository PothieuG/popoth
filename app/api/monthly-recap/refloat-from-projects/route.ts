/**
 * POST /api/monthly-recap/refloat-from-projects — virtual refund of each
 * savings project's monthly allocation, proportionally to its share of the
 * total `monthly_allocation` pool, up to the current `deficitRemaining`.
 * Sprint Projets-Épargne 08 (2026-05-26) — new intermediate step in the
 * negative cascade, inserted between savings refloat and the final budget
 * snapshot.
 *
 * The body carries only the `context`; the server computes the per-project
 * allocation via `computeProportionalProjectsRefloat` (pool =
 * `monthly_allocation`, NOT `amount_saved`). The result OVERWRITES
 * `monthly_recaps.project_snapshot_data` JSONB. No write to
 * `savings_projects` — the application is deferred to finalize (sprint 10)
 * via the existing `apply_recap_projects_snapshot` RPC (sprint 01).
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 *   - Bilan is not negative / deficit already covered                      409 no_deficit
 *   - No active projects (empty pool)                                      409 no_projects_available
 *
 * Does NOT advance `current_step` — sprint 09 cascade UI owns transitions.
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeRefloatFromProjects, RecapActionError } from '@/lib/recap/actions-negative'
import { refloatFromProjectsBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, refloatFromProjectsBodySchema)

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

    const outcome = await executeRefloatFromProjects({
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
    logger.error('[recap/refloat-from-projects] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
