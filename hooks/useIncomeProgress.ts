'use client'

import { useCallback, useMemo } from 'react'
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
  isFetching: boolean
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
const getIncomeColorClass = (
  percentage: number,
): { colorClass: string; textColorClass: string } => {
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

function calculateIncomeProgresses(
  incomes: EstimatedIncome[],
  realIncomes: RealIncome[],
): IncomeProgress[] {
  return incomes.map((income) => {
    const relatedIncomes = realIncomes.filter(
      (realIncome) => realIncome.estimated_income_id === income.id,
    )

    const receivedAmount = relatedIncomes.reduce((sum, realIncome) => sum + realIncome.amount, 0)

    const percentage =
      income.estimated_amount > 0
        ? Math.round((receivedAmount / income.estimated_amount) * 100 * 100) / 100
        : 0

    const { colorClass, textColorClass } = getIncomeColorClass(percentage)

    return {
      incomeId: income.id,
      incomeName: income.name,
      estimatedAmount: income.estimated_amount,
      receivedAmount,
      percentage,
      colorClass,
      textColorClass,
    }
  })
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
  context?: 'profile' | 'group',
): UseIncomeProgressReturn {
  const {
    incomes: realIncomes,
    loading: incomesLoading,
    isFetching: incomesFetching,
    error: incomesError,
    refreshIncomes,
  } = useRealIncomes(context)

  const incomeProgresses = useMemo(() => {
    if (!incomes.length || incomesLoading) {
      return []
    }
    return calculateIncomeProgresses(incomes, realIncomes)
  }, [incomes, realIncomes, incomesLoading])

  const refreshProgress = useCallback(async () => {
    await refreshIncomes()
  }, [refreshIncomes])

  const getIncomeProgress = useCallback(
    (incomeId: string): IncomeProgress | undefined => {
      return incomeProgresses.find((progress) => progress.incomeId === incomeId)
    },
    [incomeProgresses],
  )

  return {
    incomeProgresses,
    loading: incomesLoading,
    isFetching: incomesFetching,
    error: incomesError,
    refreshProgress,
    getIncomeProgress,
  }
}
