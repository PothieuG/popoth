'use client'

import { useQuery } from '@tanstack/react-query'
import type { GroupMemberRavDetail } from '@/lib/finance'

/**
 * RAV courant de chaque membre du groupe — chargé à la demande.
 *
 * Sprint Perf-Group-Members-Rav-Lazy (2026-09-10). Ces lignes arrivaient
 * auparavant dans `FinancialData.meta.groupMembersRav`, donc à chaque
 * `GET /api/finance/summary?context=group` : côté serveur, un
 * `getProfileFinancialData` complet par membre (9 lectures + 1 écriture
 * chacun) sur le chemin critique du dashboard groupe.
 *
 * ⚠️ `enabled` est le cœur du gain : sans lui, le hook se déclencherait au
 * montage du `PlanningDrawer` — lequel est rendu (fermé) par
 * `<FinancialIndicators>` dès le premier rendu du dashboard. On aurait
 * simplement déplacé le N+1 d'une requête à l'autre. Passer `enabled: false`
 * laisse la query `pending` sans fetch ; TanStack la déclenchera à la
 * première ouverture du drawer, puis servira le cache.
 */
export function useGroupMembersRav(enabled: boolean): {
  groupMembersRav: GroupMemberRavDetail[] | undefined
  isLoading: boolean
} {
  const { data, isLoading } = useQuery<GroupMemberRavDetail[]>({
    queryKey: ['group-members-rav'],
    enabled,
    queryFn: async () => {
      const response = await fetch('/api/finance/group-members-rav', {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`)
      }
      const payload: { data: GroupMemberRavDetail[] } = await response.json()
      return payload.data
    },
  })

  return { groupMembersRav: data, isLoading }
}
