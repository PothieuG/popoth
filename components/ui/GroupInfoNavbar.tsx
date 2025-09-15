'use client'

import { ProfileData } from '@/app/api/profile/route'
import { GroupMember } from '@/hooks/useGroupMembers'

interface GroupInfoNavbarProps {
  profile: ProfileData | null
  members: GroupMember[]
}

/**
 * GroupInfoNavbar Component - Displays group information in the navbar
 * Shows group greeting and members list in a two-line format
 */
export default function GroupInfoNavbar({ profile, members }: GroupInfoNavbarProps) {
  if (!profile || !profile.group_id) {
    return (
      <div className="text-sm text-gray-500">
        Chargement...
      </div>
    )
  }

  // Format members list for display (first names only)
  const formatMembersList = () => {
    if (members.length === 0) {
      return 'Aucun membre'
    }

    // Get first names of all members
    const firstNames = members.map(member => member.first_name)

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
      <div className="flex items-center space-x-1 mt-0.5">
        <div className="text-xs text-gray-600">
          Membres :
        </div>
        <div className="text-xs text-purple-600 font-medium truncate">
          {formatMembersList()}
        </div>
      </div>
    </div>
  )
}