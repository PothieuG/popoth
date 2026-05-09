'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { triggerFinancialRefresh } from '@/hooks/useFinancialData'

export interface RealExpense {
  id: string
  profile_id?: string
  group_id?: string
  estimated_budget_id?: string
  amount: number
  description: string
  expense_date: string
  is_exceptional: boolean
  created_at: string
  amount_from_piggy_bank?: number
  amount_from_budget_savings?: number
  amount_from_budget?: number
  estimated_budget?: {
    name: string
  }
}

export interface CreateRealExpenseRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
}

export interface UpdateRealExpenseRequest {
  id: string
  amount?: number
  description?: string
  expense_date?: string
  estimated_budget_id?: string
}

interface UseRealExpensesReturn {
  expenses: RealExpense[]
  loading: boolean
  error: string | null
  totalExpenses: number
  addExpense: (expenseData: CreateRealExpenseRequest) => Promise<boolean>
  updateExpense: (expenseData: UpdateRealExpenseRequest) => Promise<boolean>
  deleteExpense: (expenseId: string) => Promise<boolean>
  refreshExpenses: () => Promise<void>
}

/**
 * Hook for managing real expenses CRUD operations
 * Handles database interactions and state management for actual expenses
 */
export function useRealExpenses(context?: 'profile' | 'group'): UseRealExpensesReturn {
  const queryClient = useQueryClient()
  const queryKey = ['real-expenses', context ?? null]

  const {
    data: expenses = [],
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<RealExpense[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100')

      const response = await fetch(`/api/finance/expenses/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error fetching expenses:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.real_expenses ?? []) as RealExpense[]
    },
  })

  const addMutation = useMutation<RealExpense | null, Error, CreateRealExpenseRequest>({
    mutationFn: async (expenseData) => {
      const requestBody = {
        ...expenseData,
        is_for_group: context === 'group',
      }
      const response = await fetch('/api/finance/expenses/add-with-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error adding expense:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      // Smart allocation may not create a real_expense (fully covered by piggy/savings)
      return (data.real_expense ?? null) as RealExpense | null
    },
    onSuccess: (newExpense) => {
      if (newExpense) {
        queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) => [newExpense, ...prev])
      }
      triggerFinancialRefresh()
    },
    onError: (err) => {
      console.error('Error in addExpense:', err)
    },
  })

  const updateMutation = useMutation<RealExpense, Error, UpdateRealExpenseRequest>({
    mutationFn: async (expenseData) => {
      const response = await fetch(`/api/finance/expenses/real?id=${expenseData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(expenseData),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error updating expense:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_expense as RealExpense
    },
    onSuccess: (updatedExpense, expenseData) => {
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((expense) => (expense.id === expenseData.id ? updatedExpense : expense)),
      )
      triggerFinancialRefresh()
    },
    onError: (err) => {
      console.error('Error in updateExpense:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (expenseId) => {
      console.log('🗑️ [useRealExpenses] Deleting expense:', expenseId)
      const response = await fetch(`/api/finance/expenses/real?id=${expenseId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error(
          '❌ [useRealExpenses] API Error deleting expense:',
          response.status,
          errorData,
        )
        throw new Error(errorData?.error || 'Erreur lors de la suppression de la dépense')
      }
    },
    onSuccess: (_, expenseId) => {
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.filter((expense) => expense.id !== expenseId),
      )
      console.log('✅ [useRealExpenses] Expense removed from local state')
      console.log('🔄 [useRealExpenses] Refreshing financial data...')
      triggerFinancialRefresh()
      console.log('✅ [useRealExpenses] Financial data refreshed')
    },
    onError: (err) => {
      console.error('❌ [useRealExpenses] Error in deleteExpense:', err)
    },
  })

  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  return {
    expenses,
    loading: isLoading,
    error,
    totalExpenses,
    addExpense: async (expenseData) => {
      try {
        await addMutation.mutateAsync(expenseData)
        return true
      } catch {
        return false
      }
    },
    updateExpense: async (expenseData) => {
      try {
        await updateMutation.mutateAsync(expenseData)
        return true
      } catch {
        return false
      }
    },
    deleteExpense: async (expenseId) => {
      try {
        await deleteMutation.mutateAsync(expenseId)
        return true
      } catch {
        return false
      }
    },
    refreshExpenses: async () => {
      await refetch()
    },
  }
}
