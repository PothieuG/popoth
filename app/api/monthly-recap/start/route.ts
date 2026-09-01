/**
 * POST /api/monthly-recap/start — claim the recap lock for the recapped
 * month/year (previous calendar month, per `getRecapPeriod`) + context.
 * Sprint 05 Monthly Recap V3.
 *
 * Atomicité garantie côté DB par la RPC `start_monthly_recap` (cf.
 * supabase/migrations/20260525000000_create_recap_start_rpc.sql) qui retourne
 * un discriminant `result` ∈ { 'created', 'resumed', 'completed',
 * 'locked_by_other' }. La route fait le mapping HTTP status → body shape :
 *
 *   - 'created' | 'resumed'      → 200 + { data: { recap, summary } }
 *   - 'locked_by_other'           → 409 + { error: 'locked_by_other', startedBy }
 *   - 'completed' (déjà fait ce mois) → 410 + { error: 'already_completed', recapId }
 *
 * Le summary est composé via `loadRecapSummary` (parallèle FinancialData +
 * budgets + spent + piggy + bank).
 *
 * Sprint Abandoned-Recap-Recovery (2026-09-01) — la RPC balaye en plus, dans
 * la même transaction, les bilans du même propriétaire restés ouverts sur des
 * périodes strictement antérieures : leurs prélèvements (tirelire + économies)
 * sont recrédités sur la tirelire et les lignes marquées `abandoned_at`. Le
 * montant rendu revient dans `payload.recovered` et est relayé au client, qui
 * l'affiche via `<RecoveredFundsBanner>`. Les 4 résultats et leurs statuts HTTP
 * sont inchangés.
 */

import { NextResponse } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'
import { loadRecapSummary } from '@/lib/recap/load-summary'
import { getRecapPeriod } from '@/lib/recap/period'
import { startRecapBodySchema } from '@/lib/schemas/recap'
import { supabaseServer } from '@/lib/supabase-server'

interface StartRpcResult {
  result: 'created' | 'resumed' | 'completed' | 'locked_by_other'
  recap: {
    id: string
    profile_id: string | null
    group_id: string | null
    recap_month: number
    recap_year: number
    current_step: string
    started_by_profile_id: string | null
    started_at: string | null
    completed_at: string | null
  }
  /** Sprint Abandoned-Recap-Recovery — toujours présent depuis la migration
   *  `20260901000001`, mais typé optionnel pour rester tolérant si la RPC
   *  déployée est antérieure (dev appliqué en ad-hoc, cf. multi-env.md §6). */
  recovered?: {
    total: number
    periods: Array<{ month: number; year: number; amount: number }>
  }
}

export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = await parseBody(request, startRecapBodySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json({ error: 'Pas de groupe' }, { status: 400 })
    }

    const { month, year } = getRecapPeriod()

    const { data, error } = await supabaseServer.rpc('start_monthly_recap', {
      p_month: month,
      p_year: year,
      p_started_by_profile_id: userId,
      p_profile_id: context === 'profile' ? profile.id : undefined,
      p_group_id: context === 'group' ? (profile.group_id as string) : undefined,
    })

    if (error) {
      logger.error('[recap/start] RPC failed', { error, context, userId })
      return NextResponse.json({ error: 'Erreur claim lock' }, { status: 500 })
    }

    const payload = data as unknown as StartRpcResult

    if (payload.result === 'locked_by_other') {
      return NextResponse.json(
        { error: 'locked_by_other', startedBy: payload.recap.started_by_profile_id },
        { status: 409 },
      )
    }

    if (payload.result === 'completed') {
      return NextResponse.json(
        { error: 'already_completed', recapId: payload.recap.id },
        { status: 410 },
      )
    }

    // 'created' | 'resumed' → charger le summary et retourner 200.
    const summary = await loadRecapSummary({
      context,
      profileId: userId,
      groupId: profile.group_id,
      recapMonth: payload.recap.recap_month,
      recapYear: payload.recap.recap_year,
    })

    if (payload.recovered && payload.recovered.total > 0) {
      logger.info('[recap/start] recovered abandoned recaps', {
        context,
        userId,
        total: payload.recovered.total,
        periods: payload.recovered.periods,
      })
    }

    return NextResponse.json({
      data: { recap: payload.recap, summary, recovered: payload.recovered ?? null },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[recap/start] failed', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
})
