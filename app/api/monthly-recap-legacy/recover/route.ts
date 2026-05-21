import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'
import { recoverRecapBodySchema } from '@/lib/schemas/recap-legacy'
import {
  processRecovery,
  RecoverContextError,
  RecoverSnapshotCorruptedError,
  RecoverSnapshotNotFoundError,
  RecoveryAppliedPartiallyError,
} from '@/lib/recap-legacy'
import { logger } from '@/lib/logger'

/**
 * API POST /api/monthly-recap/recover
 *
 * Récupère les données depuis un snapshot de sécurité en cas de bug
 * ou d'interruption pendant le récapitulatif mensuel.
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   snapshot_id?: string, // Optionnel, prend le plus récent si non spécifié
 *   confirm: boolean      // Protection pour éviter les récupérations accidentelles
 * }
 *
 * Sprint Refactor-Recover (2026-05-16): logique métier extraite dans
 * lib/recap/recover-{algorithm,persist}.ts. La route ne porte plus que la
 * validation Zod + la résolution du contexte + le mapping d'erreurs HTTP.
 * Le CLEANUP-ATTEMPT CRITIQUE (route L286-288 pre-refactor) est préservé
 * dans applyRecoveryDecision via logger.error + RecoveryAppliedPartiallyError
 * (cf. lib/recap/recover-persist.ts).
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context, snapshot_id } = await parseBody(request, recoverRecapBodySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const output = await processRecovery({
      userId: profile.id,
      context,
      contextId,
      ownerField,
      snapshotId: snapshot_id,
      currentDate: new Date(),
    })

    return NextResponse.json(output)
  } catch (error) {
    if (error instanceof RecoverContextError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof RecoverSnapshotNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof RecoverSnapshotCorruptedError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error instanceof RecoveryAppliedPartiallyError) {
      // PRESERVED: route L289-295 pre-refactor — 500 + recovery_results in
      // body so the consumer can inspect the in-flight partial state.
      return NextResponse.json(
        {
          error: 'Erreur lors de la récupération des données',
          recovery_results: error.partialResults,
        },
        { status: 500 },
      )
    }
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * API GET /api/monthly-recap/recover
 *
 * Liste les snapshots disponibles pour récupération.
 *
 * Sprint Refactor-Recover (2026-05-16): le GET reste verbatim dans la
 * route (Q2 arbitrage user — pure I/O sans logique métier, 1 SELECT +
 * map de formatage UI fr-FR, pas de gain à extraire vers recover-persist.ts).
 */
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: snapshots, error: snapshotsError } = await supabaseServer
      .from('recap_snapshots')
      .select('id, snapshot_month, snapshot_year, created_at, is_active')
      .eq(ownerField, contextId)
      .order('created_at', { ascending: false })
      .limit(10) // Limiter aux 10 plus récents

    if (snapshotsError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des snapshots' },
        { status: 500 },
      )
    }

    const monthNames = [
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
      'Juillet',
      'Août',
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
    ]

    const formattedSnapshots =
      snapshots?.map((snapshot) => ({
        id: snapshot.id,
        month: snapshot.snapshot_month,
        year: snapshot.snapshot_year,
        month_name: monthNames[snapshot.snapshot_month - 1],
        created_at: snapshot.created_at,
        is_active: snapshot.is_active,
        formatted_date: snapshot.created_at
          ? new Date(snapshot.created_at).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—',
      })) || []

    return NextResponse.json({
      snapshots: formattedSnapshots,
      context,
      total_count: formattedSnapshots.length,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('❌ Erreur lors de la récupération des snapshots:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
