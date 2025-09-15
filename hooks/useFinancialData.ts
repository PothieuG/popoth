'use client'

import { useState, useEffect, useCallback } from 'react'
import type { FinancialData } from '@/lib/financial-calculations'

interface UseFinancialDataReturn {
  financialData: FinancialData | null
  loading: boolean
  error: string | null
  cached: boolean
  context: 'profile' | 'group' | null
  refreshFinancialData: () => Promise<void>
  invalidateCache: () => Promise<boolean>
}

interface FinancialApiResponse {
  data: FinancialData
  cached: boolean
  context: 'profile' | 'group'
  timestamp: number
  error?: string
}

/**
 * Hook personnalisé pour gérer les données financières avec cache
 * - Récupère les données financières via l'API
 * - Gère le cache et les états de chargement
 * - Fournit des méthodes pour rafraîchir et invalider le cache
 * - Invalidation automatique lors des modifications de budgets/revenus
 */
export function useFinancialData(forceContext?: 'profile' | 'group'): UseFinancialDataReturn {
  const [financialData, setFinancialData] = useState<FinancialData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [context, setContext] = useState<'profile' | 'group' | null>(null)

  /**
   * Récupère les données financières depuis l'API
   */
  const fetchFinancialData = useCallback(async () => {
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

      setFinancialData(apiResponse.data)
      setCached(apiResponse.cached)
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
  }, [forceContext])

  /**
   * Invalide le cache côté serveur
   */
  const invalidateCache = useCallback(async (): Promise<boolean> => {
    try {

      const response = await fetch('/api/financial/dashboard', {
        method: 'POST',
        credentials: 'include'
      })

      if (!response.ok) {
        console.error('❌ Erreur lors de l\'invalidation du cache:', response.status)
        return false
      }

      const result = await response.json()
      return true

    } catch (err) {
      console.error('❌ Erreur lors de l\'invalidation du cache:', err)
      return false
    }
  }, [])

  /**
   * Force le rafraîchissement des données (ignore le cache)
   */
  const refreshFinancialData = useCallback(async () => {

    // 1. Invalider le cache côté serveur
    const cacheInvalidated = await invalidateCache()

    // 2. Forcer un nouveau fetch (qui devrait ignorer le cache maintenant)
    await fetchFinancialData()
  }, [fetchFinancialData, invalidateCache])

  // Charger les données financières au montage du composant
  useEffect(() => {
    fetchFinancialData()
  }, [fetchFinancialData])

  return {
    financialData,
    loading,
    error,
    cached,
    context,
    refreshFinancialData,
    invalidateCache
  }
}

/**
 * Hook pour invalider automatiquement le cache lors des modifications
 * À utiliser dans les composants qui modifient les budgets/revenus
 */
export function useFinancialCacheInvalidation() {
  const invalidateCache = useCallback(async (): Promise<boolean> => {
    try {

      const response = await fetch('/api/financial/dashboard', {
        method: 'POST',
        credentials: 'include'
      })


      if (response.ok) {
        const result = await response.json()
        return true
      } else {
        return false
      }
    } catch (error) {
      return false
    }
  }, [])

  return { invalidateCache }
}