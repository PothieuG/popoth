/**
 * Orchestrateur de calcul des données financières (profile ou group),
 * unifié sur ContextFilter.
 *
 * Extrait de lib/financial-calculations.ts au chantier I4. Les deux
 * fonctions getProfileFinancialData (~262 LOC) et getGroupFinancialData
 * (~200 LOC) étaient à 80% identiques — la divergence porte sur 2 points :
 *   1. Profile fetche `profiles.salary` et l'ajoute au totalEstimatedIncome
 *      ET à incomeContribution (le salaire est un revenu fixe à 100%).
 *   2. Group fetche `group_contributions` et passe la somme à RAV group
 *      (terme additionnel dans la formule).
 *
 * Le helper privé `_loadFinancialData(filter)` factorise tout le reste.
 * Les 2 wrappers publics conservent leur signature externe pour les 11
 * importers (la migration vers ContextFilter relève du commit #9 ou plus
 * tard).
 *
 * Comportement fail-soft : on caught error, retourne `EMPTY_FINANCIAL_DATA`
 * — cohérent avec l'original. Le dashboard préfère afficher des zéros
 * qu'un écran d'erreur sur défaillance transitoire.
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from './calc-rtl'
import { EMPTY_FINANCIAL_DATA } from './constants'
import { asContextFilter, resolveContextIds, type ContextFilter } from './context'
import { calculateIncomeCompensation } from './income-compensation'
import { saveRavToDatabase } from './rav-persistence'
import type { FinancialData } from './types'

async function _loadFinancialData(filter: ContextFilter): Promise<FinancialData> {
  // resolveContextIds enforces the discriminated-union invariant at runtime
  // (throws if neither id is set) and exposes them as `string | undefined`,
  // letting us narrow with a single ternary.
  const { profile_id: profileIdOrU, group_id: groupIdOrU } = resolveContextIds(filter)
  const isProfile = profileIdOrU !== undefined
  const ownerColumn: 'profile_id' | 'group_id' = isProfile ? 'profile_id' : 'group_id'
  const ownerId: string = isProfile ? profileIdOrU : (groupIdOrU as string)

  try {
    // 1. Solde bancaire (commun)
    const { data: bankBalance } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq(ownerColumn, ownerId)
      .single()
    const userBankBalance = bankBalance?.balance ?? 0

    // 1.bis Profile-only: salaire fixe (toujours à 100%, pas de "real income" lié)
    let profileSalary = 0
    if (isProfile) {
      const { data: profileData } = await supabaseServer
        .from('profiles')
        .select('salary')
        .eq('id', ownerId)
        .single()
      profileSalary = profileData?.salary ?? 0
    }

    // 2. Revenus estimés
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq(ownerColumn, ownerId)
    const totalEstimatedIncome =
      (estimatedIncomes?.reduce((sum, x) => sum + x.estimated_amount, 0) ?? 0) + profileSalary

    // 3. Budgets estimés
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select(
        'id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date, cumulated_savings',
      )
      .eq(ownerColumn, ownerId)
    const totalEstimatedBudgets =
      estimatedBudgets?.reduce((sum, b) => sum + b.estimated_amount, 0) ?? 0

    // 4. Revenus réels
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq(ownerColumn, ownerId)
    const totalRealIncome = realIncomes?.reduce((sum, x) => sum + x.amount, 0) ?? 0

    // 5. Dépenses réelles
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, is_exceptional, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq(ownerColumn, ownerId)
    const totalRealExpenses = realExpenses?.reduce((sum, x) => sum + x.amount, 0) ?? 0

    // 6. Tirelire
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerColumn, ownerId)
      .maybeSingle()

    // 7. Exceptionnels (revenus + dépenses)
    const exceptionalExpenses =
      realExpenses
        ?.filter((e) => e.is_exceptional || !e.estimated_budget_id)
        .reduce((sum, e) => sum + e.amount, 0) ?? 0
    const exceptionalIncomes =
      realIncomes?.filter((i) => !i.estimated_income_id).reduce((sum, i) => sum + i.amount, 0) ?? 0

    // 8. Économies cumulées (budgets + tirelire)
    let totalSavings = 0
    if (estimatedBudgets) {
      for (const budget of estimatedBudgets) {
        totalSavings += budget.cumulated_savings ?? 0
      }
    }
    totalSavings += piggyBankData?.amount ?? 0

    // 9. Déficits par budget
    let totalBudgetDeficits = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget =
          realExpenses
            .filter((e) => !e.is_exceptional && e.estimated_budget_id === budget.id)
            .reduce((sum, e) => {
              const amountFromBudget =
                e.amount_from_budget !== null && e.amount_from_budget !== undefined
                  ? e.amount_from_budget
                  : e.amount
              return sum + amountFromBudget
            }, 0) ?? 0

        let carryoverSpent = 0
        if (budget.carryover_spent_amount !== undefined) {
          carryoverSpent = budget.carryover_spent_amount ?? 0
        } else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
          carryoverSpent = Math.abs(budget.monthly_surplus)
        }

        const deficit = calculateBudgetDeficit(
          budget.estimated_amount,
          spentOnBudget + carryoverSpent,
        )
        if (deficit > 0) {
          logger.debug(
            `[Budget Deficit] "${budget.name}": ${budget.estimated_amount}€ budgété, ${spentOnBudget + carryoverSpent}€ dépensé → Déficit: ${deficit}€`,
          )
        }
        totalBudgetDeficits += deficit
      }
    }

    // 10. Solde disponible
    const availableBalance = calculateAvailableCash(
      userBankBalance,
      totalRealIncome,
      totalRealExpenses,
    )

    // 11. Contribution revenus + RAV
    const incomeCompensation = await calculateIncomeCompensation(filter)
    // Profile : ajouter le salaire fixe à la contribution (group n'a pas de salaire)
    const incomeContribution = incomeCompensation + profileSalary

    let remainingToLive: number
    if (isProfile) {
      remainingToLive = await calculateRemainingToLiveProfile(
        incomeContribution,
        exceptionalIncomes,
        totalEstimatedBudgets,
        exceptionalExpenses,
        totalBudgetDeficits,
      )
    } else {
      // Group-only: contributions des membres
      const { data: groupContributions } = await supabaseServer
        .from('group_contributions')
        .select('contribution_amount')
        .eq('group_id', ownerId)
      const totalProfileContributions =
        groupContributions?.reduce((sum, c) => sum + c.contribution_amount, 0) ?? 0

      remainingToLive = await calculateRemainingToLiveGroup(
        incomeContribution,
        exceptionalIncomes,
        totalProfileContributions,
        totalEstimatedBudgets,
        exceptionalExpenses,
        totalBudgetDeficits,
      )
    }

    // 12. Persister le RAV
    await saveRavToDatabase(isProfile ? ownerId : null, isProfile ? null : ownerId, remainingToLive)

    return {
      availableBalance,
      remainingToLive,
      totalSavings,
      totalEstimatedIncome,
      totalEstimatedBudgets,
      totalRealIncome,
      totalRealExpenses,
    }
  } catch (error) {
    logger.error('Erreur lors du calcul des données financières', { ownerColumn, ownerId, error })
    return { ...EMPTY_FINANCIAL_DATA }
  }
}

/** Récupère les données financières pour un profile. Fail-soft → EMPTY_FINANCIAL_DATA. */
export async function getProfileFinancialData(profileId: string): Promise<FinancialData> {
  return _loadFinancialData(asContextFilter({ profile_id: profileId }))
}

/** Récupère les données financières pour un groupe. Fail-soft → EMPTY_FINANCIAL_DATA. */
export async function getGroupFinancialData(groupId: string): Promise<FinancialData> {
  return _loadFinancialData(asContextFilter({ group_id: groupId }))
}
