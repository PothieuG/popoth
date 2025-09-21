'use client'

import { useState, useEffect, useCallback } from 'react'
import { registerFinancialRefreshCallback } from '@/hooks/useFinancialData'

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

/**
 * Hook pour récupérer les données de progression des budgets et revenus
 */
export function useProgressData(context?: 'profile' | 'group'): UseProgressDataReturn {
  const [expenseProgress, setExpenseProgress] = useState<Record<string, ExpenseProgress>>({})
  const [incomeProgress, setIncomeProgress] = useState<Record<string, IncomeProgress>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProgressData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const contextParam = context ? `?context=${context}` : ''

      // Récupérer les progressions des dépenses et revenus en parallèle
      const [expenseResponse, incomeResponse] = await Promise.all([
        fetch(`/api/finances/expenses/progress${contextParam}`, {
          method: 'GET',
          credentials: 'include'
        }),
        fetch(`/api/finances/income/progress${contextParam}`, {
          method: 'GET',
          credentials: 'include'
        })
      ])

      if (!expenseResponse.ok || !incomeResponse.ok) {
        throw new Error('Erreur lors de la récupération des données de progression')
      }

      const [expenseData, incomeData] = await Promise.all([
        expenseResponse.json(),
        incomeResponse.json()
      ])

      console.log('🔍 [useProgressData] Raw expenseData:', expenseData)
      console.log('🔍 [useProgressData] Raw incomeData:', incomeData)

      // Transformer les données en maps pour un accès rapide
      const expenseMap: Record<string, ExpenseProgress> = {}
      expenseData.forEach((item: ExpenseProgress) => {
        expenseMap[item.budgetId] = item
      })

      const incomeMap: Record<string, IncomeProgress> = {}
      incomeData.forEach((item: IncomeProgress) => {
        incomeMap[item.incomeId] = item
      })

      console.log('🔍 [useProgressData] Final expenseMap:', expenseMap)
      console.log('🔍 [useProgressData] Final incomeMap:', incomeMap)

      setExpenseProgress(expenseMap)
      setIncomeProgress(incomeMap)

    } catch (err) {
      console.error('❌ Erreur dans useProgressData:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setExpenseProgress({})
      setIncomeProgress({})
    } finally {
      setLoading(false)
    }
  }, [context])

  const refreshProgressData = useCallback(async () => {
    await fetchProgressData()
  }, [fetchProgressData])

  useEffect(() => {
    fetchProgressData()
  }, [fetchProgressData])

  // S'enregistrer pour les rafraîchissements globaux
  useEffect(() => {
    const unregister = registerFinancialRefreshCallback(() => {
      console.log('🔄 [ProgressData] Received global financial refresh trigger')
      fetchProgressData()
    })

    return unregister
  }, [fetchProgressData])

  return {
    expenseProgress,
    incomeProgress,
    loading,
    error,
    refreshProgressData
  }
}