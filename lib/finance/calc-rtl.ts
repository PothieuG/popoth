/**
 * Pure calc helpers for "remaining to live" (RAV) and budget arithmetic.
 *
 * Extracted from lib/financial-calculations.ts at chantier I4. No I/O, no
 * Supabase, no env reads — formulas only. Side-effects limited to a single
 * `logger.debug` in calculateBudgetDeficit (informational, dev-only by
 * default per the LOG_LEVEL gate).
 *
 * Domain rules (battleplan.txt):
 * - RAV profile = revenus - budgets - dépenses exceptionnelles - déficits
 * - RAV group   = ditto + contributions groupe
 * - Budget savings = MAX(0, estimé - dépensé) only at end of period
 * - Budget deficit = MAX(0, dépensé - estimé)
 * - Available cash = banque + revenus réels - dépenses réelles
 *
 * NOTE: Les économies cumulées ont été SUPPRIMÉES de la formule RAV à la
 * demande utilisateur. Les déficits des budgets sont soustraits du RAV.
 */

import { logger } from '@/lib/logger'

/**
 * Calcul du solde disponible (peut être négatif, c'est un découvert).
 * Formule: solde_disponible = solde_bancaire_base + revenus_réels - dépenses_réelles
 */
export function calculateAvailableCash(
  bankBalance: number,
  realIncomes: number,
  realExpenses: number,
): number {
  return bankBalance + realIncomes - realExpenses
}

/**
 * RAV profile: revenu net + revenus exceptionnels - budgets - dépenses
 * exceptionnelles - déficits cumulés des budgets.
 */
export async function calculateRemainingToLiveProfile(
  totalIncomeContribution: number,
  exceptionalIncomes: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  budgetDeficits: number = 0,
): Promise<number> {
  return (
    totalIncomeContribution +
    exceptionalIncomes -
    estimatedBudgets -
    exceptionalExpenses -
    budgetDeficits
  )
}

/**
 * RAV group: identique au profile + contributions groupe (mensuel divisé
 * par membre).
 */
export async function calculateRemainingToLiveGroup(
  totalIncomeContribution: number,
  exceptionalIncomes: number,
  totalGroupContributions: number,
  estimatedBudgets: number,
  exceptionalExpenses: number,
  budgetDeficits: number = 0,
): Promise<number> {
  return (
    totalIncomeContribution +
    exceptionalIncomes +
    totalGroupContributions -
    estimatedBudgets -
    exceptionalExpenses -
    budgetDeficits
  )
}

/**
 * Économies d'un budget (battleplan ligne 28): "si je décide de budgéter
 * 200€ pour des courses pendant un mois et qu'en fait je ne dépense que
 * 150€, à la fin du mois, 50€ sera ajouté aux économies de ce budget".
 *
 * IMPORTANT: les économies ne sont calculées QU'À LA FIN DU MOIS/PÉRIODE,
 * pas en temps réel pendant le mois en cours. En temps réel = toujours 0.
 */
export function calculateBudgetSavings(
  estimatedAmount: number,
  spentThisMonth: number,
  isEndOfPeriod: boolean = false,
): number {
  if (!isEndOfPeriod) return 0
  return Math.max(0, estimatedAmount - spentThisMonth)
}

/**
 * Déficit d'un budget (dépassement). Soustrait du RAV.
 * Formule: Déficit = MAX(0, Dépenses Réelles - Budget Estimé).
 */
export function calculateBudgetDeficit(estimatedAmount: number, spentThisMonth: number): number {
  const deficit = Math.max(0, spentThisMonth - estimatedAmount)
  if (deficit > 0) {
    logger.debug(
      `[Budget Deficit] Budget dépassé: ${spentThisMonth}€ dépensé sur ${estimatedAmount}€ → Déficit: ${deficit}€`,
    )
  }
  return deficit
}
