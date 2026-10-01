/**
 * POST /api/monthly-recap/save-refloat-plan — enregistre le choix de
 * l'utilisateur pour UNE source du renflouement (tirelire, budgets ou
 * projets). Sprint Recap-Manual-Refloat (2026-10-01).
 *
 * Remplace la valeur précédente de la source. Rien n'est débité ici : le plan
 * est appliqué à la finalisation du récap (cf. `executeCompleteRecap`), donc
 * l'utilisateur peut revenir le modifier jusque-là. Ne fait pas avancer
 * l'étape — c'est le bouton « Continuer » (`advance-step`) qui le fait, et
 * uniquement si le déficit est couvert (ou toutes les sources épuisées).
 *
 * Validation gates (in order):
 *   - Zod body                                                  400
 *   - context='group' without group_id on the caller's profile  400
 *   - No active recap for the recapped month                    404
 *   - Caller is not the recap's initiator                       403
 *   - current_step ≠ 'manage_bilan'                             409 invalid_step
 *   - Surplus pas encore versé dans les économies               409 not_prepared
 *   - Bilan is not negative                                     409 no_deficit
 *   - Tirelire insuffisante                                     400 piggy_insufficient
 *   - Budget / projet inconnu                                   400 unknown_budget|unknown_project
 *   - Limite d'un budget / projet dépassée                      400 budget_capacity_exceeded|project_capacity_exceeded
 *   - Total de la source > reste à renflouer sans elle          400 overflow
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { getActiveRecap } from '@/lib/recap/active-recap'
import {
  executeSaveRefloatPlan,
  RecapActionError,
  type SaveRefloatPlanInput,
} from '@/lib/recap/actions-negative'
import { saveRefloatPlanBodySchema } from '@/lib/schemas/recap'

const ALLOWED_STEPS: readonly string[] = ['manage_bilan']

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const body = await parseBody(request, saveRefloatPlanBodySchema)

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

    // Le body Zod porte déjà la forme discriminée attendue (+ `context`).
    const input: SaveRefloatPlanInput = body

    const outcome = await executeSaveRefloatPlan({
      context: body.context,
      profileId: userId,
      groupId: profile.group_id,
      recap,
      input,
    })

    return NextResponse.json({ data: outcome })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapActionError) {
      return NextResponse.json({ error: error.code, ...error.extras }, { status: error.status })
    }
    logger.error('[recap/save-refloat-plan] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
