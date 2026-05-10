/**
 * Domain types shared across the lib/finance/ modules.
 *
 * Extracted from lib/financial-calculations.ts at chantier I4 to break the
 * god-file dependency. The legacy module re-exports these for back-compat
 * during the migration window (commits 2-9), then is deleted at commit 10.
 */

export interface FinancialData {
  availableBalance: number // Cash disponible (peut être négatif)
  remainingToLive: number // Reste à vivre (peut être négatif)
  totalSavings: number // Total des économies des budgets
  totalEstimatedIncome: number // Total des revenus estimés
  totalEstimatedBudgets: number // Total des budgets estimés
  totalRealIncome: number // Total des revenus réels
  totalRealExpenses: number // Total des dépenses réelles
  bankBalance?: number // Optional: solde bancaire (legacy field used in some logs)
  piggyBank?: number // Optional: tirelire (utilisé par useExpenseBreakdown)
  totalEstimatedBudget?: number // Optional: alias singulier (legacy logs)
}

export interface BudgetSavings {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  savings: number // MAX(0, estimatedAmount - spentThisMonth)
}
