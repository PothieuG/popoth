/**
 * Monthly Recap V3 — shared types for pure calculations and downstream actions.
 *
 * Consumed by `calculations.ts` (this sprint) and `actions-negative.ts`
 * (sprint 07). Pure data shapes only — no functions, no I/O.
 */

export interface BudgetSummary {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  cumulatedSavings: number
  surplus: number
  deficit: number
}

export interface RecapSummary {
  currentBalance: number
  ravEstime: number
  ravEffectif: number
  totalSurplus: number
  totalSavings: number
  piggyAmount: number
  budgets: readonly BudgetSummary[]
  /** Bilan = ravEffectif - ravEstime (soustraction). Positif = mois mieux que prévu,
   *  négatif = pire que prévu. Cf. `lib/recap/calculations.ts::computeRecapSummary`. */
  bilan: number
  bilanSign: 'positive' | 'negative' | 'zero'
}

export interface RefloatProportionalAllocation {
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  totalAllocated: number
  shortfall: number
}
