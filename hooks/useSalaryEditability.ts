'use client'

import { useQuery } from '@tanstack/react-query'
import type { SalaryEditabilityResponse } from '@/app/api/profile/salary-editability/route'
import { logger } from '@/lib/logger'

/**
 * Sprint Salary-Edit-Gating (2026-05-25) — true ssi le planificateur du user
 * est vierge (4 tables `estimated_budgets`, `estimated_incomes`,
 * `real_expenses`, `real_income_entries`). Conditionne l'édition du salaire
 * dans ProfileSettingsCard (le wizard recap reste l'autre voie autorisée).
 *
 * QueryKey `['salary-editability']` est invalidée par `invalidateFinancialRefreshes`,
 * donc toute mutation budgets/incomes/expenses refetch automatiquement.
 */
export function useSalaryEditability() {
  const { data, isLoading, isFetching, error } = useQuery<SalaryEditabilityResponse>({
    queryKey: ['salary-editability'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/profile/salary-editability', {
        method: 'GET',
        credentials: 'include',
        signal,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        logger.debug('Erreur API salary-editability:', { status: response.status, body })
        throw new Error(body?.error || `Erreur ${response.status}`)
      }
      return body.data as SalaryEditabilityResponse
    },
  })

  return {
    editable: data?.editable ?? false,
    reason: data?.reason ?? null,
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : null,
  }
}
