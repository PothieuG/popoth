import { useState, useEffect, useCallback, useRef } from 'react'
import { GroupData, CreateGroupRequest } from '@/app/api/groups/route'
import { UpdateGroupRequest } from '@/app/api/groups/[id]/route'

/**
 * Custom hook for managing user groups
 * Provides methods to fetch, create, update, and delete groups
 */
export function useGroups() {
  const [groups, setGroups] = useState<GroupData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasBeenFetched, setHasBeenFetched] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Fetches all groups for the current user
   */
  const fetchGroups = useCallback(async () => {
    try {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      abortControllerRef.current = new AbortController()
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/groups', {
        method: 'GET',
        credentials: 'include',
        signal: abortControllerRef.current.signal
      })

      const data = await response.json()

      if (!response.ok) {
        // Detailed logging for development only
        if (process.env.NODE_ENV === 'development') {
          console.error('Groups API error:', {
            status: response.status,
            statusText: response.statusText,
            data
          })
        }

        // Handle common errors
        if (response.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        
        throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      setGroups(data.groups || [])
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      
      // Log only in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error fetching groups:', err)
      }
    } finally {
      setIsLoading(false)
      setHasBeenFetched(true)
    }
  }, [])

  /**
   * Creates a new group
   */
  const createGroup = useCallback(async (groupData: CreateGroupRequest): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(groupData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la création du groupe')
      }

      // Add the new group to the list
      setGroups(prev => [...prev, data.group])
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Error creating group:', err)
      return false
    }
  }, [])

  /**
   * Updates an existing group
   */
  const updateGroup = useCallback(async (groupId: string, updates: UpdateGroupRequest): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(updates)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du groupe')
      }

      // Update the group in the list
      setGroups(prev => 
        prev.map(group => 
          group.id === groupId ? { ...group, ...data.group } : group
        )
      )
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Error updating group:', err)
      return false
    }
  }, [])

  /**
   * Deletes a group (only by creator)
   */
  const deleteGroup = useCallback(async (groupId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la suppression du groupe')
      }

      // Remove the group from the list
      setGroups(prev => prev.filter(group => group.id !== groupId))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Error deleting group:', err)
      return false
    }
  }, [])

  /**
   * Joins a group
   */
  const joinGroup = useCallback(async (groupId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'adhésion au groupe')
      }

      // Refresh groups to get updated membership info
      await fetchGroups()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Error joining group:', err)
      return false
    }
  }, [fetchGroups])

  /**
   * Leaves a group
   */
  const leaveGroup = useCallback(async (groupId: string): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la sortie du groupe')
      }

      // Remove the group from the list
      setGroups(prev => prev.filter(group => group.id !== groupId))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Error leaving group:', err)
      return false
    }
  }, [])

  // Fetch groups on component mount
  useEffect(() => {
    fetchGroups()
    
    // Cleanup: abort any pending request on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchGroups])

  return {
    groups,
    isLoading,
    error,
    hasBeenFetched,
    fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    joinGroup,
    leaveGroup,
    // Helpers
    hasGroup: groups.length > 0,
    currentGroup: groups.length > 0 ? groups[0] : null,
    isCreator: groups.length > 0 ? groups[0].is_creator : false
  }
}