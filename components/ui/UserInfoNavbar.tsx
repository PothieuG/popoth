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

  const contributionAmount = userContribution?.contribution_amount ?? 0
  const hasPositiveContribution = userContribution != null && contributionAmount > 0
  const percentage =
    userContribution && profile.salary > 0
      ? Math.round((userContribution.contribution_amount / profile.salary) * 100)
      : null

  // Business rule explained when contribution = 0 despite being in a group:
  // contribution = (mon salaire / Σ salaires positifs du groupe) × budget mensuel du groupe.
  // Le résultat tombe à 0 si le budget du groupe n'est pas renseigné, ou si le salaire
  // de l'utilisateur est à 0 alors qu'un autre membre en a un.
  const emptyContributionTooltip =
    'Votre contribution est calculée au prorata de votre salaire sur le budget mensuel du groupe. Vérifiez que le budget du groupe et votre salaire sont bien renseignés.'

  return (
    <div className="flex flex-col">
      {/* First line: Greeting */}
      <div className="text-sm font-medium text-gray-900">
        Bonjour <span className="text-orange-600">{profile.first_name}</span> !
      </div>

      {/* Second line: Group contribution */}
      <div className="mt-0.5 flex items-center space-x-1">
        {profile.group_name && userContribution ? (
          hasPositiveContribution ? (
            <>
              <div className="truncate text-xs text-gray-600">
                Contribution au groupe {profile.group_name} :
              </div>
              <div className="text-xs font-semibold whitespace-nowrap text-purple-600">
                {formatContribution(contributionAmount)}
              </div>
              {percentage != null && percentage > 0 && (
                <div className="text-xs whitespace-nowrap text-gray-500">({percentage}%)</div>
              )}
            </>
          ) : (
            <div className="truncate text-xs text-gray-500 italic" title={emptyContributionTooltip}>
              Contribution au groupe {profile.group_name} : à définir
            </div>
          )
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
