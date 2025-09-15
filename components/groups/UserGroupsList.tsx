'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GroupData } from '@/app/api/groups/route'

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
          <Card key={i} className="p-4 animate-pulse">
            <div className="flex justify-between items-start">
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-gray-300 rounded w-1/3"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/4"></div>
              </div>
              <div className="space-y-2">
                <div className="h-8 bg-gray-300 rounded w-16"></div>
                <div className="h-8 bg-gray-300 rounded w-20"></div>
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
          <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900">Aucun groupe</h3>
          <p className="text-gray-500">
            Vous n'êtes membre d'aucun groupe. Créez-en un ou rejoignez un groupe existant.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Card key={group.id} className="p-4">
          <div className="flex justify-between items-start">
            <div className="space-y-2 flex-1">
              <div className="flex items-center space-x-2">
                <h3 className="font-medium text-gray-900">{group.name}</h3>
                {group.is_creator && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    Créateur
                  </span>
                )}
              </div>
              
              <div className="space-y-1 text-sm text-gray-500">
                <p>
                  Budget estimé : <span className="font-medium">{group.monthly_budget_estimate.toFixed(2)} €/mois</span>
                </p>
                <p>
                  Membres : <span className="font-medium">{group.member_count || 1}</span>
                </p>
                <p className="text-xs">
                  Créé le {new Date(group.created_at).toLocaleDateString('fr-FR')}
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
                  className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                >
                  Supprimer
                </Button>
              )}

              {/* Leave Button (only for non-creators) */}
              {!group.is_creator && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400"
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
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span>Vous êtes le créateur de ce groupe</span>
                <span>Dernière mise à jour : {new Date(group.updated_at).toLocaleDateString('fr-FR')}</span>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}