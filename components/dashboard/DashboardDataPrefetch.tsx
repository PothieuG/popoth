'use client'

import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'
import { useProjects } from '@/hooks/useProjects'
import { useRealExpenses } from '@/hooks/useRealExpenses'
import { useRealIncomes } from '@/hooks/useRealIncomes'
import { useProgressData } from '@/hooks/useProgressData'
import { usePeriodParam } from '@/hooks/usePeriodParam'

/**
 * Amorce les requêtes de contenu du dashboard dès le montage du layout.
 *
 * Sprint Perf-Waterfall (2026-09-10) — les deux pages dashboard sortent tôt
 * tant que `useProfile` charge :
 *
 *   if (isLoading) return <CentralLoader />
 *
 * Leur sous-arbre (`FinancialIndicators`, `TransactionTabsComponent`) n'est donc
 * monté qu'APRÈS la résolution de `GET /api/profile`, et les 6 requêtes de
 * contenu ne partaient qu'à ce moment-là. Le chargement se faisait en deux
 * vagues sérialisées — exactement le symptôme rapporté : « la page s'affiche,
 * puis les chiffres arrivent ».
 *
 * Aucune de ces requêtes n'a pourtant besoin du profil : elles sont portées par
 * le cookie de session et le `context` déduit de l'URL. Ce composant les lance
 * donc en parallèle de `/api/profile`, depuis le layout qui, lui, n'est pas gaté.
 *
 * Pourquoi un composant dédié plutôt que des appels dans le layout : TanStack
 * Query dédoublonne par `queryKey`, donc quand le sous-arbre monte, ses hooks
 * rejoignent les requêtes déjà en vol — aucun appel supplémentaire. Et comme ce
 * composant ne rend rien, ses propres re-rendus (un par requête qui se résout)
 * n'entraînent pas le re-rendu de l'arbre du dashboard.
 *
 * ⚠️ Garder cette liste alignée sur les hooks réellement montés par les pages :
 * amorcer une `queryKey` que personne ne consomme ajouterait un appel réseau
 * pour rien. Le `period` vient de `usePeriodParam` pour cette raison — préfetcher
 * `['progress-data', ctx, 'month']` alors que l'URL demande la semaine
 * remplirait la mauvaise entrée de cache.
 */
export default function DashboardDataPrefetch({ context }: { context: 'profile' | 'group' }) {
  const { period } = usePeriodParam()

  useBudgets(context)
  useIncomes(context)
  useProjects(context)
  useRealExpenses(context)
  useRealIncomes(context)
  useProgressData(context, period)

  return null
}
