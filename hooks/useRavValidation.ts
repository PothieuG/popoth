'use client'

import { useMemo } from 'react'

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
}

export interface RavValidationResult {
  blocked: boolean
  newRav: number
}

/**
 * Vérifie si une dépense en cours de saisie ferait passer le RAV en négatif.
 * - Dépense exceptionnelle : impact direct sur le RAV.
 * - Dépense budgétée : seul le dépassement du budget impacte le RAV.
 * - Revenu / montant invalide : pas de blocage.
 */
export function useRavValidation(input: UseRavValidationInput): RavValidationResult {
  const { transactionType, isExceptional, amount, remainingToLive, budgetId, budgetProgress } =
    input

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
      const newTotalSpent = currentSpent + amount
      const budgetAmount = budgetProgress.estimatedAmount

      if (newTotalSpent > budgetAmount) {
        const previousOverrun = Math.max(0, currentSpent - budgetAmount)
        const newOverrun = newTotalSpent - budgetAmount
        const additionalOverrun = newOverrun - previousOverrun
        const newRav = currentRav - additionalOverrun
        return { blocked: newRav < 0, newRav }
      }

      return { blocked: false, newRav: currentRav }
    }

    return { blocked: false, newRav: 0 }
  }, [transactionType, isExceptional, amount, remainingToLive, budgetId, budgetProgress])
}
