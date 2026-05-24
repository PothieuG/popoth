import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { toggleCarryAppliedBodySchema } from '@/lib/schemas/carry-over'
import { CarryOverToggleNoOpError, toggleCarryOverAndApply } from '@/lib/finance/carry-over'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'

/**
 * POST /api/finance/expenses/real/toggle-carry-applied
 *
 * Sprint 15 Monthly Recap V3 (2026-05-27). Bidirectional flip of both
 * `is_carried_over` AND `applied_to_balance_at` on a carry-over
 * real_expenses row, with matching `bank_balances.balance` adjustment, in
 * one Postgres tx (composite RPC `toggle_carry_over_and_apply`).
 *
 * Body: { id: uuid, validate: boolean }
 *   - validate=true  : carried+unapplied → validated+applied (bank -= amount).
 *   - validate=false : validated+applied (was-carried) → carried+unapplied
 *                      (bank += amount).
 *
 * Response 200: { data: { balance, appliedToBalanceAt, isCarriedOver } }
 * Response 409: { error: 'already-in-target-state' } — silent UI no-op
 * Response 403: row exists but not owned by the auth user / their group
 * Response 404: row not found
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id, validate } = await parseBody(request, toggleCarryAppliedBodySchema)

    const { data: row, error: fetchError } = await supabaseServer
      .from('real_expenses')
      .select('profile_id, group_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      logger.error('[toggle-carry-applied/expense] fetch error', fetchError)
      return NextResponse.json(
        { error: 'Erreur lors de la lecture de la dépense' },
        { status: 500 },
      )
    }
    if (!row) {
      return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 })
    }

    const ownsAsProfile = row.profile_id != null && row.profile_id === userId
    const ownsAsGroup =
      row.group_id != null && profile.group_id != null && row.group_id === profile.group_id
    if (!ownsAsProfile && !ownsAsGroup) {
      return NextResponse.json({ error: 'Dépense non autorisée' }, { status: 403 })
    }

    const balanceFilter: ContextFilter = ownsAsProfile
      ? { profile_id: userId }
      : { group_id: profile.group_id! }
    try {
      await ensureBankBalanceRow(balanceFilter)
    } catch (ensureError) {
      logger.error('[toggle-carry-applied/expense] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    try {
      const result = await toggleCarryOverAndApply(id, validate)
      return NextResponse.json({ data: result })
    } catch (rpcError) {
      if (rpcError instanceof CarryOverToggleNoOpError) {
        return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
      }
      logger.error('[toggle-carry-applied/expense] RPC error', rpcError)
      return NextResponse.json({ error: 'Erreur lors de la mise à jour du solde' }, { status: 500 })
    }
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
