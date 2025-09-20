'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFinancialCacheInvalidationWithRefresh } from '@/hooks/useFinancialData'

export interface RealIncome {
  id: string
  profile_id?: string
  group_id?: string
  estimated_income_id?: string
  amount: number
  description: string
  entry_date: string
  is_exceptional: boolean
  created_at: string
  estimated_income?: {
    name: string
  }
}

export interface CreateRealIncomeRequest {
  amount: number
  description: string
  entry_date?: string
  estimated_income_id?: string
  is_for_group?: boolean
}

export interface UpdateRealIncomeRequest {
  id: string
  amount?: number
  description?: string
  entry_date?: string
  estimated_income_id?: string
}

interface UseRealIncomesReturn {
  incomes: RealIncome[]
  loading: boolean
  error: string | null
  totalIncomes: number
  addIncome: (incomeData: CreateRealIncomeRequest) => Promise<boolean>
  updateIncome: (incomeData: UpdateRealIncomeRequest) => Promise<boolean>
  deleteIncome: (incomeId: string) => Promise<boolean>
  refreshIncomes: () => Promise<void>
}

/**
 * Hook for managing real income entries CRUD operations
 * Handles database interactions and state management for actual income entries
 */
export function useRealIncomes(context?: 'profile' | 'group'): UseRealIncomesReturn {
  const [incomes, setIncomes] = useState<RealIncome[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { invalidateCache } = useFinancialCacheInvalidationWithRefresh()

  /**
   * Calculate total amount of all incomes
   */
  const totalIncomes = incomes.reduce((sum, income) => sum + income.amount, 0)

  /**
   * Fetch all income entries from API
   */
  const fetchIncomes = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100') // Get more items for transaction listing

      const response = await fetch(`/api/finances/income/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error fetching incomes:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setIncomes(data.real_income_entries || [])
    } catch (err) {
      console.error('Error in fetchIncomes:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [context])

  /**
   * Add a new income entry
   */
  const addIncome = useCallback(async (incomeData: CreateRealIncomeRequest): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        ...incomeData,
        is_for_group: context === 'group'
      }

      const response = await fetch('/api/finances/income/real', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error adding income:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setIncomes(prev => [data.real_income_entry, ...prev])

      // Invalidate financial cache to refresh dashboard
      await invalidateCache()

      return true
    } catch (err) {
      console.error('Error in addIncome:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [context, invalidateCache])

  /**
   * Update an existing income entry
   */
  const updateIncome = useCallback(async (incomeData: UpdateRealIncomeRequest): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/finances/income/real?id=${incomeData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(incomeData)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error updating income:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Update the income in the list
      setIncomes(prev => prev.map(income =>
        income.id === incomeData.id ? data.real_income_entry : income
      ))

      // Invalidate financial cache
      await invalidateCache()

      return true
    } catch (err) {
      console.error('Error in updateIncome:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [invalidateCache])

  /**
   * Delete an income entry
   */
  const deleteIncome = useCallback(async (incomeId: string): Promise<boolean> => {
    try {
      setError(null)
      console.log('🗑️ [useRealIncomes] Deleting income:', incomeId)

      const response = await fetch(`/api/finances/income/real?id=${incomeId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ [useRealIncomes] API Error deleting income:', response.status, errorData)
        throw new Error(errorData?.error || 'Erreur lors de la suppression du revenu')
      }

      setIncomes(prev => prev.filter(income => income.id !== incomeId))
      console.log('✅ [useRealIncomes] Income removed from local state')

      // Invalidate financial cache
      console.log('🔄 [useRealIncomes] Invalidating financial cache...')
      await invalidateCache()
      console.log('✅ [useRealIncomes] Financial cache invalidated')

      return true
    } catch (err) {
      console.error('❌ [useRealIncomes] Error in deleteIncome:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [invalidateCache])

  /**
   * Refresh the income entries list
   */
  const refreshIncomes = useCallback(async () => {
    await fetchIncomes()
  }, [fetchIncomes])

  // Load income entries on component mount
  useEffect(() => {
    fetchIncomes()
  }, [fetchIncomes])

  return {
    incomes,
    loading,
    error,
    totalIncomes,
    addIncome,
    updateIncome,
    deleteIncome,
    refreshIncomes
  }
}