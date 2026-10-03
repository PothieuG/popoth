import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { ensureBankBalanceRow, updateBankBalance } from '@/lib/finance/bank-balance'
import type { ContextFilter } from '@/lib/finance/context'
import { exceedsSavingsTransferMax, savingsTransferDelta } from '@/lib/finance/savings-transfer'
import { logger } from '@/lib/logger'
import { savingsTransferBodySchema } from '@/lib/schemas/savings'
import { supabaseServer } from '@/lib/supabase-server'

export interface SavingsTransferResponse {
  /** Nouveau solde disponible (`bank_balances.balance`). */
  balance: number
}

/**
 * POST /api/finance/savings-transfer
 *
 * Part 50 (2026-10-03). Option « Transfert d'économies » du dialogue d'ajout :
 * envoi vers l'épargne (solde − montant) ou réception depuis l'épargne
 * (solde + montant). C'est TOUT : aucune ligne de transaction, et ni les
 * économies des budgets, ni la tirelire, ni le reste à vivre ne bougent.
 *
 * Le plafond (total des économies = budgets + tirelire, comme la carte
 * « Économies » du dashboard) est relu en base : le dialogue le vérifie déjà,
 * la route ne fait pas confiance au client. Lecture puis écriture sans verrou :
 * le transfert ne modifie pas les économies, il n'y a pas d'état à protéger,
 * seulement un garde-fou.
 *
 * Groupe : ouvert à tout membre, comme l'ajout d'une transaction ou sa
 * validation sur le solde (l'édition directe du solde, elle, reste réservée au
 * créateur).
 *
 * Codes d'erreur :
 *   - 400 corps invalide, ou contexte groupe sans groupe
 *   - 409 savings-transfer-exceeds-savings
 *   - 500 erreur inattendue
 */
export const POST = withAuthAndGroup(async (request: NextRequest, { userId, groupId }) => {
  try {
    const body = await parseBody(request, savingsTransferBodySchema)

    if (body.context === 'group' && !groupId) {
      return NextResponse.json(
        { error: "Utilisateur ne fait pas partie d'un groupe" },
        { status: 400 },
      )
    }
    const filter: ContextFilter =
      body.context === 'group' ? { group_id: groupId! } : { profile_id: userId }
    const ownerColumn = body.context === 'group' ? 'group_id' : 'profile_id'
    const ownerId = body.context === 'group' ? groupId! : userId

    const [budgetsRes, piggyRes] = await Promise.all([
      supabaseServer.from('estimated_budgets').select('cumulated_savings').eq(ownerColumn, ownerId),
      supabaseServer.from('piggy_bank').select('amount').eq(ownerColumn, ownerId).maybeSingle(),
    ])
    if (budgetsRes.error || piggyRes.error) {
      logger.error('[savings-transfer] read failed', {
        budgetsError: budgetsRes.error,
        piggyError: piggyRes.error,
      })
      return NextResponse.json(
        { error: 'Erreur lors de la lecture des économies' },
        { status: 500 },
      )
    }

    const totalSavings =
      (budgetsRes.data ?? []).reduce((sum, b) => sum + (b.cumulated_savings ?? 0), 0) +
      (piggyRes.data?.amount ?? 0)
    if (exceedsSavingsTransferMax(body.amount, totalSavings)) {
      return NextResponse.json({ error: 'savings-transfer-exceeds-savings' }, { status: 409 })
    }

    try {
      await ensureBankBalanceRow(filter)
    } catch (ensureError) {
      logger.error('[savings-transfer] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    const balance = await updateBankBalance(
      filter,
      savingsTransferDelta(body.direction, body.amount),
    )
    const response: SavingsTransferResponse = { balance }
    return NextResponse.json({ data: response })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[savings-transfer] failed', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
