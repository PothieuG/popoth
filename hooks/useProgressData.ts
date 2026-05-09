'use client'

import { useQuery } from '@tanstack/react-query'

interface ExpenseProgress {
  budgetId: string
  budgetName: string
  spentAmount: number
  estimatedAmount: number
  remainingAmount: number
  economyAmount: number
}

interface IncomeProgress {
  incomeId: string
  incomeName: string
  receivedAmount: number
  estimatedAmount: number
  bonusAmount: number
}

interface UseProgressDataReturn {
  expenseProgress: Record<string, ExpenseProgress>
  incomeProgress: Record<string, IncomeProgress>
  loading: boolean
  error: string | null
  refreshProgressData: () => Promise<void>
}

interface ProgressDataPayload {
  expense: Record<string, ExpenseProgress>
  income: Record<string, IncomeProgress>
}

/**
 * Hook pour récupérer les données de progression des budgets et revenus
 */
export function useProgressData(context?: 'profile' | 'group'): UseProgressDataReturn {
  const { data, isLoading, error, refetch } = useQuery<ProgressDataPayload>({
    queryKey: ['progress-data', context ?? null],
    queryFn: async () => {
      const contextParam = context ? `?context=${context}` : ''

      const [expenseResponse, incomeResponse] = await Promise.all([
        fetch(`/api/finance/expenses/progress${contextParam}`, {
          method: 'GET',
          credentials: 'include',
        }),
        fetch(`/api/finance/income/progress${contextParam}`, {
          method: 'GET',
          credentials: 'include',
        }),
      ])

      if (!expenseResponse.ok || !incomeResponse.ok) {
        throw new Error('Erreur lors de la récupération des données de progression')
      }

      const [expenseData, incomeData] = await Promise.all([
        expenseResponse.json(),
        incomeResponse.json(),
      ])

      const expense: Record<string, ExpenseProgress> = {}
      expenseData.forEach((item: ExpenseProgress) => {
        expense[item.budgetId] = item
      })

      const income: Record<string, IncomeProgress> = {}
      incomeData.forEach((item: IncomeProgress) => {
        income[item.incomeId] = item
      })

      return { expense, income }
    },
  })

  return {
    expenseProgress: data?.expense ?? {},
    incomeProgress: data?.income ?? {},
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refreshProgressData: async () => {
      await refetch()
    },
  }
}
