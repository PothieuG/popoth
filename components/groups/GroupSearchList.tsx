'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { SearchableGroup } from '@/app/api/groups/search/route'

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
        setError("Erreur lors de l'adhésion au groupe")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setJoiningGroup(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-1/3 rounded bg-gray-300"></div>
                <div className="h-3 w-1/2 rounded bg-gray-200"></div>
                <div className="h-3 w-1/4 rounded bg-gray-200"></div>
              </div>
              <div className="h-8 w-20 rounded bg-gray-300"></div>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="space-y-1.5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="h-8 w-8 text-gray-400"
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
          <h3 className="text-lg font-medium text-gray-900">Aucun groupe trouvé</h3>
          <p className="text-gray-500">
            Essayez de modifier votre recherche ou créez un nouveau groupe.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {/* Error Message */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Groups List */}
      {groups.map((group) => (
        <Card key={group.id} className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center space-x-1.5">
                <h3 className="font-medium text-gray-900">{group.name}</h3>
                {group.is_member && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                    Membre
                  </span>
                )}
              </div>

              <div className="space-y-1 text-sm text-gray-500">
                <p>
                  Budget estimé :{' '}
                  <span className="font-medium">
                    {group.monthly_budget_estimate.toFixed(2)} €/mois
                  </span>
                </p>
                <p>
                  Membres : <span className="font-medium">{group.member_count}</span>
                </p>
                <p>
                  Créé par : <span className="font-medium">{group.creator_name}</span>
                </p>
                <p className="text-xs">
                  Créé le{' '}
                  {group.created_at ? new Date(group.created_at).toLocaleDateString('fr-FR') : '—'}
                </p>
              </div>
            </div>

            <div className="ml-3">
              {group.is_member ? (
                <Button variant="outline" disabled className="border-green-300 text-green-600">
                  Déjà membre
                </Button>
              ) : (
                <Button
                  onClick={() => handleJoinGroup(group.id)}
                  disabled={joiningGroup === group.id}
                  className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
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
