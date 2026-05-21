'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

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
  created_by?: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
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
  isFetching: boolean
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
  const queryClient = useQueryClient()
  const queryKey = ['real-incomes', context ?? null]

  const {
    data: incomes = [],
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<RealIncome[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100')

      const response = await fetch(`/api/finance/income/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.real_income_entries ?? []) as RealIncome[]
    },
  })

  const addMutation = useMutation<RealIncome, Error, CreateRealIncomeRequest>({
    mutationFn: async (incomeData) => {
      const requestBody = {
        ...incomeData,
        is_for_group: context === 'group',
      }
      const response = await fetch('/api/finance/income/real', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_income_entry as RealIncome
    },
    onSuccess: (newIncome) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) => [newIncome, ...prev])
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (addIncome retourne false sans toast)
      logger.error('Error in addIncome:', err)
    },
  })

  const updateMutation = useMutation<RealIncome, Error, UpdateRealIncomeRequest>({
    mutationFn: async (incomeData) => {
      const response = await fetch(`/api/finance/income/real?id=${incomeData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(incomeData),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_income_entry as RealIncome
    },
    onSuccess: (updatedIncome, incomeData) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((income) => (income.id === incomeData.id ? updatedIncome : income)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (updateIncome retourne false sans toast)
      logger.error('Error in updateIncome:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (incomeId) => {
      const response = await fetch(`/api/finance/income/real?id=${incomeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Erreur lors de la suppression du revenu')
      }
    },
    onSuccess: (_, incomeId) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.filter((income) => income.id !== incomeId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (deleteIncome retourne false sans toast)
      logger.error('❌ [useRealIncomes] Error in deleteIncome:', err)
    },
  })

  const totalIncomes = incomes.reduce((sum, income) => sum + income.amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  // Stable refresh reference — useIncomeProgress depends on this for its own
  // useCallback. See useBudgets.ts / useRealExpenses.ts.
  const refreshIncomes = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    incomes,
    loading: isLoading,
    isFetching,
    error,
    totalIncomes,
    addIncome: async (incomeData) => {
      try {
        await addMutation.mutateAsync(incomeData)
        return true
      } catch {
        return false
      }
    },
    updateIncome: async (incomeData) => {
      try {
        await updateMutation.mutateAsync(incomeData)
        return true
      } catch {
        return false
      }
    },
    deleteIncome: async (incomeId) => {
      try {
        await deleteMutation.mutateAsync(incomeId)
        return true
      } catch {
        return false
      }
    },
    refreshIncomes,
  }
}
