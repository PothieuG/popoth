'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGroups } from '@/hooks/useGroups'
import { useGroupSearch } from '@/hooks/useGroupSearch'
import CreateGroupForm from '@/components/groups/CreateGroupForm'
import GroupSearchList from '@/components/groups/GroupSearchList'
import GroupMembersWithContributionsModal from '@/components/groups/GroupMembersWithContributionsModal'
import ConfirmationDialog from '@/components/ui/ConfirmationDialog'

interface GroupManagementPanelProps {
  onBack: () => void
  onClose: () => void
}

export default function GroupManagementPanel({ onBack, onClose }: GroupManagementPanelProps) {
  const { currentGroup, hasGroup, isLoading: groupsLoading, createGroup, leaveGroup } = useGroups()
  const {
    searchResults,
    isLoading: searchLoading,
    searchGroups,
    loadAllGroups,
    updateGroupMembership,
    hasSearched,
    clearSearch,
  } = useGroupSearch()
  const { joinGroup } = useGroups()

  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showLeaveWarning, setShowLeaveWarning] = useState(false)
  const [isOperationLoading, setIsOperationLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const showSuccess = (message: string) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(''), 3000)
  }

  const handleCreateGroup = async (name: string, budget: number): Promise<boolean> => {
    const success = await createGroup({ name, monthly_budget_estimate: budget })
    if (success) {
      setShowCreateForm(false)
      clearSearch()
      setShowSearch(false)
      showSuccess('Groupe créé')
    }
    return success
  }

  const handleJoinGroup = async (groupId: string): Promise<boolean> => {
    setIsOperationLoading(true)
    try {
      const success = await joinGroup(groupId)
      if (success) {
        updateGroupMembership(groupId, true)
        clearSearch()
        setShowSearch(false)
        showSuccess('Vous avez rejoint le groupe')
      }
      return success
    } finally {
      setIsOperationLoading(false)
    }
  }

  const handleLeaveGroup = async (): Promise<boolean> => {
    if (!currentGroup) return false

    setIsOperationLoading(true)
    try {
      const success = await leaveGroup(currentGroup.id)
      if (success) {
        setShowSearch(false)
        setShowLeaveWarning(false)
        showSuccess('Vous avez quitté le groupe')
      }
      return success
    } finally {
      setIsOperationLoading(false)
    }
  }

  const handleLeaveClick = () => {
    if (!currentGroup) return
    if (currentGroup.is_creator) {
      setShowLeaveWarning(true)
    } else {
      void handleLeaveGroup()
    }
  }

  const handleSearch = async () => {
    if (searchQuery.trim()) {
      await searchGroups(searchQuery)
    } else {
      await loadAllGroups()
    }
    setShowSearch(true)
  }

  const handleBrowseGroups = async () => {
    if (hasGroup) {
      return
    }

    setSearchQuery('')
    await loadAllGroups()
    setShowSearch(true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — same style as main settings panel */}
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="p-2" aria-label="Retour">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Button>
          <h2 className="text-lg font-semibold text-gray-900">Gestion du groupe</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="p-2" aria-label="Fermer">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </Button>
      </div>

      {/* Content scrollable */}
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* My Group Section */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Mon groupe</h3>
            {!hasGroup && !groupsLoading && (
              <Button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
              >
                {showCreateForm ? 'Annuler' : 'Créer un groupe'}
              </Button>
            )}
          </div>

          {/* Create Group Form */}
          {showCreateForm && !hasGroup && (
            <div className="mb-6">
              <CreateGroupForm
                onSubmit={handleCreateGroup}
                onCancel={() => setShowCreateForm(false)}
              />
            </div>
          )}

          {/* Skeleton while loading initial groups */}
          {groupsLoading && !hasGroup && !currentGroup ? (
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-2/3 rounded bg-gray-200" />
              <div className="h-4 w-1/2 rounded bg-gray-200" />
              <div className="h-4 w-1/3 rounded bg-gray-200" />
            </div>
          ) : hasGroup && currentGroup ? (
            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center space-x-2">
                    <h4 className="font-medium text-gray-900">{currentGroup.name}</h4>
                  </div>

                  <div className="space-y-1 text-sm text-gray-500">
                    <p>
                      Budget estimé :{' '}
                      <span className="font-medium">
                        {currentGroup.monthly_budget_estimate.toFixed(2)} €/mois
                      </span>
                    </p>
                    <p>
                      Membres :{' '}
                      <span className="font-medium">{currentGroup.member_count || 1}</span>
                    </p>
                    <p className="text-xs">
                      Créé le{' '}
                      {currentGroup.created_at
                        ? new Date(currentGroup.created_at).toLocaleDateString('fr-FR')
                        : '—'}
                    </p>
                  </div>
                </div>

                <div className="ml-4 space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowMembersModal(true)}
                    disabled={isOperationLoading}
                  >
                    Voir membres
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLeaveClick}
                    disabled={isOperationLoading}
                    className="w-full border-orange-300 text-orange-600 hover:border-orange-400 hover:bg-orange-50 disabled:opacity-50"
                  >
                    {isOperationLoading ? 'Chargement...' : 'Quitter'}
                  </Button>
                </div>
              </div>

              {currentGroup.is_creator && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Vous êtes le créateur de ce groupe</span>
                    <span>
                      Dernière mise à jour :{' '}
                      {currentGroup.updated_at
                        ? new Date(currentGroup.updated_at).toLocaleDateString('fr-FR')
                        : '—'}
                    </span>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            !showCreateForm && (
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
                  <h4 className="text-lg font-medium text-gray-900">Aucun groupe</h4>
                  <p className="text-gray-500">
                    Vous n&apos;appartenez à aucun groupe. Créez-en un ou rejoignez un groupe
                    existant.
                  </p>
                </div>
              </Card>
            )
          )}
        </Card>

        {/* Join Group Section - Only show if user has no group */}
        {!hasGroup && !groupsLoading && (
          <Card className="p-6">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Rejoindre un groupe</h3>

            <div className="mb-6 space-y-4">
              <div className="flex space-x-2">
                <div className="flex-1">
                  <Label htmlFor="groupSearch" className="sr-only">
                    Rechercher un groupe
                  </Label>
                  <Input
                    id="groupSearch"
                    type="text"
                    placeholder="Nom du groupe à rechercher..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch()
                      }
                    }}
                    className="w-full"
                  />
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={searchLoading}
                  className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
                >
                  {searchLoading ? 'Recherche...' : 'Rechercher'}
                </Button>
              </div>

              <div className="flex justify-center">
                <Button variant="outline" onClick={handleBrowseGroups} disabled={searchLoading}>
                  Voir tous les groupes disponibles
                </Button>
              </div>
            </div>

            {showSearch && (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">
                    {hasSearched ? 'Résultats de recherche' : 'Groupes disponibles'}
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowSearch(false)
                      clearSearch()
                    }}
                  >
                    Masquer
                  </Button>
                </div>

                <GroupSearchList
                  groups={searchResults}
                  isLoading={searchLoading}
                  onJoinGroup={handleJoinGroup}
                />
              </>
            )}
          </Card>
        )}

        {/* Info message for users who already have a group */}
        {hasGroup && (
          <Card className="border-blue-200 bg-blue-50 p-6">
            <div className="flex items-center space-x-3">
              <div className="shrink-0">
                <svg
                  className="h-6 w-6 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-medium text-blue-800">
                  Vous appartenez déjà à un groupe
                </h4>
                <p className="mt-1 text-sm text-blue-700">
                  Pour rejoindre un autre groupe, vous devez d&apos;abord quitter votre groupe
                  actuel.
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Snackbar — z-[60] passe au-dessus du drawer (z-50). Pattern mirror ProfileSettingsCard.tsx. */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="animate-in slide-in-from-bottom-4 fade-in fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg duration-300"
        >
          {successMessage}
        </div>
      )}

      {/* Leave Warning for Creators */}
      <ConfirmationDialog
        isOpen={showLeaveWarning}
        onClose={() => setShowLeaveWarning(false)}
        onConfirm={() => void handleLeaveGroup()}
        title="Quitter votre groupe ?"
        message="Vous êtes le créateur de ce groupe. En quittant, vous perdez le contrôle du groupe mais celui-ci continuera d'exister avec ses membres restants. Cette action est irréversible."
        confirmText="Quitter"
        cancelText="Annuler"
        variant="warning"
        loading={isOperationLoading}
      />

      {/* Group Members Modal */}
      {currentGroup && (
        <GroupMembersWithContributionsModal
          group={currentGroup}
          isOpen={showMembersModal}
          onClose={() => setShowMembersModal(false)}
        />
      )}
    </div>
  )
}
