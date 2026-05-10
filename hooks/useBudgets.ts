'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

export interface EstimatedBudget {
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
  addBudget: (budgetData: {
    name: string
    estimatedAmount: number
    isGroupBudget?: boolean
  }) => Promise<boolean>
  updateBudget: (
    budgetId: string,
    budgetData: { name: string; estimatedAmount: number },
  ) => Promise<boolean>
  deleteBudget: (budgetId: string) => Promise<boolean>
  refreshBudgets: () => Promise<void>
  totalBudgets: number
}

/**
 * Hook pour la gestion des budgets estimés
 * Gère le CRUD complet avec la base de données
 */
export function useBudgets(context?: 'profile' | 'group'): UseBudgetsReturn {
  const queryClient = useQueryClient()
  const queryKey = ['budgets', context ?? null]

  const {
    data: budgets = [],
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<EstimatedBudget[]>({
    queryKey,
    queryFn: async () => {
      const url = context
        ? `/api/finance/budgets/estimated?group=${context === 'group'}`
        : '/api/finance/budgets/estimated'
      const response = await fetch(url, { method: 'GET', credentials: 'include' })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.estimated_budgets ?? []) as EstimatedBudget[]
    },
  })

  const addMutation = useMutation<
    EstimatedBudget,
    Error,
    { name: string; estimatedAmount: number; isGroupBudget?: boolean }
  >({
    mutationFn: async (budgetData) => {
      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount,
      }
      const url = context ? `/api/finance/budgets?context=${context}` : `/api/finance/budgets`
      const response = await fetch(url, {
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
      return data.budget as EstimatedBudget
    },
    onSuccess: (newBudget) => {
      queryClient.setQueryData<EstimatedBudget[]>(queryKey, (prev = []) => [newBudget, ...prev])
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error("Erreur lors de l'ajout du budget:", err)
    },
  })

  const updateMutation = useMutation<
    EstimatedBudget,
    Error,
    { budgetId: string; budgetData: { name: string; estimatedAmount: number } }
  >({
    mutationFn: async ({ budgetId, budgetData }) => {
      const requestBody = {
        name: budgetData.name,
        estimatedAmount: budgetData.estimatedAmount,
      }
      const response = await fetch(`/api/finance/budgets?id=${budgetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.budget as EstimatedBudget
    },
    onSuccess: (updatedBudget, { budgetId }) => {
      queryClient.setQueryData<EstimatedBudget[]>(queryKey, (prev = []) =>
        prev.map((budget) => (budget.id === budgetId ? updatedBudget : budget)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Erreur lors de la mise à jour du budget:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (budgetId) => {
      const response = await fetch(`/api/finance/budgets?id=${budgetId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du budget')
      }
    },
    onSuccess: (_, budgetId) => {
      queryClient.setQueryData<EstimatedBudget[]>(queryKey, (prev = []) =>
        prev.filter((budget) => budget.id !== budgetId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Erreur lors de la suppression du budget:', err)
    },
  })

  const totalBudgets = budgets.reduce((sum, budget) => sum + budget.estimated_amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  return {
    budgets,
    loading: isLoading,
    error,
    addBudget: async (budgetData) => {
      try {
        await addMutation.mutateAsync(budgetData)
        return true
      } catch {
        return false
      }
    },
    updateBudget: async (budgetId, budgetData) => {
      try {
        await updateMutation.mutateAsync({ budgetId, budgetData })
        return true
      } catch {
        return false
      }
    },
    deleteBudget: async (budgetId) => {
      try {
        await deleteMutation.mutateAsync(budgetId)
        return true
      } catch {
        return false
      }
    },
    refreshBudgets: async () => {
      await refetch()
    },
    totalBudgets,
  }
}
