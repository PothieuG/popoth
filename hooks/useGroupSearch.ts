import { useState, useCallback, useRef } from 'react'
import { SearchableGroup } from '@/app/api/groups/search/route'

/**
 * Custom hook for searching and discovering groups
 */
export function useGroupSearch() {
  const [searchResults, setSearchResults] = useState<SearchableGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState<string>('')
  const [hasSearched, setHasSearched] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Searches for groups based on a query
   */
  const searchGroups = useCallback(async (query: string = '', limit: number = 20) => {
    try {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      abortControllerRef.current = new AbortController()
      setIsLoading(true)
      setError(null)
      setLastQuery(query)

      const searchParams = new URLSearchParams()
      if (query.trim()) {
        searchParams.append('q', query.trim())
      }
      searchParams.append('limit', limit.toString())

      const response = await fetch(`/api/groups/search?${searchParams.toString()}`, {
        method: 'GET',
        credentials: 'include',
        signal: abortControllerRef.current.signal
      })

      const data = await response.json()

      if (!response.ok) {
        // Detailed logging for development only
        if (process.env.NODE_ENV === 'development') {
          console.error('Group search API error:', {
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

      setSearchResults(data.groups || [])
      setHasSearched(true)
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      
      // Log only in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error searching groups:', err)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Loads all available groups (empty search)
   */
  const loadAllGroups = useCallback(async (limit: number = 20) => {
    return searchGroups('', limit)
  }, [searchGroups])

  /**
   * Clears search results and resets state
   */
  const clearSearch = useCallback(() => {
    setSearchResults([])
    setError(null)
    setLastQuery('')
    setHasSearched(false)
    
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  /**
   * Updates a group's membership status in search results
   * Useful after joining/leaving a group
   */
  const updateGroupMembership = useCallback((groupId: string, isMember: boolean) => {
    setSearchResults(prev => 
      prev.map(group => 
        group.id === groupId 
          ? { ...group, is_member: isMember, member_count: group.member_count + (isMember ? 1 : -1) }
          : group
      )
    )
  }, [])

  /**
   * Removes a group from search results
   * Useful when a group is deleted
   */
  const removeGroupFromResults = useCallback((groupId: string) => {
    setSearchResults(prev => prev.filter(group => group.id !== groupId))
  }, [])

  return {
    searchResults,
    isLoading,
    error,
    lastQuery,
    hasSearched,
    searchGroups,
    loadAllGroups,
    clearSearch,
    updateGroupMembership,
    removeGroupFromResults,
    // Helpers
    hasResults: searchResults.length > 0,
    availableGroups: searchResults.filter(group => !group.is_member),
    currentMemberGroup: searchResults.find(group => group.is_member) || null
  }
}