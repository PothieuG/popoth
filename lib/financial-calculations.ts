/**
 * Bibliothèque de calculs financiers côté application
 * Implémente les règles métier définies dans battleplan.txt
 */

import { supabaseServer } from '@/lib/supabase-server'

// ============================================
// INTERFACES TYPESCRIPT
// ============================================

export interface FinancialData {
  availableBalance: number      // Cash disponible (peut être négatif)
  remainingToLive: number      // Reste à vivre (peut être négatif)
  totalSavings: number         // Total des économies des budgets
  totalEstimatedIncome: number // Total des revenus estimés
  totalEstimatedBudgets: number // Total des budgets estimés
  totalRealIncome: number      // Total des revenus réels
  totalRealExpenses: number    // Total des dépenses réelles
}

export interface BudgetSavings {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  savings: number              // MAX(0, estimatedAmount - spentThisMonth)
}

export interface RemainingToLiveSnapshot {
  id: string
  profileId?: string
  groupId?: string
  remainingToLive: number
  availableBalance: number
  totalSavings: number
  totalEstimatedIncome: number
  totalEstimatedBudgets: number
  totalRealIncome: number
  totalRealExpenses: number
  snapshotReason: string
  createdAt: string
}

// ============================================
// CALCULS SELON BATTLEPLAN.TXT
// ============================================

/**
 * Calcule l'ajout de revenus au reste à vivre pour un profile
 * LOGIQUE CORRECTE:
 * - Revenu estimé NON utilisé (0€ réel) = +revenu estimé au reste à vivre
 * - Revenu estimé utilisé = +montant réellement reçu au reste à vivre
 */
async function calculateIncomeCompensationProfile(profileId: string): Promise<number> {
  try {
    console.log(`🔍 [DEBUG INCOME COMPENSATION] ====================================`)
    console.log(`🔍 [DEBUG INCOME COMPENSATION] CALCUL CONTRIBUTION REVENUS PROFILE: ${profileId}`)
    console.log(`🔍 [DEBUG INCOME COMPENSATION] ====================================`)

    // 1. Récupérer tous les revenus estimés du profile
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('id, estimated_amount')
      .eq('profile_id', profileId)

    console.log(`🔍 [DEBUG INCOME COMPENSATION] Revenus estimés trouvés: ${estimatedIncomes?.length || 0}`)
    if (!estimatedIncomes || estimatedIncomes.length === 0) {
      console.log(`🔍 [DEBUG INCOME COMPENSATION] Aucun revenu estimé - Contribution: 0€`)
      return 0
    }

    // 2. Récupérer tous les revenus réels liés aux revenus estimés
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq('profile_id', profileId)
      .not('estimated_income_id', 'is', null)

    const realIncomesData = realIncomes || []

    // 3. Calculer ce qui doit être ajouté au reste à vivre
    let totalToAdd = 0

    for (const estimatedIncome of estimatedIncomes) {
      const estimated = estimatedIncome.estimated_amount
      const realAmountForThisIncome = realIncomesData
        .filter(real => real.estimated_income_id === estimatedIncome.id)
        .reduce((sum, real) => sum + real.amount, 0)

      let amountToAdd = 0

      if (realAmountForThisIncome === 0) {
        // Revenu estimé NON utilisé → ajouter le montant estimé au reste à vivre
        amountToAdd = estimated
        console.log(`📊 [Income Addition] Revenu ${estimatedIncome.id}: NON UTILISÉ, estimé=${estimated}€ → +${estimated}€ au reste à vivre`)
      } else {
        // Revenu estimé utilisé → ajouter le montant réellement reçu
        amountToAdd = realAmountForThisIncome
        console.log(`📊 [Income Addition] Revenu ${estimatedIncome.id}: UTILISÉ, estimé=${estimated}€, réel=${realAmountForThisIncome}€ → +${realAmountForThisIncome}€ au reste à vivre`)
      }

      totalToAdd += amountToAdd
    }

    console.log(`🔍 [DEBUG INCOME COMPENSATION] RÉSULTAT FINAL - Contribution: ${totalToAdd}€`)
    console.log(`🔍 [DEBUG INCOME COMPENSATION] ====================================`)
    return totalToAdd

  } catch (error) {
    console.error('❌ Erreur lors du calcul des revenus profile:', error)
    return 0
  }
}

/**
 * Calcule l'ajout de revenus au reste à vivre pour un groupe
 * LOGIQUE CORRECTE:
 * - Revenu estimé NON utilisé (0€ réel) = +revenu estimé au reste à vivre
 * - Revenu estimé utilisé = +montant réellement reçu au reste à vivre
 */
async function calculateIncomeCompensationGroup(groupId: string): Promise<number> {
  try {
    // 1. Récupérer tous les revenus estimés du groupe
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('id, estimated_amount')
      .eq('group_id', groupId)

    if (!estimatedIncomes || estimatedIncomes.length === 0) return 0

    // 2. Récupérer tous les revenus réels liés aux revenus estimés
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq('group_id', groupId)
      .not('estimated_income_id', 'is', null)

    const realIncomesData = realIncomes || []

    // 3. Calculer la compensation pour chaque revenu estimé
    let totalCompensation = 0

    for (const estimatedIncome of estimatedIncomes) {
      const estimated = estimatedIncome.estimated_amount
      const realAmountForThisIncome = realIncomesData
        .filter(real => real.estimated_income_id === estimatedIncome.id)
        .reduce((sum, real) => sum + real.amount, 0)

      let compensation = 0

      if (realAmountForThisIncome === 0) {
        // Revenu estimé NON utilisé → ajouter le montant estimé au reste à vivre
        compensation = estimated
        console.log(`📊 [Income Compensation] Revenu ${estimatedIncome.id}: NON UTILISÉ, estimé=${estimated}€ → +${estimated}€ au reste à vivre`)
      } else {
        // Revenu estimé utilisé → ajouter le montant réellement reçu
        compensation = realAmountForThisIncome
        console.log(`📊 [Income Compensation] Revenu ${estimatedIncome.id}: UTILISÉ, estimé=${estimated}€, réel=${realAmountForThisIncome}€ → +${realAmountForThisIncome}€ au reste à vivre`)
      }

      totalCompensation += compensation
    }

    console.log(`💰 [Income Compensation Group] Total à ajouter: ${totalCompensation}€`)
    return totalCompensation

  } catch (error) {
    console.error('❌ Erreur lors du calcul de compensation revenus group:', error)
    return 0
  }
}

/**
 * Règle cash disponible (battleplan ligne 13-16):
 * "c'est l'argent disponible sur le compte bancaire à un temps T"
 * "c'est les réels entrées d'argent moins les réels dépenses"
 * "Ca peut être négatif"
 *
 * IMPORTANT: Cette fonction calcule le solde disponible en combinant:
 * - Le solde bancaire de base (éditable par l'utilisateur)
 * - Plus tous les revenus réels ajoutés
 * - Moins toutes les dépenses réelles ajoutées
 *
 * Formule: solde_disponible = solde_bancaire_base + revenus_réels - dépenses_réelles
 */
export function calculateAvailableCash(bankBalance: number, realIncomes: number, realExpenses: number): number {
  const result = bankBalance + realIncomes - realExpenses
  console.log('💰 [calculateAvailableCash] Calcul du solde disponible:', {
    bankBalance,
    realIncomes,
    realExpenses,
    result
  })
  return result
}

/**
 * CALCUL CORRECT du reste à vivre pour PROFILES selon les règles métier:
 * RAV = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels - Budgets Estimés - Dépenses Exceptionnelles - Déficits des Budgets
 *
 * NOTE: Les économies cumulées ont été SUPPRIMÉES de la formule à la demande utilisateur
 * NOTE: Les déficits des budgets (dépassements) sont maintenant soustraits du RAV
 */
export async function calculateRemainingToLiveProfile(
  totalIncomeContribution: number,
  exceptionalIncomes: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  budgetDeficits: number = 0
): Promise<number> {
  const remainingToLive = totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits
  console.log(`🔍 [DEBUG RAV PROFILE] ====================================`)
  console.log(`🔍 [DEBUG RAV PROFILE] CALCUL DÉTAILLÉ DU RESTE À VIVRE:`)
  console.log(`🔍 [DEBUG RAV PROFILE] - Contribution revenus: +${totalIncomeContribution}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] - Revenus exceptionnels: +${exceptionalIncomes}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] - Budgets estimés: -${estimatedBudgets}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] - Dépenses exceptionnelles: -${exceptionalExpenses}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] - Déficits des budgets: -${budgetDeficits}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] FORMULE: ${totalIncomeContribution} + ${exceptionalIncomes} - ${estimatedBudgets} - ${exceptionalExpenses} - ${budgetDeficits} = ${remainingToLive}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] RÉSULTAT FINAL: ${remainingToLive}€`)
  console.log(`🔍 [DEBUG RAV PROFILE] ====================================`)
  return remainingToLive
}


/**
 * CALCUL CORRECT du reste à vivre pour GROUPS selon les règles métier:
 * RAV = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels + Contributions Groupe - Budgets Estimés - Dépenses Exceptionnelles - Déficits des Budgets
 *
 * NOTE: Les économies cumulées ont été SUPPRIMÉES de la formule à la demande utilisateur
 * NOTE: Les déficits des budgets (dépassements) sont maintenant soustraits du RAV
 */
export async function calculateRemainingToLiveGroup(
  totalIncomeContribution: number,
  exceptionalIncomes: number,
  totalGroupContributions: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  budgetDeficits: number = 0
): Promise<number> {
  const remainingToLive = totalIncomeContribution + exceptionalIncomes + totalGroupContributions - estimatedBudgets - exceptionalExpenses - budgetDeficits
  console.log(`🔍 [DEBUG RAV GROUP] ====================================`)
  console.log(`🔍 [DEBUG RAV GROUP] CALCUL DÉTAILLÉ DU RESTE À VIVRE:`)
  console.log(`🔍 [DEBUG RAV GROUP] - Contribution revenus: +${totalIncomeContribution}€`)
  console.log(`🔍 [DEBUG RAV GROUP] - Revenus exceptionnels: +${exceptionalIncomes}€`)
  console.log(`🔍 [DEBUG RAV GROUP] - Contributions groupe: +${totalGroupContributions}€`)
  console.log(`🔍 [DEBUG RAV GROUP] - Budgets estimés: -${estimatedBudgets}€`)
  console.log(`🔍 [DEBUG RAV GROUP] - Dépenses exceptionnelles: -${exceptionalExpenses}€`)
  console.log(`🔍 [DEBUG RAV GROUP] - Déficits des budgets: -${budgetDeficits}€`)
  console.log(`🔍 [DEBUG RAV GROUP] FORMULE: ${totalIncomeContribution} + ${exceptionalIncomes} + ${totalGroupContributions} - ${estimatedBudgets} - ${exceptionalExpenses} - ${budgetDeficits} = ${remainingToLive}€`)
  console.log(`🔍 [DEBUG RAV GROUP] RÉSULTAT FINAL: ${remainingToLive}€`)
  console.log(`🔍 [DEBUG RAV GROUP] ====================================`)
  return remainingToLive
}


/**
 * Calcul des économies d'un budget (battleplan ligne 28):
 * "si je décide de budgété 200€ pour des courses pendant un mois et qu'en fait je ne dépense que 150€,
 * à la fin du mois, 50€ sera ajouté aux économies de ce budget"
 *
 * IMPORTANT: Les économies ne sont calculées QU'À LA FIN DU MOIS/PÉRIODE,
 * pas en temps réel pendant le mois en cours.
 * En temps réel = toujours 0 (car le mois n'est pas terminé)
 */
export function calculateBudgetSavings(
  estimatedAmount: number,
  spentThisMonth: number,
  isEndOfPeriod: boolean = false
): number {
  // En temps réel pendant le mois : pas d'économies calculées
  if (!isEndOfPeriod) {
    return 0
  }

  // À la fin du mois seulement : calculer les vraies économies
  return Math.max(0, estimatedAmount - spentThisMonth)
}

/**
 * Calcul du déficit d'un budget:
 * Si les dépenses réelles dépassent le budget estimé, le dépassement doit être soustrait du reste à vivre
 *
 * Formule: Déficit = MAX(0, Dépenses Réelles - Budget Estimé)
 *
 * Exemple:
 * - Budget Transport: 300€
 * - Dépensé: 450€
 * - Déficit: 150€ → Ces 150€ sont soustraits du reste à vivre
 */
export function calculateBudgetDeficit(
  estimatedAmount: number,
  spentThisMonth: number
): number {
  const deficit = Math.max(0, spentThisMonth - estimatedAmount)
  if (deficit > 0) {
    console.log(`⚠️ [Budget Deficit] Budget dépassé: ${spentThisMonth}€ dépensé sur ${estimatedAmount}€ → Déficit: ${deficit}€`)
  }
  return deficit
}

// ============================================
// FONCTIONS DE RÉCUPÉRATION DE DONNÉES
// ============================================

/**
 * Saves the calculated RAV to the database for a profile or group
 */
async function saveRavToDatabase(profileId: string | null, groupId: string | null, remainingToLive: number): Promise<void> {
  try {
    // Determine which field to use for the update
    if (profileId) {
      const { error } = await supabaseServer
        .from('bank_balances')
        .update({
          current_remaining_to_live: remainingToLive,
          updated_at: new Date().toISOString()
        })
        .eq('profile_id', profileId)

      if (error) {
        console.error('❌ Error saving RAV to database (profile):', error)
      } else {
        console.log(`✅ RAV saved to database for profile ${profileId}: ${remainingToLive}€`)
      }
    } else if (groupId) {
      const { error } = await supabaseServer
        .from('bank_balances')
        .update({
          current_remaining_to_live: remainingToLive,
          updated_at: new Date().toISOString()
        })
        .eq('group_id', groupId)

      if (error) {
        console.error('❌ Error saving RAV to database (group):', error)
      } else {
        console.log(`✅ RAV saved to database for group ${groupId}: ${remainingToLive}€`)
      }
    }
  } catch (error) {
    console.error('❌ Exception while saving RAV to database:', error)
  }
}

/**
 * Retrieves the RAV from database for a profile
 * Falls back to calculating if not found in database
 */
export async function getRavFromDatabase(profileId: string | null, groupId: string | null): Promise<number> {
  try {
    if (profileId) {
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .select('current_remaining_to_live')
        .eq('profile_id', profileId)
        .single()

      if (error) {
        console.warn('⚠️ Could not retrieve RAV from database for profile, will calculate:', error)
        return 0
      }

      return data?.current_remaining_to_live ?? 0
    } else if (groupId) {
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .select('current_remaining_to_live')
        .eq('group_id', groupId)
        .single()

      if (error) {
        console.warn('⚠️ Could not retrieve RAV from database for group, will calculate:', error)
        return 0
      }

      return data?.current_remaining_to_live ?? 0
    }

    return 0
  } catch (error) {
    console.error('❌ Exception while retrieving RAV from database:', error)
    return 0
  }
}

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

    const totalEstimatedIncome = (estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0) + profileSalary

    // 3. Récupérer tous les budgets estimés du profile
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date, cumulated_savings')
      .eq('profile_id', profileId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 4. Récupérer tous les revenus réels du profile
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id, description, entry_date')
      .eq('profile_id', profileId)

    console.log(`💵 [DEBUG DB QUERY] Revenus réels récupérés: ${realIncomes?.length || 0} entrées`)
    if (realIncomes && realIncomes.length > 0) {
      console.log(`💵 [DEBUG DB QUERY] Détail des revenus:`)
      realIncomes.forEach((income, idx) => {
        console.log(`   ${idx + 1}. ${income.amount}€ - ${income.description || 'Sans description'} (${income.entry_date})`)
      })
    }

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0
    console.log(`💵 [DEBUG DB QUERY] TOTAL revenus réels: ${totalRealIncome}€`)

    // 5. Récupérer toutes les dépenses réelles du profile
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional, description, expense_date, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
      .eq('profile_id', profileId)

    console.log(`💸 [DEBUG DB QUERY] Dépenses réelles récupérées: ${realExpenses?.length || 0} entrées`)
    if (realExpenses && realExpenses.length > 0) {
      console.log(`💸 [DEBUG DB QUERY] Détail des dépenses:`)
      realExpenses.forEach((expense, idx) => {
        console.log(`   ${idx + 1}. ${expense.amount}€ - ${expense.description || 'Sans description'} (${expense.expense_date}) ${expense.is_exceptional ? '[EXCEPTIONNELLE]' : ''}`)
      })
    }

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0
    console.log(`💸 [DEBUG DB QUERY] TOTAL dépenses réelles: ${totalRealExpenses}€`)

    // 5. Calculer les dépenses exceptionnelles (non liées à un budget)
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5.1. Calculer les dépenses réelles liées aux budgets (pour nouvelles règles)
    const realExpensesOnBudgets = realExpenses
      ?.filter(expense => !expense.is_exceptional && expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5.2. Calculer les revenus exceptionnels (non liés à un revenu estimé)
    const totalExceptionalIncomes = realIncomes
      ?.filter(income => !income.estimated_income_id)
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
        const spentOnBudget = realExpenses
          ?.filter(expense => !expense.is_exceptional && expense.estimated_budget_id === budget.id)
          ?.reduce((sum, expense) => {
            const amountFromBudget = expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
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
          console.log(`⚠️ [Budget Deficit] "${budget.name}": ${budget.estimated_amount}€ budgété, ${totalSpent}€ dépensé → Déficit: ${deficit}€`)
        }

        totalBudgetDeficits += deficit
      }
    }
    console.log(`🔍 [DEBUG getProfileFinancialData] Total déficits des budgets: ${totalBudgetDeficits}€`)

    // 7. Appliquer les règles de calcul SIMPLIFIÉES
    // Utiliser la fonction dédiée pour calculer le solde disponible
    console.log('📊 [getProfileFinancialData] Calcul du solde disponible pour le profil:', profileId)
    const availableBalance = calculateAvailableCash(userBankBalance, totalRealIncome, totalRealExpenses)

    // Calculer la contribution des revenus au RAV selon les règles métier
    console.log(`🔍 [DEBUG getProfileFinancialData] Calcul contribution revenus pour profile ${profileId}`)
    const incomeCompensation = await calculateIncomeCompensationProfile(profileId)
    // Ajouter le salaire du profil comme revenu (toujours à 100%, pas de "real income" lié)
    const incomeContribution = incomeCompensation + profileSalary
    console.log(`🔍 [DEBUG getProfileFinancialData] Contribution revenus calculée: ${incomeCompensation}€ + salaire ${profileSalary}€ = ${incomeContribution}€`)

    console.log(`🔍 [DEBUG getProfileFinancialData] DONNÉES POUR CALCUL RAV:`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - incomeContribution: ${incomeContribution}€`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - totalExceptionalIncomes: ${totalExceptionalIncomes}€`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - totalEstimatedBudgets: ${totalEstimatedBudgets}€`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - exceptionalExpenses: ${exceptionalExpenses}€`)
    console.log(`🔍 [DEBUG getProfileFinancialData] - totalBudgetDeficits: ${totalBudgetDeficits}€`)

    // NOUVELLE LOGIQUE CORRECTE: RAV = Revenus + Revenus Exceptionnels - Budgets - Dépenses Exceptionnelles - Déficits des Budgets
    const remainingToLive = await calculateRemainingToLiveProfile(
      incomeContribution,
      totalExceptionalIncomes,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalBudgetDeficits
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
    console.log(`   - Dépenses réelles (${realExpenses?.length || 0} entrées): ${totalRealExpenses}€`)
    console.log(``)
    console.log(`📈 CALCULS DÉRIVÉS:`)
    console.log(`   - Solde disponible: ${userBankBalance} + ${totalRealIncome} - ${totalRealExpenses} = ${availableBalance}€`)
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
      totalRealExpenses
    }

  } catch (error) {
    console.error('❌ Erreur lors du calcul des données financières:', error)
    // Retourner des valeurs par défaut en cas d'erreur
    return {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0
    }
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

    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0

    // 2. Récupérer les budgets estimés du groupe
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date, cumulated_savings')
      .eq('group_id', groupId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 3. Récupérer les revenus réels du groupe
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq('group_id', groupId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 4. Récupérer les dépenses réelles du groupe
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
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
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 6.1. Calculer les dépenses réelles liées aux budgets (pour nouvelles règles)
    const realExpensesOnBudgets = realExpenses
      ?.filter(expense => !expense.is_exceptional && expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 6.2. Calculer les revenus exceptionnels (non liés à un revenu estimé)
    const totalExceptionalIncomes = realIncomes
      ?.filter(income => !income.estimated_income_id)
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
        const spentOnBudget = realExpenses
          ?.filter(expense => !expense.is_exceptional && expense.estimated_budget_id === budget.id)
          ?.reduce((sum, expense) => {
            const amountFromBudget = expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
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
          console.log(`⚠️ [Budget Deficit] "${budget.name}": ${budget.estimated_amount}€ budgété, ${totalSpent}€ dépensé → Déficit: ${deficit}€`)
        }

        totalBudgetDeficits += deficit
      }
    }
    console.log(`🔍 [DEBUG getGroupFinancialData] Total déficits des budgets: ${totalBudgetDeficits}€`)

    // 8. Récupérer les contributions des profiles du groupe
    const { data: groupContributions } = await supabaseServer
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', groupId)

    const totalProfileContributions = groupContributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // 9. Appliquer les règles de calcul SIMPLIFIÉES pour groupe
    // Utiliser la fonction dédiée pour calculer le solde disponible du groupe
    console.log('📊 [getGroupFinancialData] Calcul du solde disponible pour le groupe:', groupId)
    const availableBalance = calculateAvailableCash(totalGroupBankBalance, totalRealIncome, totalRealExpenses)

    // Calculer la contribution des revenus au RAV selon les règles métier
    const incomeContribution = await calculateIncomeCompensationGroup(groupId)

    // NOUVELLE LOGIQUE CORRECTE: RAV = Revenus + Revenus Exceptionnels + Contributions - Budgets - Dépenses Exceptionnelles - Déficits des Budgets
    const remainingToLive = await calculateRemainingToLiveGroup(
      incomeContribution,
      totalExceptionalIncomes,
      totalProfileContributions,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalBudgetDeficits
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
      totalSavings
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
      totalRealExpenses
    }

  } catch (error) {
    console.error('❌ Erreur lors du calcul des données financières du groupe:', error)
    return {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0
    }
  }
}

/**
 * Récupère le détail des économies par budget pour un profile
 */
export async function getBudgetSavingsDetail(profileId: string): Promise<BudgetSavings[]> {
  try {
    const { data: budgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, monthly_surplus, carryover_spent_amount, carryover_applied_date')
      .eq('profile_id', profileId)

    if (!budgets) return []

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
      .eq('profile_id', profileId)
      .not('estimated_budget_id', 'is', null)

    const result: BudgetSavings[] = []

    for (const budget of budgets) {
      // Only count amount_from_budget (not piggy bank or savings)
      const realExpensesThisMonth = expenses
        ?.filter(expense => expense.estimated_budget_id === budget.id)
        ?.reduce((sum, expense) => {
          // Use amount_from_budget if available, otherwise use amount (backward compatibility)
          const amountFromBudget = expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
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

      console.log(`📊 [getBudgetSavingsDetail] "${budget.name}": ${realExpensesThisMonth}€ réel + ${carryoverSpent}€ carryover = ${totalSpentThisMonth}€ total`)

      result.push({
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedAmount: budget.estimated_amount,
        spentThisMonth: totalSpentThisMonth, // Maintenant inclut le carryover
        savings
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

/**
 * Sauvegarde automatique du reste à vivre pour un profile après modification de planification
 */
export async function saveRemainingToLiveSnapshotProfile(
  profileId: string,
  reason: string
): Promise<boolean> {
  try {
    console.log(`📊 Sauvegarde du reste à vivre pour le profile ${profileId}, raison: ${reason}`)

    // 1. Calculer les données financières actuelles
    const financialData = await getProfileFinancialData(profileId)

    // 2. Insérer le snapshot en base
    const { error } = await supabaseServer
      .from('remaining_to_live_snapshots')
      .insert({
        profile_id: profileId,
        remaining_to_live: financialData.remainingToLive,
        available_balance: financialData.availableBalance,
        total_savings: financialData.totalSavings,
        total_estimated_income: financialData.totalEstimatedIncome,
        total_estimated_budgets: financialData.totalEstimatedBudgets,
        total_real_income: financialData.totalRealIncome,
        total_real_expenses: financialData.totalRealExpenses,
        snapshot_reason: reason
      })

    if (error) {
      console.error('❌ Erreur lors de la sauvegarde du snapshot:', error)
      return false
    }

    console.log(`✅ Snapshot sauvegardé - Reste à vivre: ${financialData.remainingToLive}€`)
    return true

  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde du snapshot profile:', error)
    return false
  }
}

/**
 * Sauvegarde automatique du reste à vivre pour un groupe après modification de planification
 */
export async function saveRemainingToLiveSnapshotGroup(
  groupId: string,
  reason: string
): Promise<boolean> {
  try {
    console.log(`📊 Sauvegarde du reste à vivre pour le groupe ${groupId}, raison: ${reason}`)

    // 1. Calculer les données financières actuelles du groupe
    const financialData = await getGroupFinancialData(groupId)

    // 2. Insérer le snapshot en base
    const { error } = await supabaseServer
      .from('remaining_to_live_snapshots')
      .insert({
        group_id: groupId,
        remaining_to_live: financialData.remainingToLive,
        available_balance: financialData.availableBalance,
        total_savings: financialData.totalSavings,
        total_estimated_income: financialData.totalEstimatedIncome,
        total_estimated_budgets: financialData.totalEstimatedBudgets,
        total_real_income: financialData.totalRealIncome,
        total_real_expenses: financialData.totalRealExpenses,
        snapshot_reason: reason
      })

    if (error) {
      console.error('❌ Erreur lors de la sauvegarde du snapshot groupe:', error)
      return false
    }

    console.log(`✅ Snapshot groupe sauvegardé - Reste à vivre: ${financialData.remainingToLive}€`)
    return true

  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde du snapshot groupe:', error)
    return false
  }
}

/**
 * Sauvegarde intelligente qui détecte automatiquement si c'est un profile ou un groupe
 * en fonction des paramètres fournis lors de la modification de planification
 */
export async function saveRemainingToLiveSnapshot(
  options: {
    profileId?: string
    groupId?: string
    reason: string
  }
): Promise<boolean> {
  const { profileId, groupId, reason } = options

  // Validation: doit avoir soit profileId soit groupId
  if (!profileId && !groupId) {
    console.error('❌ Erreur: profileId ou groupId requis pour la sauvegarde')
    return false
  }

  if (profileId && groupId) {
    console.error('❌ Erreur: profileId et groupId ne peuvent pas être fournis simultanément')
    return false
  }

  // Appeler la fonction appropriée
  if (profileId) {
    return await saveRemainingToLiveSnapshotProfile(profileId, reason)
  } else if (groupId) {
    return await saveRemainingToLiveSnapshotGroup(groupId, reason)
  }

  return false
}

/**
 * Récupère l'historique des snapshots pour un profile
 */
export async function getRemainingToLiveHistory(
  profileId: string,
  limit: number = 50
): Promise<RemainingToLiveSnapshot[]> {
  try {
    const { data, error } = await supabaseServer
      .from('remaining_to_live_snapshots')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('❌ Erreur lors de la récupération de l\'historique:', error)
      return []
    }

    return data?.map(snapshot => ({
      id: snapshot.id,
      profileId: snapshot.profile_id,
      groupId: snapshot.group_id,
      remainingToLive: snapshot.remaining_to_live,
      availableBalance: snapshot.available_balance,
      totalSavings: snapshot.total_savings,
      totalEstimatedIncome: snapshot.total_estimated_income,
      totalEstimatedBudgets: snapshot.total_estimated_budgets,
      totalRealIncome: snapshot.total_real_income,
      totalRealExpenses: snapshot.total_real_expenses,
      snapshotReason: snapshot.snapshot_reason,
      createdAt: snapshot.created_at
    })) || []

  } catch (error) {
    console.error('❌ Erreur lors de la récupération de l\'historique:', error)
    return []
  }
}

/**
 * Récupère l'historique des snapshots pour un groupe
 */
export async function getGroupRemainingToLiveHistory(
  groupId: string,
  limit: number = 50
): Promise<RemainingToLiveSnapshot[]> {
  try {
    const { data, error } = await supabaseServer
      .from('remaining_to_live_snapshots')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('❌ Erreur lors de la récupération de l\'historique groupe:', error)
      return []
    }

    return data?.map(snapshot => ({
      id: snapshot.id,
      profileId: snapshot.profile_id,
      groupId: snapshot.group_id,
      remainingToLive: snapshot.remaining_to_live,
      availableBalance: snapshot.available_balance,
      totalSavings: snapshot.total_savings,
      totalEstimatedIncome: snapshot.total_estimated_income,
      totalEstimatedBudgets: snapshot.total_estimated_budgets,
      totalRealIncome: snapshot.total_real_income,
      totalRealExpenses: snapshot.total_real_expenses,
      snapshotReason: snapshot.snapshot_reason,
      createdAt: snapshot.created_at
    })) || []

  } catch (error) {
    console.error('❌ Erreur lors de la récupération de l\'historique groupe:', error)
    return []
  }
}