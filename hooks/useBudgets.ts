'use client'

import { useCallback } from 'react'
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
  carryover_spent_amount?: number // Déficit reporté du recap précédent (inclus dans spent_this_month)
  carryover_applied_date?: string // Date d'application du carryover par finalize_recap
  cumulated_savings?: number // Économies cumulées
  last_savings_update?: string // Date de dernière mise à jour des économies
  spent_this_month?: number // carryover_spent_amount + sum(amount_from_budget) du mois courant
}

interface UseBudgetsReturn {
  budgets: EstimatedBudget[]
  loading: boolean
  isFetching: boolean
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
  deleteBudget: (
    budgetId: string,
  ) => Promise<{ success: boolean; transferredAmount?: number; piggyAmount?: number | null }>
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
    isFetching,
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

  const deleteMutation = useMutation<
    { transferredAmount: number; piggyAmount: number | null },
    Error,
    string
  >({
    mutationFn: async (budgetId) => {
      const response = await fetch(`/api/finance/budgets?id=${budgetId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du budget')
      }
      const data = await response.json()
      return {
        transferredAmount: Number(data.transferredAmount ?? 0),
        piggyAmount:
          data.piggyAmount !== null && data.piggyAmount !== undefined
            ? Number(data.piggyAmount)
            : null,
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

  // Stable refresh reference — refetch from TanStack Query is already stable,
  // so wrapping with useCallback gives a stable function identity across renders.
  // Required by consumers that pass refreshBudgets in a useEffect dep array
  // (e.g. PlanningDrawer:154) — without this, exposing isFetching at the return
  // triggers a re-render → new arrow ref → useEffect refire → refetch → loop.
  const refreshBudgets = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    budgets,
    loading: isLoading,
    isFetching,
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
        const result = await deleteMutation.mutateAsync(budgetId)
        return {
          success: true,
          transferredAmount: result.transferredAmount,
          piggyAmount: result.piggyAmount,
        }
      } catch {
        return { success: false }
      }
    },
    refreshBudgets,
    totalBudgets,
  }
}
