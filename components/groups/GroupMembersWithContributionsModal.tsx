'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { GroupData } from '@/app/api/groups/route'

interface GroupMembersWithContributionsModalProps {
  group: GroupData
  isOpen: boolean
  onClose: () => void
}

/**
 * Enhanced modal component for displaying group members with their contributions
 * Shows list of all members with their names, join dates, and contribution information
 */
export default function GroupMembersWithContributionsModal({ group, isOpen, onClose }: GroupMembersWithContributionsModalProps) {
  const { members, isLoading: membersLoading, error: membersError, fetchGroupMembers, clearMembers } = useGroupMembers()
  const { contributions, groupInfo, isLoading: contributionsLoading, error: contributionsError, fetchContributions } = useGroupContributions()

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
      maximumFractionDigits: 0
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

  /**
   * Gets contribution data for a member
   */
  const getMemberContribution = (memberId: string) => {
    return contributions.find(contrib => contrib.profile_id === memberId)
  }

  if (!isOpen) return null

  const isLoading = membersLoading || contributionsLoading
  const hasError = membersError || contributionsError
  const error = membersError || contributionsError

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black bg-opacity-50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Membres et contributions</h2>
              <p className="text-sm text-gray-500">{group.name}</p>
              {groupInfo && (
                <p className="text-xs text-gray-400 mt-1">
                  Budget: {formatCurrency(groupInfo.monthly_budget_estimate)}/mois
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>

          {/* Content */}
          <div className="p-6 max-h-96 overflow-y-auto">
            {isLoading ? (
              /* Loading State */
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Chargement des données...</p>
              </div>
            ) : hasError ? (
              /* Error State */
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Erreur de chargement</h3>
                <p className="text-gray-600 mb-4">{error}</p>
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
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun membre</h3>
                <p className="text-gray-600">Ce groupe n'a actuellement aucun membre.</p>
              </div>
            ) : (
              /* Members List with Contributions */
              <div className="space-y-3">
                <div className="flex justify-between items-center mb-4">
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
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                              {member.first_name.charAt(0)}{member.last_name.charAt(0)}
                            </div>
                            
                            {/* Member Info */}
                            <div>
                              <p className="font-medium text-gray-900">
                                {member.first_name} {member.last_name}
                              </p>
                              <p className="text-xs text-gray-500">
                                Membre depuis le {new Date(member.joined_at).toLocaleDateString('fr-FR')}
                              </p>
                            </div>
                          </div>

                          {/* Creator Badge */}
                          {member.id === group.creator_id && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              Créateur
                            </span>
                          )}
                        </div>

                        {/* Contribution Information */}
                        {contribution ? (
                          <div className="bg-gray-50 p-3 rounded-lg">
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
                          <div className="bg-yellow-50 p-3 rounded-lg">
                            <div className="flex items-center space-x-2">
                              <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-sm text-yellow-700">
                                Contribution non calculée
                              </span>
                            </div>
                            <p className="text-xs text-yellow-600 mt-1">
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
          <div className="p-6 border-t border-gray-200">
            {groupInfo && (
              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <h4 className="text-sm font-medium text-blue-800 mb-2">Résumé du groupe</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-blue-600">Budget mensuel:</span>
                    <p className="font-medium">{formatCurrency(groupInfo.monthly_budget_estimate)}</p>
                  </div>
                  <div>
                    <span className="text-blue-600">Total contributions:</span>
                    <p className="font-medium">{formatCurrency(groupInfo.total_contributions)}</p>
                  </div>
                </div>
              </div>
            )}
            <Button 
              onClick={onClose}
              className="w-full"
              variant="outline"
            >
              Fermer
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}