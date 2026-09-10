/**
 * RAV par membre d'un groupe — chargé À LA DEMANDE, hors du chemin critique
 * du dashboard.
 *
 * Sprint Perf-Group-Members-Rav-Lazy (2026-09-10). Ce calcul vivait dans
 * `_loadFinancialData` (§13) et hydratait `FinancialData.meta.groupMembersRav`,
 * donc il était payé à CHAQUE `GET /api/finance/summary?context=group` — et
 * aussi par `lib/recap/load-summary.ts` et `lib/finance/snapshots.ts`, qui
 * n'en lisent pourtant jamais le résultat.
 *
 * Le coût était un N+1 complet : un `getProfileFinancialData(memberId)` par
 * membre, soit 9 lectures + 1 écriture chacun. Mesuré sur le mock du plan de
 * requêtes (30 ms de latence simulée par aller-retour) :
 *
 *   dashboard perso            :  9 requêtes,  2 allers-retours
 *   dashboard groupe 1 membre  : 18 requêtes,  4 allers-retours
 *   dashboard groupe 2 membres : 27 requêtes,  4 allers-retours
 *   dashboard groupe 5 membres : 54 requêtes,  4 allers-retours
 *
 * Or `groupMembersRav` n'a qu'un seul consommateur : l'encart « RAV actuel →
 * projeté » des modals Add/Edit Budget et Add/Edit Projet, qui vivent dans le
 * `PlanningDrawer`. Rien de tout ça n'est visible au premier rendu du
 * dashboard. Le calcul est donc déplacé derrière `GET /api/finance/group-
 * members-rav`, que le drawer ne requête qu'à son ouverture.
 *
 * La formule, elle, est INCHANGÉE : on appelle toujours
 * `getProfileFinancialData(memberId)`, strictement la même que le dashboard
 * perso du membre. La formule simplifiée `salaire − budgets_perso −
 * contribution` avait été retirée au sprint Group-RAV-Recap (2026-05-27) parce
 * qu'elle ignorait la compensation des revenus estimés, les revenus/dépenses
 * exceptionnels et les déficits budget — plusieurs € de dérive à l'écran. On
 * ne la réintroduit pas : on paie le même calcul, mais seulement quand il est
 * regardé.
 */

import { supabaseServer } from '@/lib/supabase-server'

import { getProfileFinancialData } from './financial-data'
import type { GroupMemberRavDetail } from './types'

/** Ligne de `group_contributions` jointe au profil du membre. */
type MemberRow = {
  salary: number
  profile_id: string
  profiles: { first_name: string; salary: number | null } | null
}

/**
 * Charge le RAV courant de chaque membre du groupe, trié par prénom (tri
 * stable, cohérent avec `meta.readOnlyIncomes`).
 *
 * Effet de bord conservé depuis §13 : chaque `getProfileFinancialData` met à
 * jour `bank_balances.current_remaining_to_live` du membre. Ce snapshot n'est
 * lu que par `GET /api/finance/rav` (aucun consommateur applicatif à ce jour),
 * il n'est donc pas critique — mais le rafraîchir reste gratuit ici.
 *
 * Fail-soft aligné sur `_loadFinancialData` : jamais d'exception propagée, un
 * groupe sans contribution renvoie `[]`.
 */
export async function loadGroupMembersRav(groupId: string): Promise<GroupMemberRavDetail[]> {
  const { data } = await supabaseServer
    .from('group_contributions')
    .select('salary, profile_id, profiles:profile_id (first_name, salary)')
    .eq('group_id', groupId)

  const members = (data ?? []) as unknown as MemberRow[]
  if (members.length === 0) return []

  const ravByProfileId = new Map(
    await Promise.all(
      members.map(
        async (m) =>
          // Volontairement SANS `window` : ce chiffre est libellé « RAV actuel »
          // du membre. Le propager depuis un récap groupe changerait silencieuse-
          // ment un nombre affiché, et chaque membre a de toute façon sa propre
          // période de récap. Cf. FinancialMonthWindow.
          [m.profile_id, (await getProfileFinancialData(m.profile_id)).remainingToLive] as const,
      ),
    ),
  )

  return members
    .map((m) => ({
      profileId: m.profile_id,
      firstName: m.profiles?.first_name ?? '',
      salary: m.profiles?.salary ?? m.salary ?? 0,
      currentRav: ravByProfileId.get(m.profile_id) ?? 0,
    }))
    .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
}
