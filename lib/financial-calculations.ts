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
 * Règle reste à vivre pour PROFILES (nouvelle règle 2025 + améliorations 2025-09-20):
 * "l'ensemble des entrées d'argent moins ce qui a été budgété pour le mois
 * moins les dépenses non-budgété (exceptionnelles)"
 *
 * NOUVELLES RÈGLES AJOUTÉES:
 * - Si budget dépassé (dépenses réelles > budgets estimés): déduction de la différence
 * - Si bonus revenus (revenus réels > revenus estimés): ajout de la différence
 * - Calcul précis des bonus par revenu associé (pas global)
 */
export function calculateRemainingToLiveProfile(
  estimatedIncomes: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  realIncomes?: number,
  realExpensesOnBudgets?: number,
  incomeBonus?: number
): number {
  let remainingToLive = estimatedIncomes - estimatedBudgets - exceptionalExpenses

  // NOUVELLE RÈGLE 1: Déduction si budget dépassé
  // Si les dépenses réelles sur budgets > budgets estimés, déduire la différence
  if (realExpensesOnBudgets !== undefined && realExpensesOnBudgets > estimatedBudgets) {
    const budgetOverrun = realExpensesOnBudgets - estimatedBudgets
    remainingToLive -= budgetOverrun
    console.log(`📉 [calculateRemainingToLiveProfile] Budget dépassé de ${budgetOverrun}€, déduction appliquée`)
  }

  // NOUVELLE RÈGLE 2: Addition des bonus revenus calculés précisément
  // Utilise le bonus calculé par getProfileFinancialData basé sur les revenus associés
  if (incomeBonus !== undefined && incomeBonus > 0) {
    remainingToLive += incomeBonus
    console.log(`📈 [calculateRemainingToLiveProfile] Bonus revenus précis de ${incomeBonus}€, addition appliquée`)
  }

  console.log(`💰 [calculateRemainingToLiveProfile] Calcul final: ${remainingToLive}€`)
  return remainingToLive
}

/**
 * Règle reste à vivre pour GROUPS (nouvelle règle 2025 + améliorations 2025-09-20):
 * "l'ensemble des entrées d'argent estimées et entrées réelles (les contributions des profiles du groupe + entrées d'argent exceptionnels),
 * moins l'ensemble de ce qui a été budgété moins les dépenses non-budgétées (ou réelles dépenses qui ne sont pas liées à un budget)"
 *
 * NOUVELLES RÈGLES AJOUTÉES:
 * - Si budget dépassé (dépenses réelles > budgets estimés): déduction de la différence
 * - Si bonus revenus (revenus réels totaux > revenus estimés): ajout de la différence
 * - Calcul précis des bonus par revenu associé (pas global)
 */
export function calculateRemainingToLiveGroup(
  estimatedIncomes: number,
  realIncomes: number,
  profileContributions: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  realExpensesOnBudgets?: number,
  incomeBonus?: number
): number {
  const totalIncomes = estimatedIncomes + realIncomes + profileContributions
  let remainingToLive = totalIncomes - estimatedBudgets - exceptionalExpenses

  // NOUVELLE RÈGLE 1: Déduction si budget dépassé
  // Si les dépenses réelles sur budgets > budgets estimés, déduire la différence
  if (realExpensesOnBudgets !== undefined && realExpensesOnBudgets > estimatedBudgets) {
    const budgetOverrun = realExpensesOnBudgets - estimatedBudgets
    remainingToLive -= budgetOverrun
    console.log(`📉 [calculateRemainingToLiveGroup] Budget dépassé de ${budgetOverrun}€, déduction appliquée`)
  }

  // NOUVELLE RÈGLE 2: Addition des bonus revenus calculés précisément
  // Utilise le bonus calculé par getGroupFinancialData basé sur les revenus associés
  if (incomeBonus !== undefined && incomeBonus > 0) {
    remainingToLive += incomeBonus
    console.log(`📈 [calculateRemainingToLiveGroup] Bonus revenus précis de ${incomeBonus}€, addition appliquée`)
  }

  console.log(`💰 [calculateRemainingToLiveGroup] Calcul final: ${remainingToLive}€`)
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

// ============================================
// FONCTIONS DE RÉCUPÉRATION DE DONNÉES
// ============================================

/**
 * Récupère les données financières pour un utilisateur (profile)
 */
export async function getProfileFinancialData(profileId: string): Promise<FinancialData> {
  try {

    // 1. Récupérer le solde bancaire éditable de l'utilisateur
    const { data: bankBalance } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', profileId)
      .single()

    const userBankBalance = bankBalance?.balance || 0

    // 2. Récupérer tous les revenus estimés du profile
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('estimated_amount')
      .eq('profile_id', profileId)

    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0

    // 3. Récupérer tous les budgets estimés du profile
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount')
      .eq('profile_id', profileId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 4. Récupérer tous les revenus réels du profile
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .eq('profile_id', profileId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 5. Récupérer toutes les dépenses réelles du profile
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional')
      .eq('profile_id', profileId)

    const totalRealExpenses = realExpenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5. Calculer les dépenses exceptionnelles (non liées à un budget)
    const exceptionalExpenses = realExpenses
      ?.filter(expense => expense.is_exceptional || !expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5.1. Calculer les dépenses réelles liées aux budgets (pour nouvelles règles)
    const realExpensesOnBudgets = realExpenses
      ?.filter(expense => !expense.is_exceptional && expense.estimated_budget_id)
      ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    // 5.2. Calculer le bonus revenus précis par revenu associé
    let totalIncomeBonus = 0
    if (estimatedIncomes && realIncomes) {
      // Récupérer les revenus réels avec leur estimation associée
      const { data: realIncomesWithEstimated } = await supabaseServer
        .from('real_income_entries')
        .select(`
          amount,
          estimated_income_id,
          estimated_income:estimated_incomes(estimated_amount)
        `)
        .eq('profile_id', profileId)
        .not('estimated_income_id', 'is', null)

      if (realIncomesWithEstimated) {
        // Grouper les revenus réels par estimation
        const groupedByEstimated = realIncomesWithEstimated.reduce((acc, income) => {
          const estimatedId = income.estimated_income_id!
          if (!acc[estimatedId]) {
            acc[estimatedId] = {
              totalReal: 0,
              estimatedAmount: (income.estimated_income as any)?.estimated_amount || 0
            }
          }
          acc[estimatedId].totalReal += income.amount
          return acc
        }, {} as Record<string, { totalReal: number; estimatedAmount: number }>)

        // Calculer les bonus pour chaque revenu estimé
        for (const [estimatedId, data] of Object.entries(groupedByEstimated)) {
          if (data.totalReal > data.estimatedAmount) {
            const bonus = data.totalReal - data.estimatedAmount
            totalIncomeBonus += bonus
            console.log(`📈 [getProfileFinancialData] Bonus revenu ${estimatedId}: ${bonus}€ (${data.totalReal}€ - ${data.estimatedAmount}€)`)
          }
        }
      }
    }

    // 6. Calculer les économies pour chaque budget
    let totalSavings = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget = realExpenses
          .filter(expense => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0)

        const budgetSavings = calculateBudgetSavings(budget.estimated_amount, spentOnBudget, false)
        totalSavings += budgetSavings
      }
    }

    // 7. Appliquer les règles de calcul du battleplan avec nouvelles règles
    // Utiliser la fonction dédiée pour calculer le solde disponible
    console.log('📊 [getProfileFinancialData] Calcul du solde disponible pour le profil:', profileId)
    const availableBalance = calculateAvailableCash(userBankBalance, totalRealIncome, totalRealExpenses)
    const remainingToLive = calculateRemainingToLiveProfile(
      totalEstimatedIncome,
      totalEstimatedBudgets,
      exceptionalExpenses,
      totalRealIncome,
      realExpensesOnBudgets,
      totalIncomeBonus
    )

    // Calculs terminés
    console.log('💰 [getProfileFinancialData] Calculs financiers terminés pour le profil:', profileId)
    console.log('💰 [getProfileFinancialData] Détail des calculs:', {
      profileId,
      // Données de base
      userBankBalance,
      totalRealIncome,
      totalRealExpenses,
      // Résultat final
      availableBalance: `${userBankBalance} + ${totalRealIncome} - ${totalRealExpenses} = ${availableBalance}`,
      // Autres données
      totalEstimatedIncome,
      totalEstimatedBudgets,
      exceptionalExpenses,
      remainingToLive,
      totalSavings
    })

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
      .select('id, name, estimated_amount')
      .eq('group_id', groupId)

    const totalEstimatedBudgets = estimatedBudgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0

    // 3. Récupérer les revenus réels du groupe
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .eq('group_id', groupId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0

    // 4. Récupérer les dépenses réelles du groupe
    const { data: realExpenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id, is_exceptional')
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

    // 6.2. Calculer le bonus revenus précis par revenu associé pour le groupe
    let totalIncomeBonus = 0
    if (estimatedIncomes && realIncomes) {
      // Récupérer les revenus réels du groupe avec leur estimation associée
      const { data: realIncomesWithEstimated } = await supabaseServer
        .from('real_income_entries')
        .select(`
          amount,
          estimated_income_id,
          estimated_income:estimated_incomes(estimated_amount)
        `)
        .eq('group_id', groupId)
        .not('estimated_income_id', 'is', null)

      if (realIncomesWithEstimated) {
        // Grouper les revenus réels par estimation
        const groupedByEstimated = realIncomesWithEstimated.reduce((acc, income) => {
          const estimatedId = income.estimated_income_id!
          if (!acc[estimatedId]) {
            acc[estimatedId] = {
              totalReal: 0,
              estimatedAmount: (income.estimated_income as any)?.estimated_amount || 0
            }
          }
          acc[estimatedId].totalReal += income.amount
          return acc
        }, {} as Record<string, { totalReal: number; estimatedAmount: number }>)

        // Calculer les bonus pour chaque revenu estimé du groupe
        for (const [estimatedId, data] of Object.entries(groupedByEstimated)) {
          if (data.totalReal > data.estimatedAmount) {
            const bonus = data.totalReal - data.estimatedAmount
            totalIncomeBonus += bonus
            console.log(`📈 [getGroupFinancialData] Bonus revenu groupe ${estimatedId}: ${bonus}€ (${data.totalReal}€ - ${data.estimatedAmount}€)`)
          }
        }
      }
    }

    // 7. Calculer les économies des budgets
    let totalSavings = 0
    if (estimatedBudgets && realExpenses) {
      for (const budget of estimatedBudgets) {
        const spentOnBudget = realExpenses
          .filter(expense => expense.estimated_budget_id === budget.id)
          .reduce((sum, expense) => sum + expense.amount, 0)

        const budgetSavings = calculateBudgetSavings(budget.estimated_amount, spentOnBudget, false)
        totalSavings += budgetSavings
      }
    }

    // 8. Récupérer les contributions des profiles du groupe
    const { data: groupContributions } = await supabaseServer
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', groupId)

    const totalProfileContributions = groupContributions?.reduce((sum, contrib) => sum + contrib.contribution_amount, 0) || 0

    // 9. Appliquer les règles de calcul pour groupe avec nouvelles règles
    // Utiliser la fonction dédiée pour calculer le solde disponible du groupe
    console.log('📊 [getGroupFinancialData] Calcul du solde disponible pour le groupe:', groupId)
    const availableBalance = calculateAvailableCash(totalGroupBankBalance, totalRealIncome, totalRealExpenses)
    const remainingToLive = calculateRemainingToLiveGroup(
      totalEstimatedIncome,
      totalRealIncome,
      totalProfileContributions,
      totalEstimatedBudgets,
      exceptionalExpenses,
      realExpensesOnBudgets,
      totalIncomeBonus
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
      remainingToLive,
      totalSavings
    })

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
      .select('id, name, estimated_amount')
      .eq('profile_id', profileId)

    if (!budgets) return []

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, estimated_budget_id')
      .eq('profile_id', profileId)
      .not('estimated_budget_id', 'is', null)

    const result: BudgetSavings[] = []

    for (const budget of budgets) {
      const spentThisMonth = expenses
        ?.filter(expense => expense.estimated_budget_id === budget.id)
        ?.reduce((sum, expense) => sum + expense.amount, 0) || 0

      const savings = calculateBudgetSavings(budget.estimated_amount, spentThisMonth, false)

      result.push({
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedAmount: budget.estimated_amount,
        spentThisMonth,
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