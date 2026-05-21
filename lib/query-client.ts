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
 * Invalidate the 5 cross-domain financial-refresh keys.
 *
 * Replaces the legacy bridge `triggerFinancialRefresh()` removed in Sprint 2.
 * Call from a CRUD mutation's `onSuccess` so the dashboard summary, progress
 * views, budgets list, group contributions, AND the savings drawer data all
 * refetch.
 *
 * `group-contributions` was added by Sprint Group-Budget-Auto-Sync (2026-05-19)
 * so that creating/updating/deleting an estimated_budget cascades to the
 * contribution UI without manual plumbing in each mutation.
 *
 * `savings-data` was added by Sprint Delete-Budget-Savings-Transfer (2026-05-20)
 * — the SavingsDistributionDrawer has its own queryKey separate from
 * `financial-summary` and was stale after a budget delete that moved
 * cumulated_savings to the piggy bank.
 */
export function invalidateFinancialRefreshes(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['financial-summary'] })
  qc.invalidateQueries({ queryKey: ['progress-data'] })
  qc.invalidateQueries({ queryKey: ['budgets'] })
  qc.invalidateQueries({ queryKey: ['group-contributions'] })
  qc.invalidateQueries({ queryKey: ['savings-data'] })
}
