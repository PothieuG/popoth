'use client'

import { Skeleton } from '@/components/ui/skeleton'
import type { ProfileData } from '@/app/api/profile/route'
import type { GroupContributionData } from '@/app/api/groups/contributions/route'
import { AMOUNT_TO_FUND_TOOLTIP } from '@/lib/contribution-calculator'

interface UserInfoNavbarProps {
  profile: ProfileData | null
  userContribution: GroupContributionData | null
  /**
   * Reste à financer par les membres du groupe (budget − revenus estimés du
   * groupe, cf. `calculateAmountToFund`) — base du % "du reste à financer".
   * Les parts de tous les membres totalisent 100 %, même quand un revenu de
   * groupe (ex. CAF) couvre une partie du budget.
   */
  amountToFund?: number | null
  /**
   * True dès que les contributions sont en cours de refetch (post-mutation
   * budget ou switch de contexte). Remplace le montant + les % par skeletons
   * tout en conservant le "Bonjour".
   */
  isFetching?: boolean
}

/**
 * UserInfoNavbar Component - Displays user contribution information in the navbar.
 * Shows family contribution details in an explanatory and elegant way.
 *
 * Layout (3 lignes mobile-first ≤ 430 px) :
 *   1. "Bonjour <prénom> !"
 *   2. "Contribution au groupe <nom> : <montant>"
 *   3. (si contribution > 0) "<X%> de votre salaire · <Y%> du reste à financer" —
 *      petits caractères, chiffres en gras pour scanning rapide.
 */
export default function UserInfoNavbar({
  profile,
  userContribution,
  amountToFund,
  isFetching = false,
}: UserInfoNavbarProps) {
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
  const salaryPercent =
    userContribution && profile.salary > 0
      ? Math.round((userContribution.contribution_amount / profile.salary) * 100)
      : null
  const fundedSharePercent =
    userContribution && amountToFund && amountToFund > 0
      ? Math.round((userContribution.contribution_amount / amountToFund) * 100)
      : null
  const hasPercentRow =
    hasPositiveContribution &&
    ((salaryPercent != null && salaryPercent > 0) ||
      (fundedSharePercent != null && fundedSharePercent > 0))

  // Business rule explained when contribution = 0 despite being in a group:
  // contribution = (mon salaire / Σ salaires positifs du groupe) × (budget − revenus du groupe).
  // Le résultat tombe à 0 si le budget du groupe n'est pas renseigné, si les revenus du
  // groupe couvrent tout le budget, ou si le salaire de l'utilisateur est à 0 alors
  // qu'un autre membre en a un.
  const emptyContributionTooltip =
    'Votre contribution est calculée au prorata de votre salaire sur le reste à financer du groupe (budget mensuel moins les revenus du groupe). Vérifiez que le budget du groupe et votre salaire sont bien renseignés.'

  return (
    <div className="flex flex-col">
      {/* First line: Greeting */}
      <div className="text-sm font-medium text-gray-900">
        Bonjour <span className="text-orange-600">{profile.first_name}</span> !
      </div>

      {/* Second line: Group contribution amount */}
      <div className="mt-0.5 flex items-center space-x-1">
        {isFetching && profile.group_name ? (
          <>
            <div className="truncate text-xs text-gray-600">
              Contribution au groupe {profile.group_name} :
            </div>
            <Skeleton className="h-3 w-12" />
          </>
        ) : profile.group_name && userContribution ? (
          hasPositiveContribution ? (
            <>
              <div className="truncate text-xs text-gray-600">
                Contribution au groupe {profile.group_name} :
              </div>
              <div className="text-xs font-semibold whitespace-nowrap text-purple-600">
                {formatContribution(contributionAmount)}
              </div>
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

      {/* Third line: percentages (small, with bold numbers). Hidden if both are
          unavailable (e.g. salary missing AND nothing left to fund). */}
      {isFetching && profile.group_name ? (
        <div className="mt-0.5 flex items-center gap-x-1.5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      ) : (
        hasPercentRow && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-gray-500">
            {salaryPercent != null && salaryPercent > 0 && (
              <span className="whitespace-nowrap">
                <strong className="font-semibold text-gray-700">{salaryPercent}%</strong> de votre
                salaire
              </span>
            )}
            {salaryPercent != null &&
              salaryPercent > 0 &&
              fundedSharePercent != null &&
              fundedSharePercent > 0 && <span className="text-gray-300">·</span>}
            {fundedSharePercent != null && fundedSharePercent > 0 && (
              <span className="whitespace-nowrap" title={AMOUNT_TO_FUND_TOOLTIP}>
                <strong className="font-semibold text-gray-700">{fundedSharePercent}%</strong> du
                reste à financer
              </span>
            )}
          </div>
        )
      )}
    </div>
  )
}
