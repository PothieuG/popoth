'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { GroupData } from '@/app/api/groups/route'

interface UserGroupsListProps {
  groups: GroupData[]
  isLoading: boolean
  onDeleteGroup: (group: GroupData) => void
}

/**
 * Component to display user's groups with management options
 */
export default function UserGroupsList({ groups, isLoading, onDeleteGroup }: UserGroupsListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <Card key={i} className="animate-pulse p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-gray-300"></div>
                <div className="h-3 w-1/2 rounded bg-gray-200"></div>
                <div className="h-3 w-1/4 rounded bg-gray-200"></div>
              </div>
              <div className="space-y-2">
                <div className="h-8 w-16 rounded bg-gray-300"></div>
                <div className="h-8 w-20 rounded bg-gray-300"></div>
              </div>
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
          <h3 className="text-lg font-medium text-gray-900">Aucun groupe</h3>
          <p className="text-gray-500">
            Vous n&apos;êtes membre d&apos;aucun groupe. Créez-en un ou rejoignez un groupe
            existant.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Card key={group.id} className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <div className="flex items-center space-x-2">
                <h3 className="font-medium text-gray-900">{group.name}</h3>
                {group.is_creator && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                    Créateur
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
                  Membres : <span className="font-medium">{group.member_count || 1}</span>
                </p>
                <p className="text-xs">
                  Créé le{' '}
                  {group.created_at ? new Date(group.created_at).toLocaleDateString('fr-FR') : '—'}
                </p>
              </div>
            </div>

            <div className="ml-4 space-y-2">
              {/* View Members Button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  // TODO: Implement view members functionality
                }}
              >
                Voir membres
              </Button>

              {/* Delete Button (only for creators) */}
              {group.is_creator && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDeleteGroup(group)}
                  className="w-full border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50"
                >
                  Supprimer
                </Button>
              )}

              {/* Leave Button (only for non-creators) */}
              {!group.is_creator && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-orange-300 text-orange-600 hover:border-orange-400 hover:bg-orange-50"
                  onClick={() => {
                    // TODO: Implement leave group functionality
                  }}
                >
                  Quitter
                </Button>
              )}
            </div>
          </div>

          {/* Additional Info for Creators */}
          {group.is_creator && (
            <div className="mt-3 border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Vous êtes le créateur de ce groupe</span>
                <span>
                  Dernière mise à jour :{' '}
                  {group.updated_at ? new Date(group.updated_at).toLocaleDateString('fr-FR') : '—'}
                </span>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
