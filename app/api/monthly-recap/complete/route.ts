import { NextResponse, type NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import type { Database } from '@/lib/database.types'
import { logger } from '@/lib/logger'
import { completeV2BodySchema } from '@/lib/schemas/recap'
import { supabaseServer } from '@/lib/supabase-server'

type MonthlyRecapV2Insert = Database['public']['Tables']['monthly_recaps_v2']['Insert']

/**
 * POST /api/monthly-recap/complete — V2 ossature stub. Marks the current
 * month as closed for the (profile|group) via UPSERT on `monthly_recaps_v2`.
 * Idempotent : repeated POST resets `completed_at` to `now()` without
 * creating duplicate rows (UNIQUE constraint + onConflict).
 *
 * Le flow fonctionnel V2 (step1, transferts, auto-balance, snapshots) sera
 * ajouté dans les sprints additifs ultérieurs au-dessus de cet endpoint.
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { profile }) => {
  try {
    const { context } = await parseBody(request, completeV2BodySchema)

    const contextId = context === 'profile' ? profile.id : profile.group_id
    if (!contextId) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    const completedAt = now.toISOString()

    const payload: MonthlyRecapV2Insert =
      context === 'profile'
        ? {
            profile_id: contextId,
            recap_month: month,
            recap_year: year,
            completed_at: completedAt,
          }
        : {
            group_id: contextId,
            recap_month: month,
            recap_year: year,
            completed_at: completedAt,
          }

    const onConflict =
      context === 'profile'
        ? 'profile_id,recap_month,recap_year'
        : 'group_id,recap_month,recap_year'

    const { data, error } = await supabaseServer
      .from('monthly_recaps_v2')
      .upsert(payload, { onConflict })
      .select('id, completed_at')
      .single()

    if (error) {
      logger.error('[POST /api/monthly-recap/complete] UPSERT failed', error)
      return NextResponse.json({ error: 'Erreur lors de la clôture du mois' }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[POST /api/monthly-recap/complete] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 },
    )
  }
})
