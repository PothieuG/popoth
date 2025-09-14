import { useState, useCallback, useRef } from 'react'
import { GroupContributionData, GroupContributionsResponse } from '@/app/api/groups/contributions/route'

/**
 * Hook personnalisé pour gérer les contributions de groupe
 * Fournit des méthodes pour récupérer et recalculer les contributions proportionnelles
 */
export function useGroupContributions() {
  const [contributions, setContributions] = useState<GroupContributionData[]>([])
  const [groupInfo, setGroupInfo] = useState<GroupContributionsResponse['group_info'] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Récupère les contributions du groupe de l'utilisateur
   */
  const fetchContributions = useCallback(async () => {
    try {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      abortControllerRef.current = new AbortController()
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/groups/contributions', {
        method: 'GET',
        credentials: 'include',
        signal: abortControllerRef.current.signal
      })

      const data = await response.json()

      if (!response.ok) {
        // Log détaillé uniquement pour le développement
        if (process.env.NODE_ENV === 'development') {
          console.error('Erreur API contributions:', {
            status: response.status,
            statusText: response.statusText,
            data
          })
        }

        // Gestion spécifique des erreurs communes
        if (response.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        } else if (response.status === 400 && data.error?.includes('aucun groupe')) {
          // Pas d'erreur si l'utilisateur n'a pas de groupe
          setContributions([])
          setGroupInfo(null)
          return
        }
        
        throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      const contributionsResponse = data as GroupContributionsResponse
      setContributions(contributionsResponse.contributions || [])
      setGroupInfo(contributionsResponse.group_info || null)
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      
      // Log uniquement en développement
      if (process.env.NODE_ENV === 'development') {
        console.error('Erreur lors de la récupération des contributions:', err)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Déclenche un recalcul manuel des contributions
   */
  const recalculateContributions = useCallback(async (): Promise<boolean> => {
    try {
      setIsRecalculating(true)
      setError(null)

      const response = await fetch('/api/groups/contributions', {
        method: 'POST',
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du recalcul des contributions')
      }

      // Rafraîchir les données après le recalcul
      await fetchContributions()
      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      
      if (process.env.NODE_ENV === 'development') {
        console.error('Erreur lors du recalcul des contributions:', err)
      }
      return false
    } finally {
      setIsRecalculating(false)
    }
  }, [fetchContributions])

  /**
   * Trouve la contribution de l'utilisateur actuel dans la liste
   */
  const getUserContribution = useCallback((userId: string): GroupContributionData | null => {
    return contributions.find(contrib => contrib.profile_id === userId) || null
  }, [contributions])

  /**
   * Calcule les statistiques du groupe
   */
  const getGroupStats = useCallback(() => {
    if (!groupInfo || contributions.length === 0) {
      return {
        averageContribution: 0,
        highestContribution: 0,
        lowestContribution: 0,
        memberCount: 0
      }
    }

    const amounts = contributions.map(c => c.contribution_amount)
    return {
      averageContribution: amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length,
      highestContribution: Math.max(...amounts),
      lowestContribution: Math.min(...amounts),
      memberCount: contributions.length
    }
  }, [contributions, groupInfo])

  /**
   * Réinitialise l'état des contributions
   */
  const resetContributions = useCallback(() => {
    setContributions([])
    setGroupInfo(null)
    setError(null)
    setIsLoading(false)
    setIsRecalculating(false)
    
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  // Cleanup: abort any pending request on unmount
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  return {
    // Data
    contributions,
    groupInfo,
    
    // Loading states
    isLoading,
    error,
    isRecalculating,
    
    // Methods
    fetchContributions,
    recalculateContributions,
    getUserContribution,
    getGroupStats,
    resetContributions,
    cleanup,
    
    // Computed values
    hasContributions: contributions.length > 0,
    hasGroup: groupInfo !== null,
    totalMembers: contributions.length,
    isOperationInProgress: isLoading || isRecalculating
  }
}