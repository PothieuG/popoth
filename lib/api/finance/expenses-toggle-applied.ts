import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { toggleAppliedBodySchema } from '@/lib/schemas/applied-balance'
import {
  AppliedToggleNoOpError,
  toggleContributionPairApplied,
  toggleRealExpenseAppliedToBalance,
} from '@/lib/finance/applied-balance'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'

/**
 * POST /api/finance/expenses/real/toggle-applied
 *
 * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Flips
 * `applied_to_balance_at` on a real_expenses row AND adjusts
 * `bank_balances.balance` in a single Postgres tx (composite RPC).
 *
 * Body: { id: uuid, apply: boolean }
 * Response 200: { data: { balance: number, appliedToBalanceAt: string|null } }
 * Response 409: { error: 'already-in-target-state' } — silent UI no-op
 * Response 403: row exists but not owned by the auth user / their group
 * Response 404: row not found
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id, apply } = await parseBody(request, toggleAppliedBodySchema)

    // Ownership check BEFORE the RPC: ensure the row belongs to the auth user
    // (profile_id match) or their group (group_id match). The RPC bypasses RLS
    // via SECURITY DEFINER, so this is the only authorization gate.
    const { data: row, error: fetchError } = await supabaseServer
      .from('real_expenses')
      .select('profile_id, group_id, contribution_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      logger.error('[toggle-applied/expense] fetch error', fetchError)
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

    // Sprint Contribution-Income-Mirror (2026-06-05). Si la dépense est une
    // contribution virtuelle (contribution_id != null), router vers la RPC
    // orchestratrice qui toggle la paire (expense user + income groupe miroir)
    // ATOMIQUEMENT. Sinon, comportement standard single-side.
    if (row.contribution_id != null) {
      // Pre-ensure des 2 bank_balances (user + groupe). On lit le group_id
      // depuis la row contribution_id (l'income mirror est côté group).
      const { data: contribRow } = await supabaseServer
        .from('group_contributions')
        .select('profile_id, group_id')
        .eq('id', row.contribution_id)
        .maybeSingle()
      if (!contribRow) {
        return NextResponse.json(
          { error: 'Contribution introuvable' },
          { status: 404 },
        )
      }
      try {
        await ensureBankBalanceRow({ profile_id: contribRow.profile_id })
        await ensureBankBalanceRow({ group_id: contribRow.group_id })
      } catch (ensureError) {
        logger.error('[toggle-applied/expense] ensureBankBalanceRow (pair) failed', ensureError)
        return NextResponse.json(
          { error: 'Erreur lors de la préparation du solde' },
          { status: 500 },
        )
      }
      try {
        const pairResult = await toggleContributionPairApplied(row.contribution_id, apply)
        // Compat shape avec les consumers existants (UI optimistic update) :
        // on renvoie le balance côté EXPENSE (profile) qui correspond à la
        // perspective du long-press côté user perso.
        return NextResponse.json({
          data: {
            balance: pairResult.expenseBalance ?? 0,
            appliedToBalanceAt: pairResult.applied ? new Date().toISOString() : null,
            pair: pairResult,
          },
        })
      } catch (rpcError) {
        if (rpcError instanceof AppliedToggleNoOpError) {
          return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
        }
        logger.error('[toggle-applied/expense] pair RPC error', rpcError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour du solde' },
          { status: 500 },
        )
      }
    }

    // Ensure bank_balances row exists for this owner before invoking the
    // composite RPC (`update_bank_balance` RAISEs "row not found" sinon —
    // cas brand-new user qui n'a jamais set son solde via le crayon).
    const balanceFilter: ContextFilter = ownsAsProfile
      ? { profile_id: userId }
      : { group_id: profile.group_id! }
    try {
      await ensureBankBalanceRow(balanceFilter)
    } catch (ensureError) {
      logger.error('[toggle-applied/expense] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    try {
      const result = await toggleRealExpenseAppliedToBalance(id, apply)
      return NextResponse.json({ data: result })
    } catch (rpcError) {
      if (rpcError instanceof AppliedToggleNoOpError) {
        return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
      }
      logger.error('[toggle-applied/expense] RPC error', rpcError)
      return NextResponse.json({ error: 'Erreur lors de la mise à jour du solde' }, { status: 500 })
    }
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
