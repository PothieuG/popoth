import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import { logger } from '@/lib/logger'
import { validateSalaryBodySchema } from '@/lib/schemas/income'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * POST /api/finance/income/real/validate-salary
 *
 * Sprint Salary-Auto-At-Recap-Complete (2026-06-05).
 *
 * Appelé par la modal `SalaryValidationModal` (long-press sur une ligne
 * salaire non-validée, recap_origin_id != null && applied_to_balance_at == null).
 *
 * Comportement :
 *   1. Vérifie que la row appartient à l'user (ownership via profile_id).
 *   2. Vérifie que c'est bien un revenu salaire en attente de validation
 *      (recap_origin_id != null, applied_to_balance_at == null).
 *   3. Appelle le RPC atomique `validate_salary_with_delta` qui :
 *      - Valide la ligne salaire à son amount original (bank_balance += amount)
 *      - Si delta = (real_amount - amount) != 0 → crée + valide un revenu
 *        ou dépense exceptionnelle "Équilibrage salaire" à hauteur de |delta|
 *
 * Codes d'erreur :
 *   - 400 Zod parse error (bad body)
 *   - 404 salary-income-not-found (row absente ou pas owned by user)
 *   - 409 salary-already-validated (applied_to_balance_at déjà non-null)
 *   - 409 salary-row-mismatch (recap_origin_id IS NULL — pas un salaire auto)
 *   - 500 Erreur RPC inattendue
 *
 * Retourne `{ data: { delta, exceptionalKind?, exceptionalId?, balance } }`.
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, validateSalaryBodySchema)

    // 1+2. Pre-check : la row existe, appartient à l'user, et est un salaire en attente
    const { data: row, error: fetchError } = await supabaseServer
      .from('real_income_entries')
      .select('id, profile_id, recap_origin_id, applied_to_balance_at, amount')
      .eq('id', body.income_id)
      .maybeSingle()

    if (fetchError) {
      logger.error('[validate-salary] fetch error', fetchError)
      return NextResponse.json({ error: 'Erreur lors de la lecture du salaire' }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: 'salary-income-not-found' }, { status: 404 })
    }
    if (row.profile_id !== userId) {
      return NextResponse.json({ error: 'salary-income-not-found' }, { status: 404 })
    }
    if (row.recap_origin_id == null) {
      return NextResponse.json({ error: 'salary-row-mismatch' }, { status: 409 })
    }
    if (row.applied_to_balance_at != null) {
      return NextResponse.json({ error: 'salary-already-validated' }, { status: 409 })
    }

    // Ensure bank_balance row exists before invoking the RPC (pattern miroir
    // expenses-toggle-applied / income-toggle-applied).
    try {
      await ensureBankBalanceRow({ profile_id: userId })
    } catch (ensureError) {
      logger.error('[validate-salary] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json(
        { error: 'Erreur lors de la préparation du solde' },
        { status: 500 },
      )
    }

    // 3. RPC atomique
    const { data: rpcResult, error: rpcError } = await supabaseServer.rpc(
      'validate_salary_with_delta',
      {
        p_income_id: body.income_id,
        p_real_amount: body.real_amount,
        p_created_by_profile_id: userId,
      },
    )

    if (rpcError) {
      logger.error('[validate-salary] RPC error', { error: rpcError })
      return NextResponse.json(
        { error: 'Erreur lors de la validation du salaire' },
        { status: 500 },
      )
    }

    return NextResponse.json({ data: rpcResult })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[validate-salary] failed', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
