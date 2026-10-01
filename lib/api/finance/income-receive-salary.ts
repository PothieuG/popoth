import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { now } from '@/lib/clock'
import { ensureBankBalanceRow } from '@/lib/finance/bank-balance'
import {
  nextMonth,
  parseSalaryMonth,
  sameMonth,
  toSalaryMonth,
  type MonthRef,
} from '@/lib/finance/salary-reception'
import { logger } from '@/lib/logger'
import { checkRecapStatus } from '@/lib/recap/check-status'
import { receiveSalaryBodySchema } from '@/lib/schemas/income'
import { supabaseServer } from '@/lib/supabase-server'

export interface ReceiveSalaryResponse {
  incomeId: string
  /** Mois financé, `AAAA-MM-01`. */
  salaryMonth: string
  /** Salaire attendu (ligne en attente, ou salaire déclaré du profil). */
  expected: number
  received: number
  /** received − expected, arrondi au centime. */
  delta: number
  /** `true` : l'écart est déjà dans le reste à vivre (mois ouvert). `false` :
   *  il y entrera à la fin du récap (mois suivant). */
  deltaApplied: boolean
  balance: number
}

interface ValidateSalaryRpcResult {
  delta: number
  balance: number
}

interface ReceiveSalaryRpcResult {
  income_id: string
  amount: number
  expected_salary: number
  delta: number
  delta_applied: boolean
  salary_month: string
  balance: number
}

const PG_UNIQUE_VIOLATION = '23505'

/**
 * Mois « ouvert » du compte perso : celui que l'utilisateur est en train de
 * vivre. Tant que le récap du mois écoulé n'est pas terminé (dashboard
 * verrouillé, saisie possible seulement dans « Compléter le mois »), c'est ce
 * mois écoulé ; ensuite, le mois du jour. Même règle que le dialogue, qui
 * passe le mois recapé depuis le wizard.
 */
async function resolveOpenMonth(userId: string): Promise<MonthRef> {
  const recap = await checkRecapStatus(userId, 'profile')
  if (recap.status.kind !== 'completed') {
    return { month: recap.recapMonth, year: recap.recapYear }
  }
  const today = now()
  return { month: today.getMonth() + 1, year: today.getFullYear() }
}

/**
 * POST /api/finance/income/real/receive-salary
 *
 * Sprint Salary-Reception (2026-10-02). Option « Réception du salaire » du
 * dialogue d'ajout, espace perso uniquement. L'utilisateur choisit le mois que
 * sa paie finance : le mois ouvert (payé le 3) ou le suivant (payé le 28).
 *
 *   1. Une ligne « Salaire » créée par le récap attend sa validation pour ce
 *      mois → c'est elle qui est validée (`validate_salary_with_delta`, même
 *      effet que l'appui long + modal).
 *   2. Sinon `receive_salary` crée la ligne et crédite le solde. L'écart avec
 *      le salaire déclaré entre dans le reste à vivre tout de suite pour le
 *      mois ouvert, à la fin du récap pour le mois suivant.
 *
 * Codes d'erreur :
 *   - 400 corps invalide, ou `invalid-salary-month` (ni le mois ouvert ni le
 *     suivant)
 *   - 409 salary-already-received (un salaire est déjà enregistré pour ce mois)
 *   - 409 no-salary-declared (profil sans salaire : rien à comparer)
 *   - 500 erreur inattendue
 */
export const POST = withAuthAndGroup(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, receiveSalaryBodySchema)

    const target = parseSalaryMonth(body.salary_month)
    if (!target) {
      return NextResponse.json({ error: 'invalid-salary-month' }, { status: 400 })
    }

    const openMonth = await resolveOpenMonth(userId)
    const isOpenMonth = sameMonth(target, openMonth)
    if (!isOpenMonth && !sameMonth(target, nextMonth(openMonth))) {
      return NextResponse.json({ error: 'invalid-salary-month' }, { status: 400 })
    }
    const salaryMonth = toSalaryMonth(target)

    const [profileRes, lineRes] = await Promise.all([
      supabaseServer.from('profiles').select('salary').eq('id', userId).maybeSingle(),
      supabaseServer
        .from('real_income_entries')
        .select('id, amount, recap_origin_id, applied_to_balance_at')
        .eq('profile_id', userId)
        .eq('salary_month', salaryMonth)
        .maybeSingle(),
    ])

    if (profileRes.error || lineRes.error) {
      logger.error('[receive-salary] read failed', {
        profileError: profileRes.error,
        lineError: lineRes.error,
      })
      return NextResponse.json({ error: 'Erreur lors de la lecture du salaire' }, { status: 500 })
    }

    try {
      await ensureBankBalanceRow({ profile_id: userId })
    } catch (ensureError) {
      logger.error('[receive-salary] ensureBankBalanceRow failed', ensureError)
      return NextResponse.json({ error: 'Erreur lors de la préparation du solde' }, { status: 500 })
    }

    // 1. Un salaire existe déjà pour ce mois.
    const line = lineRes.data
    if (line) {
      const awaitsValidation = line.recap_origin_id != null && line.applied_to_balance_at == null
      if (!awaitsValidation) {
        return NextResponse.json({ error: 'salary-already-received' }, { status: 409 })
      }
      const { data, error } = await supabaseServer.rpc('validate_salary_with_delta', {
        p_income_id: line.id,
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
        incomeId: line.id,
        salaryMonth,
        expected: line.amount,
        received: body.amount,
        delta: result.delta,
        deltaApplied: true,
        balance: result.balance,
      }
      return NextResponse.json({ data: response })
    }

    // 2. Aucun salaire pour ce mois : on le crée.
    if (!profileRes.data || (profileRes.data.salary ?? 0) <= 0) {
      return NextResponse.json({ error: 'no-salary-declared' }, { status: 409 })
    }

    const { data, error } = await supabaseServer.rpc('receive_salary', {
      p_profile_id: userId,
      p_amount: body.amount,
      p_salary_month: salaryMonth,
      p_entry_date: body.entry_date ?? (now().toISOString().split('T')[0] as string),
      p_apply_delta_now: isOpenMonth,
    })
    if (error) {
      // Deux réceptions simultanées pour le même mois : la seconde est refusée.
      if (error.code === PG_UNIQUE_VIOLATION) {
        return NextResponse.json({ error: 'salary-already-received' }, { status: 409 })
      }
      logger.error('[receive-salary] receive_salary failed', { error })
      return NextResponse.json(
        { error: "Erreur lors de l'enregistrement du salaire" },
        { status: 500 },
      )
    }

    const result = data as unknown as ReceiveSalaryRpcResult
    const response: ReceiveSalaryResponse = {
      incomeId: result.income_id,
      salaryMonth,
      expected: result.expected_salary,
      received: result.amount,
      delta: result.delta,
      deltaApplied: result.delta_applied,
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
