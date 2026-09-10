'use client'

import { useQuery } from '@tanstack/react-query'

export interface GroupMember {
  id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  joined_at: string
}

interface UseGroupMembersOptions {
  /** `false` = ne pas charger (drawer fermé, contexte perso…). Défaut `true`. */
  enabled?: boolean
}

const NO_MEMBERS: GroupMember[] = []

/**
 * Membres du groupe — TanStack Query, key `['group-members', groupId]`.
 *
 * Sprint Perf-Toggle-Targeted-Refresh (2026-09-10). Dernier hook fetcher
 * encore en `useState` + fetch impératif (`fetchGroupMembers(groupId)` appelé
 * depuis un `useEffect` des consommateurs). Conséquence : aucun cache — chaque
 * bascule perso → groupe relançait `GET /api/groups/[id]/members` et repassait
 * l'en-tête du dashboard groupe en skeleton, alors que la liste des membres
 * ne change qu'aux rares moments où quelqu'un rejoint ou quitte le groupe.
 *
 * Désormais : servi depuis le cache dans le `staleTime` (30 s), dédoublonné
 * entre l'en-tête et la modal « Voir les membres », invalidé par les mutations
 * d'appartenance de `useGroups` (`['group-members']`).
 *
 * `enabled` porte le gating : sans `groupId`, ou avec `enabled: false`, la
 * query reste en attente sans aucun fetch (miroir `useGroupMembersRav`).
 */
export function useGroupMembers(
  groupId: string | null | undefined,
  options: UseGroupMembersOptions = {},
) {
  const enabled = (options.enabled ?? true) && !!groupId

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<GroupMember[]>({
    queryKey: ['group-members', groupId ?? null],
    enabled,
    queryFn: async () => {
      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'GET',
        credentials: 'include',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Erreur lors de la récupération des membres')
      }
      return (body?.members ?? []) as GroupMember[]
    },
  })

  const members = data ?? NO_MEMBERS

  return {
    members,
    isLoading,
    isFetching,
    error: queryError instanceof Error ? queryError.message : null,
    /** Relance explicite (bouton « Réessayer » de la modal). */
    refetch: async (): Promise<void> => {
      await refetch()
    },
    // Helpers
    memberCount: members.length,
    hasMembers: members.length > 0,
  }
}
