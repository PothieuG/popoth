/**
 * POST /api/monthly-recap/complete — finalize the recap (écran 5). Sprint 08
 * Monthly Recap V3.
 *
 * Idempotent on retry: a second call after a successful finalize returns
 * `{ alreadyCompleted: true, recap }` with HTTP 200. `getActiveRecap` filters
 * `completed_at IS NULL`, so a NULL recap here means either "never started"
 * OR "already completed" — disambiguate with a direct lookup of the completed
 * row for the current month before responding 404.
 *
 * Orchestration (via `executeCompleteRecap`):
 *   1. (fail-soft) `finalize_recap_apply_snapshot` — applies the deferred
 *      JSONB snapshot to `estimated_budgets.carryover_spent_amount`.
 *   2. (fail-soft) `process_recap_transactions` — DELETEs validated rows
 *      (real_expenses + real_income_entries with `applied_to_balance_at IS NOT NULL`),
 *      flags non-validated ones with `is_carried_over=true` + `carried_from_recap_id`.
 *   3. (HARD) UPDATE `monthly_recaps.completed_at = now()` + `current_step = 'completed'`.
 *      If this errors, the recap stays open and the client must retry — the
 *      next call's idempotency check will short-circuit any duplicate work.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap (and no completed row for the month)                 404
 *     OR no active recap but COMPLETED row exists                          200 alreadyCompleted
 *   - Caller is not the recap's initiator                                  403
 *   - current_step ≠ 'final_recap'                                         409
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeCompleteRecap } from '@/lib/recap/actions-finalize'
import { RecapActionError } from '@/lib/recap/actions-negative'
import { completeRecapBodySchema } from '@/lib/schemas/recap'
import { supabaseServer } from '@/lib/supabase-server'

const ALLOWED_STEPS: readonly string[] = ['final_recap']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, completeRecapBodySchema)

    if (body.context === 'group' && !profile.group_id) {
      return NextResponse.json({ error: 'Pas de groupe' }, { status: 400 })
    }

    const recap = await getActiveRecap({ context: body.context, userId, profile })

    if (!recap) {
      // Idempotency disambiguation: query for a COMPLETED row for the current
      // month. If present, the user already finalized — return success.
      const now = new Date()
      const ownerFilter: { profile_id?: string; group_id?: string } =
        body.context === 'profile'
          ? { profile_id: profile.id }
          : { group_id: profile.group_id as string }

      const { data: completedRow, error: lookupError } = await supabaseServer
        .from('monthly_recaps')
        .select('id, completed_at, current_step')
        .match({
          ...ownerFilter,
          recap_month: now.getMonth() + 1,
          recap_year: now.getFullYear(),
        })
        .not('completed_at', 'is', null)
        .maybeSingle()

      if (lookupError) {
        logger.error('[recap/complete] idempotency lookup failed', { error: lookupError })
      }
      if (completedRow) {
        return NextResponse.json({ data: { alreadyCompleted: true, recap: completedRow } })
      }
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

    const outcome = await executeCompleteRecap({
      context: body.context,
      profile,
      recap,
    })

    return NextResponse.json({ data: outcome })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapActionError) {
      return NextResponse.json({ error: error.code, ...error.extras }, { status: error.status })
    }
    logger.error('[recap/complete] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
