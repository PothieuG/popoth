/**
 * Monthly Recap V3 — agrégateur Supabase → RecapSummary.
 *
 * Construit l'input de `computeRecapSummary` (sprint 04) en composant en
 * parallèle (Promise.all) 5 lectures Supabase :
 *   1. FinancialData (RAV estimé/effectif via `getProfileFinancialData` /
 *      `getGroupFinancialData` — réutilise l'existant lib/finance).
 *   2. Liste des `estimated_budgets` du contexte (id, name, estimated_amount,
 *      cumulated_savings) pour le tableau per-budget du summary.
 *   3. Dépensé par budget sur le mois recapé (`input.recapMonth`/`recapYear`,
 *      PAS le mois calendaire en cours — cf. `getRecapPeriod`, le récap revoit
 *      toujours le mois écoulé) — agrégat `amount_from_budget` filtré sur
 *      `carried_from_recap_id IS NULL` et `expense_date` dans ce mois-là.
 *      Toutes les transactions pures du mois comptent (validées ou non — la
 *      validation `applied_to_balance_at` n'impacte que le solde bancaire,
 *      pas le RAV ni le surplus, miroir de `getProfileFinancialData` deficit
 *      loop ligne 137). Le filtre carry-over (Part 35) exclut les transactions
 *      héritées d'un recap antérieur dans les 2 états (en attente + validée).
 *      Le carryover_spent_amount est passé séparément au computeRecapSummary
 *      qui l'additionne dans `effectiveSpent`.
 *   4. Tirelire (`piggy_bank.amount`) — `.maybeSingle()` + fallback 0
 *      (règle CLAUDE.md "Tables owner-row hybrides" : un fresh account
 *      n'a pas encore de row).
 *   5. Solde bancaire (`bank_balances.balance`) — `.maybeSingle()` + 0.
 *
 * RAV mapping (cf. .claude/conventions/operational-rules.md §5 — formule RAV canonique) :
 *   - ravEstime (profile) = totalEstimatedIncome - totalEstimatedBudgets
 *   - ravEstime (group)   = totalEstimatedIncome + totalGroupContributions - totalEstimatedBudgets
 *   - ravEffectif         = remainingToLive (calc-rtl existant)
 *
 * Depuis Sprint Bilan-Equals-RavEffectif, le bilan = `ravEffectif` seul — le
 * terme `ravEstime` n'entre plus dans le bilan, il n'est plus qu'une métrique
 * affichée. On garde néanmoins `totalGroupContributions` côté ravEstime en
 * contexte groupe (mirror auto-synchronisé de `groups.monthly_budget_estimate`
 * via trigger PG) pour que la carte « Reste à vivre estimé » reste cohérente
 * d'affichage avec `ravEffectif` (cf. `lib/finance/calc-rtl.ts:58-74`).
 *
 * Tous les montants sont passés en cents-precise via `computeRecapSummary`
 * (round2 stable). Ce helper ne fait pas d'écriture (pure read + compose).
 * `recapMonth`/`recapYear` sont **requis** — le caller doit les fournir
 * depuis la ligne `monthly_recaps` en jeu (`recap_month`/`recap_year`) ou,
 * à défaut de ligne existante, depuis `checkRecapStatus`/`getRecapPeriod`.
 * Pas de fallback implicite sur `now()` ici : un call site qui oublierait de
 * les passer réintroduirait la classe de bug "le récap regarde le mauvais
 * mois" (cf. Fix-Recap-Surplus-Wrong-Month). Utilisé par /api/monthly-recap/
 * start (post-claim), /api/monthly-recap/status (in_progress), et les
 * actions positive/negative du wizard (sprints 06+).
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
  /** Mois recapé 1-12 (`monthly_recaps.recap_month` de la ligne en jeu, ou
   *  `getRecapPeriod()` s'il n'y a pas encore de ligne). PAS le mois
   *  calendaire courant — cf. docstring du module. */
  recapMonth: number
  recapYear: number
  /** Sprint Recap-Positive-Consume-Surplus (2026-05-25). Forwarded to
   *  `computeRecapSummary` so per-budget surpluses already routed to the
   *  piggy bank during this active recap are consumed (subtracted from the
   *  monthly under-spend). Callers (status route + actions-positive) read
   *  the value from `monthly_recaps.piggy_transfers_data` and pass it here
   *  — this helper stays pure-load (no extra I/O). Pass `undefined` (or
   *  omit) when there is no active recap or when the column is empty. */
  piggyTransfersData?: Record<string, number>
  /** Sprint Projets-Épargne 10. Forwarded to `computeRecapSummary` so the
   *  `projectSnapshot` preview reflects refunds already accumulated on the
   *  active recap. Callers (status route) read it from
   *  `monthly_recaps.project_snapshot_data`. Omit / `undefined` when there is
   *  no active recap. */
  projectSnapshotData?: Record<string, number>
}

export async function loadRecapSummary(input: LoadRecapSummaryInput): Promise<RecapSummary> {
  const {
    context,
    profileId,
    groupId,
    recapMonth,
    recapYear,
    piggyTransfersData,
    projectSnapshotData,
  } = input

  if (context === 'group' && !groupId) {
    throw new Error('loadRecapSummary: group context requires non-null groupId')
  }

  const ownerColumn: 'profile_id' | 'group_id' = context === 'profile' ? 'profile_id' : 'group_id'
  const ownerId = context === 'profile' ? profileId : (groupId as string)

  // Bornes calendaires du mois RECAPÉ (pas le mois calendaire en cours).
  const monthStart = formatIsoDate(recapYear, recapMonth, 1)
  const nextMonthStart =
    recapMonth === 12
      ? formatIsoDate(recapYear + 1, 1, 1)
      : formatIsoDate(recapYear, recapMonth + 1, 1)

  const [financialData, budgetsResult, spentRows, piggyRow, bankRow] = await Promise.all([
    context === 'profile' ? getProfileFinancialData(profileId) : getGroupFinancialData(groupId!),
    supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings, carryover_spent_amount')
      .eq(ownerColumn, ownerId),
    supabaseServer
      .from('real_expenses')
      .select('estimated_budget_id, amount_from_budget')
      .eq(ownerColumn, ownerId)
      .is('carried_from_recap_id', null)
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
    ravEstime:
      financialData.totalEstimatedIncome +
      (financialData.meta?.totalGroupContributions ?? 0) -
      financialData.totalEstimatedBudgets,
    ravEffectif: financialData.remainingToLive,
    piggyAmount,
    budgets: budgets.map((b) => ({
      budgetId: b.id,
      budgetName: b.name,
      estimatedAmount: Number(b.estimated_amount),
      spentThisMonth: spentByBudgetId.get(b.id) ?? 0,
      cumulatedSavings: Number(b.cumulated_savings ?? 0),
      carryoverSpentAmount: Number(b.carryover_spent_amount ?? 0),
    })),
    piggyTransfersData,
    // Sprint Projets-Épargne 07 (2026-05-26) — réutilise la liste déjà
    // fetchée par `_loadFinancialData` (pas de RTT supplémentaire). Le
    // subset `SavingsProjectMeta` est construit dans `buildSavingsProjectMeta`
    // avec `monthsRemaining` dérivé à l'instant T du fetch.
    savingsProjects: financialData.meta?.savingsProjects ?? [],
    // Sprint Projets-Épargne 10 — preview de l'effet de la finalize sur les
    // projets. Active uniquement quand le caller fournit la valeur (status
    // route lit `monthly_recaps.project_snapshot_data` ; start / autres
    // callers passent `undefined` car aucun snapshot n'est encore matérialisé).
    projectSnapshotData,
  })
}

function formatIsoDate(year: number, month1Indexed: number, day: number): string {
  const mm = String(month1Indexed).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}
