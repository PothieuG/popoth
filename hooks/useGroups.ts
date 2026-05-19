'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateGroupRequest, GroupData } from '@/app/api/groups/route'
import type { UpdateGroupRequest } from '@/app/api/groups/[id]/route'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

/**
 * Custom hook for managing user groups
 * Provides methods to fetch, create, update, and delete groups
 */
export function useGroups() {
  const queryClient = useQueryClient()

  const {
    data: groups = [],
    isLoading,
    error: queryError,
    isFetched,
    refetch,
  } = useQuery<GroupData[]>({
    queryKey: ['groups'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/groups', {
        method: 'GET',
        credentials: 'include',
        signal,
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      return (data.groups ?? []) as GroupData[]
    },
  })

  const createMutation = useMutation<GroupData, Error, CreateGroupRequest>({
    mutationFn: async (groupData) => {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(groupData),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la création du groupe')
      }
      return data.group as GroupData
    },
    onSuccess: (newGroup) => {
      queryClient.setQueryData<GroupData[]>(['groups'], (prev = []) => [...prev, newGroup])
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Error creating group:', err)
    },
  })

  const updateMutation = useMutation<
    GroupData,
    Error,
    { groupId: string; updates: UpdateGroupRequest }
  >({
    mutationFn: async ({ groupId, updates }) => {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du groupe')
      }
      return data.group as GroupData
    },
    onSuccess: (updatedGroup, { groupId }) => {
      queryClient.setQueryData<GroupData[]>(['groups'], (prev = []) =>
        prev.map((g) => (g.id === groupId ? { ...g, ...updatedGroup } : g)),
      )
      // monthly_budget_estimate is no longer mutable through PUT /api/groups/[id]
      // (auto-synced via DB trigger from estimated_budgets), so only a name
      // change is possible here — no need to invalidate financial refreshes.
    },
    onError: (err) => {
      logger.error('Error updating group:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (groupId) => {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la suppression du groupe')
      }
    },
    onSuccess: (_, groupId) => {
      queryClient.setQueryData<GroupData[]>(['groups'], (prev = []) =>
        prev.filter((g) => g.id !== groupId),
      )
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Error deleting group:', err)
    },
  })

  const joinMutation = useMutation<void, Error, string>({
    mutationFn: async (groupId) => {
      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Erreur lors de l'adhésion au groupe")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // CRITICAL cross-mutation cascade : si POST /members succeed côté serveur
      // mais le client throw avant l'invalidation profile/financial, le state
      // financier reste stale jusqu'au prochain staleTime / F5.
      logger.error('Error joining group:', err)
    },
  })

  const leaveMutation = useMutation<void, Error, string>({
    mutationFn: async (groupId) => {
      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la sortie du groupe')
      }
    },
    onSuccess: (_, groupId) => {
      queryClient.setQueryData<GroupData[]>(['groups'], (prev = []) =>
        prev.filter((g) => g.id !== groupId),
      )
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // CRITICAL cross-mutation cascade : si DELETE /members succeed côté
      // serveur mais le client throw avant l'invalidation profile/financial,
      // le state financier reste stale.
      logger.error('Error leaving group:', err)
    },
  })

  const latestError =
    createMutation.error ??
    updateMutation.error ??
    deleteMutation.error ??
    joinMutation.error ??
    leaveMutation.error ??
    queryError
  const error = latestError instanceof Error ? latestError.message : null

  return {
    groups,
    isLoading,
    error,
    hasBeenFetched: isFetched,
    fetchGroups: async () => {
      await refetch()
    },
    createGroup: async (groupData: CreateGroupRequest): Promise<boolean> => {
      try {
        await createMutation.mutateAsync(groupData)
        return true
      } catch {
        return false
      }
    },
    updateGroup: async (groupId: string, updates: UpdateGroupRequest): Promise<boolean> => {
      try {
        await updateMutation.mutateAsync({ groupId, updates })
        return true
      } catch {
        return false
      }
    },
    deleteGroup: async (groupId: string): Promise<boolean> => {
      try {
        await deleteMutation.mutateAsync(groupId)
        return true
      } catch {
        return false
      }
    },
    joinGroup: async (groupId: string): Promise<boolean> => {
      try {
        await joinMutation.mutateAsync(groupId)
        return true
      } catch {
        return false
      }
    },
    leaveGroup: async (groupId: string): Promise<boolean> => {
      try {
        await leaveMutation.mutateAsync(groupId)
        return true
      } catch {
        return false
      }
    },
    // Helpers
    hasGroup: groups.length > 0,
    currentGroup: groups.length > 0 ? groups[0] : null,
    isCreator: groups.length > 0 ? (groups[0]?.is_creator ?? false) : false,
  }
}
