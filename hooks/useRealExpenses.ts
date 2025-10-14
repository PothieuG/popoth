'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const [expenses, setExpenses] = useState<RealExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  /**
   * Calculate total amount of all expenses
   */
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  /**
   * Fetch all expenses from API
   */
  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100') // Get more items for transaction listing

      const response = await fetch(`/api/finances/expenses/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error fetching expenses:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setExpenses(data.real_expenses || [])
    } catch (err) {
      console.error('Error in fetchExpenses:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [context])

  /**
   * Add a new expense with smart allocation logic
   * Uses piggy bank → savings → budget priority
   */
  const addExpense = useCallback(async (expenseData: CreateRealExpenseRequest): Promise<boolean> => {
    try {
      setError(null)

      const requestBody = {
        ...expenseData,
        is_for_group: context === 'group'
      }

      // Use the new smart allocation endpoint
      const response = await fetch('/api/finances/expenses/add-with-logic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error adding expense:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Only add to state if a real expense was created (fromBudget > 0)
      if (data.real_expense) {
        setExpenses(prev => [data.real_expense, ...prev])
      }

      // Refresh financial dashboard
      triggerFinancialRefresh()

      return true
    } catch (err) {
      console.error('Error in addExpense:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [context])

  /**
   * Update an existing expense
   */
  const updateExpense = useCallback(async (expenseData: UpdateRealExpenseRequest): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/finances/expenses/real?id=${expenseData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(expenseData)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Error updating expense:', response.status, errorData)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Update the expense in the list
      setExpenses(prev => prev.map(expense =>
        expense.id === expenseData.id ? data.real_expense : expense
      ))

      // Refresh financial data
      triggerFinancialRefresh()

      return true
    } catch (err) {
      console.error('Error in updateExpense:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Delete an expense
   */
  const deleteExpense = useCallback(async (expenseId: string): Promise<boolean> => {
    try {
      setError(null)
      console.log('🗑️ [useRealExpenses] Deleting expense:', expenseId)

      const response = await fetch(`/api/finances/expenses/real?id=${expenseId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('❌ [useRealExpenses] API Error deleting expense:', response.status, errorData)
        throw new Error(errorData?.error || 'Erreur lors de la suppression de la dépense')
      }

      setExpenses(prev => prev.filter(expense => expense.id !== expenseId))
      console.log('✅ [useRealExpenses] Expense removed from local state')

      // Refresh financial data
      console.log('🔄 [useRealExpenses] Refreshing financial data...')
      triggerFinancialRefresh()
      console.log('✅ [useRealExpenses] Financial data refreshed')

      return true
    } catch (err) {
      console.error('❌ [useRealExpenses] Error in deleteExpense:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      return false
    }
  }, [])

  /**
   * Refresh the expenses list
   */
  const refreshExpenses = useCallback(async () => {
    await fetchExpenses()
  }, [fetchExpenses])

  // Load expenses on component mount
  useEffect(() => {
    fetchExpenses()
  }, [fetchExpenses])

  return {
    expenses,
    loading,
    error,
    totalExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    refreshExpenses
  }
}