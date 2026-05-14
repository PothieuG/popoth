'use client'

import type { ProfileData } from '@/app/api/profile/route'
import type { GroupContributionData } from '@/app/api/groups/contributions/route'

interface UserInfoNavbarProps {
  profile: ProfileData | null
  userContribution: GroupContributionData | null
}

/**
 * UserInfoNavbar Component - Displays user contribution information in the navbar
 * Shows family contribution details in an explanatory and elegant way
 */
export default function UserInfoNavbar({ profile, userContribution }: UserInfoNavbarProps) {
  if (!profile) {
    return <div className="text-sm text-gray-500">Chargement...</div>
  }

  // Format contribution amount for display
  const formatContribution = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  // Calculate contribution percentage of salary
  const getContributionPercentage = () => {
    if (!userContribution || !profile.salary || profile.salary === 0) {
      return null
    }
    const percentage = (userContribution.contribution_amount / profile.salary) * 100
    return Math.round(percentage)
  }

  return (
    <div className="flex flex-col">
      {/* First line: Greeting */}
      <div className="text-sm font-medium text-gray-900">
        Bonjour <span className="text-orange-600">{profile.first_name}</span> !
      </div>

      {/* Second line: Group contribution */}
      <div className="mt-0.5 flex items-center space-x-1">
        {profile.group_name && userContribution ? (
          <>
            <div className="truncate text-xs text-gray-600">
              Contribution au groupe {profile.group_name} :
            </div>
            <div className="text-xs font-semibold whitespace-nowrap text-purple-600">
              {formatContribution(userContribution.contribution_amount)}
            </div>
            {getContributionPercentage() && (
              <div className="text-xs whitespace-nowrap text-gray-500">
                ({getContributionPercentage()}%)
              </div>
            )}
          </>
        ) : profile.group_name ? (
          <div className="truncate text-xs text-gray-500">
            Groupe {profile.group_name} • Contribution en cours de calcul
          </div>
        ) : (
          <div className="text-xs text-gray-500">Créez un groupe pour partager vos finances</div>
        )}
      </div>
    </div>
  )
}
