'use client'

import { useQuery } from '@tanstack/react-query'

interface ExpenseProgress {
  budgetId: string
  spentAmount: number
  estimatedAmount: number
  remainingAmount: number
  economyAmount: number
}

interface UseExpenseProgressReturn {
  expenseProgress: Record<string, ExpenseProgress>
  loading: boolean
  error: string | null
  refreshExpenseProgress: () => Promise<void>
}

/**
 * Hook pour récupérer les données de progression des dépenses par budget
 */
export function useExpenseProgress(context?: 'profile' | 'group'): UseExpenseProgressReturn {
  const { data, isLoading, error, refetch } = useQuery<Record<string, ExpenseProgress>>({
    queryKey: ['expense-progress', context ?? null],
    queryFn: async () => {
      const url = context
        ? `/api/finance/expenses/progress?context=${context}`
        : '/api/finance/expenses/progress'

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`)
      }

      const items: ExpenseProgress[] = await response.json()
      const progressMap: Record<string, ExpenseProgress> = {}
      items.forEach((item) => {
        progressMap[item.budgetId] = item
      })
      return progressMap
    },
  })

  return {
    expenseProgress: data ?? {},
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refreshExpenseProgress: async () => {
      await refetch()
    },
  }
}
