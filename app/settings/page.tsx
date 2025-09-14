'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { useGroupSearch } from '@/hooks/useGroupSearch'
import CreateGroupForm from '@/components/groups/CreateGroupForm'
import GroupSearchList from '@/components/groups/GroupSearchList'
import DeleteGroupModal from '@/components/groups/DeleteGroupModal'
import GroupMembersModal from '@/components/groups/GroupMembersModal'
import { GroupData } from '@/app/api/groups/route'

/**
 * Settings page - User settings and group management
 */
export default function SettingsPage() {
  const { logoutAndRedirect } = useAuth()
  const { currentGroup, hasGroup, isLoading: groupsLoading, createGroup, deleteGroup, leaveGroup } = useGroups()
  const { 
    searchResults, 
    isLoading: searchLoading, 
    searchGroups, 
    loadAllGroups,
    updateGroupMembership,
    hasSearched,
    clearSearch
  } = useGroupSearch()
  const { joinGroup } = useGroups()
  
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<GroupData | null>(null)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [isOperationLoading, setIsOperationLoading] = useState(false)

  /**
   * Handles group creation
   */
  const handleCreateGroup = async (name: string, budget: number): Promise<boolean> => {
    const success = await createGroup({ name, monthly_budget_estimate: budget })
    if (success) {
      setShowCreateForm(false)
      // Clear search results since user now has a group
      clearSearch()
      setShowSearch(false)
    }
    return success
  }

  /**
   * Handles joining a group from search results
   */
  const handleJoinGroup = async (groupId: string): Promise<boolean> => {
    setIsOperationLoading(true)
    try {
      const success = await joinGroup(groupId)
      if (success) {
        updateGroupMembership(groupId, true)
        // Clear search and hide it since user now has a group
        clearSearch()
        setShowSearch(false)
      }
      return success
    } finally {
      setIsOperationLoading(false)
    }
  }

  /**
   * Handles leaving the current group
   */
  const handleLeaveGroup = async (): Promise<boolean> => {
    if (!currentGroup) return false
    
    setIsOperationLoading(true)
    try {
      const success = await leaveGroup(currentGroup.id)
      if (success) {
        // User can now search for groups again
        setShowSearch(false)
      }
      return success
    } finally {
      setIsOperationLoading(false)
    }
  }

  /**
   * Handles group search
   */
  const handleSearch = async () => {
    if (searchQuery.trim()) {
      await searchGroups(searchQuery)
    } else {
      await loadAllGroups()
    }
    setShowSearch(true)
  }

  /**
   * Handles group deletion
   */
  const handleDeleteGroup = async (groupId: string): Promise<boolean> => {
    const success = await deleteGroup(groupId)
    if (success) {
      setGroupToDelete(null)
    }
    return success
  }

  /**
   * Opens delete confirmation modal
   */
  const openDeleteModal = () => {
    if (currentGroup) {
      setGroupToDelete(currentGroup)
    }
  }

  /**
   * Loads all groups for browsing
   */
  const handleBrowseGroups = async () => {
    if (hasGroup) {
      // User already has a group, show message
      alert('Vous êtes déjà membre d\'un groupe. Quittez d\'abord votre groupe actuel pour en rejoindre un autre.')
      return
    }
    
    setSearchQuery('')
    await loadAllGroups()
    setShowSearch(true)
  }

  // Show loading screen while fetching group data
  if (groupsLoading && !hasGroup && !currentGroup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Header */}
        <div className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
          <div className="flex justify-between items-center p-4">
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.history.back()}
                className="p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </Button>
              <h1 className="text-xl font-semibold text-gray-900">Gestion du groupe</h1>
            </div>
            <Button
              onClick={logoutAndRedirect}
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              Se déconnecter
            </Button>
          </div>
        </div>

        {/* Loading Content */}
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 mb-2">Chargement de vos groupes...</p>
            <p className="text-sm text-gray-500">Veuillez patienter</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 relative">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
        <div className="flex justify-between items-center p-4">
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.history.back()}
              className="p-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <h1 className="text-xl font-semibold text-gray-900">Gestion du groupe</h1>
          </div>
          <Button
            onClick={logoutAndRedirect}
            variant="outline"
            size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            Se déconnecter
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <main className="p-4 space-y-6">
        {/* My Group Section */}
        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Mon groupe</h2>
            {!hasGroup && (
              <Button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
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

          {/* Current Group Display */}
          {hasGroup && currentGroup ? (
            <Card className="p-4">
              <div className="flex justify-between items-start">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-medium text-gray-900">{currentGroup.name}</h3>
                    {currentGroup.is_creator && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        Créateur
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-1 text-sm text-gray-500">
                    <p>
                      Budget estimé : <span className="font-medium">{currentGroup.monthly_budget_estimate.toFixed(2)} €/mois</span>
                    </p>
                    <p>
                      Membres : <span className="font-medium">{currentGroup.member_count || 1}</span>
                    </p>
                    <p className="text-xs">
                      Créé le {new Date(currentGroup.created_at).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>

                <div className="ml-4 space-y-2">
                  {/* View Members Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowMembersModal(true)}
                    disabled={isOperationLoading}
                  >
                    Voir membres
                  </Button>

                  {/* Action Buttons */}
                  {currentGroup.is_creator ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openDeleteModal}
                      disabled={isOperationLoading}
                      className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 disabled:opacity-50"
                    >
                      Supprimer
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLeaveGroup}
                      disabled={isOperationLoading}
                      className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400 disabled:opacity-50"
                    >
                      {isOperationLoading ? 'Chargement...' : 'Quitter'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Additional Info for Creators */}
              {currentGroup.is_creator && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span>Vous êtes le créateur de ce groupe</span>
                    <span>Dernière mise à jour : {new Date(currentGroup.updated_at).toLocaleDateString('fr-FR')}</span>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            !showCreateForm && (
              <Card className="p-8 text-center">
                <div className="space-y-2">
                  <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">Aucun groupe</h3>
                  <p className="text-gray-500">
                    Vous n'appartenez à aucun groupe. Créez-en un ou rejoignez un groupe existant.
                  </p>
                </div>
              </Card>
            )
          )}
        </Card>

        {/* Join Group Section - Only show if user has no group */}
        {!hasGroup && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Rejoindre un groupe</h2>
            
            {/* Search Interface */}
            <div className="space-y-4 mb-6">
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
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                >
                  {searchLoading ? 'Recherche...' : 'Rechercher'}
                </Button>
              </div>
              
              <div className="flex justify-center">
                <Button 
                  variant="outline" 
                  onClick={handleBrowseGroups}
                  disabled={searchLoading}
                >
                  Voir tous les groupes disponibles
                </Button>
              </div>
            </div>

            {/* Search Results */}
            {showSearch && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-medium text-gray-900">
                    {hasSearched ? 'Résultats de recherche' : 'Groupes disponibles'}
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setShowSearch(false)
                    clearSearch()
                  }}>
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
          <Card className="p-6 bg-blue-50 border-blue-200">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-medium text-blue-800">
                  Vous appartenez déjà à un groupe
                </h3>
                <p className="mt-1 text-sm text-blue-700">
                  Pour rejoindre un autre groupe, vous devez d'abord quitter votre groupe actuel.
                </p>
              </div>
            </div>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {groupToDelete && (
        <DeleteGroupModal
          group={groupToDelete}
          isOpen={true}
          onClose={() => setGroupToDelete(null)}
          onConfirm={handleDeleteGroup}
        />
      )}

      {/* Group Members Modal */}
      {currentGroup && (
        <GroupMembersModal
          group={currentGroup}
          isOpen={showMembersModal}
          onClose={() => setShowMembersModal(false)}
        />
      )}

      {/* Loading Overlay for Group Operations */}
      {isOperationLoading && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 shadow-xl text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-700 font-medium">Opération en cours...</p>
            <p className="text-sm text-gray-500 mt-1">Veuillez patienter</p>
          </div>
        </div>
      )}
    </div>
  )
}