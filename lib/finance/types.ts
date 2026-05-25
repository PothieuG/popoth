/**
 * Domain types shared across the lib/finance/ modules.
 *
 * Extracted from lib/financial-calculations.ts at chantier I4 to break the
 * god-file dependency. The legacy module re-exports these for back-compat
 * during the migration window (commits 2-9), then is deleted at commit 10.
 */

export interface ReadOnlyIncome {
  kind: 'salary' | 'contribution'
  label: string
  amount: number
}

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
  // Sprint 16 Monthly Recap V3 — métadonnées présentationnelles pour le
  // drawer Planification.
  //
  // - readOnlyIncomes : lignes virtuelles read-only à afficher en tête de la
  //   liste des revenus estimés (salaire perso, contribution de chaque membre
  //   en groupe). Purement présentationnel, aucun impact sur les autres totaux.
  // - groupSalaryTotal (groupe uniquement) : somme des salaires des membres,
  //   utilisée par le formulaire "Ajouter/Modifier un budget" comme plafond
  //   de validation. Sans ce plafond, un groupe vide est bloqué : pas de
  //   budget → contribution = 0 → "Total revenus estimés" = 0 → impossible
  //   d'ajouter le moindre budget. Le plafond salaires brise ce cycle :
  //   le groupe ne peut pas budgéter plus que ce que ses membres gagnent
  //   collectivement.
  meta?: {
    readOnlyIncomes: ReadOnlyIncome[]
    groupSalaryTotal?: number
  }
}

export interface BudgetSavings {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  savings: number // MAX(0, estimatedAmount - spentThisMonth)
}
