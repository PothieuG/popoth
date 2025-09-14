import { useState, useCallback } from 'react'

export interface GroupMember {
  id: string
  first_name: string
  last_name: string
  joined_at: string
}

/**
 * Custom hook for managing group members
 * Provides methods to fetch group members
 */
export function useGroupMembers() {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Fetches all members of a specific group
   */
  const fetchGroupMembers = useCallback(async (groupId: string): Promise<boolean> => {
    if (!groupId) {
      setError('ID du groupe requis')
      return false
    }

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'GET',
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des membres')
      }

      setMembers(data.members || [])
      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('Error fetching group members:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Clears the members list and error state
   */
  const clearMembers = useCallback(() => {
    setMembers([])
    setError(null)
  }, [])

  return {
    members,
    isLoading,
    error,
    fetchGroupMembers,
    clearMembers,
    // Helpers
    memberCount: members.length,
    hasMembers: members.length > 0
  }
}