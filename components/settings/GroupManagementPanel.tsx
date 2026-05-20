'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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

  const handleCreateGroup = async (name: string): Promise<boolean> => {
    const success = await createGroup({ name })
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
      const otherMembers = (currentGroup.member_count || 1) - 1
      if (otherMembers > 0) return
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

  const memberCount = currentGroup?.member_count || 1
  const isInitialLoading = groupsLoading && !hasGroup && !currentGroup
  const isCreatorBlocked = !!currentGroup?.is_creator && memberCount > 1

  return (
    <div className="flex h-full flex-col">
      {/* Header — same style as main settings panel */}
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div className="flex items-center space-x-1.5">
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
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isInitialLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-5 w-2/3 rounded bg-gray-200" />
            <div className="h-4 w-1/2 rounded bg-gray-200" />
            <div className="h-4 w-1/3 rounded bg-gray-200" />
          </div>
        ) : hasGroup && currentGroup ? (
          <>
            {/* CTA Voir les membres — iOS-style menu item, prominent en haut */}
            <button
              type="button"
              onClick={() => setShowMembersModal(true)}
              disabled={isOperationLoading}
              className="group flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-indigo-50 p-4 text-left shadow-xs transition-all hover:border-blue-300 hover:from-blue-100 hover:to-indigo-100 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98] disabled:opacity-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-purple-600 text-white shadow-sm">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">Voir les membres</p>
                <p className="text-xs text-gray-600">
                  {memberCount} membre{memberCount > 1 ? 's' : ''}
                </p>
              </div>
              <svg
                className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            {/* Section Informations du groupe — flat, no Card wrapper */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Informations du groupe</h3>
                {currentGroup.is_creator && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                    Créateur
                  </span>
                )}
              </div>

              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between border-b border-gray-100 py-2">
                  <dt className="text-gray-600">Nom</dt>
                  <dd className="font-medium text-gray-900">{currentGroup.name}</dd>
                </div>
                <div className="flex items-center justify-between border-b border-gray-100 py-2">
                  <dt className="text-gray-600">Budget estimé</dt>
                  <dd className="font-medium text-gray-900">
                    {currentGroup.monthly_budget_estimate.toFixed(2)} €/mois
                  </dd>
                </div>
                <div className="flex items-center justify-between border-b border-gray-100 py-2">
                  <dt className="text-gray-600">Membres</dt>
                  <dd className="font-medium text-gray-900">{memberCount}</dd>
                </div>
                <div className="flex items-center justify-between py-2">
                  <dt className="text-gray-600">Créé le</dt>
                  <dd className="font-medium text-gray-900">
                    {currentGroup.created_at
                      ? new Date(currentGroup.created_at).toLocaleDateString('fr-FR')
                      : '—'}
                  </dd>
                </div>
              </dl>
            </section>
          </>
        ) : (
          <>
            {/* Section Créer un groupe — flat */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Créer un groupe</h3>
                <Button
                  onClick={() => setShowCreateForm(!showCreateForm)}
                  className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
                >
                  {showCreateForm ? 'Annuler' : 'Créer'}
                </Button>
              </div>

              {showCreateForm && (
                <CreateGroupForm
                  onSubmit={handleCreateGroup}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
            </section>

            {/* Section Rejoindre un groupe — flat */}
            <section className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Rejoindre un groupe</h3>

              <div className="space-y-2">
                <div className="flex space-x-1.5">
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
                    {searchLoading ? '...' : 'Rechercher'}
                  </Button>
                </div>

                <Button
                  variant="outline"
                  onClick={handleBrowseGroups}
                  disabled={searchLoading}
                  className="w-full"
                >
                  Voir tous les groupes disponibles
                </Button>
              </div>

              {showSearch && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900">
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
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Footer — bouton Quitter le groupe (slot dédié comme "Se déconnecter" dans SettingsDrawer) */}
      {hasGroup && currentGroup && (
        <div className="space-y-1.5 border-t border-gray-200 p-4">
          {isCreatorBlocked && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              En tant que créateur, vous ne pouvez pas quitter ce groupe tant qu&apos;il y a
              d&apos;autres membres. Les autres membres doivent d&apos;abord le quitter.
            </div>
          )}
          <Button
            onClick={handleLeaveClick}
            disabled={isOperationLoading || isCreatorBlocked}
            aria-disabled={isCreatorBlocked || undefined}
            variant="outline"
            className="w-full border-orange-300 text-orange-600 hover:border-orange-400 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {isOperationLoading ? 'Chargement...' : 'Quitter le groupe'}
          </Button>
        </div>
      )}

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

      {/* Leave Warning for Creators (creator alone case — group becomes empty) */}
      <ConfirmationDialog
        isOpen={showLeaveWarning}
        onClose={() => setShowLeaveWarning(false)}
        onConfirm={() => void handleLeaveGroup()}
        title="Quitter votre groupe ?"
        message="Vous êtes le seul membre de ce groupe. En quittant, le groupe restera sans membre. Cette action est irréversible."
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
