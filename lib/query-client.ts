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
 * Invalidate the 4 cross-domain financial-refresh keys.
 *
 * Replaces the legacy bridge `triggerFinancialRefresh()` removed in Sprint 2.
 * Call from a CRUD mutation's `onSuccess` so the dashboard summary, progress
 * views, budgets list, and group contributions all refetch.
 *
 * `group-contributions` was added by Sprint Group-Budget-Auto-Sync (2026-05-19)
 * so that creating/updating/deleting an estimated_budget cascades to the
 * contribution UI without manual plumbing in each mutation.
 */
export function invalidateFinancialRefreshes(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['financial-summary'] })
  qc.invalidateQueries({ queryKey: ['progress-data'] })
  qc.invalidateQueries({ queryKey: ['budgets'] })
  qc.invalidateQueries({ queryKey: ['group-contributions'] })
}
