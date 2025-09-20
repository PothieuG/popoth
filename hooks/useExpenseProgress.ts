'use client'

import { useState, useEffect, useCallback } from 'react'

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
  const [expenseProgress, setExpenseProgress] = useState<Record<string, ExpenseProgress>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExpenseProgress = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const url = context
        ? `/api/finances/expenses/progress?context=${context}`
        : '/api/finances/expenses/progress'

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Transformer les données en map pour un accès rapide
      const progressMap: Record<string, ExpenseProgress> = {}
      data.forEach((item: ExpenseProgress) => {
        progressMap[item.budgetId] = item
      })

      setExpenseProgress(progressMap)

    } catch (err) {
      console.error('❌ Erreur dans useExpenseProgress:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setExpenseProgress({})
    } finally {
      setLoading(false)
    }
  }, [context])

  const refreshExpenseProgress = useCallback(async () => {
    await fetchExpenseProgress()
  }, [fetchExpenseProgress])

  useEffect(() => {
    fetchExpenseProgress()
  }, [fetchExpenseProgress])

  return {
    expenseProgress,
    loading,
    error,
    refreshExpenseProgress
  }
}