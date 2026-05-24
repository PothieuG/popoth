import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { toggleCarryAppliedBodySchema } from '@/lib/schemas/carry-over'
import { CarryOverToggleNoOpError, toggleCarryOverAndApplyIncome } from '@/lib/finance/carry-over'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'

/**
 * POST /api/finance/income/real/toggle-carry-applied
 *
 * Sprint 15 Monthly Recap V3 (2026-05-27). Mirror of
 * expenses-toggle-carry-applied for real_income_entries. Credit/debit sign
 * is inverted (validate income → balance += amount).
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id, validate } = await parseBody(request, toggleCarryAppliedBodySchema)

    const { data: row, error: fetchError } = await supabaseServer
      .from('real_income_entries')
      .select('profile_id, group_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      logger.error('[toggle-carry-applied/income] fetch error', fetchError)
      return NextResponse.json({ error: 'Erreur lors de la lecture du revenu' }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: 'Revenu introuvable' }, { status: 404 })
    }

    const ownsAsProfile = row.profile_id != null && row.profile_id === userId
    const ownsAsGroup =
      row.group_id != null && profile.group_id != null && row.group_id === profile.group_id
    if (!ownsAsProfile && !ownsAsGroup) {
      return NextResponse.json({ error: 'Revenu non autorisé' }, { status: 403 })
    }

    const balanceFilter: ContextFilter = ownsAsProfile
      ? { profile_id: userId }
      : { group_id: profile.group_id! }
    try {
      await ensureBankBalanceRow(balanceFilter)
    } catch (ensureError) {
      logger.error('[toggle-carry-applied/income] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    try {
      const result = await toggleCarryOverAndApplyIncome(id, validate)
      return NextResponse.json({ data: result })
    } catch (rpcError) {
      if (rpcError instanceof CarryOverToggleNoOpError) {
        return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
      }
      logger.error('[toggle-carry-applied/income] RPC error', rpcError)
      return NextResponse.json({ error: 'Erreur lors de la mise à jour du solde' }, { status: 500 })
    }
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
