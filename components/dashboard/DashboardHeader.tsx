'use client'

import { useProfile } from '@/hooks/useProfile'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import UserInfoNavbar from '@/components/ui/UserInfoNavbar'
import GroupInfoNavbar from '@/components/ui/GroupInfoNavbar'
import UserAvatar from '@/components/ui/UserAvatar'
import { calculateAmountToFund } from '@/lib/contribution-calculator'

interface DashboardHeaderProps {
  context: 'profile' | 'group'
  onOpenMenu: () => void
}

/**
 * Header sticky partagé entre /dashboard et /group-dashboard. Rendu dans
 * `app/(dashboards)/layout.tsx` pour persister entre les navigations
 * soeurs (pas de re-mount). Affiche soit UserInfoNavbar (profile), soit
 * GroupInfoNavbar (group) selon le `context`, plus l'UserAvatar à droite.
 *
 * Les hooks `useProfile`/`useGroupContributions`/`useGroupMembers` sont
 * dédupliqués par TanStack Query — appeler les mêmes hooks dans les pages
 * enfants n'engage pas de re-fetch. Les membres ne sont chargés qu'en
 * contexte groupe (`enabled`), et servis depuis le cache à la bascule
 * perso → groupe suivante (Sprint Perf-Toggle-Targeted-Refresh 2026-09-10 :
 * avant, le hook legacy refetchait à chaque bascule et repassait l'en-tête
 * en skeleton).
 */
export default function DashboardHeader({ context, onOpenMenu }: DashboardHeaderProps) {
  const { profile } = useProfile()
  const {
    getUserContribution,
    groupInfo,
    isFetching: contributionsFetching,
  } = useGroupContributions()
  const { members, isLoading: membersLoading } = useGroupMembers(profile?.group_id, {
    enabled: context === 'group',
  })
  // Base du % affiché dans l'en-tête : le reste à financer par les membres
  // (budget − revenus du groupe), pas le budget brut — sinon les parts des
  // membres ne totalisent pas 100 % dès que le groupe a un revenu (ex. CAF).
  const amountToFund = groupInfo
    ? calculateAmountToFund(groupInfo.monthly_budget_estimate, groupInfo.monthly_income_estimate)
    : null

  return (
    <nav className="pt-safe sticky top-0 z-40 border-b border-gray-200 bg-white shadow-xs">
      <div className="flex items-center justify-between p-4">
        {context === 'profile' ? (
          <UserInfoNavbar
            profile={profile}
            userContribution={profile?.id ? getUserContribution(profile.id) : null}
            amountToFund={amountToFund}
            isFetching={contributionsFetching}
          />
        ) : (
          <GroupInfoNavbar
            profile={profile}
            members={members}
            userContribution={profile?.id ? getUserContribution(profile.id) : null}
            amountToFund={amountToFund}
            isFetching={membersLoading}
            isFetchingContribution={contributionsFetching}
          />
        )}
        <UserAvatar profile={profile} onClick={onOpenMenu} size="md" />
      </div>
    </nav>
  )
}
