'use client'

import { useState, useEffect } from 'react'
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

/**
 * Hook personnalisé pour gérer les données financières en temps réel
 * - Récupère les données financières via l'API
 * - Gère les états de chargement
 * - Fournit des méthodes pour rafraîchir les données
 * - Calcul toujours en temps réel sans cache
 */
export function useFinancialData(forceContext?: 'profile' | 'group'): UseFinancialDataReturn {
  const [financialData, setFinancialData] = useState<FinancialData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<'profile' | 'group' | null>(null)

  /**
   * Récupère les données financières depuis l'API
   */
  const fetchFinancialData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Construire l'URL avec le paramètre de contexte si spécifié
      const url = forceContext
        ? `/api/financial/dashboard?context=${forceContext}`
        : '/api/financial/dashboard'

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`)
      }

      const apiResponse: FinancialApiResponse = await response.json()

      // Log détaillé des données reçues
      console.log(``)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(`🏠🏠🏠 [FRONTEND] DONNÉES FINANCIÈRES REÇUES`)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(`🏠 CONTEXTE: ${apiResponse.context}`)
      console.log(`🏠 TIMESTAMP: ${new Date().toISOString()}`)
      console.log(``)
      console.log(`💰 RESTE À VIVRE (RAV): ${apiResponse.data.remainingToLive}€`)
      console.log(``)
      console.log(`📊 DÉTAILS FINANCIERS:`)
      console.log(`   - Solde disponible: ${apiResponse.data.availableBalance}€`)
      console.log(`   - Revenus estimés: ${apiResponse.data.totalEstimatedIncome}€`)
      console.log(`   - Revenus réels: ${apiResponse.data.totalRealIncome}€`)
      console.log(`   - Budgets estimés: ${apiResponse.data.totalEstimatedBudgets || apiResponse.data.totalEstimatedBudget}€`)
      console.log(`   - Dépenses réelles: ${apiResponse.data.totalRealExpenses}€`)
      console.log(`   - Total économies: ${apiResponse.data.totalSavings}€`)
      console.log(`🏠🏠🏠 ========================================================`)
      console.log(``)

      setFinancialData(apiResponse.data)
      setContext(apiResponse.context)

      // Si il y a un message d'erreur dans la réponse, l'afficher
      if (apiResponse.error) {
        setError(apiResponse.error)
      }

    } catch (err) {
      console.error('❌ Erreur dans useFinancialData:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')

      // En cas d'erreur, définir des données par défaut seulement une fois
      setFinancialData(prevData => {
        if (!prevData) {
          return {
            availableBalance: 0,
            remainingToLive: 0,
            totalSavings: 0,
            totalEstimatedIncome: 0,
            totalEstimatedBudgets: 0,
            totalRealIncome: 0,
            totalRealExpenses: 0
          }
        }
        return prevData
      })
    } finally {
      setLoading(false)
    }
  }

  /**
   * Force le rafraîchissement des données
   */
  const refreshFinancialData = async () => {
    await fetchFinancialData()
  }

  // Charger les données financières au montage du composant
  useEffect(() => {
    fetchFinancialData()
  }, [forceContext])

  // Register for global financial refresh notifications
  useEffect(() => {
    const refreshHandler = () => {
      console.log('🔄 [useFinancialData] Global refresh triggered')
      fetchFinancialData()
    }
    const unregister = registerFinancialRefreshCallback(refreshHandler)
    return unregister
  }, [])

  return {
    financialData,
    loading,
    error,
    context,
    refreshFinancialData
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
  console.log('🔄 [FinancialData] Triggering global financial refresh for', financialRefreshCallbacks.size, 'registered callbacks')
  financialRefreshCallbacks.forEach(callback => {
    try {
      callback()
    } catch (error) {
      console.error('❌ Error in financial refresh callback:', error)
    }
  })
}