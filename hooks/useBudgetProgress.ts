'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRealExpenses, type RealExpense } from '@/hooks/useRealExpenses'

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
}

interface UseBudgetProgressReturn {
  budgetProgresses: BudgetProgress[]
  loading: boolean
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
const getBudgetColorClass = (percentage: number): { colorClass: string; textColorClass: string } => {
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
 * @param budgets - Liste des budgets estimés
 * @param context - Contexte profile ou group
 */
export function useBudgetProgress(
  budgets: EstimatedBudget[],
  context?: 'profile' | 'group'
): UseBudgetProgressReturn {
  const [budgetProgresses, setBudgetProgresses] = useState<BudgetProgress[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hook pour récupérer les dépenses réelles
  const {
    expenses,
    loading: expensesLoading,
    error: expensesError,
    refreshExpenses
  } = useRealExpenses(context)

  /**
   * Calcule la progression pour tous les budgets
   */
  const calculateBudgetProgresses = useCallback(
    (budgets: EstimatedBudget[], expenses: RealExpense[]): BudgetProgress[] => {
      return budgets.map(budget => {
        // Trouver toutes les dépenses liées à ce budget
        const relatedExpenses = expenses.filter(
          expense => expense.estimated_budget_id === budget.id
        )

        // Calculer le montant total dépensé pour ce budget
        const spentAmount = relatedExpenses.reduce(
          (sum, expense) => sum + expense.amount, 0
        )

        // Calculer le pourcentage de consommation
        const percentage = budget.estimated_amount > 0
          ? Math.round((spentAmount / budget.estimated_amount) * 100 * 100) / 100 // 2 décimales
          : 0

        // Calculer les économies selon les règles financières:
        // En temps réel pendant le mois : toujours 0 (économies calculées seulement à la fin de la période)
        // Ref: financial-calculations.ts ligne 160-173
        const savings = 0

        // Déterminer les classes de couleur
        const { colorClass, textColorClass } = getBudgetColorClass(percentage)

        return {
          budgetId: budget.id,
          budgetName: budget.name,
          estimatedAmount: budget.estimated_amount,
          spentAmount,
          percentage,
          savings,
          colorClass,
          textColorClass
        }
      })
    },
    []
  )

  // Calculer les progressions quand les budgets ou dépenses changent
  const calculatedProgresses = useMemo(() => {
    if (!budgets.length || expensesLoading) {
      return []
    }
    return calculateBudgetProgresses(budgets, expenses)
  }, [budgets, expenses, expensesLoading, calculateBudgetProgresses])

  // Mettre à jour l'état quand les calculs changent
  useEffect(() => {
    setBudgetProgresses(calculatedProgresses)
    setLoading(expensesLoading)
    setError(expensesError)
  }, [calculatedProgresses, expensesLoading, expensesError])

  /**
   * Rafraîchit les données de progression
   */
  const refreshProgress = useCallback(async () => {
    await refreshExpenses()
  }, [refreshExpenses])

  /**
   * Récupère la progression d'un budget spécifique par son ID
   */
  const getBudgetProgress = useCallback((budgetId: string): BudgetProgress | undefined => {
    return budgetProgresses.find(progress => progress.budgetId === budgetId)
  }, [budgetProgresses])

  return {
    budgetProgresses,
    loading,
    error,
    refreshProgress,
    getBudgetProgress
  }
}