'use client'

import { Skeleton } from '@/components/ui/skeleton'
import type { ProfileData } from '@/app/api/profile/route'
import type { GroupMember } from '@/hooks/useGroupMembers'
import type { GroupContributionData } from '@/app/api/groups/contributions/route'

interface GroupInfoNavbarProps {
  profile: ProfileData | null
  members: GroupMember[]
  /**
   * Contribution de l'utilisateur courant — alimente la 3ème ligne
   * "Ma contribution : <montant> (<%>)". Lue depuis le même hook
   * `useGroupContributions` que UserInfoNavbar pour cohérence cross-dashboard.
   */
  userContribution?: GroupContributionData | null
  /**
   * Budget mensuel total du groupe — base du % "part du budget" affiché
   * entre parenthèses. Lu depuis `groupInfo.monthly_budget_estimate`
   * (auto-syncé via trigger DB depuis SUM(estimated_budgets), cf. Sprint
   * Group-Budget-Auto-Sync 2026-05-19).
   */
  groupBudget?: number | null
  /**
   * True dès que la liste des membres est en cours de fetch (initial ou
   * refetch post-switch context). Remplace la liste par un skeleton.
   */
  isFetching?: boolean
  /**
   * True dès que les contributions sont en cours de refetch. Remplace le
   * montant de contribution par un skeleton. Séparé d'`isFetching` car
   * les deux hooks sources (membres / contributions) sont indépendants.
   */
  isFetchingContribution?: boolean
}

/**
 * GroupInfoNavbar Component - Displays group information in the navbar.
 *
 * Layout (3 lignes mobile-first ≤ 430 px, mirror de UserInfoNavbar pour
 * que les deux navbars de dashboard soient visuellement de même hauteur) :
 *   1. "Bonjour <nom du groupe> !"
 *   2. "Membres : <liste>"
 *   3. "Ma contribution : <montant>€ (<%> du budget)" — montant en violet,
 *      pourcentage en gras entre parenthèses (sprint Group-Dashboard-Navbar-Contribution).
 */
export default function GroupInfoNavbar({
  profile,
  members,
  userContribution,
  groupBudget,
  isFetching = false,
  isFetchingContribution = false,
}: GroupInfoNavbarProps) {
  if (!profile || !profile.group_id) {
    return <div className="text-sm text-gray-500">Chargement...</div>
  }

  // Format members list for display (first names only)
  const formatMembersList = () => {
    if (members.length === 0) {
      return 'Aucun membre'
    }

    // Get first names of all members
    const firstNames = members.map((member) => member.first_name)

    if (firstNames.length <= 2) {
      return firstNames.join(', ')
    } else {
      // Show first 2 names + count
      const firstTwo = firstNames.slice(0, 2).join(', ')
      const remaining = firstNames.length - 2
      return `${firstTwo} et ${remaining} autre${remaining > 1 ? 's' : ''}`
    }
  }

  const formatContribution = (amount: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)

  const contributionAmount = userContribution?.contribution_amount ?? 0
  const hasPositiveContribution = userContribution != null && contributionAmount > 0
  const budgetPercent =
    userContribution && groupBudget && groupBudget > 0
      ? Math.round((userContribution.contribution_amount / groupBudget) * 100)
      : null

  return (
    <div className="flex flex-col">
      {/* First line: Group greeting */}
      <div className="text-sm font-medium text-gray-900">
        Bonjour <span className="text-orange-600">{profile.group_name || 'Groupe'}</span> !
      </div>

      {/* Second line: Members list */}
      <div className="mt-0.5 flex items-center space-x-1">
        <div className="text-xs text-gray-600">Membres :</div>
        {isFetching ? (
          <Skeleton className="h-3 w-32" />
        ) : (
          <div className="truncate text-xs font-medium text-purple-600">{formatMembersList()}</div>
        )}
      </div>

      {/* Third line: My contribution to the group */}
      <div className="mt-0.5 flex items-center space-x-1">
        <div className="truncate text-xs text-gray-600">Ma contribution :</div>
        {isFetchingContribution ? (
          <Skeleton className="h-3 w-16" />
        ) : hasPositiveContribution ? (
          <div className="text-xs whitespace-nowrap">
            <span className="font-semibold text-purple-600">
              {formatContribution(contributionAmount)}
            </span>
            {budgetPercent != null && budgetPercent > 0 && (
              <span className="text-gray-600">
                {' '}
                (<strong className="font-semibold">{budgetPercent}%</strong>)
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic">à définir</div>
        )}
      </div>
    </div>
  )
}
