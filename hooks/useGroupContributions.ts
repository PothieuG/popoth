'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'
import type {
  GroupContributionData,
  GroupContributionsResponse,
} from '@/app/api/groups/contributions/route'

/**
 * Hook to fetch and manage group contributions.
 *
 * Sprint Group-Budget-Auto-Sync (2026-05-19) — migrated from useState +
 * AbortController to TanStack Query (queryKey: ['group-contributions'])
 * to close the dette tech connue (cf. doc2/features/group-contributions.md
 * §11). Public API preserved so existing consumers compile unchanged.
 *
 * The query is auto-invalidated by `invalidateFinancialRefreshes` (which
 * fires from `useBudgets` / `useGroups` mutations), so creating/updating/
 * deleting an estimated_budget for the group propagates here automatically
 * without any cross-hook plumbing.
 */
export function useGroupContributions() {
  const qc = useQueryClient()

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<GroupContributionsResponse | null>({
    queryKey: ['group-contributions'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/groups/contributions', {
        method: 'GET',
        credentials: 'include',
        signal,
      })

      // 400 "Vous n'appartenez à aucun groupe" is not an error from the UI
      // standpoint — fall through to null so consumers see hasGroup=false
      // without raising a banner.
      if (res.status === 400) {
        return null
      }

      const body = await res.json().catch(() => null)

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        throw new Error(body?.error || `Erreur ${res.status}: ${res.statusText}`)
      }

      return body as GroupContributionsResponse
    },
  })

  const recalcMutation = useMutation<boolean, Error>({
    mutationFn: async () => {
      const res = await fetch('/api/groups/contributions', {
        method: 'POST',
        credentials: 'include',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error || 'Erreur lors du recalcul des contributions')
      }
      return true
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-contributions'] })
      invalidateFinancialRefreshes(qc)
    },
    onError: (err) => {
      logger.error('Erreur lors du recalcul des contributions:', err)
    },
  })

  // Stabilize references so downstream useCallback deps don't churn every
  // render (queryFn returns a fresh object each refetch; the contributions
  // array identity changes even when values are byte-identical).
  const contributions = useMemo(() => data?.contributions ?? [], [data?.contributions])
  const groupInfo = useMemo(() => data?.group_info ?? null, [data?.group_info])

  const fetchContributions = useCallback(async () => {
    await refetch()
  }, [refetch])

  const recalculateContributions = useCallback(async (): Promise<boolean> => {
    try {
      return await recalcMutation.mutateAsync()
    } catch {
      return false
    }
  }, [recalcMutation])

  const getUserContribution = useCallback(
    (userId: string): GroupContributionData | null =>
      contributions.find((contrib) => contrib.profile_id === userId) ?? null,
    [contributions],
  )

  const getGroupStats = useCallback(() => {
    if (!groupInfo || contributions.length === 0) {
      return {
        averageContribution: 0,
        highestContribution: 0,
        lowestContribution: 0,
        memberCount: 0,
      }
    }
    const amounts = contributions.map((c) => c.contribution_amount)
    return {
      averageContribution: amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length,
      highestContribution: Math.max(...amounts),
      lowestContribution: Math.min(...amounts),
      memberCount: contributions.length,
    }
  }, [contributions, groupInfo])

  // Legacy no-ops — TanStack Query handles request cancellation natively
  // (via the AbortSignal passed to queryFn) and cache invalidation via
  // queryClient.invalidateQueries. Consumers calling these still compile;
  // they just become harmless.
  const resetContributions = useCallback(() => {
    // no-op since TanStack manages cache
  }, [])
  const cleanup = useCallback(() => {
    // no-op since TanStack manages signal lifecycle
  }, [])

  return {
    // Data
    contributions,
    groupInfo,

    // Loading states
    isLoading,
    isFetching,
    error: queryError instanceof Error ? queryError.message : null,
    isRecalculating: recalcMutation.isPending,

    // Methods
    fetchContributions,
    recalculateContributions,
    getUserContribution,
    getGroupStats,
    resetContributions,
    cleanup,

    // Computed values
    hasContributions: contributions.length > 0,
    hasGroup: groupInfo !== null,
    totalMembers: contributions.length,
    isOperationInProgress: isLoading || recalcMutation.isPending,
  }
}
