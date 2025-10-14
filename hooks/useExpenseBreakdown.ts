'use client'

import { useMemo } from 'react'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useBudgets } from '@/hooks/useBudgets'
import { useRealExpenses } from '@/hooks/useRealExpenses'

export interface ExpenseBreakdown {
  total_amount: number
  from_piggy_bank: number
  from_budget_savings: number
  from_budget: number
  piggy_bank_before: number
  piggy_bank_after: number
  savings_before: number
  savings_after: number
  budget_spent_before: number
  budget_spent_after: number
  budget_estimated: number
}

interface UseExpenseBreakdownProps {
  amount: number
  budgetId?: string
  context?: 'profile' | 'group'
}

/**
 * Hook to calculate and preview expense breakdown
 * Shows how an expense will be allocated across piggy bank → savings → budget
 */
export function useExpenseBreakdown({
  amount,
  budgetId,
  context = 'profile'
}: UseExpenseBreakdownProps): ExpenseBreakdown | null {
  const { financialData } = useFinancialData(context)
  const { budgets } = useBudgets(context)
  const { expenses } = useRealExpenses(context)

  const breakdown = useMemo(() => {
    if (!amount || amount <= 0 || !budgetId || !financialData) {
      return null
    }

    // Get piggy bank amount
    const piggyBankBefore = financialData.piggyBank || 0

    // Get budget info
    const budget = budgets.find(b => b.id === budgetId)
    if (!budget) {
      return null
    }

    const savingsBefore = budget.cumulated_savings || 0
    const budgetEstimated = budget.estimated_amount

    // Calculate current spent amount
    const budgetSpentBefore = expenses
      .filter(e => e.estimated_budget_id === budgetId)
      .reduce((sum, e) => sum + e.amount, 0)

    // Calculate breakdown
    let remainingToAllocate = amount
    let fromPiggyBank = 0
    let fromBudgetSavings = 0
    let fromBudget = 0

    // Priority 1: Piggy bank
    if (piggyBankBefore > 0) {
      fromPiggyBank = Math.min(remainingToAllocate, piggyBankBefore)
      remainingToAllocate -= fromPiggyBank
    }

    // Priority 2: Budget savings
    if (remainingToAllocate > 0 && savingsBefore > 0) {
      fromBudgetSavings = Math.min(remainingToAllocate, savingsBefore)
      remainingToAllocate -= fromBudgetSavings
    }

    // Priority 3: Budget itself
    if (remainingToAllocate > 0) {
      fromBudget = remainingToAllocate
    }

    return {
      total_amount: amount,
      from_piggy_bank: fromPiggyBank,
      from_budget_savings: fromBudgetSavings,
      from_budget: fromBudget,
      piggy_bank_before: piggyBankBefore,
      piggy_bank_after: piggyBankBefore - fromPiggyBank,
      savings_before: savingsBefore,
      savings_after: savingsBefore - fromBudgetSavings,
      budget_spent_before: budgetSpentBefore,
      budget_spent_after: budgetSpentBefore + fromBudget,
      budget_estimated: budgetEstimated
    }
  }, [amount, budgetId, financialData, budgets, expenses])

  return breakdown
}
