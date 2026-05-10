'use client'

import { useQuery } from '@tanstack/react-query'
import type { FinancialData } from '@/lib/finance'

interface UseFinancialDataReturn {
  financialData: FinancialData | null
  loading: boolean
  error: string | null
  context: 'profile' | 'group' | null
  refreshFinancialData: () => Promise<void>
}

interface FinancialApiResponse {
  data: FinancialData
  context: 'profile' | 'group'
  timestamp: number
  error?: string
}

const defaultFinancialData: FinancialData = {
  availableBalance: 0,
  remainingToLive: 0,
  totalSavings: 0,
  totalEstimatedIncome: 0,
  totalEstimatedBudgets: 0,
  totalRealIncome: 0,
  totalRealExpenses: 0,
}

/**
 * Hook personnalisé pour gérer les données financières en temps réel
 * - Récupère les données financières via l'API
 * - Gère les états de chargement
 * - Fournit des méthodes pour rafraîchir les données
 * - Calcul toujours en temps réel sans cache
 */
export function useFinancialData(forceContext?: 'profile' | 'group'): UseFinancialDataReturn {
  const {
    data: apiResponse,
    isLoading,
    error,
    refetch,
  } = useQuery<FinancialApiResponse>({
    queryKey: ['financial-summary', forceContext ?? null],
    queryFn: async () => {
      const url = forceContext
        ? `/api/finance/summary?context=${forceContext}`
        : '/api/finance/summary'

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`)
      }

      const payload: FinancialApiResponse = await response.json()

      return payload
    },
  })

  return {
    financialData: apiResponse?.data ?? (error ? defaultFinancialData : null),
    loading: isLoading,
    error: error instanceof Error ? error.message : (apiResponse?.error ?? null),
    context: apiResponse?.context ?? null,
    refreshFinancialData: async () => {
      await refetch()
    },
  }
}
