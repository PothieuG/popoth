/**
 * Bibliothèque de calculs financiers côté application
 * Implémente les règles métier définies dans battleplan.txt
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer as typedSupabase } from '@/lib/supabase-server'
import {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateBudgetSavings,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from '@/lib/finance/calc-rtl'
import { EMPTY_FINANCIAL_DATA } from '@/lib/finance/constants'
import { asContextFilter } from '@/lib/finance/context'
import { calculateIncomeCompensation } from '@/lib/finance/income-compensation'
import { saveRavToDatabase } from '@/lib/finance/rav-persistence'
import type { BudgetSavings, FinancialData } from '@/lib/finance/types'

// God file per CLAUDE.md (chantier I4 — do not refactor). Scope-cast to
// untyped: legacy local shapes diverge from generated row types
// (e.g. profileId: string | undefined vs row string | null). Tracked as a
// follow-up.
const supabaseServer = typedSupabase as unknown as SupabaseClient

// ============================================
// INTERFACES TYPESCRIPT
// ============================================
// Moved to lib/finance/types.ts at chantier I4 — re-exported here for
// back-compat with the 17 importers until commit #9 migrates them.
export type { BudgetSavings, FinancialData } from './finance/types'

// ============================================
// CALCULS SELON BATTLEPLAN.TXT
// ============================================

// calculateIncomeCompensation{Profile,Group} unified into a single function
// taking ContextFilter at chantier I4 — see lib/finance/income-compensation.ts.
// The 2 internal callers below pass `asContextFilter({ profile_id })` /
// `asContextFilter({ group_id })`. Flow logs and per-iteration logs dropped
// per Lot 2 §6 règle d'or; outer catch error migrated to logger.error.

// Pure calc helpers moved to lib/finance/calc-rtl.ts at chantier I4 — flow
// logs dropped per Lot 2 §6 règle d'or (DROP debug-only); deficit notice
// migrated to logger.debug. Re-exported here for back-compat with the 17
// importers until commit #9.
export {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateBudgetSavings,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from './finance/calc-rtl'

// ============================================
// FONCTIONS DE RÉCUPÉRATION DE DONNÉES
// ============================================
// `saveRavToDatabase` (interne) et `getRavFromDatabase` (utilisé par
// rav.ts + summary.ts) extraits vers lib/finance/rav-persistence.ts au
// chantier I4. Re-export public + import local pour les call sites internes.
export { getRavFromDatabase } from './finance/rav-persistence'

/**
 * Récupère les données financières pour un utilisateur (profile)
 */
export async function getProfileFinancialData(profileId: string): Promise<FinancialData> {
  try {
    console.log(`🔍 [DEBUG getProfileFinancialData] ====================================`)
    console.log(`🔍 [DEBUG getProfileFinancialData] DÉBUT CALCUL POUR PROFILE: ${profileId}`)
    console.log(`🔍 [DEBUG getProfileFinancialData] ====================================`)

    // 1. Récupérer le solde bancaire éditable de l'utilisateur
    const { data: bankBalance } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', profileId)
      .single()

    const userBankBalance = bankBalance?.balance || 0

    // 1.bis Récupérer le salaire du profil
    const { data: profileData } = await supabaseServer
      .from('profiles')
      .select('salary')
      .eq('id', profileId)
      .single()

    const profileSalary = profileData?.salary || 0
    console.log(`💰 [DEBUG getProfileFinancialData] Salaire du profil: ${profileSalary}€`)

    // 2. Récupérer tous les revenus estimés du profile
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq('profile_id', profileId)

    const totalEstimatedIncome =
      (estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0) +
      profileSalary

    // 3. Récupérer tous les budgets estimés du profile
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select(
        'id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date, cumulated_savings',
      )
      .eq('profile_id', profileId)

    const totalEstimatedBudgets =
      estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 4. Récupérer tous les revenus réels du profile
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id, description, entry_date')
      .eq('profile_id', profileId)

    console.log(`💵 [DEBUG DB QUERY] Revenus réels récupérés: ${realIncomes?.length || 0} entrées`)
    if (realIncomes && realIncomes.length > 0) {
      console.log(`💵 [DEBUG DB QUERY] Détail des revenus:`)
      realIncomes.forEach((income, idx) => {
        console.log(
          `   ${idx + 1}. ${income.amount}€ - ${income.description || 'Sans description'} (${income.entry_date})`,
        )
      })
    }

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0
    console.log(`💵 [DEBUG DB QUERY] TOTAL revenus réels: ${totalRealIncome}€`)

    // 5. Récupérer toutes les dépenses réelles du profile
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, is_exceptional, description, expense_date, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq('profile_id', profileId)

    console.log(
      `💸 [DEBUG DB QUERY] Dépenses réelles récupérées: ${realExpenses?.length || 0} entrées`,
    )
    if (realExpenses && realExpenses.length > 0) {
      console.log(`💸 [DEBUG DB QUERY] Détail des dépenses:`)
      realExpenses.forEach((expense, idx) => {
        console.log(
          `   ${idx + 1}. ${expense.amount}€ - ${expense.description || 'Sans description'} (${expense.expense_date}) ${expense.is_exceptional ? '[EXCEPTIONNELLE]' : ''}`,
        )
      })
    }

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0
    console.log(`💸 [DEBUG DB QUERY] TOTAL dépenses réelles: ${totalRealExpenses}€`)

    // 5. Calculer les dépenses exceptionnelles (non liées à un budget)
    const exceptionalExpenses =
      realExpenses
        ?.filter((expense) => expense.is_exceptional || !expense.estimated_budget_id)
        ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5.2. Calculer les revenus exceptionnels (non liés à un revenu estimé)
    const totalExceptionalIncomes =
      realIncomes
        ?.filter((income) => !income.estimated_income_id)
        ?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 5.3. SUPPRIMÉ: Calcul des différences revenus (bonus/déficits)

    // 6. Calculer le total des économies cumulées de tous les budgets
    let totalSavings = 0
    if (estimatedBudgets) {
      for (const budget of estimatedBudgets) {
        // Utiliser cumulated_savings qui contient toutes les économies accumulées
        const cumulatedSavings = budget.cumulated_savings || 0
        totalSavings += cumulatedSavings
      }
    }

    // 6.bis Ajouter le montant de la tirelire aux économies totales
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', profileId)
      .maybeSingle()

    totalSavings += piggyBankData?.amount || 0

    // 6.1. Calculer les déficits des budgets (dépenses > budget estimé)
    console.log(`🔍 [DEBUG getProfileFinancialData] Calcul des déficits des budgets...`)
    let totalBudgetDeficits = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        // Calculer le total dépensé pour ce budget (only amount_from_budget)
        const spentOnBudget =
          realExpenses
            ?.filter(
              (expense) => !expense.is_exceptional && expense.estimated_budget_id === budget.id,
            )
            ?.reduce((sum, expense) => {
              const amountFromBudget =
                expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
                  ? expense.amount_from_budget
                  : expense.amount
              return sum + amountFromBudget
            }, 0) || 0

        // Ajouter le carryover si applicable
        let carryoverSpent = 0
        if (budget.carryover_spent_amount !== undefined) {
          carryoverSpent = budget.carryover_spent_amount || 0
        } else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
          carryoverSpent = Math.abs(budget.monthly_surplus)
        }

        const totalSpent = spentOnBudget + carryoverSpent
        const deficit = calculateBudgetDeficit(budget.estimated_amount, totalSpent)

        if (deficit > 0) {
          console.log(
            `⚠️ [Budget Deficit] "${budget.name}": ${budget.estimated_amount}€ budgété, ${totalSpent}€ dépensé → Déficit: ${deficit}€`,
          )
        }

        totalBudgetDeficits += deficit
      }
    }
    console.log(
      `🔍 [DEBUG getProfileFinancialData] Total déficits des budgets: ${totalBudgetDeficits}€`,
    )

    // 7. Appliquer les règles de calcul SIMPLIFIÉES
    // Utiliser la fonction dédiée pour calculer le solde disponible
    console.log(
      '📊 [getProfileFinancialData] Calcul du solde disponible pour le profil:',
      profileId,
    )
    const availableBalance = calculateAvailableCash(
      userBankBalance,
      totalRealIncome,
      totalRealExpenses,
    )

    // Calculer la contribution des revenus au RAV selon les règles métier
    console.log(
      `🔍 [DEBUG getProfileFinancialData] Calcul contribution revenus pour profile ${profileId}`,
    )
    const incomeCompensation = await calculateIncomeCompensation(
      asContextFilter({ profile_id: profileId }),
    )
    // Ajouter le salaire du profil comme revenu (toujours à 100%, pas de "real income" lié)
    const incomeContribution = incomeCompensation + profileSalary
    console.log(
      `🔍 [DEBUG getProfileFinancialData] Contribution revenus calculée: ${incomeCompensation}€ + salaire ${profileSalary}€ = ${incomeContribution}€`,
    )

    console.log(`🔍 [DEBUG getProfileFinancialData] DONNÉES POUR CALCUL RAV:`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - incomeContribution: ${incomeContribution}€`)
    console.log(
      `🔍 [DEBUG getProfileFinancialData] - totalExceptionalIncomes: ${totalExceptionalIncomes}€`,
    )
    console.log(
      `🔍 [DEBUG getProfileFinancialData] - totalEstimatedBudgets: ${totalEstimatedBudgets}€`,
    )
    console.log(`🔍 [DEBUG getProfileFinancialData] - exceptionalExpenses: ${exceptionalExpenses}€`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - totalBudgetDeficits: ${totalBudgetDeficits}€`)

    // NOUVELLE LOGIQUE CORRECTE: RAV = Revenus + Revenus Exceptionnels - Budgets - Dépenses Exceptionnelles - Déficits des Budgets
    const remainingToLive = await calculateRemainingToLiveProfile(
      incomeContribution,
      totalExceptionalIncomes,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalBudgetDeficits,
    )

    // Calculs terminés
    console.log(``)
    console.log(`📊📊📊 ========================================================`)
    console.log(`📊📊📊 RÉSUMÉ CALCULS FINANCIERS - PROFILE`)
    console.log(`📊📊📊 ========================================================`)
    console.log(`📊 PROFILE ID: ${profileId}`)
    console.log(``)
    console.log(`🏦 DONNÉES BASE:`)
    console.log(`   - Solde bancaire: ${userBankBalance}€`)
    console.log(`   - Revenus réels (${realIncomes?.length || 0} entrées): ${totalRealIncome}€`)
    console.log(
      `   - Dépenses réelles (${realExpenses?.length || 0} entrées): ${totalRealExpenses}€`,
    )
    console.log(``)
    console.log(`📈 CALCULS DÉRIVÉS:`)
    console.log(
      `   - Solde disponible: ${userBankBalance} + ${totalRealIncome} - ${totalRealExpenses} = ${availableBalance}€`,
    )
    console.log(`   - Contribution revenus: ${incomeContribution}€`)
    console.log(`   - Revenus exceptionnels: ${totalExceptionalIncomes}€`)
    console.log(`   - Budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`   - Dépenses exceptionnelles: ${exceptionalExpenses}€`)
    console.log(`   - Déficits des budgets: ${totalBudgetDeficits}€`)
    console.log(``)
    console.log(`💰 RESTE À VIVRE: ${remainingToLive}€`)
    console.log(`💎 TOTAL ÉCONOMIES: ${totalSavings}€`)
    console.log(`📊📊📊 ========================================================`)
    console.log(``)

    // Save RAV to database for persistence
    await saveRavToDatabase(profileId, null, remainingToLive)

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
    console.error('❌ Erreur lors du calcul des données financières:', error)
    // Retourner des valeurs par défaut en cas d'erreur
    return { ...EMPTY_FINANCIAL_DATA }
  }
}

/**
 * Récupère les données financières pour un groupe
 */
export async function getGroupFinancialData(groupId: string): Promise<FinancialData> {
  try {
    // 1. Récupérer les revenus estimés du groupe
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq('group_id', groupId)

    const totalEstimatedIncome =
      estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0

    // 2. Récupérer les budgets estimés du groupe
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select(
        'id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date, cumulated_savings',
      )
      .eq('group_id', groupId)

    const totalEstimatedBudgets =
      estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 3. Récupérer les revenus réels du groupe
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq('group_id', groupId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 4. Récupérer les dépenses réelles du groupe
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, is_exceptional, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq('group_id', groupId)

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5. Récupérer le solde bancaire du groupe (indépendant des membres)
    const { data: groupBankBalance } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq('group_id', groupId)
      .single()

    const totalGroupBankBalance = groupBankBalance?.balance || 0

    // 6. Calculer les dépenses exceptionnelles
    const exceptionalExpenses =
      realExpenses
        ?.filter((expense) => expense.is_exceptional || !expense.estimated_budget_id)
        ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 6.2. Calculer les revenus exceptionnels (non liés à un revenu estimé)
    const totalExceptionalIncomes =
      realIncomes
        ?.filter((income) => !income.estimated_income_id)
        ?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 6.3. SUPPRIMÉ: Calcul des différences revenus (bonus/déficits)

    // 7. Calculer le total des économies cumulées de tous les budgets
    let totalSavings = 0
    if (estimatedBudgets) {
      for (const budget of estimatedBudgets) {
        // Utiliser cumulated_savings qui contient toutes les économies accumulées
        const cumulatedSavings = budget.cumulated_savings || 0
        totalSavings += cumulatedSavings
      }
    }

    // 7.bis Ajouter le montant de la tirelire aux économies totales
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq('group_id', groupId)
      .maybeSingle()

    totalSavings += piggyBankData?.amount || 0

    // 7.1. Calculer les déficits des budgets (dépenses > budget estimé)
    console.log(`🔍 [DEBUG getGroupFinancialData] Calcul des déficits des budgets...`)
    let totalBudgetDeficits = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        // Calculer le total dépensé pour ce budget (only amount_from_budget)
        const spentOnBudget =
          realExpenses
            ?.filter(
              (expense) => !expense.is_exceptional && expense.estimated_budget_id === budget.id,
            )
            ?.reduce((sum, expense) => {
              const amountFromBudget =
                expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
                  ? expense.amount_from_budget
                  : expense.amount
              return sum + amountFromBudget
            }, 0) || 0

        // Ajouter le carryover si applicable
        let carryoverSpent = 0
        if (budget.carryover_spent_amount !== undefined) {
          carryoverSpent = budget.carryover_spent_amount || 0
        } else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
          carryoverSpent = Math.abs(budget.monthly_surplus)
        }

        const totalSpent = spentOnBudget + carryoverSpent
        const deficit = calculateBudgetDeficit(budget.estimated_amount, totalSpent)

        if (deficit > 0) {
          console.log(
            `⚠️ [Budget Deficit] "${budget.name}": ${budget.estimated_amount}€ budgété, ${totalSpent}€ dépensé → Déficit: ${deficit}€`,
          )
        }

        totalBudgetDeficits += deficit
      }
    }
    console.log(
      `🔍 [DEBUG getGroupFinancialData] Total déficits des budgets: ${totalBudgetDeficits}€`,
    )

    // 8. Récupérer les contributions des profiles du groupe
    const { data: groupContributions } = await supabaseServer
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', groupId)

    const totalProfileContributions =
      groupContributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // 9. Appliquer les règles de calcul SIMPLIFIÉES pour groupe
    // Utiliser la fonction dédiée pour calculer le solde disponible du groupe
    console.log('📊 [getGroupFinancialData] Calcul du solde disponible pour le groupe:', groupId)
    const availableBalance = calculateAvailableCash(
      totalGroupBankBalance,
      totalRealIncome,
      totalRealExpenses,
    )

    // Calculer la contribution des revenus au RAV selon les règles métier
    const incomeContribution = await calculateIncomeCompensation(
      asContextFilter({ group_id: groupId }),
    )

    // NOUVELLE LOGIQUE CORRECTE: RAV = Revenus + Revenus Exceptionnels + Contributions - Budgets - Dépenses Exceptionnelles - Déficits des Budgets
    const remainingToLive = await calculateRemainingToLiveGroup(
      incomeContribution,
      totalExceptionalIncomes,
      totalProfileContributions,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalBudgetDeficits,
    )

    console.log('💰 [getGroupFinancialData] Calculs financiers terminés pour le groupe:', groupId)
    console.log('💰 [getGroupFinancialData] Détail des calculs:', {
      groupId,
      // Données de base
      totalGroupBankBalance,
      totalRealIncome,
      totalRealExpenses,
      // Résultat final
      availableBalance: `${totalGroupBankBalance} + ${totalRealIncome} - ${totalRealExpenses} = ${availableBalance}`,
      // Autres données
      totalEstimatedIncome,
      totalProfileContributions,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalBudgetDeficits,
      remainingToLive,
      totalSavings,
    })

    // Save RAV to database for persistence
    await saveRavToDatabase(null, groupId, remainingToLive)

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
    console.error('❌ Erreur lors du calcul des données financières du groupe:', error)
    return { ...EMPTY_FINANCIAL_DATA }
  }
}

/**
 * Récupère le détail des économies par budget pour un profile
 */
export async function getBudgetSavingsDetail(profileId: string): Promise<BudgetSavings[]> {
  try {
    const { data: budgets } = await supabaseServer
      .from('estimated_budgets')
      .select(
        'id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date',
      )
      .eq('profile_id', profileId)

    if (!budgets) return []

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq('profile_id', profileId)
      .not('estimated_budget_id', 'is', null)

    const result: BudgetSavings[] = []

    for (const budget of budgets) {
      // Only count amount_from_budget (not piggy bank or savings)
      const realExpensesThisMonth =
        expenses
          ?.filter((expense) => expense.estimated_budget_id === budget.id)
          ?.reduce((sum, expense) => {
            // Use amount_from_budget if available, otherwise use amount (backward compatibility)
            const amountFromBudget =
              expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
                ? expense.amount_from_budget
                : expense.amount
            return sum + amountFromBudget
          }, 0) || 0

      // Utiliser carryover_spent_amount si disponible, sinon fallback sur monthly_surplus négatif
      let carryoverSpent = 0
      if (budget.carryover_spent_amount !== undefined) {
        // Nouveau système de carryover
        carryoverSpent = budget.carryover_spent_amount || 0
      } else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
        // Ancien système de fallback
        carryoverSpent = Math.abs(budget.monthly_surplus)
      }

      // Total dépensé = dépenses réelles + carryover du mois précédent
      const totalSpentThisMonth = realExpensesThisMonth + carryoverSpent

      const savings = calculateBudgetSavings(budget.estimated_amount, totalSpentThisMonth, false)

      console.log(
        `📊 [getBudgetSavingsDetail] "${budget.name}": ${realExpensesThisMonth}€ réel + ${carryoverSpent}€ carryover = ${totalSpentThisMonth}€ total`,
      )

      result.push({
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedAmount: budget.estimated_amount,
        spentThisMonth: totalSpentThisMonth, // Maintenant inclut le carryover
        savings,
      })
    }

    return result
  } catch (error) {
    console.error('❌ Erreur lors du calcul des économies par budget:', error)
    return []
  }
}

// ============================================
// FONCTIONS DE SAUVEGARDE AUTOMATIQUE
// ============================================
// `saveRemainingToLiveSnapshot` extrait vers lib/finance/snapshots.ts au
// chantier I4 — fail-soft contract préservé (R1). Les 2 wrappers
// `*Profile`/`*Group` n'avaient aucun callsite externe (vérifié grep), seul
// le dispatcher est ré-exporté pour les 5 callsites dans lib/api/finance/*.
export { saveRemainingToLiveSnapshot } from './finance/snapshots'
