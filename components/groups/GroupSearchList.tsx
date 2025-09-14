'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SearchableGroup } from '@/app/api/groups/search/route'

interface GroupSearchListProps {
  groups: SearchableGroup[]
  isLoading: boolean
  onJoinGroup: (groupId: string) => Promise<boolean>
}

/**
 * Component to display search results and allow joining groups
 */
export default function GroupSearchList({ groups, isLoading, onJoinGroup }: GroupSearchListProps) {
  const [joiningGroup, setJoiningGroup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Handles joining a group
   */
  const handleJoinGroup = async (groupId: string) => {
    setJoiningGroup(groupId)
    setError(null)

    try {
      const success = await onJoinGroup(groupId)
      if (!success) {
        setError('Erreur lors de l\'adhésion au groupe')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setJoiningGroup(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="flex justify-between items-start">
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-gray-300 rounded w-1/3"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/4"></div>
              </div>
              <div className="h-8 bg-gray-300 rounded w-20"></div>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="space-y-2">
          <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900">Aucun groupe trouvé</h3>
          <p className="text-gray-500">
            Essayez de modifier votre recherche ou créez un nouveau groupe.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Groups List */}
      {groups.map((group) => (
        <Card key={group.id} className="p-4">
          <div className="flex justify-between items-start">
            <div className="space-y-2 flex-1">
              <div className="flex items-center space-x-2">
                <h3 className="font-medium text-gray-900">{group.name}</h3>
                {group.is_member && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Membre
                  </span>
                )}
              </div>
              
              <div className="space-y-1 text-sm text-gray-500">
                <p>
                  Budget estimé : <span className="font-medium">{group.monthly_budget_estimate.toFixed(2)} €/mois</span>
                </p>
                <p>
                  Membres : <span className="font-medium">{group.member_count}</span>
                </p>
                <p>
                  Créé par : <span className="font-medium">{group.creator_name}</span>
                </p>
                <p className="text-xs">
                  Créé le {new Date(group.created_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </div>

            <div className="ml-4">
              {group.is_member ? (
                <Button variant="outline" disabled className="text-green-600 border-green-300">
                  Déjà membre
                </Button>
              ) : (
                <Button
                  onClick={() => handleJoinGroup(group.id)}
                  disabled={joiningGroup === group.id}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                >
                  {joiningGroup === group.id ? 'Adhésion...' : 'Rejoindre'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}