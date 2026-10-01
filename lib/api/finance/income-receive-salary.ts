import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { now } from '@/lib/clock'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import { logger } from '@/lib/logger'
import { receiveSalaryBodySchema } from '@/lib/schemas/income'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Mois financé par le salaire reçu :
 *   - `current` : une ligne « Salaire » du mois attendait d'être validée — la
 *     réception la valide, l'écart entre dans le reste à vivre tout de suite.
 *   - `advance` : le salaire du mois est déjà réglé — la paie reçue finance le
 *     mois suivant. Le solde est crédité maintenant, l'écart entrera dans le
 *     reste à vivre à la fin du prochain récap.
 */
export type SalaryReceptionMode = 'current' | 'advance'

export interface ReceiveSalaryResponse {
  mode: SalaryReceptionMode
  incomeId: string
  /** Salaire attendu (ligne en attente, ou salaire déclaré du profil). */
  expected: number
  received: number
  /** received − expected, arrondi au centime. */
  delta: number
  balance: number
}

interface ValidateSalaryRpcResult {
  delta: number
  balance: number
}

interface ReceiveInAdvanceRpcResult {
  income_id: string
  amount: number
  expected_salary: number
  delta: number
  balance: number
}

const PG_UNIQUE_VIOLATION = '23505'

/**
 * POST /api/finance/income/real/receive-salary
 *
 * Sprint Salary-Reception (2026-10-02). Option « Réception du salaire » du
 * dialogue d'ajout, espace perso uniquement. Deux issues, choisies ici pour
 * que le client n'ait pas à connaître la mécanique :
 *
 *   1. Une ligne « Salaire » automatique attend sa validation (créée à la fin
 *      du dernier récap) → c'est ce salaire-là qui vient d'arriver :
 *      `validate_salary_with_delta` (même effet que l'appui long + modal).
 *   2. Sinon → la paie finance le mois suivant : `receive_salary_in_advance`
 *      crée la ligne et crédite le solde ; le prochain récap perso l'adopte
 *      (`create_salary_income_for_recap`).
 *
 * Codes d'erreur :
 *   - 400 corps invalide
 *   - 409 salary-already-received (une réception attend déjà le prochain récap)
 *   - 409 no-salary-declared (profil sans salaire : rien à comparer)
 *   - 500 erreur inattendue
 */
export const POST = withAuthAndGroup(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, receiveSalaryBodySchema)

    const [profileRes, salaryRowsRes] = await Promise.all([
      supabaseServer.from('profiles').select('salary').eq('id', userId).maybeSingle(),
      supabaseServer
        .from('real_income_entries')
        .select('id, amount, entry_date, recap_origin_id, applied_to_balance_at, salary_reception')
        .eq('profile_id', userId)
        .or('salary_reception.is.true,recap_origin_id.not.is.null')
        .order('entry_date', { ascending: true }),
    ])

    if (profileRes.error || salaryRowsRes.error) {
      logger.error('[receive-salary] read failed', {
        profileError: profileRes.error,
        rowsError: salaryRowsRes.error,
      })
      return NextResponse.json({ error: 'Erreur lors de la lecture du salaire' }, { status: 500 })
    }

    const salaryRows = salaryRowsRes.data ?? []

    try {
      await ensureBankBalanceRow({ profile_id: userId })
    } catch (ensureError) {
      logger.error('[receive-salary] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    // 1. Ligne salaire du mois encore à valider (la plus ancienne d'abord).
    const awaiting = salaryRows.find(
      (row) => row.recap_origin_id != null && row.applied_to_balance_at == null,
    )
    if (awaiting) {
      const { data, error } = await supabaseServer.rpc('validate_salary_with_delta', {
        p_income_id: awaiting.id,
        p_real_amount: body.amount,
        p_created_by_profile_id: userId,
      })
      if (error) {
        logger.error('[receive-salary] validate_salary_with_delta failed', { error })
        return NextResponse.json(
          { error: 'Erreur lors de la validation du salaire' },
          { status: 500 },
        )
      }
      const result = data as unknown as ValidateSalaryRpcResult
      const response: ReceiveSalaryResponse = {
        mode: 'current',
        incomeId: awaiting.id,
        expected: awaiting.amount,
        received: body.amount,
        delta: result.delta,
        balance: result.balance,
      }
      return NextResponse.json({ data: response })
    }

    // 2. Salaire du mois suivant.
    if (salaryRows.some((row) => row.salary_reception === true)) {
      return NextResponse.json({ error: 'salary-already-received' }, { status: 409 })
    }
    if (!profileRes.data || (profileRes.data.salary ?? 0) <= 0) {
      return NextResponse.json({ error: 'no-salary-declared' }, { status: 409 })
    }

    const { data, error } = await supabaseServer.rpc('receive_salary_in_advance', {
      p_profile_id: userId,
      p_amount: body.amount,
      p_entry_date: body.entry_date ?? (now().toISOString().split('T')[0] as string),
    })
    if (error) {
      // Deux réceptions simultanées : la seconde bute sur l'index unique partiel.
      if (error.code === PG_UNIQUE_VIOLATION) {
        return NextResponse.json({ error: 'salary-already-received' }, { status: 409 })
      }
      logger.error('[receive-salary] receive_salary_in_advance failed', { error })
      return NextResponse.json(
        { error: "Erreur lors de l'enregistrement du salaire" },
        { status: 500 },
      )
    }

    const result = data as unknown as ReceiveInAdvanceRpcResult
    const response: ReceiveSalaryResponse = {
      mode: 'advance',
      incomeId: result.income_id,
      expected: result.expected_salary,
      received: result.amount,
      delta: result.delta,
      balance: result.balance,
    }
    return NextResponse.json({ data: response })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[receive-salary] failed', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
