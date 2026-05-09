'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import type { GroupData } from '@/app/api/groups/route'

interface GroupMembersModalProps {
  group: GroupData
  isOpen: boolean
  onClose: () => void
}

/**
 * Modal component for displaying group members
 * Shows list of all members with their names and join dates
 */
export default function GroupMembersModal({ group, isOpen, onClose }: GroupMembersModalProps) {
  const { members, isLoading, error, fetchGroupMembers, clearMembers } = useGroupMembers()

  // Fetch members when modal opens
  useEffect(() => {
    if (isOpen && group.id) {
      fetchGroupMembers(group.id)
    } else if (!isOpen) {
      clearMembers()
    }
  }, [isOpen, group.id, fetchGroupMembers, clearMembers])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="max-h-[90vh] w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Membres du groupe</h2>
              <p className="text-sm text-gray-500">{group.name}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="p-2">
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

          {/* Content */}
          <div className="max-h-96 overflow-y-auto p-6">
            {isLoading ? (
              /* Loading State */
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="text-gray-600">Chargement des membres...</p>
              </div>
            ) : error ? (
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
                  onClick={() => fetchGroupMembers(group.id)}
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
              /* Members List */
              <div className="space-y-3">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">
                    {members.length} membre{members.length > 1 ? 's' : ''}
                  </h3>
                </div>

                {members.map((member) => (
                  <Card key={member.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {/* Avatar */}
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 font-medium text-white">
                          {member.first_name.charAt(0)}
                          {member.last_name.charAt(0)}
                        </div>

                        {/* Member Info */}
                        <div>
                          <p className="font-medium text-gray-900">
                            {member.first_name} {member.last_name}
                          </p>
                          <p className="text-sm text-gray-500">
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
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 p-6">
            <Button onClick={onClose} className="w-full" variant="outline">
              Fermer
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
