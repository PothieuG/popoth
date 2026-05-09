import { QueryClient } from '@tanstack/react-query'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

/**
 * Invalidate the 3 cross-domain financial-refresh keys.
 *
 * Replaces the legacy bridge `triggerFinancialRefresh()` removed in Sprint 2.
 * Call from a CRUD mutation's `onSuccess` so the dashboard summary, progress
 * views, and budgets list all refetch.
 */
export function invalidateFinancialRefreshes(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['financial-summary'] })
  qc.invalidateQueries({ queryKey: ['progress-data'] })
  qc.invalidateQueries({ queryKey: ['budgets'] })
}
