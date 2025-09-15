'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFinancialCacheInvalidation } from '@/hooks/useFinancialData'

interface EstimatedBudget {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
}

interface UseBudgetsReturn {
  budgets: EstimatedBudget[]
  loading: boolean
  error: string | null
  addBudget: (budgetData: { name: string; estimatedAmount: number; isGroupBudget?: boolean }) => Promise<boolean>
  updateBudget: (budgetId: string, budgetData: { name: string; estimatedAmount: number }) => Promise<boolean>
  deleteBudget: (budgetId: string) => Promise<boolean>
  refreshBudgets: () => Promise<void>
  totalBudgets: number
}

/**
 * Hook pour la gestion des budgets estimés
 * Gère le CRUD complet avec la base de données
 */
export function useBudgets(): UseBudgetsReturn {
  const [budgets, setBudgets] = useState<EstimatedBudget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { invalidateCache } = useFinancialCacheInvalidation()

  /**
   * Calcule le total des budgets estimés
   */
  const totalBudgets = budgets.reduce((sum, budget) => sum + budget.estimated_amount, 0)

  /**
   * Récupère tous les budgets depuis l'API
   */
  const fetchBudgets = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/budgets', {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Erreur API budgets:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setBudgets(data.budgets || [])
    } catch (err) {
      console.error('Erreur lors de la récupération des budgets:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Ajoute un nouveau budget
   */
  const addBudget = useCallback(async (budgetData: { name: string; estimatedAmount: number; isGroupBudget?: boolean }): Promise<boolean> => {
    try {
      console.log('🔄 Ajout budget - Début:', budgetData)
      setError(null)

      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount,
        isGroupBudget: budgetData.isGroupBudget || false
      }
      console.log('📤 Données envoyées:', requestBody)

      const response = await fetch('/api/budgets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })

      console.log('📥 Réponse reçue:', response.status, response.statusText)

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API budget:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Budget créé avec succès:', data.budget)
      setBudgets(prev => [data.budget, ...prev])

      // Invalider le cache des données financières
      await invalidateCache()
      console.log('🗑️ Cache financier invalidé après ajout de budget')

      return true
    } catch (err) {
      console.error('Erreur lors de l\'ajout du budget:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Met à jour un budget existant
   */
  const updateBudget = useCallback(async (budgetId: string, budgetData: { name: string; estimatedAmount: number }): Promise<boolean> => {
    try {
      console.log('🔄 Mise à jour budget - Début:', budgetId, budgetData)
      setError(null)

      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount
      }
      console.log('📤 Données envoyées:', requestBody)

      const response = await fetch(`/api/budgets?id=${budgetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })

      console.log('📥 Réponse reçue:', response.status, response.statusText)

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API budget:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Budget mis à jour avec succès:', data.budget)

      // Met à jour le budget dans la liste
      setBudgets(prev => prev.map(budget =>
        budget.id === budgetId ? data.budget : budget
      ))

      // Invalider le cache des données financières
      await invalidateCache()
      console.log('🗑️ Cache financier invalidé après modification de budget')

      return true
    } catch (err) {
      console.error('Erreur lors de la mise à jour du budget:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Supprime un budget
   */
  const deleteBudget = useCallback(async (budgetId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/budgets?id=${budgetId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du budget')
      }

      setBudgets(prev => prev.filter(budget => budget.id !== budgetId))

      // Invalider le cache des données financières
      await invalidateCache()
      console.log('🗑️ Cache financier invalidé après suppression de budget')

      return true
    } catch (err) {
      console.error('Erreur lors de la suppression du budget:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Rafraîchit la liste des budgets
   */
  const refreshBudgets = useCallback(async () => {
    await fetchBudgets()
  }, [fetchBudgets])

  // Charger les budgets au montage du composant
  useEffect(() => {
    fetchBudgets()
  }, [fetchBudgets])

  return {
    budgets,
    loading,
    error,
    addBudget,
    updateBudget,
    deleteBudget,
    refreshBudgets,
    totalBudgets
  }
}