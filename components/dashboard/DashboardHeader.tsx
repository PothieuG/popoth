'use client'

import { useEffect } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import UserInfoNavbar from '@/components/ui/UserInfoNavbar'
import GroupInfoNavbar from '@/components/ui/GroupInfoNavbar'
import UserAvatar from '@/components/ui/UserAvatar'

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
 * enfants n'engage pas de re-fetch. `useGroupMembers` reste legacy
 * useState (pas TanStack), donc on lui passe le groupId via useEffect ;
 * il refetch quand le profile groupId change.
 */
export default function DashboardHeader({ context, onOpenMenu }: DashboardHeaderProps) {
  const { profile } = useProfile()
  const { getUserContribution, groupInfo } = useGroupContributions()
  const { members, fetchGroupMembers } = useGroupMembers()

  // Hydrate les membres uniquement en context group, dès que le profile a un group_id.
  // useGroupMembers est legacy (useState + useEffect) ; cet useEffect couvre le cas
  // où l'utilisateur navigue vers le group-dashboard depuis le profile-dashboard.
  useEffect(() => {
    if (context === 'group' && profile?.group_id) {
      fetchGroupMembers(profile.group_id)
    }
  }, [context, profile?.group_id, fetchGroupMembers])

  return (
    <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-xs">
      <div className="flex items-center justify-between p-4">
        {context === 'profile' ? (
          <UserInfoNavbar
            profile={profile}
            userContribution={profile?.id ? getUserContribution(profile.id) : null}
            groupBudget={groupInfo?.monthly_budget_estimate ?? null}
          />
        ) : (
          <GroupInfoNavbar profile={profile} members={members} />
        )}
        <UserAvatar profile={profile} onClick={onOpenMenu} size="md" />
      </div>
    </nav>
  )
}
