'use client'

import { useCallback, useMemo } from 'react'
import { useRealExpenses, type RealExpense } from '@/hooks/useRealExpenses'
import { computePeriodDateRange, type Period } from '@/lib/finance/period'

/**
 * Interface pour la progression d'un budget
 */
export interface BudgetProgress {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentAmount: number
  percentage: number
  savings: number
  /** Sprint Carryover-Self-Healing UI (2026-05-26). Montant `carryover_spent_amount`
   *  du budget (dette reportée du recap précédent). Quand > 0, le card affiche
   *  un badge "↩ Reporté du mois précédent : X €" pour expliquer pourquoi
   *  spentAmount inclut une part déjà consommée. Sémantique self-healing :
   *  `bilan_deficit = max(0, carryover + spent - estimated)` → la marge libre
   *  du budget absorbe le carryover, et au prochain finalize il décroît
   *  jusqu'à 0 (overwrite RPC). */
  carryoverSpentAmount: number
  colorClass: string
  textColorClass: string
}

/**
 * Interface pour un budget estimé (simplifié)
 */
interface EstimatedBudget {
  id: string
  name: string
  estimated_amount: number
  monthly_surplus?: number // Champ legacy, plus utilisé
  /** Sprint Carryover-Self-Healing (2026-05-26) — utilisé : la dette reportée
   *  du recap précédent. L'API `/api/finance/budgets/estimated` l'inclut dans
   *  `spent_this_month` (carryover + actualSpent), et le hook l'expose
   *  séparément sur BudgetProgress pour l'affichage badge. */
  carryover_spent_amount?: number
  carryover_applied_date?: string
  spent_this_month?: number // Dépenses réelles du mois (inclut carryover via API)
  cumulated_savings?: number // Économies cumulées
  last_savings_update?: string // Date de dernière mise à jour des économies
}

interface UseBudgetProgressReturn {
  budgetProgresses: BudgetProgress[]
  loading: boolean
  isFetching: boolean
  error: string | null
  refreshProgress: () => Promise<void>
  getBudgetProgress: (budgetId: string) => BudgetProgress | undefined
}

/**
 * Détermine la classe de couleur selon le pourcentage de consommation du budget
 * Règles:
 * - 0% : noir
 * - >1% : jaune foncé
 * - 100% : bleu
 * - >100% : rouge
 */
const getBudgetColorClass = (
  percentage: number,
): { colorClass: string; textColorClass: string } => {
  if (percentage === 0) {
    return { colorClass: 'bg-gray-100', textColorClass: 'text-gray-900' }
  } else if (percentage > 0 && percentage < 100) {
    return { colorClass: 'bg-yellow-100', textColorClass: 'text-yellow-800' }
  } else if (percentage === 100) {
    return { colorClass: 'bg-blue-100', textColorClass: 'text-blue-800' }
  } else {
    return { colorClass: 'bg-red-100', textColorClass: 'text-red-800' }
  }
}

/**
 * Hook pour calculer la progression des budgets estimés
 * Calcule pour chaque budget le montant dépensé, pourcentage, économies et code couleur
 *
 * Sprint P1 — accepte un `period` optionnel. Quand fourni et différent de
 * 'month', les expenses sont filtrées CSR par `expense_date` dans le range
 * calculé via computePeriodDateRange (lundi-dimanche pour 'week', today pour
 * 'day'). 'month' = pas de filtre, sémantique "depuis dernier recap"
 * préservée. Le `estimatedAmount` (budget mensuel) reste inchangé : le
 * `spentAmount` reflète la sous-période vs cap mensuel.
 *
 * @param budgets - Liste des budgets estimés
 * @param context - Contexte profile ou group
 * @param period - Période optionnelle (default 'month' = no filter)
 */
export function useBudgetProgress(
  budgets: EstimatedBudget[],
  context?: 'profile' | 'group',
  period?: Period,
): UseBudgetProgressReturn {
  // Hook pour récupérer les dépenses réelles
  const {
    expenses,
    loading: expensesLoading,
    isFetching: expensesFetching,
    error: expensesError,
    refreshExpenses,
  } = useRealExpenses(context)

  /**
   * Calcule la progression pour tous les budgets
   */
  const calculateBudgetProgresses = useCallback(
    (budgets: EstimatedBudget[], expenses: RealExpense[]): BudgetProgress[] => {
      return budgets.map((budget) => {
        // Trouver toutes les dépenses liées à ce budget
        const relatedExpenses = expenses.filter(
          (expense) => expense.estimated_budget_id === budget.id,
        )

        // Utiliser le montant déjà calculé par l'API (qui inclut le carryover)
        // ou recalculer si pas disponible
        // Ne compter QUE amount_from_budget (pas tirelire ni savings)
        const spentAmount =
          budget.spent_this_month !== undefined
            ? budget.spent_this_month
            : relatedExpenses.reduce((sum, expense) => {
                // Use amount_from_budget if available, otherwise use amount (backward compatibility)
                const amountFromBudget =
                  expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
                    ? parseFloat(expense.amount_from_budget.toString())
                    : parseFloat(expense.amount.toString())
                return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
              }, 0)

        // Calculer le pourcentage de consommation
        const percentage =
          budget.estimated_amount > 0
            ? Math.round((spentAmount / budget.estimated_amount) * 100 * 100) / 100 // 2 décimales
            : 0

        // Utiliser les économies cumulées du budget
        const savings = budget.cumulated_savings || 0

        // Déterminer les classes de couleur
        const { colorClass, textColorClass } = getBudgetColorClass(percentage)

        return {
          budgetId: budget.id,
          budgetName: budget.name,
          estimatedAmount: budget.estimated_amount,
          spentAmount,
          percentage,
          savings,
          carryoverSpentAmount: budget.carryover_spent_amount ?? 0,
          colorClass,
          textColorClass,
        }
      })
    },
    [],
  )

  // Filtre expenses par période (CSR) — Sprint P1.
  // computePeriodDateRange retourne null pour 'month' = pas de filtre.
  const filteredExpenses = useMemo<RealExpense[]>(() => {
    if (!period || period === 'month') return expenses
    const range = computePeriodDateRange(period)
    if (!range) return expenses
    return expenses.filter(
      (e) => e.expense_date >= range.startDate && e.expense_date <= range.endDate,
    )
  }, [expenses, period])

  // Source unique de vérité : calcul memorise a partir de budgets + filteredExpenses
  const budgetProgresses = useMemo<BudgetProgress[]>(() => {
    if (!budgets.length || expensesLoading) {
      return []
    }
    return calculateBudgetProgresses(budgets, filteredExpenses)
  }, [budgets, filteredExpenses, expensesLoading, calculateBudgetProgresses])

  /**
   * Rafraîchit les données de progression
   */
  const refreshProgress = useCallback(async () => {
    await refreshExpenses()
  }, [refreshExpenses])

  /**
   * Récupère la progression d'un budget spécifique par son ID
   */
  const getBudgetProgress = useCallback(
    (budgetId: string): BudgetProgress | undefined => {
      return budgetProgresses.find((progress) => progress.budgetId === budgetId)
    },
    [budgetProgresses],
  )

  return {
    budgetProgresses,
    loading: expensesLoading,
    isFetching: expensesFetching,
    error: expensesError,
    refreshProgress,
    getBudgetProgress,
  }
}
