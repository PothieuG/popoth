'use client'

import { ProfileData } from '@/app/api/profile/route'
import { GroupContributionData } from '@/app/api/groups/contributions/route'

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
    return (
      <div className="text-sm text-gray-500">
        Chargement...
      </div>
    )
  }

  // Format contribution amount for display
  const formatContribution = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
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
      <div className="flex items-center space-x-1 mt-0.5">
        {profile.group_name && userContribution ? (
          <>
            <div className="text-xs text-gray-600 truncate">
              Contribution au groupe {profile.group_name} :
            </div>
            <div className="text-xs font-semibold text-purple-600 whitespace-nowrap">
              {formatContribution(userContribution.contribution_amount)}
            </div>
            {getContributionPercentage() && (
              <div className="text-xs text-gray-500 whitespace-nowrap">
                ({getContributionPercentage()}%)
              </div>
            )}
          </>
        ) : profile.group_name ? (
          <div className="text-xs text-gray-500 truncate">
            Groupe {profile.group_name} • Contribution en cours de calcul
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            Créez un groupe pour partager vos finances
          </div>
        )}
      </div>
    </div>
  )
}