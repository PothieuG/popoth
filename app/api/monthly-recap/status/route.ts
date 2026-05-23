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
 * Codes HTTP :
 *   - 200 { data: { status, summary | null } }                — happy path
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
import { checkRecapStatus, RecapStatusError } from '@/lib/recap/check-status'
import { loadRecapSummary } from '@/lib/recap/load-summary'
import { statusQuerySchema } from '@/lib/schemas/recap'

export const GET = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = parseQuery(request, statusQuerySchema)

    const result = await checkRecapStatus(userId, context)

    if (result.status.kind === 'in_progress') {
      const summary = await loadRecapSummary({
        context,
        profileId: userId,
        groupId: profile.group_id,
      })
      return NextResponse.json({ data: { status: result.status, summary } })
    }

    return NextResponse.json({ data: { status: result.status, summary: null } })
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
