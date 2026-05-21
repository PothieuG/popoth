'use client'

import { useMemo } from 'react'
import { calculateBreakdown } from '@/lib/expense-breakdown'

interface BudgetProgressLike {
  spentAmount: number
  estimatedAmount: number
}

export interface UseRavValidationInput {
  transactionType: 'expense' | 'income'
  isExceptional: boolean
  amount: number
  remainingToLive: number | null | undefined
  budgetId: string
  budgetProgress: BudgetProgressLike | undefined
  /**
   * Budget local cumulated_savings (Sprint P4-P5-P6 / Phase A5). Used to
   * compute how much of an overflow will be absorbed by savings cascade
   * vs hitting the budget as deficit (which impacts RAV). Default 0 if
   * absent — backward compat with consumers that don't yet pass it.
   */
  savingsAvailable?: number
  /**
   * P5 opt-in toggle (Sprint P4-P5-P6 / Phase A5). When true, savings are
   * consumed BEFORE the budget — protects RAV from any deficit because
   * the budget side stays at 0. When false (default), P4 strict cascade
   * applies (savings only absorb overflow). Default false.
   */
  useSavingsToggle?: boolean
}

export interface RavValidationResult {
  blocked: boolean
  newRav: number
}

/**
 * Vérifie si une dépense en cours de saisie ferait passer le RAV en négatif.
 *
 * - **Dépense exceptionnelle** : impact direct sur le RAV (`newRav = RAV - amount`).
 * - **Dépense budgétée** : seul l'`amount_from_budget` (après cascade savings)
 *   contribue au déficit budget, qui est ce qui impacte le RAV. La cascade
 *   savings absorbe une partie de l'overflow → RAV pas impacté autant.
 * - **Revenu / montant invalide** : pas de blocage.
 *
 * Le hook délègue le calcul du breakdown à `calculateBreakdown` (pure-sync,
 * 0 I/O) — single source of truth partagée avec les route handlers (Sprint
 * P4-P5-P6 / Phase A1).
 */
export function useRavValidation(input: UseRavValidationInput): RavValidationResult {
  const {
    transactionType,
    isExceptional,
    amount,
    remainingToLive,
    budgetId,
    budgetProgress,
    savingsAvailable,
    useSavingsToggle,
  } = input

  return useMemo<RavValidationResult>(() => {
    if (transactionType !== 'expense' || remainingToLive == null || amount <= 0) {
      return { blocked: false, newRav: 0 }
    }

    const currentRav = remainingToLive

    if (isExceptional) {
      const newRav = currentRav - amount
      return { blocked: newRav < 0, newRav }
    }

    if (budgetId && budgetProgress) {
      const currentSpent = budgetProgress.spentAmount
      const budgetAmount = budgetProgress.estimatedAmount
      const budgetRemaining = budgetAmount - currentSpent
      const savings = savingsAvailable ?? 0

      // Compute how the breakdown algorithm will allocate the amount.
      // amount_from_budget = fromBudget + overflow (overshoot absorbed by
      // budget per handler behavior). amount_from_budget_savings doesn't
      // increment budget deficit (it consumes the savings pool instead).
      const breakdown = calculateBreakdown(amount, budgetRemaining, savings, {
        useSavingsToggle: useSavingsToggle ?? false,
      })
      const additionalAmountFromBudget = breakdown.fromBudget + breakdown.overflow
      const newSpent = currentSpent + additionalAmountFromBudget

      if (newSpent > budgetAmount) {
        const previousDeficit = Math.max(0, currentSpent - budgetAmount)
        const newDeficit = newSpent - budgetAmount
        const additionalDeficit = newDeficit - previousDeficit
        const newRav = currentRav - additionalDeficit
        return { blocked: newRav < 0, newRav }
      }

      return { blocked: false, newRav: currentRav }
    }

    return { blocked: false, newRav: 0 }
  }, [
    transactionType,
    isExceptional,
    amount,
    remainingToLive,
    budgetId,
    budgetProgress,
    savingsAvailable,
    useSavingsToggle,
  ])
}
