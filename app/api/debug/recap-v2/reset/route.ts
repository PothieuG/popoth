import { NextResponse, type NextRequest } from 'next/server'

import { blockInProduction } from '@/lib/debug-guard'
import { logger } from '@/lib/logger'
import { resetRecapV2BodySchema } from '@/lib/schemas/debug'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * POST /api/debug/recap-v2/reset
 *
 * Sprint Recap-V2-Dev-Tools (2026-05-22). Drops the V2 monthly recap row
 * for the current month + deactivates V2 snapshots, so the gating
 * (`lib/recap/check-status.ts` reading `monthly_recaps_v2`) redirects the
 * user to `/monthly-recap` on next nav. Mirror of
 * /api/debug/retrigger-recap but targeting V2 tables.
 *
 * Gated `blockInProduction()` — 404 in prod.
 */
export async function POST(request: NextRequest) {
  const blocked = blockInProduction()
  if (blocked) return blocked

  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }
    const userId = session.userId

    let rawBody: unknown = {}
    try {
      rawBody = await request.json()
    } catch {
      // No body or malformed → use schema defaults
    }
    const parsed = resetRecapV2BodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body invalide', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { context } = parsed.data

    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    const contextId = context === 'group' && profile.group_id ? profile.group_id : profile.id
    const ownerField: 'profile_id' | 'group_id' =
      context === 'group' && profile.group_id ? 'group_id' : 'profile_id'

    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const { data: deletedRecaps, error: deleteError } = await supabaseServer
      .from('monthly_recaps_v2')
      .delete()
      .eq(ownerField, contextId)
      .eq('recap_month', month)
      .eq('recap_year', year)
      .select('id')

    if (deleteError) {
      logger.error('[recap-v2/reset] delete failed', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const { error: snapshotError } = await supabaseServer
      .from('recap_snapshots_v2')
      .update({ is_active: false })
      .eq(ownerField, contextId)
      .eq('is_active', true)

    if (snapshotError) {
      logger.warn('[recap-v2/reset] deactivate snapshots failed', snapshotError)
    }

    return NextResponse.json({
      success: true,
      message:
        (deletedRecaps?.length ?? 0) > 0
          ? `Recap V2 ${month}/${year} supprimé — recharge /monthly-recap`
          : `Aucun recap V2 ${month}/${year} — déjà prêt`,
      details: {
        context,
        contextId,
        month,
        year,
        recaps_deleted: deletedRecaps?.length ?? 0,
        snapshots_deactivated: !snapshotError,
      },
    })
  } catch (error) {
    logger.error('[recap-v2/reset] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 },
    )
  }
}
