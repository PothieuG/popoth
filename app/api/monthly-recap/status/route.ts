/**
 * GET /api/monthly-recap/status?context=profile|group — read the recap
 * status for the current month/year + context. Sprint 05 Monthly Recap V3.
 *
 * Wraps `checkRecapStatus` (sprint 03) qui retourne un discriminated union
 * `RecapStatusKind = no_recap | in_progress | locked_by_other | completed`.
 * Le summary n'est calculé que pour `in_progress` — les 3 autres états ne
 * portent pas de données aggregées utiles (no_recap = rien à montrer ;
 * locked_by_other = écran de verrou ; completed = le user voit le dashboard
 * standard).
 *
 * Sprint 13 — quand `in_progress`, retourne aussi `recap`, un sibling expose
 * les trackers de progression du `monthly_recaps` row (refloatedFromPiggy /
 * refloatedFromSavings / snapshotData / currentStep). Le négatif
 * `BilanNegativeStep` recalcule le compteur déficit live à partir de ces
 * trackers, ce qui garantit la cohérence à chaque visite (cf. memory
 * `feedback_recap_exact_reentry`). `null` dans tous les autres états.
 *
 * Codes HTTP :
 *   - 200 { data: { status, summary | null, recap | null } } — happy path
 *   - 400 { error: 'Query invalide', issues }                  — Zod fail
 *   - 400 { error: 'Utilisateur ne fait partie d'aucun groupe' } — NO_GROUP
 *   - 404 { error: 'Profil utilisateur non trouvé' }           — PROFILE_NOT_FOUND
 *   - 401                                                       — gérée par wrapper
 *   - 500 { error: 'Erreur interne' }                          — exception inattendue
 *
 * Consommé par le wizard front-end (sprints 10+) à chaque rafraîchissement
 * UI ainsi qu'au mount initial pour décider du routing (welcome / écran
 * lock / écran wizard étape X).
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseQuery } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import { checkRecapStatus, RecapStatusError } from '@/lib/recap/check-status'
import { coerceSnapshot } from '@/lib/recap/deficit-math'
import { loadRecapSummary } from '@/lib/recap/load-summary'
import type { RecapStep } from '@/lib/recap/state'
import { statusQuerySchema } from '@/lib/schemas/recap'

const VALID_STEPS: readonly RecapStep[] = [
  'welcome',
  'complete_month',
  'summary',
  'manage_bilan',
  'salary_update',
  'final_recap',
  'completed',
]

function coerceStep(raw: string): RecapStep {
  return (VALID_STEPS as readonly string[]).includes(raw) ? (raw as RecapStep) : 'welcome'
}

export const GET = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = parseQuery(request, statusQuerySchema)

    const result = await checkRecapStatus(userId, context)

    // Sprint Complete-Month-Step (2026-05-29) — expose recapYear/recapMonth so
    // the new wizard step can filter the transaction list to the recapped
    // month and default the AddTransactionModal date. Derived server-side via
    // `checkRecapStatus` so client doesn't drift when crossing a month boundary.
    const recapYear = result.currentYear
    const recapMonth = result.currentMonth

    if (result.status.kind === 'in_progress') {
      const [summary, recapRow] = await Promise.all([
        loadRecapSummary({
          context,
          profileId: userId,
          groupId: profile.group_id,
        }),
        getActiveRecap({ context, userId, profile }),
      ])

      const recap = recapRow
        ? {
            id: recapRow.id,
            currentStep: coerceStep(recapRow.current_step),
            refloatedFromPiggy: Number(recapRow.refloated_from_piggy ?? 0),
            refloatedFromSavings: Number(recapRow.refloated_from_savings ?? 0),
            snapshotData: coerceSnapshot(recapRow.budget_snapshot_data),
          }
        : null

      return NextResponse.json({
        data: { status: result.status, summary, recap, recapYear, recapMonth },
      })
    }

    return NextResponse.json({
      data: { status: result.status, summary: null, recap: null, recapYear, recapMonth },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled

    if (error instanceof RecapStatusError) {
      const status = error.code === 'PROFILE_NOT_FOUND' ? 404 : 400
      return NextResponse.json({ error: error.message }, { status })
    }

    logger.error('[recap/status] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
