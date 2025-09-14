'use client'

import { useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
    contributions,
    groupInfo,
    isLoading,
    error,
    fetchContributions,
    getUserContribution,
    hasGroup,
    isRecalculating,
    recalculateContributions
  } = useGroupContributions()

  // Load contributions on mount
  useEffect(() => {
    fetchContributions()
  }, [fetchContributions])

  /**
   * Formats currency amount for display
   */
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount)
  }

  /**
   * Formats percentage for display
   */
  const formatPercentage = (percentage: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(percentage / 100)
  }

  // Don't show if user has no group
  if (!hasGroup || !groupInfo) {
    return null
  }

  if (isLoading) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={`p-6 border-red-200 ${className}`}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-red-800 mb-2">Erreur de contribution</h3>
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
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Votre contribution</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={recalculateContributions}
          disabled={isRecalculating}
          className="text-blue-600 border-blue-300 hover:bg-blue-50"
        >
          {isRecalculating ? 'Recalcul...' : 'Actualiser'}
        </Button>
      </div>

      {userContribution ? (
        <div className="space-y-4">
          {/* Group Budget Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Budget du groupe</h4>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(groupInfo.monthly_budget_estimate)} / mois
            </p>
          </div>

          {/* User Contribution Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contribution Amount */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-blue-700 mb-1">Votre contribution</h4>
              <p className="text-xl font-bold text-blue-900">
                {formatCurrency(userContribution.contribution_amount)}
              </p>
              <p className="text-xs text-blue-600 mt-1">par mois</p>
            </div>

            {/* Contribution Percentage */}
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-green-700 mb-1">Pourcentage</h4>
              <p className="text-xl font-bold text-green-900">
                {formatPercentage(userContribution.contribution_percentage)}
              </p>
              <p className="text-xs text-green-600 mt-1">de votre salaire</p>
            </div>
          </div>

          {/* Salary Info */}
          {userContribution.salary > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Basé sur votre salaire</h4>
              <p className="text-lg font-semibold text-gray-900">
                {formatCurrency(userContribution.salary)} / mois
              </p>
            </div>
          )}

          {/* Group Statistics */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Statistiques du groupe</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
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
          <div className="text-xs text-gray-500 text-center">
            Dernière mise à jour: {new Date(userContribution.calculated_at).toLocaleString('fr-FR')}
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto bg-yellow-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h4 className="text-lg font-medium text-gray-900 mb-2">Contribution non calculée</h4>
          <p className="text-gray-600 mb-4">
            Vos contributions ne sont pas encore calculées. Assurez-vous d'avoir défini votre salaire.
          </p>
          <Button
            onClick={recalculateContributions}
            disabled={isRecalculating}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
          >
            {isRecalculating ? 'Calcul en cours...' : 'Calculer maintenant'}
          </Button>
        </div>
      )}
    </Card>
  )
}