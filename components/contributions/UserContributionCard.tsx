'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import { useGroupContributions } from '@/hooks/useGroupContributions'

interface UserContributionCardProps {
  userId: string
  className?: string
}

/**
 * Component for displaying the user's personal contribution information
 */
export default function UserContributionCard({ userId, className }: UserContributionCardProps) {
  const {
    groupInfo,
    isLoading,
    isFetching,
    error,
    fetchContributions,
    getUserContribution,
    hasGroup,
    isRecalculating,
    recalculateContributions,
  } = useGroupContributions()

  /**
   * Formats currency amount for display
   */
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  /**
   * Formats percentage for display
   */
  const formatPercentage = (percentage: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(percentage / 100)
  }

  // Don't show if user has no group
  if (!hasGroup || !groupInfo) {
    return null
  }

  if (isLoading || isFetching) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={`border-red-200 p-6 ${className}`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="mb-1.5 text-lg font-semibold text-red-800">Erreur de contribution</h3>
            <p className="text-sm text-red-600">{error}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchContributions}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            Réessayer
          </Button>
        </div>
      </Card>
    )
  }

  const userContribution = getUserContribution(userId)

  return (
    <Card className={`p-6 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Votre contribution</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={recalculateContributions}
          disabled={isRecalculating}
          className="border-blue-300 text-blue-600 hover:bg-blue-50"
        >
          {isRecalculating && <InlineSpinner className="mr-1.5" />}
          {isRecalculating ? 'Recalcul...' : 'Actualiser'}
        </Button>
      </div>

      {userContribution ? (
        <div className="space-y-3">
          {/* Group Budget Info */}
          <div className="rounded-lg bg-gray-50 p-4">
            <h4 className="mb-1.5 text-sm font-medium text-gray-700">Budget du groupe</h4>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(groupInfo.monthly_budget_estimate)} / mois
            </p>
          </div>

          {/* User Contribution Details */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Contribution Amount */}
            <div className="rounded-lg bg-blue-50 p-4">
              <h4 className="mb-1 text-sm font-medium text-blue-700">Votre contribution</h4>
              <p className="text-xl font-bold text-blue-900">
                {formatCurrency(userContribution.contribution_amount)}
              </p>
              <p className="mt-1 text-xs text-blue-600">par mois</p>
            </div>

            {/* Contribution Percentage */}
            <div className="rounded-lg bg-green-50 p-4">
              <h4 className="mb-1 text-sm font-medium text-green-700">Pourcentage</h4>
              <p className="text-xl font-bold text-green-900">
                {formatPercentage(userContribution.contribution_percentage)}
              </p>
              <p className="mt-1 text-xs text-green-600">de votre salaire</p>
            </div>
          </div>

          {/* Salary Info */}
          {userContribution.salary > 0 && (
            <div className="rounded-lg bg-gray-50 p-4">
              <h4 className="mb-1.5 text-sm font-medium text-gray-700">Basé sur votre salaire</h4>
              <p className="text-lg font-semibold text-gray-900">
                {formatCurrency(userContribution.salary)} / mois
              </p>
            </div>
          )}

          {/* Group Statistics */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="mb-2 text-sm font-medium text-gray-700">Statistiques du groupe</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Total des salaires:</span>
                <p className="font-medium">{formatCurrency(groupInfo.total_salaries)}</p>
              </div>
              <div>
                <span className="text-gray-500">Total des contributions:</span>
                <p className="font-medium">{formatCurrency(groupInfo.total_contributions)}</p>
              </div>
            </div>
          </div>

          {/* Last Updated */}
          <div className="text-center text-xs text-gray-500">
            Dernière mise à jour:{' '}
            {userContribution.calculated_at
              ? new Date(userContribution.calculated_at).toLocaleString('fr-FR')
              : '—'}
          </div>
        </div>
      ) : (
        <div className="py-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <svg
              className="h-8 w-8 text-yellow-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h4 className="mb-1.5 text-lg font-medium text-gray-900">Contribution non calculée</h4>
          <p className="mb-3 text-gray-600">
            Vos contributions ne sont pas encore calculées. Assurez-vous d&apos;avoir défini votre
            salaire.
          </p>
          <Button
            onClick={recalculateContributions}
            disabled={isRecalculating}
            className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
          >
            {isRecalculating && <InlineSpinner className="mr-1.5" />}
            {isRecalculating ? 'Calcul en cours...' : 'Calculer maintenant'}
          </Button>
        </div>
      )}
    </Card>
  )
}
