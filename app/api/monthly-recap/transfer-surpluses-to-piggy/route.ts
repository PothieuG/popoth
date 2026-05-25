/**
 * POST /api/monthly-recap/transfer-surpluses-to-piggy — sweep the selected
 * budgets' surplus into the piggy bank. Sprint 06 Monthly Recap V3 — positive
 * flow action 1 (the user keeps some surplus aside in the shared piggy).
 *
 * Each per-budget transfer goes through the atomic RPC
 * `transfer_budget_to_piggy_bank` (cf. lib/finance/savings.ts) so the budget
 * debit + the piggy upsert are tx-bound. The loop is fail-soft: when one RPC
 * raises (e.g. another tab already drew the surplus down), the budget id is
 * reported in `failed[]` and the remaining transfers proceed.
 *
 * Validation gates (in order):
 *   - Zod body                                                             400
 *   - context='group' without group_id on the caller's profile             400
 *   - No active recap for the current month                                404
 *   - Caller is not the recap's initiator (group context)                  403
 *   - current_step ∉ { 'summary', 'manage_bilan' }                         409
 *
 * 200 responses can contain `failed: [...]` non-empty — that is by design.
 * The route does NOT advance `current_step` (transferring partial surplus
 * to the piggy is reversible from the UI perspective; the user typically
 * follows up with /transform-remaining-surpluses-to-savings).
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { executeTransferSurplusesToPiggy } from '@/lib/recap/actions-positive'
import { transferSurplusesBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['summary', 'manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, transferSurplusesBodySchema)

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

    const { outcome, summary, piggyTransfersData } = await executeTransferSurplusesToPiggy({
      context: body.context,
      filter,
      profileId: userId,
      groupId: profile.group_id,
      budgetIds: body.budgetIds,
      recap,
    })

    return NextResponse.json({
      data: {
        transferred: outcome.transferred,
        failed: outcome.failed,
        summary,
        piggyTransfersData,
      },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[recap/transfer-surpluses-to-piggy] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
