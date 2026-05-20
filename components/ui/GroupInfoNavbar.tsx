'use client'

import { Skeleton } from '@/components/ui/skeleton'
import type { ProfileData } from '@/app/api/profile/route'
import type { GroupMember } from '@/hooks/useGroupMembers'

interface GroupInfoNavbarProps {
  profile: ProfileData | null
  members: GroupMember[]
  /**
   * True dès que la liste des membres est en cours de fetch (initial ou
   * refetch post-switch context). Remplace la liste par un skeleton.
   */
  isFetching?: boolean
}

/**
 * GroupInfoNavbar Component - Displays group information in the navbar
 * Shows group greeting and members list in a two-line format
 */
export default function GroupInfoNavbar({
  profile,
  members,
  isFetching = false,
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
    </div>
  )
}
