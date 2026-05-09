'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FinancialData } from '@/lib/financial-calculations'

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
  const queryClient = useQueryClient()

  const { data: apiResponse, isLoading, error, refetch } = useQuery<FinancialApiResponse>({
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

      console.log(``)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(`🏠🏠🏠 [FRONTEND] DONNÉES FINANCIÈRES REÇUES`)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(`🏠 CONTEXTE: ${payload.context}`)
      console.log(`🏠 TIMESTAMP: ${new Date().toISOString()}`)
      console.log(``)
      console.log(`💰 RESTE À VIVRE (RAV): ${payload.data.remainingToLive}€`)
      console.log(``)
      console.log(`📊 DÉTAILS FINANCIERS:`)
      console.log(`   - Solde disponible: ${payload.data.availableBalance}€`)
      console.log(`   - Revenus estimés: ${payload.data.totalEstimatedIncome}€`)
      console.log(`   - Revenus réels: ${payload.data.totalRealIncome}€`)
      console.log(
        `   - Budgets estimés: ${payload.data.totalEstimatedBudgets || payload.data.totalEstimatedBudget}€`,
      )
      console.log(`   - Dépenses réelles: ${payload.data.totalRealExpenses}€`)
      console.log(`   - Total économies: ${payload.data.totalSavings}€`)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(``)

      return payload
    },
  })

  // Bridge: legacy `triggerFinancialRefresh()` callsites (in useBudgets, useIncomes, etc.)
  // invalidate the financial-summary query, which Query then refetches.
  useEffect(() => {
    const handler = () => {
      console.log('🔄 [useFinancialData] Global refresh triggered')
      queryClient.invalidateQueries({ queryKey: ['financial-summary'] })
    }
    const unregister = registerFinancialRefreshCallback(handler)
    return () => {
      unregister()
    }
  }, [queryClient])

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

/**
 * Global refresh callback registry for financial data
 * Allows other hooks to register refresh callbacks that get triggered
 * when real transactions are modified
 */
const financialRefreshCallbacks = new Set<() => void>()

export function registerFinancialRefreshCallback(callback: () => void) {
  financialRefreshCallbacks.add(callback)
  return () => financialRefreshCallbacks.delete(callback)
}

export function triggerFinancialRefresh() {
  console.log(
    '🔄 [FinancialData] Triggering global financial refresh for',
    financialRefreshCallbacks.size,
    'registered callbacks',
  )
  financialRefreshCallbacks.forEach((callback) => {
    try {
      callback()
    } catch (error) {
      console.error('❌ Error in financial refresh callback:', error)
    }
  })
}
