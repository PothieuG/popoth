'use client'

import { useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import type { GroupData } from '@/app/api/groups/route'

interface GroupMembersWithContributionsModalProps {
  group: GroupData
  isOpen: boolean
  onClose: () => void
}

/**
 * Enhanced modal component for displaying group members with their contributions.
 * Shows list of all members with their names, join dates, and contribution information.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 */
export default function GroupMembersWithContributionsModal({
  group,
  isOpen,
  onClose,
}: GroupMembersWithContributionsModalProps) {
  const {
    members,
    isLoading: membersLoading,
    error: membersError,
    fetchGroupMembers,
    clearMembers,
  } = useGroupMembers()
  const {
    contributions,
    groupInfo,
    isLoading: contributionsLoading,
    error: contributionsError,
    fetchContributions,
  } = useGroupContributions()

  // Fetch data when modal opens
  useEffect(() => {
    if (isOpen && group.id) {
      fetchGroupMembers(group.id)
      fetchContributions()
    } else if (!isOpen) {
      clearMembers()
    }
  }, [isOpen, group.id, fetchGroupMembers, fetchContributions, clearMembers])

  /**
   * Formats currency amount for display
   */
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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

  /**
   * Gets contribution data for a member
   */
  const getMemberContribution = (memberId: string) => {
    return contributions.find((contrib) => contrib.profile_id === memberId)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const isLoading = membersLoading || contributionsLoading
  const hasError = membersError || contributionsError
  const error = membersError || contributionsError

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden rounded-lg border-0 p-0 shadow-xl sm:max-w-2xl sm:rounded-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-6">
          <div>
            <DialogTitle asChild>
              <h2 className="text-lg font-semibold text-gray-900">Membres et contributions</h2>
            </DialogTitle>
            <p className="text-sm text-gray-500">{group.name}</p>
            {groupInfo && (
              <p className="mt-1 text-xs text-gray-400">
                Budget: {formatCurrency(groupInfo.monthly_budget_estimate)}/mois
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer" className="p-2">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto p-6">
            {isLoading ? (
              /* Loading State */
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="text-gray-600">Chargement des données...</p>
              </div>
            ) : hasError ? (
              /* Error State */
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg
                    className="h-6 w-6 text-red-600"
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
                <h3 className="mb-2 text-lg font-medium text-gray-900">Erreur de chargement</h3>
                <p className="mb-4 text-gray-600">{error}</p>
                <Button
                  onClick={() => {
                    fetchGroupMembers(group.id)
                    fetchContributions()
                  }}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                >
                  Réessayer
                </Button>
              </div>
            ) : members.length === 0 ? (
              /* Empty State */
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <svg
                    className="h-6 w-6 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-medium text-gray-900">Aucun membre</h3>
                <p className="text-gray-600">Ce groupe n&apos;a actuellement aucun membre.</p>
              </div>
            ) : (
              /* Members List with Contributions */
              <div className="space-y-3">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">
                    {members.length} membre{members.length > 1 ? 's' : ''}
                  </h3>
                  {groupInfo && (
                    <div className="text-sm text-gray-500">
                      Total: {formatCurrency(groupInfo.total_contributions)}
                    </div>
                  )}
                </div>

                {members.map((member) => {
                  const contribution = getMemberContribution(member.id)

                  return (
                    <Card key={member.id} className="p-4">
                      <div className="space-y-3">
                        {/* Member Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {/* Avatar */}
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-medium text-white">
                              {member.first_name.charAt(0)}
                              {member.last_name.charAt(0)}
                            </div>

                            {/* Member Info */}
                            <div>
                              <p className="font-medium text-gray-900">
                                {member.first_name} {member.last_name}
                              </p>
                              <p className="text-xs text-gray-500">
                                Membre depuis le{' '}
                                {new Date(member.joined_at).toLocaleDateString('fr-FR')}
                              </p>
                            </div>
                          </div>

                          {/* Creator Badge */}
                          {member.id === group.creator_id && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                              Créateur
                            </span>
                          )}
                        </div>

                        {/* Contribution Information */}
                        {contribution ? (
                          <div className="rounded-lg bg-gray-50 p-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Contribution:</span>
                                <p className="font-semibold text-blue-600">
                                  {formatCurrency(contribution.contribution_amount)}
                                </p>
                              </div>
                              <div>
                                <span className="text-gray-600">Pourcentage:</span>
                                <p className="font-semibold text-green-600">
                                  {formatPercentage(contribution.contribution_percentage)}
                                </p>
                              </div>
                            </div>
                            {contribution.salary > 0 && (
                              <div className="mt-2 text-xs text-gray-500">
                                Basé sur un salaire de {formatCurrency(contribution.salary)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-lg bg-yellow-50 p-3">
                            <div className="flex items-center space-x-2">
                              <svg
                                className="h-4 w-4 text-yellow-600"
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
                              <span className="text-sm text-yellow-700">
                                Contribution non calculée
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-yellow-600">
                              Le membre doit définir son salaire
                            </p>
                          </div>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 p-6">
            {groupInfo && (
              <div className="mb-4 rounded-lg bg-blue-50 p-3">
                <h4 className="mb-2 text-sm font-medium text-blue-800">Résumé du groupe</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-blue-600">Budget mensuel:</span>
                    <p className="font-medium">
                      {formatCurrency(groupInfo.monthly_budget_estimate)}
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-600">Total contributions:</span>
                    <p className="font-medium">{formatCurrency(groupInfo.total_contributions)}</p>
                  </div>
                </div>
              </div>
            )}
            <Button onClick={onClose} className="w-full" variant="outline">
              Fermer
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  )
}
