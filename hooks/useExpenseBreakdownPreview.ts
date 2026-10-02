'use client'

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { coverageTotal, type OverflowCoverage } from '@/lib/expense-breakdown'

/**
 * Aperçu de la répartition d'une dépense budgétée
 * (`GET /api/finance/expenses/preview-breakdown`), partagé entre la modale
 * d'ajout (dépassement, réserves disponibles, étape « Couvrir le
 * dépassement ») et `ExpenseBreakdownPreview` (même clé de cache).
 *
 * Sprint Expense-Overflow-Coverage (2026-10-02) : en ajout, la route renvoie
 * la répartition SANS couverture (dépassement en déficit) ; la couverture
 * choisie est appliquée ici, côté navigateur (`applyCoverageToPreview`), pour
 * que les curseurs bougent l'aperçu en direct sans aller-retour serveur.
 */

export interface CrossBudgetDebitPreview {
  budget_id: string
  budget_name: string
  amount: number
  available_before: number
  available_after: number
}

export interface BudgetSavingsAvailability {
  budget_id: string
  budget_name: string
  available: number
}

export interface ExpenseBreakdownPreviewData {
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
  budget_name: string
  cross_budget_debits: CrossBudgetDebitPreview[]
  /** Dépassement après économies du budget et budget lui-même. */
  overflow: number
  /** Économies des autres budgets, mobilisables pour couvrir le dépassement. */
  other_budgets_savings: BudgetSavingsAvailability[]
}

export interface ExpenseBreakdownPreviewParams {
  amount: number
  budgetId: string
  context?: 'profile' | 'group'
  /** Mode édition : la route simule reverse + réapplication. */
  expenseId?: string
  useSavings?: boolean
  /** Mois recapé (wizard « Compléter le mois ») ; mois courant sinon. */
  month?: number
  year?: number
}

export function expenseBreakdownPreviewQuery({
  amount,
  budgetId,
  context = 'profile',
  expenseId,
  useSavings = false,
  month,
  year,
}: ExpenseBreakdownPreviewParams) {
  return {
    queryKey: [
      'expense-breakdown',
      amount,
      budgetId,
      context,
      expenseId ?? null,
      useSavings,
      month ?? null,
      year ?? null,
    ] as const,
    // Aperçu d'une écriture à venir : toujours relu à l'ouverture de la
    // modale (une dépense ajoutée entre-temps change le dépassement).
    staleTime: 0,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ExpenseBreakdownPreviewData> => {
      const params = new URLSearchParams({
        amount: amount.toString(),
        budget_id: budgetId,
        context,
      })
      if (expenseId) params.set('expense_id', expenseId)
      if (useSavings) params.set('use_savings', 'true')
      if (month != null && year != null) {
        params.set('month', String(month))
        params.set('year', String(year))
      }

      const response = await fetch(`/api/finance/expenses/preview-breakdown?${params}`, {
        credentials: 'include',
        signal,
      })
      if (!response.ok) {
        throw new Error('Erreur lors du calcul du breakdown')
      }
      const data = await response.json()
      return data.breakdown as ExpenseBreakdownPreviewData
    },
  }
}

/** Relit la route (jamais le cache) : sert à décider, au moment de l'envoi,
 *  si l'étape « Couvrir le dépassement » est nécessaire. */
export function fetchFreshExpenseBreakdownPreview(
  queryClient: QueryClient,
  params: ExpenseBreakdownPreviewParams,
): Promise<ExpenseBreakdownPreviewData> {
  return queryClient.fetchQuery(expenseBreakdownPreviewQuery(params))
}

/**
 * `keepPrevious` : garde la valeur précédente pendant la frappe du montant
 * (encart « Dépassement » et libellé du bouton stables). La décision finale
 * (étape de couverture ou ajout direct) relit la route au moment de l'envoi
 * via `fetchFresh`.
 */
export function useExpenseBreakdownPreview(
  params: ExpenseBreakdownPreviewParams,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    ...expenseBreakdownPreviewQuery(params),
    enabled: params.amount > 0 && !!params.budgetId,
    placeholderData: keepPrevious
      ? (previous: ExpenseBreakdownPreviewData | undefined) => previous
      : undefined,
  })
  return {
    data,
    isLoading,
    error,
    fetchFresh: (fresh: ExpenseBreakdownPreviewParams) =>
      fetchFreshExpenseBreakdownPreview(queryClient, fresh),
  }
}

const roundCents = (value: number): number => Math.round(value * 100) / 100

/**
 * L'étape « Couvrir le dépassement » n'a de sens que s'il y a un dépassement
 * ET au moins une réserve (tirelire ou économies d'un autre budget). Sinon le
 * dépassement va directement sur le reste à vivre.
 */
export function needsCoverageStep(breakdown: ExpenseBreakdownPreviewData): boolean {
  return (
    breakdown.overflow > 0.004 &&
    (breakdown.piggy_bank_before > 0.004 ||
      breakdown.other_budgets_savings.some((b) => b.available > 0.004))
  )
}

/**
 * Applique une couverture choisie à l'aperçu SANS couverture renvoyé par la
 * route en ajout : débite tirelire et économies choisies, et retire du budget
 * destination ce qui ne part plus en déficit.
 */
export function applyCoverageToPreview(
  breakdown: ExpenseBreakdownPreviewData,
  coverage: OverflowCoverage,
): ExpenseBreakdownPreviewData {
  const covered = coverageTotal(coverage)
  if (covered <= 0) return breakdown
  return {
    ...breakdown,
    from_piggy_bank: coverage.piggy,
    piggy_bank_after: roundCents(breakdown.piggy_bank_before - coverage.piggy),
    from_budget: roundCents(breakdown.from_budget - covered),
    budget_spent_after: roundCents(breakdown.budget_spent_after - covered),
    cross_budget_debits: coverage.budgets
      .filter((b) => b.amount > 0)
      .map((b) => {
        const source = breakdown.other_budgets_savings.find((o) => o.budget_id === b.budget_id)
        const availableBefore = source?.available ?? 0
        return {
          budget_id: b.budget_id,
          budget_name: source?.budget_name ?? '',
          amount: b.amount,
          available_before: availableBefore,
          available_after: roundCents(availableBefore - b.amount),
        }
      }),
  }
}

/**
 * Baisse du reste à vivre causée par la dépense : hausse du déficit du budget
 * (la part qui dépasse son montant prévu).
 */
export function ravDeltaOf(breakdown: ExpenseBreakdownPreviewData): number {
  const before = Math.max(0, breakdown.budget_spent_before - breakdown.budget_estimated)
  const after = Math.max(0, breakdown.budget_spent_after - breakdown.budget_estimated)
  return roundCents(after - before)
}
