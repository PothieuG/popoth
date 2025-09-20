'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRealIncomes, type RealIncome } from '@/hooks/useRealIncomes'

/**
 * Interface pour la progression d'un revenu
 */
export interface IncomeProgress {
  incomeId: string
  incomeName: string
  estimatedAmount: number
  receivedAmount: number
  percentage: number
  colorClass: string
  textColorClass: string
}

/**
 * Interface pour un revenu estimé (simplifié)
 */
interface EstimatedIncome {
  id: string
  name: string
  estimated_amount: number
}

interface UseIncomeProgressReturn {
  incomeProgresses: IncomeProgress[]
  loading: boolean
  error: string | null
  refreshProgress: () => Promise<void>
  getIncomeProgress: (incomeId: string) => IncomeProgress | undefined
}

/**
 * Détermine la classe de couleur selon le pourcentage de récupération du revenu
 * Règles:
 * - >= 90% et < 100% : jaune foncé (dans les 10% près)
 * - < 90% : rouge (en dessous de la valeur acceptable)
 * - = 100% : bleu (valeur exacte)
 * - > 100% : vert (au-dessus)
 */
const getIncomeColorClass = (percentage: number): { colorClass: string; textColorClass: string } => {
  if (percentage >= 90 && percentage < 100) {
    return { colorClass: 'bg-yellow-100', textColorClass: 'text-yellow-800' }
  } else if (percentage < 90) {
    return { colorClass: 'bg-red-100', textColorClass: 'text-red-800' }
  } else if (percentage === 100) {
    return { colorClass: 'bg-blue-100', textColorClass: 'text-blue-800' }
  } else {
    return { colorClass: 'bg-green-100', textColorClass: 'text-green-800' }
  }
}

/**
 * Hook pour calculer la progression des revenus estimés
 * Calcule pour chaque revenu le montant reçu, pourcentage, surplus et code couleur
 *
 * @param incomes - Liste des revenus estimés
 * @param context - Contexte profile ou group
 */
export function useIncomeProgress(
  incomes: EstimatedIncome[],
  context?: 'profile' | 'group'
): UseIncomeProgressReturn {
  const [incomeProgresses, setIncomeProgresses] = useState<IncomeProgress[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hook pour récupérer les revenus réels
  const {
    incomes: realIncomes,
    loading: incomesLoading,
    error: incomesError,
    refreshIncomes
  } = useRealIncomes(context)

  /**
   * Calcule la progression pour tous les revenus
   */
  const calculateIncomeProgresses = useCallback(
    (incomes: EstimatedIncome[], realIncomes: RealIncome[]): IncomeProgress[] => {
      return incomes.map(income => {
        // Trouver tous les revenus réels liés à ce revenu estimé
        const relatedIncomes = realIncomes.filter(
          realIncome => realIncome.estimated_income_id === income.id
        )

        // Calculer le montant total reçu pour ce revenu
        const receivedAmount = relatedIncomes.reduce(
          (sum, realIncome) => sum + realIncome.amount, 0
        )

        // Calculer le pourcentage de récupération
        const percentage = income.estimated_amount > 0
          ? Math.round((receivedAmount / income.estimated_amount) * 100 * 100) / 100 // 2 décimales
          : 0

        // Note: Le surplus n'est plus calculé ici car cette feature sera implémentée plus tard

        // Déterminer les classes de couleur
        const { colorClass, textColorClass } = getIncomeColorClass(percentage)

        return {
          incomeId: income.id,
          incomeName: income.name,
          estimatedAmount: income.estimated_amount,
          receivedAmount,
          percentage,
          colorClass,
          textColorClass
        }
      })
    },
    []
  )

  // Calculer les progressions quand les revenus estimés ou réels changent
  const calculatedProgresses = useMemo(() => {
    if (!incomes.length || incomesLoading) {
      return []
    }
    return calculateIncomeProgresses(incomes, realIncomes)
  }, [incomes, realIncomes, incomesLoading, calculateIncomeProgresses])

  // Mettre à jour l'état quand les calculs changent
  useEffect(() => {
    setIncomeProgresses(calculatedProgresses)
    setLoading(incomesLoading)
    setError(incomesError)
  }, [calculatedProgresses, incomesLoading, incomesError])

  /**
   * Rafraîchit les données de progression
   */
  const refreshProgress = useCallback(async () => {
    await refreshIncomes()
  }, [refreshIncomes])

  /**
   * Récupère la progression d'un revenu spécifique par son ID
   */
  const getIncomeProgress = useCallback((incomeId: string): IncomeProgress | undefined => {
    return incomeProgresses.find(progress => progress.incomeId === incomeId)
  }, [incomeProgresses])

  return {
    incomeProgresses,
    loading,
    error,
    refreshProgress,
    getIncomeProgress
  }
}