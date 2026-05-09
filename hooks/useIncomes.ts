'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

export interface EstimatedIncome {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  is_salary?: boolean
  created_at: string
  updated_at: string
}

interface UseIncomesReturn {
  incomes: EstimatedIncome[]
  loading: boolean
  error: string | null
  addIncome: (incomeData: {
    name: string
    estimatedAmount: number
    isGroupIncome?: boolean
  }) => Promise<boolean>
  updateIncome: (
    incomeId: string,
    incomeData: { name: string; estimatedAmount: number },
  ) => Promise<boolean>
  deleteIncome: (incomeId: string) => Promise<boolean>
  refreshIncomes: () => Promise<void>
  totalIncomes: number
}

/**
 * Hook pour la gestion des revenus estimés
 * Gère le CRUD complet avec la base de données
 */
export function useIncomes(context?: 'profile' | 'group'): UseIncomesReturn {
  const queryClient = useQueryClient()
  const queryKey = ['incomes', context ?? null]

  const {
    data: incomes = [],
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<EstimatedIncome[]>({
    queryKey,
    queryFn: async () => {
      const url = context ? `/api/finance/incomes?context=${context}` : '/api/finance/incomes'
      const response = await fetch(url, { method: 'GET', credentials: 'include' })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Erreur API revenus:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.incomes ?? []) as EstimatedIncome[]
    },
  })

  const addMutation = useMutation<
    EstimatedIncome,
    Error,
    { name: string; estimatedAmount: number; isGroupIncome?: boolean }
  >({
    mutationFn: async (incomeData) => {
      const requestBody = {
        name: incomeData.name,
        estimatedAmount: incomeData.estimatedAmount,
      }
      const url = context ? `/api/finance/incomes?context=${context}` : '/api/finance/incomes'
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API revenu:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.income as EstimatedIncome
    },
    onSuccess: (newIncome) => {
      queryClient.setQueryData<EstimatedIncome[]>(queryKey, (prev = []) => [newIncome, ...prev])
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      console.error("Erreur lors de l'ajout du revenu:", err)
    },
  })

  const updateMutation = useMutation<
    EstimatedIncome,
    Error,
    { incomeId: string; incomeData: { name: string; estimatedAmount: number } }
  >({
    mutationFn: async ({ incomeId, incomeData }) => {
      const requestBody = {
        name: incomeData.name,
        estimatedAmount: incomeData.estimatedAmount,
      }
      const response = await fetch(`/api/finance/incomes?id=${incomeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ Erreur API revenu:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.income as EstimatedIncome
    },
    onSuccess: (updatedIncome, { incomeId }) => {
      queryClient.setQueryData<EstimatedIncome[]>(queryKey, (prev = []) =>
        prev.map((income) => (income.id === incomeId ? updatedIncome : income)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      console.error('Erreur lors de la mise à jour du revenu:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (incomeId) => {
      const response = await fetch(`/api/finance/incomes?id=${incomeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du revenu')
      }
    },
    onSuccess: (_, incomeId) => {
      queryClient.setQueryData<EstimatedIncome[]>(queryKey, (prev = []) =>
        prev.filter((income) => income.id !== incomeId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      console.error('Erreur lors de la suppression du revenu:', err)
    },
  })

  const totalIncomes = incomes.reduce((sum, income) => sum + income.estimated_amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  return {
    incomes,
    loading: isLoading,
    error,
    addIncome: async (incomeData) => {
      try {
        await addMutation.mutateAsync(incomeData)
        return true
      } catch {
        return false
      }
    },
    updateIncome: async (incomeId, incomeData) => {
      try {
        await updateMutation.mutateAsync({ incomeId, incomeData })
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
    refreshIncomes: async () => {
      await refetch()
    },
    totalIncomes,
  }
}
