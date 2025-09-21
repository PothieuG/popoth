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
  monthly_surplus?: number // Champ legacy, plus utilisé
  carryover_spent_amount?: number // Champ legacy, plus utilisé
  carryover_applied_date?: string // Champ legacy, plus utilisé
  cumulated_savings?: number // Économies cumulées
  last_savings_update?: string // Date de dernière mise à jour des économies
  spent_this_month?: number // Dépenses réelles du mois
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
export function useBudgets(context?: 'profile' | 'group'): UseBudgetsReturn {
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

      const url = context ? `/api/finances/budgets/estimated?group=${context === 'group'}` : '/api/finances/budgets/estimated'
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Erreur API budgets:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setBudgets(data.estimated_budgets || [])
    } catch (err) {
      console.error('Erreur lors de la récupération des budgets:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [context])

  /**
   * Ajoute un nouveau budget
   */
  const addBudget = useCallback(async (budgetData: { name: string; estimatedAmount: number; isGroupBudget?: boolean }): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount
      }

      const url = `/api/budgets`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })


      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API budget:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setBudgets(prev => [data.budget, ...prev])

      // Invalider le cache des données financières
      const cacheInvalidated = await invalidateCache()

      return true
    } catch (err) {
      console.error('Erreur lors de l\'ajout du budget:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [context])

  /**
   * Met à jour un budget existant
   */
  const updateBudget = useCallback(async (budgetId: string, budgetData: { name: string; estimatedAmount: number }): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount
      }

      const response = await fetch(`/api/budgets?id=${budgetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })


      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API budget:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Met à jour le budget dans la liste
      setBudgets(prev => prev.map(budget =>
        budget.id === budgetId ? data.budget : budget
      ))

      // Invalider le cache des données financières
      await invalidateCache()

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