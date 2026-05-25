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
  calculateBudgetDeficit,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from './calc-rtl'
import { EMPTY_FINANCIAL_DATA } from './constants'
import { asContextFilter, resolveContextIds, type ContextFilter } from './context'
import { calculateIncomeCompensation } from './income-compensation'
import { saveRavToDatabase } from './rav-persistence'
import type { FinancialData, ReadOnlyIncome } from './types'

async function _loadFinancialData(filter: ContextFilter): Promise<FinancialData> {
  // resolveContextIds enforces the discriminated-union invariant at runtime
  // (throws if neither id is set) and exposes them as `string | undefined`,
  // letting us narrow with a single ternary.
  const { profile_id: profileIdOrU, group_id: groupIdOrU } = resolveContextIds(filter)
  const isProfile = profileIdOrU !== undefined
  const ownerColumn: 'profile_id' | 'group_id' = isProfile ? 'profile_id' : 'group_id'
  const ownerId = isProfile ? profileIdOrU : groupIdOrU
  if (!ownerId) {
    // resolveContextIds throws if neither id is defined, so this branch is
    // unreachable. The assertion documents the invariant for the type-checker
    // and replaces an `as string` cast that lied about runtime nullability.
    throw new Error('unreachable: resolveContextIds returned no owner id')
  }

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

    // 4. Revenus réels. Sprint 15 V3 — exclure les carry-overs : ils sont
    // affichés en lecture sur le dashboard mais ne comptent pas dans le RAV,
    // le solde, ou tout autre calcul tant que l'utilisateur ne les a pas
    // validés via long-press (spec §5.2).
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq(ownerColumn, ownerId)
      .eq('is_carried_over', false)
    const totalRealIncome = realIncomes?.reduce((sum, x) => sum + x.amount, 0) ?? 0

    // 5. Dépenses réelles (idem §4 — exclure les carry-overs).
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select(
        'amount, estimated_budget_id, is_exceptional, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget',
      )
      .eq(ownerColumn, ownerId)
      .eq('is_carried_over', false)
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

    // 10. Solde disponible. Sprint Long-Press-Toggle-Apply-To-Balance
    // (2026-05-23) : sémantique pure-bank — `availableBalance ===
    // bank_balances.balance`. La formule `calculateAvailableCash(bank,
    // incomes, expenses)` pré-sprint projetait un solde "post toutes
    // pending" mais ne reflétait jamais la réalité du compte. Maintenant,
    // le user contrôle quand une transaction "atterrit" sur le solde via
    // long-press (toggle_real_*_applied_to_balance) — le dashboard expose
    // donc la valeur authoritative de la table `bank_balances` directement.
    // calculateAvailableCash est conservé pour les tests legacy gated +
    // backward-compat helpers (cf. lib/finance/calc-rtl.ts).
    const availableBalance = userBankBalance

    // 11. Contribution revenus + RAV
    const incomeCompensation = await calculateIncomeCompensation(filter)
    // Profile : ajouter le salaire fixe à la contribution (group n'a pas de salaire)
    const incomeContribution = incomeCompensation + profileSalary

    // Sprint 16 V3 — pour le groupe, on fetch une fois les contributions
    // jointes au first_name des membres + le snapshot de salaire. Le résultat
    // sert à 3 calculs : (1) RAV via totalProfileContributions, (2) lignes
    // virtuelles read-only une-par-membre, (3) plafond de validation budget
    // (`meta.groupSalaryTotal`, voir types.ts).
    type GroupContribRow = {
      contribution_amount: number
      salary: number
      profiles: { first_name: string } | null
    }
    let groupContributions: GroupContribRow[] = []
    if (!isProfile) {
      const { data } = await supabaseServer
        .from('group_contributions')
        .select('contribution_amount, salary, profiles:profile_id (first_name)')
        .eq('group_id', ownerId)
      groupContributions = (data ?? []) as unknown as GroupContribRow[]
    }

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
      const totalProfileContributions = groupContributions.reduce(
        (sum, c) => sum + c.contribution_amount,
        0,
      )

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

    // 13. Sprint 16 Monthly Recap V3 — lignes virtuelles read-only à afficher
    // dans le drawer Planification (salaire perso, contribution de chaque
    // membre en groupe). Ces valeurs sont déjà incluses dans le RAV via
    // incomeContribution (perso) et totalProfileContributions (groupe) —
    // donc PAS de double-comptage côté backend. `meta.readOnlyIncomes` est
    // purement présentationnel ; aucun impact sur totalEstimatedIncome ni
    // sur les calculs du recap mensuel (load-summary.ts).
    const readOnlyIncomes: ReadOnlyIncome[] = []
    let groupSalaryTotal: number | undefined
    if (isProfile) {
      if (profileSalary > 0) {
        readOnlyIncomes.push({ kind: 'salary', label: 'Salaire', amount: profileSalary })
      }
    } else {
      // Une ligne read-only par membre du groupe ayant une contribution > 0.
      // Tri stable par prénom pour un affichage déterministe (utile pour les
      // tests + l'UX).
      const memberRows = groupContributions
        .filter((c) => c.contribution_amount > 0)
        .map((c) => ({
          firstName: c.profiles?.first_name ?? '',
          amount: c.contribution_amount,
        }))
        .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
      for (const row of memberRows) {
        readOnlyIncomes.push({
          kind: 'contribution',
          label: row.firstName ? `Contribution de ${row.firstName}` : 'Contribution groupe',
          amount: row.amount,
        })
      }
      // Somme des salaires des membres (snapshot via trigger), utilisée comme
      // plafond de validation pour "Ajouter un budget" en contexte groupe.
      // Brise le cycle "pas de budget → contribution = 0 → ajout budget bloqué".
      groupSalaryTotal = groupContributions.reduce((sum, c) => sum + (c.salary ?? 0), 0)
    }

    return {
      availableBalance,
      remainingToLive,
      totalSavings,
      totalEstimatedIncome,
      totalEstimatedBudgets,
      totalRealIncome,
      totalRealExpenses,
      meta: { readOnlyIncomes, ...(groupSalaryTotal !== undefined && { groupSalaryTotal }) },
    }
  } catch (error) {
    logger.error('Erreur lors du calcul des données financières', { ownerColumn, ownerId, error })
    return { ...EMPTY_FINANCIAL_DATA, meta: { readOnlyIncomes: [] } }
  }
}

/** Récupère les données financières pour un profile. Fail-soft → EMPTY_FINANCIAL_DATA. */
export async function getProfileFinancialData(profileId: string): Promise<FinancialData> {
  return _loadFinancialData(asContextFilter({ profile_id: profileId }))
}

/**
 * Récupère les données financières pour un groupe. Fail-soft → EMPTY_FINANCIAL_DATA.
 *
 * Sprint 16 Monthly Recap V3 — `meta.readOnlyIncomes` expose la contribution
 * de CHAQUE membre du groupe (label `Contribution de <prénom>`) en plus du
 * calcul RAV existant. Pas de paramètre userId : on ne distingue pas
 * visuellement la contribution du user courant des autres.
 */
export async function getGroupFinancialData(groupId: string): Promise<FinancialData> {
  return _loadFinancialData(asContextFilter({ group_id: groupId }))
}
