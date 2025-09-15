'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFinancialCacheInvalidation } from '@/hooks/useFinancialData'

interface EstimatedIncome {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
}

interface UseIncomesReturn {
  incomes: EstimatedIncome[]
  loading: boolean
  error: string | null
  addIncome: (incomeData: { name: string; estimatedAmount: number; isGroupIncome?: boolean }) => Promise<boolean>
  updateIncome: (incomeId: string, incomeData: { name: string; estimatedAmount: number }) => Promise<boolean>
  deleteIncome: (incomeId: string) => Promise<boolean>
  refreshIncomes: () => Promise<void>
  totalIncomes: number
}

/**
 * Hook pour la gestion des revenus estimés
 * Gère le CRUD complet avec la base de données
 */
export function useIncomes(): UseIncomesReturn {
  const [incomes, setIncomes] = useState<EstimatedIncome[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { invalidateCache } = useFinancialCacheInvalidation()

  /**
   * Calcule le total des revenus estimés
   */
  const totalIncomes = incomes.reduce((sum, income) => sum + income.estimated_amount, 0)

  /**
   * Récupère tous les revenus depuis l'API
   */
  const fetchIncomes = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/incomes', {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Erreur API revenus:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setIncomes(data.incomes || [])
    } catch (err) {
      console.error('Erreur lors de la récupération des revenus:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Ajoute un nouveau revenu
   */
  const addIncome = useCallback(async (incomeData: { name: string; estimatedAmount: number; isGroupIncome?: boolean }): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        name: incomeData.name,
        estimatedAmount: incomeData.estimatedAmount,
        isGroupIncome: incomeData.isGroupIncome || false
      }

      const response = await fetch('/api/incomes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })


      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API revenu:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setIncomes(prev => [data.income, ...prev])

      // Invalider le cache des données financières
      await invalidateCache()

      return true
    } catch (err) {
      console.error('Erreur lors de l\'ajout du revenu:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Met à jour un revenu existant
   */
  const updateIncome = useCallback(async (incomeId: string, incomeData: { name: string; estimatedAmount: number }): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        name: incomeData.name,
        estimatedAmount: incomeData.estimatedAmount
      }

      const response = await fetch(`/api/incomes?id=${incomeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })


      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API revenu:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Met à jour le revenu dans la liste
      setIncomes(prev => prev.map(income =>
        income.id === incomeId ? data.income : income
      ))

      // Invalider le cache des données financières
      await invalidateCache()

      return true
    } catch (err) {
      console.error('Erreur lors de la mise à jour du revenu:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Supprime un revenu
   */
  const deleteIncome = useCallback(async (incomeId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/incomes?id=${incomeId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du revenu')
      }

      setIncomes(prev => prev.filter(income => income.id !== incomeId))

      // Invalider le cache des données financières
      await invalidateCache()

      return true
    } catch (err) {
      console.error('Erreur lors de la suppression du revenu:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Rafraîchit la liste des revenus
   */
  const refreshIncomes = useCallback(async () => {
    await fetchIncomes()
  }, [fetchIncomes])

  // Charger les revenus au montage du composant
  useEffect(() => {
    fetchIncomes()
  }, [fetchIncomes])

  return {
    incomes,
    loading,
    error,
    addIncome,
    updateIncome,
    deleteIncome,
    refreshIncomes,
    totalIncomes
  }
}