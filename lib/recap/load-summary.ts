/**
 * Monthly Recap V3 — agrégateur Supabase → RecapSummary.
 *
 * Construit l'input de `computeRecapSummary` (sprint 04) en composant en
 * parallèle (Promise.all) 5 lectures Supabase :
 *   1. FinancialData (RAV estimé/effectif via `getProfileFinancialData` /
 *      `getGroupFinancialData` — réutilise l'existant lib/finance).
 *   2. Liste des `estimated_budgets` du contexte (id, name, estimated_amount,
 *      cumulated_savings) pour le tableau per-budget du summary.
 *   3. Dépensé par budget ce mois — agrégat `amount_from_budget` filtré sur
 *      `applied_to_balance_at IS NOT NULL`, `is_carried_over = false`, et
 *      `expense_date` dans le mois courant. Sémantique calendaire validée :
 *      une dépense compte dans le mois de sa date, peu importe quand elle
 *      a été appliquée au solde.
 *   4. Tirelire (`piggy_bank.amount`) — `.maybeSingle()` + fallback 0
 *      (règle CLAUDE.md "Tables owner-row hybrides" : un fresh account
 *      n'a pas encore de row).
 *   5. Solde bancaire (`bank_balances.balance`) — `.maybeSingle()` + 0.
 *
 * RAV mapping (cf. prompt-montly-recap/04-calculations.md ligne 45-46) :
 *   - ravEstime  = totalEstimatedIncome - totalEstimatedBudgets
 *   - ravEffectif = remainingToLive (calc-rtl existant)
 *
 * Tous les montants sont passés en cents-precise via `computeRecapSummary`
 * (round2 stable). Ce helper ne fait pas d'écriture (pure read + compose).
 * Utilisé par /api/monthly-recap/start (post-claim) et /api/monthly-recap/
 * status (in_progress only) — sera ré-utilisé sprints 06/07.
 */

import { getGroupFinancialData, getProfileFinancialData } from '@/lib/finance'
import { supabaseServer } from '@/lib/supabase-server'

import { computeRecapSummary } from './calculations'
import type { RecapContext } from './check-status'
import type { RecapSummary } from './types'

export interface LoadRecapSummaryInput {
  context: RecapContext
  profileId: string
  groupId: string | null
}

export async function loadRecapSummary(input: LoadRecapSummaryInput): Promise<RecapSummary> {
  const { context, profileId, groupId } = input

  if (context === 'group' && !groupId) {
    throw new Error('loadRecapSummary: group context requires non-null groupId')
  }

  const ownerColumn: 'profile_id' | 'group_id' = context === 'profile' ? 'profile_id' : 'group_id'
  const ownerId = context === 'profile' ? profileId : (groupId as string)

  // Bornes calendaires du mois courant (UTC fallback aligné avec checkRecapStatus).
  const now = new Date()
  const currentMonth = now.getMonth() + 1 // 1..12
  const currentYear = now.getFullYear()
  const monthStart = formatIsoDate(currentYear, currentMonth, 1)
  const nextMonthStart =
    currentMonth === 12
      ? formatIsoDate(currentYear + 1, 1, 1)
      : formatIsoDate(currentYear, currentMonth + 1, 1)

  const [financialData, budgetsResult, spentRows, piggyRow, bankRow] = await Promise.all([
    context === 'profile' ? getProfileFinancialData(profileId) : getGroupFinancialData(groupId!),
    supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq(ownerColumn, ownerId),
    supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount_from_budget')
      .eq(ownerColumn, ownerId)
      .not('applied_to_balance_at', 'is', null)
      .eq('is_carried_over', false)
      .gte('expense_date', monthStart)
      .lt('expense_date', nextMonthStart),
    supabaseServer.from('piggy_bank').select('amount').eq(ownerColumn, ownerId).maybeSingle(),
    supabaseServer.from('bank_balances').select('balance').eq(ownerColumn, ownerId).maybeSingle(),
  ])

  const budgets = budgetsResult.data ?? []
  const piggyAmount = piggyRow.data?.amount ?? 0
  const currentBalance = bankRow.data?.balance ?? 0

  // Agréger spentThisMonth par budgetId (sum amount_from_budget, fallback 0 si null).
  const spentByBudgetId = new Map<string, number>()
  for (const row of spentRows.data ?? []) {
    if (!row.estimated_budget_id) continue
    const portion = row.amount_from_budget ?? 0
    spentByBudgetId.set(
      row.estimated_budget_id,
      (spentByBudgetId.get(row.estimated_budget_id) ?? 0) + portion,
    )
  }

  return computeRecapSummary({
    currentBalance,
    ravEstime: financialData.totalEstimatedIncome - financialData.totalEstimatedBudgets,
    ravEffectif: financialData.remainingToLive,
    piggyAmount,
    budgets: budgets.map((b) => ({
      budgetId: b.id,
      budgetName: b.name,
      estimatedAmount: Number(b.estimated_amount),
      spentThisMonth: spentByBudgetId.get(b.id) ?? 0,
      cumulatedSavings: Number(b.cumulated_savings ?? 0),
    })),
  })
}

function formatIsoDate(year: number, month1Indexed: number, day: number): string {
  const mm = String(month1Indexed).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}
