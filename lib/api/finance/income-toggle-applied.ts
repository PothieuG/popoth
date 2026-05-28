import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { toggleAppliedBodySchema } from '@/lib/schemas/applied-balance'
import {
  AppliedToggleNoOpError,
  toggleContributionPairApplied,
  toggleRealIncomeAppliedToBalance,
} from '@/lib/finance/applied-balance'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import type { ContextFilter } from '@/lib/finance/context'
import { logger } from '@/lib/logger'

/**
 * POST /api/finance/income/real/toggle-applied
 *
 * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Mirror of
 * expenses-toggle-applied for real_income_entries. Credit/debit sign is
 * inverted (apply income → balance += amount).
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { id, apply } = await parseBody(request, toggleAppliedBodySchema)

    const { data: row, error: fetchError } = await supabaseServer
      .from('real_income_entries')
      .select('profile_id, group_id, recap_origin_id, applied_to_balance_at, contribution_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      logger.error('[toggle-applied/income] fetch error', fetchError)
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

    // Sprint Salary-Auto-At-Recap-Complete (2026-06-05). Filet défense contre
    // un appel API direct (court-circuit de la modal côté client) :
    //   - Ligne salaire (recap_origin_id != null) non-validée → 409 forçant
    //     l'utilisateur à passer par la modal SalaryValidationModal qui
    //     route vers `/validate-salary` (logique delta + Équilibrage).
    //   - Ligne salaire déjà validée → 409 read-only à vie (pas de un-apply).
    if (row.recap_origin_id != null) {
      if (row.applied_to_balance_at == null) {
        return NextResponse.json({ error: 'salary-validation-requires-modal' }, { status: 409 })
      }
      return NextResponse.json({ error: 'cannot-toggle-validated-recap-salary' }, { status: 409 })
    }

    // Sprint Contribution-Income-Mirror (2026-06-05). Si le revenu est un
    // miroir contribution (contribution_id != null), router vers la RPC
    // orchestratrice qui toggle la paire (expense user + income groupe).
    if (row.contribution_id != null) {
      const { data: contribRow } = await supabaseServer
        .from('group_contributions')
        .select('profile_id, group_id')
        .eq('id', row.contribution_id)
        .maybeSingle()
      if (!contribRow) {
        return NextResponse.json({ error: 'Contribution introuvable' }, { status: 404 })
      }
      try {
        await ensureBankBalanceRow({ profile_id: contribRow.profile_id })
        await ensureBankBalanceRow({ group_id: contribRow.group_id })
      } catch (ensureError) {
        logger.error('[toggle-applied/income] ensureBankBalanceRow (pair) failed', ensureError)
        return NextResponse.json(
          { error: 'Erreur lors de la préparation du solde' },
          { status: 500 },
        )
      }
      try {
        const pairResult = await toggleContributionPairApplied(row.contribution_id, apply)
        // Compat shape : pour la perspective long-press côté groupe (income),
        // on renvoie le balance côté INCOME (group).
        return NextResponse.json({
          data: {
            balance: pairResult.incomeBalance ?? 0,
            appliedToBalanceAt: pairResult.applied ? new Date().toISOString() : null,
            pair: pairResult,
          },
        })
      } catch (rpcError) {
        if (rpcError instanceof AppliedToggleNoOpError) {
          return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
        }
        logger.error('[toggle-applied/income] pair RPC error', rpcError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour du solde' },
          { status: 500 },
        )
      }
    }

    // Ensure bank_balances row exists for this owner before invoking the
    // composite RPC. Cf. miroir dans expenses-toggle-applied.ts.
    const balanceFilter: ContextFilter = ownsAsProfile
      ? { profile_id: userId }
      : { group_id: profile.group_id! }
    try {
      await ensureBankBalanceRow(balanceFilter)
    } catch (ensureError) {
      logger.error('[toggle-applied/income] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    try {
      const result = await toggleRealIncomeAppliedToBalance(id, apply)
      return NextResponse.json({ data: result })
    } catch (rpcError) {
      if (rpcError instanceof AppliedToggleNoOpError) {
        return NextResponse.json({ error: 'already-in-target-state' }, { status: 409 })
      }
      logger.error('[toggle-applied/income] RPC error', rpcError)
      return NextResponse.json({ error: 'Erreur lors de la mise à jour du solde' }, { status: 500 })
    }
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
